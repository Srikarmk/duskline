/**
 * Cross-device profile merge (AUDIT 21).
 *
 * This is here because the feature it guards CANNOT be exercised by hand on
 * this deployment — settings sync needs a Google client id and a KV store, and
 * neither is configured — and because its failure mode is silent. A merge that
 * drops a counter does not throw; it hands the player a smaller career than
 * the one they drove, on whichever machine they happened to open second, and
 * nothing anywhere says so.
 *
 * So the rule the merge exists to keep gets asserted directly: NOTHING
 * MONOTONIC EVER GOES DOWN. Everything else here is a case that came out of
 * writing it — the empty remote, the parallel-play case, the finished season
 * that must not be resurrected, and the one-time seeding flag that must never
 * be cleared.
 *
 * Run: npm run test:sync   (Node 22+, --experimental-strip-types)
 *
 * profileMerge.ts imports only TYPES, which strip-types erases — that is why
 * this can import the real module rather than a copy of it. Importing sync.ts
 * instead would drag localStorage and fetch in.
 */
import { mergeProfiles } from "../src/ui/profileMerge.ts";

const failures = [];
const check = (ok, what) => {
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${what}`);
  if (!ok) failures.push(what);
};

const career = (races, podiums, wins, metres, bestScore, seeded) => ({
  races, podiums, wins, metres, bestScore, ...(seeded === undefined ? {} : { seeded }),
});

const profile = (c, updated, season = null, settings = {}) => ({
  settings, career: c, season, updated,
});

console.log("\nprofile merge\n");

// --- an empty account -------------------------------------------------------
{
  const local = profile(career(5, 2, 1, 4000, 900), 1000);
  const out = mergeProfiles(null, local);
  check(out === local, "no remote profile returns the local one untouched");
}

// --- the case the whole design exists for ----------------------------------
// Laptop and phone each drove races the other never saw. A whole-document
// last-write-wins would keep one set and silently bin the other.
{
  const remote = profile(career(10, 4, 2, 9000, 1500), 2000);   // the laptop, synced later
  const local = profile(career(7, 1, 3, 12000, 1200), 1000);    // the phone, stale clock
  const out = mergeProfiles(remote, local);
  check(out.career.races === 10, "races takes the higher of the two (10)");
  check(out.career.podiums === 4, "podiums takes the higher of the two (4)");
  check(out.career.wins === 3, "wins takes the higher — from the OLDER document");
  check(out.career.metres === 12000, "metres takes the higher — from the OLDER document");
  check(out.career.bestScore === 1500, "best score takes the higher (1500)");
  check(out.updated === 2000, "updated carries the newer timestamp");
}

// --- the invariant, stated directly ----------------------------------------
{
  const keys = ["races", "podiums", "wins", "metres", "bestScore"];
  let ok = true;
  // Every ordering of a spread of values, in both timestamp directions.
  const vals = [0, 1, 7, 12, 4000, 99999];
  for (const a of vals) {
    for (const b of vals) {
      for (const [ra, la] of [[2000, 1000], [1000, 2000]]) {
        const out = mergeProfiles(
          profile(career(a, a, a, a, a), ra),
          profile(career(b, b, b, b, b), la),
        );
        for (const k of keys) {
          if (out.career[k] < a || out.career[k] < b) ok = false;
        }
      }
    }
  }
  check(ok, "no monotonic counter is ever lower than either input (72 pairs)");
}

// --- the seeding flag -------------------------------------------------------
// seedFromHistory back-credits races played before careers existed and must
// run exactly once, ever. Clearing the flag in a merge would re-credit them.
{
  const withSeed = profile(career(3, 0, 0, 0, 0, true), 1000);
  const without = profile(career(9, 0, 0, 0, 0), 5000);
  check(mergeProfiles(withSeed, without).career.seeded === true,
    "seeded survives when only the REMOTE has it, even though local is newer");
  check(mergeProfiles(without, withSeed).career.seeded === true,
    "seeded survives when only the LOCAL has it, even though remote is newer");
  check(mergeProfiles(without, profile(career(1, 0, 0, 0, 0), 1)).career.seeded === false,
    "seeded stays false when neither side has it");
}

// --- seasons ----------------------------------------------------------------
{
  const season = { round: 1, champ: { YOU: 10 }, totalScore: 500, totalTimeMs: 60000, gems: 3, stunts: 2 };

  // The player finished (or abandoned) the championship on the device that
  // wrote LAST. The other device still has it part-raced; bringing it back
  // would be a bug, not a rescue.
  check(mergeProfiles(profile(career(1, 0, 0, 0, 0), 1000, season),
                      profile(career(1, 0, 0, 0, 0), 2000, null)).season === null,
    "a season finished on the NEWER device is not resurrected by the older one");
  check(mergeProfiles(profile(career(1, 0, 0, 0, 0), 2000, null),
                      profile(career(1, 0, 0, 0, 0), 1000, season)).season === null,
    "...in either direction — newer-null wins whichever side it is on");

  // And the mirror: a season STARTED on the device that wrote last should
  // arrive on the one that has none.
  check(mergeProfiles(profile(career(1, 0, 0, 0, 0), 2000, season),
                      profile(career(1, 0, 0, 0, 0), 1000, null)).season === season,
    "a season started on the NEWER device is picked up by the older one");

  const a = { ...season, round: 1 };
  const b = { ...season, round: 2 };
  const out = mergeProfiles(profile(career(1, 0, 0, 0, 0), 3000, b), profile(career(1, 0, 0, 0, 0), 1000, a));
  check(out.season === b, "the newer season is taken WHOLE, not field-by-field");
}

// --- settings ---------------------------------------------------------------
{
  const remote = profile(career(1, 0, 0, 0, 0), 2000, null, { quality: "low", showFps: true });
  const local = profile(career(1, 0, 0, 0, 0), 1000, null, { quality: "high", musicVolume: 0.2 });
  const out = mergeProfiles(remote, local);
  check(out.settings.quality === "low", "the newer document wins a contested setting");
  check(out.settings.musicVolume === 0.2, "a setting only the older document has is kept");
  check(out.settings.showFps === true, "a setting only the newer document has is kept");
}

console.log("");
if (failures.length) {
  console.error(`✗ ${failures.length} failed:`);
  for (const f of failures) console.error(`   - ${f}`);
  process.exit(1);
}
console.log("✓ profile merge holds — no monotonic counter can go backwards\n");
