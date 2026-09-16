/**
 * Holds the race ticket for the current run.
 *
 * Asked for when a race STARTS, not when it finishes — the whole value of the
 * ticket is that the server timestamps it at the beginning and can then check
 * that the claimed duration really elapsed. Requesting it at submission time
 * would prove nothing at all.
 *
 * In memory only, deliberately: a ticket in localStorage is a ticket someone
 * can bank and reuse, and it is worthless after the run anyway.
 */

let token: string | null = null;
let pending: Promise<void> | null = null;

/**
 * Call as a race begins. Never throws and never blocks the race.
 *
 * Keeps an UNSPENT ticket rather than replacing it, which matters for Grand
 * Prix: that submits one aggregate result covering three rounds, but each
 * round goes through here. Replacing the ticket each time would leave the
 * final submission claiming five minutes of racing against a ticket issued
 * ninety seconds ago, and the server would correctly reject it. The ticket is
 * cleared on submission instead, so a fresh single race always gets a new one.
 */
export function beginRace(): void {
  if (token || pending) return;
  pending = fetch("/api/race-token", { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : null))
    .then((j: { token?: string | null } | null) => {
      token = j?.token ?? null;
    })
    .catch(() => {
      // Offline or unreachable. Submission will be refused if the server is
      // enforcing, which is the right way round: no ticket, no post.
      token = null;
    })
    .finally(() => {
      pending = null;
    });
}

/** The ticket for this run, waiting for the request if it is still in flight. */
export async function raceToken(): Promise<string | null> {
  if (pending) await pending;
  return token;
}

/** Spent — the server allows one score per ticket, so drop ours after posting. */
export function clearRaceToken(): void {
  token = null;
}
