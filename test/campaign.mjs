/**
 * The campaign's data and scoring, in plain Node.
 *
 * The campaign is pure data plus a judge, and both fail silently: an event
 * pointing at a realm id that was renamed builds the wrong world, a chapter
 * that needs more stars than exist before it can never be opened, and a goal
 * the judge reads wrongly hands out stars (or never does). None of that
 * breaks the types or the build.
 *
 * Run: npm run test:campaign
 */
import { REALMS } from "../src/game3d/realms.ts";
import {
  CHAPTERS, EVENTS, TOTAL_STARS, evaluate, maskOf, starsIn, totalStars, chapterOpen, nextEvent, goalLabel,
} from "../src/ui/campaignData.ts";

const failures = [];
const check = (ok, what) => { console.log(`  ${ok ? "ok  " : "FAIL"}  ${what}`); if (!ok) failures.push(what); };

// --- data -------------------------------------------------------------------
const ids = EVENTS.map((e) => e.id);
check(new Set(ids).size === ids.length, `event ids are unique (${ids.length} events)`);
for (const e of EVENTS) {
  check(Boolean(REALMS[e.realm]), `${e.id}: realm "${e.realm}" exists`);
  check(e.goals.length === 3 && e.goals.every((g) => goalLabel(g).length > 0), `${e.id}: three labelled goals`);
  if (e.mode === "classic") {
    check(Number.isInteger(e.laps) && e.laps >= 1 && e.laps <= 7, `${e.id}: 1-7 laps`);
    check(!e.goals.some((g) => g.kind === "reach" || g.kind === "time"), `${e.id}: no distance/time goal on a circuit`);
  } else {
    check(e.targetKm > 0, `${e.id}: a Neon Run event has a target distance`);
    check(!e.goals.some((g) => g.kind === "place"), `${e.id}: no placing goal on a solo run`);
  }
  for (const g of e.goals) {
    if (g.kind === "gems") check(g.share > 0 && g.share < 1, `${e.id}: gem share is a fraction (${g.share})`);
  }
}
let available = 0;
CHAPTERS.forEach((c, i) => {
  if (i > 0) check(c.needStars > CHAPTERS[i - 1].needStars, `${c.id}: opens later than the chapter before it`);
  check(c.needStars <= available, `${c.id}: needs ${c.needStars}★, ${available}★ exist before it`);
  available += c.events.length * 3;
});
check(TOTAL_STARS === available, `${TOTAL_STARS} stars in all`);

// --- judging ----------------------------------------------------------------
const race = (o) => ({ mode: "classic", score: 0, gems: 0, stunts: 0, laneBonuses: 0, penalties: 0, timeMs: 200000, ...o });
const first = EVENTS[0];          // place 5, gems 25%, win
check(evaluate(first, race({ position: 1, gems: 30, gemsOffered: 100 })).join() === "true,true,true", "a win with 30% gems takes all three");
check(evaluate(first, race({ position: 4, gems: 10, gemsOffered: 100 })).join() === "true,false,false", "4th with 10% gems takes one");
check(evaluate(first, race({ position: 1, gems: 50, gemsOffered: 0 }))[1] === false, "no gems on offer is never a gem star");
check(evaluate(first, race({}))[0] === false, "no position (a retirement) is not a finish");
const fin = EVENTS.find((e) => e.mode === "endless");
check(evaluate(fin, race({ distanceM: 6000, timeMs: 150000 }))[2] === true, "the finale's clock star at 6 km in 2:30");
check(evaluate(fin, race({ distanceM: 2000, timeMs: 60000 }))[2] === false, "a fast clock without the distance is not the clock star");

// --- the record ----------------------------------------------------------------
check(maskOf([true, false, true]) === 0b101 && starsIn(0b101) === 2, "bitmask round-trips");
check(chapterOpen(CHAPTERS[0], {}) && !chapterOpen(CHAPTERS[1], {}), "a fresh campaign opens chapter one only");
const six = Object.fromEntries(CHAPTERS[0].events.slice(0, 2).map((e) => [e.id, 7]));
check(totalStars(six) === 6 && chapterOpen(CHAPTERS[1], six), "six stars open the second chapter");
check(nextEvent({})?.id === EVENTS[0].id, "the first thing to play is the first event");
check(nextEvent({ [EVENTS[0].id]: 7 }, EVENTS[0].id)?.id === EVENTS[1].id, "after a three-star event, the next one with stars left");

console.log("");
if (failures.length) {
  console.error(`✗ ${failures.length} failed:`);
  for (const f of failures) console.error(`   - ${f}`);
  process.exit(1);
}
console.log(`✓ campaign holds (${EVENTS.length} events, ${CHAPTERS.length} chapters, ${TOTAL_STARS} stars)`);
