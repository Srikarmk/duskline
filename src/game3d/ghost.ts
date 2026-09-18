import { read, write } from "@/src/ui/storage";

/**
 * Your best lap, driving beside you.
 *
 * A solo lap has nothing to measure itself against — the AI is rubber-banded,
 * so beating it says more about the band than about you. A ghost turns every
 * lap into a race you can actually lose, against the only opponent whose pace
 * is exactly worth beating, and it does it without a single new asset.
 *
 * Stored in track-space — (distance along the lap, lateral offset, heading) —
 * not world XYZ. That is the coordinate system the whole game already thinks
 * in, and it means a ghost survives anything that moves the road in world
 * space: re-tuned elevation, a different bank, a wider ribbon. A world-space
 * recording would have to be thrown away every time the track art changed.
 *
 * SAMPLED BY DISTANCE, NOT BY TIME. A time-sampled ghost has to be searched or
 * interpolated to answer "where was I at this point on the track", which is the
 * only question the replay ever asks. Distance-indexed, the lookup is an array
 * index. It also makes the file a fixed size regardless of how slow the lap
 * was, and makes "am I ahead or behind?" a subtraction rather than a search.
 */

/** Metres between samples. 4 m at ~45 m/s is ~11 Hz — smooth enough to
 *  interpolate, small enough that a 4 km lap is 1000 samples. */
const STEP_M = 4;

export interface GhostLap {
  /** Track length when recorded, so a re-tuned circuit invalidates the ghost. */
  trackLength: number;
  realm: string;
  car: string;
  timeMs: number;
  /** Seconds elapsed at each sample index (index i = i * STEP_M metres). */
  t: number[];
  /** Lateral offset in metres at each sample. */
  lat: number[];
  /** Heading in radians at each sample. */
  yaw: number[];
}

function key(realm: string): string {
  return `ghost-${realm}`;
}

/**
 * Records one lap as it is driven.
 *
 * Samples are laid down at fixed distance boundaries, so a lap driven at any
 * speed produces the same array shape. Distance is fed in monotonically by the
 * caller; going backwards (a spin, a reset) simply stops adding samples until
 * the car is past its high-water mark again, which is what keeps a messy lap
 * from writing garbage over a clean one.
 */
export class GhostRecorder {
  private readonly t: number[] = [];
  private readonly lat: number[] = [];
  private readonly yaw: number[] = [];
  private next = 0;          // the distance boundary we are waiting to cross
  private elapsed = 0;

  constructor(private readonly trackLength: number) {}

  reset(): void {
    this.t.length = 0;
    this.lat.length = 0;
    this.yaw.length = 0;
    this.next = 0;
    this.elapsed = 0;
  }

  /** @param lapDist 0..trackLength, distance into the current lap. */
  sample(dt: number, lapDist: number, lateral: number, heading: number): void {
    this.elapsed += dt;
    // Fill every boundary the car has passed since the last call — at 195 km/h
    // a 16 ms frame covers 0.9 m, but a hitch could skip several.
    while (lapDist >= this.next && this.next <= this.trackLength) {
      this.t.push(this.elapsed);
      this.lat.push(lateral);
      this.yaw.push(heading);
      this.next += STEP_M;
    }
  }

  /**
   * The lap just completed, or null if it was too short to be real.
   *
   * Rounded on the way out. A 4 km lap is ~970 samples and a raw double
   * serialises as twenty characters of JSON ("0.016666666666666666"), which
   * measured 56 KB per realm — twelve realms would be an eighth of the whole
   * localStorage quota for precision no one can see. A millisecond of time, a
   * centimetre of lateral and a thousandth of a radian (0.06°) are all well
   * below what a 4 m sample spacing can resolve anyway.
   */
  finish(realm: string, car: string): GhostLap | null {
    if (this.t.length < 8) return null;
    const r = (v: number, dp: number) => Math.round(v * dp) / dp;
    return {
      trackLength: Math.round(this.trackLength * 100) / 100,
      realm,
      car,
      timeMs: Math.round(this.elapsed * 1000),
      t: this.t.map((v) => r(v, 1e3)),
      lat: this.lat.map((v) => r(v, 1e2)),
      yaw: this.yaw.map((v) => r(v, 1e3)),
    };
  }
}

export function loadGhost(realm: string, trackLength: number): GhostLap | null {
  const raw = read(key(realm));
  if (!raw) return null;
  try {
    const g = JSON.parse(raw) as GhostLap;
    if (!Array.isArray(g.t) || !Array.isArray(g.lat) || g.t.length < 8) return null;
    // A circuit whose length has changed is a different circuit. Better to lose
    // the ghost than to replay it against a road that is no longer there.
    if (Math.abs(g.trackLength - trackLength) > 1) return null;
    return g;
  } catch {
    return null;
  }
}

/** Keep the new lap only if it beats the stored one. */
export function saveGhostIfBest(realm: string, lap: GhostLap): boolean {
  const existing = loadGhost(realm, lap.trackLength);
  if (existing && existing.timeMs <= lap.timeMs) return false;
  try {
    write(key(realm), JSON.stringify(lap));
    return true;
  } catch {
    return false;   // storage full or blocked; the race still counts
  }
}

/**
 * Where the ghost was at a given time into its lap.
 *
 * Walks forward from the last index rather than searching, because playback is
 * monotonic — the cursor only ever advances. Returns null once the ghost has
 * finished its lap, which is the cue to hide it.
 */
export class GhostPlayer {
  private i = 0;

  constructor(private readonly lap: GhostLap) {}

  reset(): void {
    this.i = 0;
  }

  get timeMs(): number {
    return this.lap.timeMs;
  }

  /**
   * How long the best lap took to reach a given distance.
   *
   * This is the whole payoff of indexing by distance instead of by time: the
   * one question a delta readout asks — "how long did I take to get here, and
   * how long did my best lap take?" — is an array lookup rather than a search.
   *
   * The obvious alternative, dividing the metres between you and the ghost by
   * your current speed, is wrong in exactly the moment you care about it: brake
   * for a corner and the divisor collapses, so a 36 m gap reads as 4.5 seconds
   * down when it is 0.8. Measured that way while coasting, it did.
   *
   * @returns seconds, clamped to the ends of the recording.
   */
  timeAt(dist: number): number {
    const t = this.lap.t;
    const f = dist / STEP_M;
    if (f <= 0) return t[0];
    if (f >= t.length - 1) return t[t.length - 1];
    const i = Math.floor(f);
    return t[i] + (t[i + 1] - t[i]) * (f - i);
  }

  /** @returns distance/lateral/heading, or null when the lap is over. */
  at(elapsed: number): { dist: number; lateral: number; yaw: number } | null {
    const t = this.lap.t;
    if (elapsed >= t[t.length - 1]) return null;
    while (this.i < t.length - 2 && t[this.i + 1] <= elapsed) this.i++;
    const a = this.i, b = this.i + 1;
    const span = t[b] - t[a];
    const f = span > 1e-4 ? (elapsed - t[a]) / span : 0;
    // Heading is an angle: lerping 350° to 10° the naive way spins the car all
    // the way round the wrong side.
    let dy = this.lap.yaw[b] - this.lap.yaw[a];
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    return {
      dist: (a + f) * STEP_M,
      lateral: this.lap.lat[a] + (this.lap.lat[b] - this.lap.lat[a]) * f,
      yaw: this.lap.yaw[a] + dy * f,
    };
  }
}
