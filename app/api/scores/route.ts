import { NextRequest, NextResponse } from "next/server";
import { rateLimit, tooManyRequests } from "@/src/server/rateLimit";
import { verifyRaceToken, spendRaceToken, tokenEnforced } from "@/src/server/raceToken";
import { addScore, storeShared, topScores, type ScoreEntry } from "@/src/server/store";
import type { GameMode } from "@/src/game/engine";

export const dynamic = "force-dynamic";

type Entry = ScoreEntry;

const MAX = 20;
/** what the store keeps beyond the 20 shown — room for "where would I rank" */
const KEEP = 1000;
// Every mode that can reach this endpoint. "spacewars" and "endless" were
// missing, so scores from them were silently relabelled "classic" — the board
// was attributing Neon Run distances to circuit races.
const VALID_MODES = new Set<GameMode>([
  "classic", "transform", "grandprix", "spacewars", "endless",
]);

// Works with the shared store (Supabase or Upstash — see src/server/store.ts)
// when one is configured; otherwise falls back to per-instance memory so the
// app never breaks.
const memory: Entry[] = [];

async function topEntries(): Promise<Entry[]> {
  if (storeShared) return topScores(MAX);
  return [...memory].sort((a, b) => b.score - a.score).slice(0, MAX);
}

async function addEntry(e: Entry): Promise<void> {
  if (storeShared) await addScore(e, KEEP);
  else memory.push(e);
}

export async function GET() {
  try {
    const scores = await topEntries();
    return NextResponse.json({ scores, global: storeShared });
  } catch {
    return NextResponse.json({ scores: [], global: false });
  }
}

export async function POST(req: NextRequest) {
  // 10 a minute. A real player posts one score every few minutes at most, so
  // this is invisible to them and closes the "flood the board" case.
  const limit = await rateLimit(req, "scores", 10, 60);
  if (!limit.ok) return tooManyRequests(limit.retryAfter);
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const name =
      String(body.name ?? "")
        .trim()
        .replace(/[^\x20-\x7E]/g, "")
        .slice(0, 14) || "ANON";
    const score = Math.round(Number(body.score));
    if (!Number.isFinite(score) || score < 0 || score > 10_000_000) {
      return NextResponse.json({ error: "bad score" }, { status: 400 });
    }
    const mode = VALID_MODES.has(body.mode as GameMode) ? (body.mode as GameMode) : "classic";
    const timeMs = Math.max(0, Math.round(Number(body.timeMs) || 0));
    // Cheap plausibility gate. The client computes the score and would POST
    // whatever it liked, and running the sim server-side is not worth it for
    // this — but a result claiming a huge score in a couple of seconds is not a
    // borderline call, and rejecting it costs nothing.
    if (timeMs > 0 && timeMs < 8_000 && score > 5_000) {
      return NextResponse.json({ error: "implausible" }, { status: 400 });
    }
    if (timeMs > 6 * 60 * 60 * 1000) {
      return NextResponse.json({ error: "bad time" }, { status: 400 });
    }
    // The ticket proves a race was actually started, and that enough of the
    // claimed duration has really elapsed since. It does NOT make the score
    // itself trustworthy — the client computes that — so the response reports
    // `verified` rather than leaving anyone to assume more than is true.
    const ticket = verifyRaceToken(body.token, timeMs);
    if (!ticket.ok) {
      return NextResponse.json({ error: ticket.reason ?? "unverified" }, { status: 403 });
    }
    // One ticket, one score. A ticket is valid for three hours, so without
    // this a single race buys an afternoon of submissions.
    if (!(await spendRaceToken(ticket.nonce))) {
      return NextResponse.json({ error: "token already used" }, { status: 403 });
    }
    await addEntry({ name, score, mode, timeMs, date: new Date().toISOString().slice(0, 10) });
    const scores = await topEntries();
    return NextResponse.json({ scores, global: storeShared, verified: tokenEnforced });
  } catch {
    return NextResponse.json({ error: "server" }, { status: 500 });
  }
}
