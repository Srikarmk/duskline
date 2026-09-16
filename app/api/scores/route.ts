import { NextRequest, NextResponse } from "next/server";
import { rateLimit, tooManyRequests } from "@/src/server/rateLimit";
import type { GameMode } from "@/src/game/engine";

export const dynamic = "force-dynamic";

interface Entry {
  name: string;
  score: number;
  mode: GameMode;
  timeMs: number;
  date: string;
}

const KEY = "dl:scores:v1";
const MAX = 20;
// Every mode that can reach this endpoint. "spacewars" and "endless" were
// missing, so scores from them were silently relabelled "classic" — the board
// was attributing Neon Run distances to circuit races.
const VALID_MODES = new Set<GameMode>([
  "classic", "transform", "grandprix", "spacewars", "endless",
]);

// Works with a Vercel KV / Upstash Redis store when its env vars are present;
// otherwise falls back to per-instance memory so the app never breaks.
const KV_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const hasKV = Boolean(KV_URL && KV_TOKEN);

const memory: { member: string; score: number }[] = [];

async function kv(cmd: (string | number)[]): Promise<unknown> {
  const res = await fetch(KV_URL as string, {
    method: "POST",
    headers: { Authorization: `Bearer ${KV_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(cmd),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`kv ${res.status}`);
  const json = (await res.json()) as { result: unknown };
  return json.result;
}

async function topEntries(): Promise<Entry[]> {
  if (hasKV) {
    const flat = (await kv(["ZREVRANGE", KEY, "0", String(MAX - 1), "WITHSCORES"])) as string[];
    const out: Entry[] = [];
    for (let i = 0; i < flat.length; i += 2) {
      try {
        out.push(JSON.parse(flat[i]) as Entry);
      } catch {
        // skip malformed
      }
    }
    return out;
  }
  return [...memory]
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX)
    .map((m) => JSON.parse(m.member) as Entry);
}

async function addEntry(e: Entry): Promise<void> {
  const member = JSON.stringify(e);
  if (hasKV) {
    await kv(["ZADD", KEY, String(e.score), member]);
    await kv(["ZREMRANGEBYRANK", KEY, "0", String(-(MAX + 1))]);
  } else {
    memory.push({ member, score: e.score });
  }
}

export async function GET() {
  try {
    const scores = await topEntries();
    return NextResponse.json({ scores, global: hasKV });
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
    await addEntry({ name, score, mode, timeMs, date: new Date().toISOString().slice(0, 10) });
    const scores = await topEntries();
    return NextResponse.json({ scores, global: hasKV });
  } catch {
    return NextResponse.json({ error: "server" }, { status: 500 });
  }
}
