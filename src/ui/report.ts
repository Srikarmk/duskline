/**
 * Crash reporting.
 *
 * Launching blind means never learning what broke. There are two places an
 * engine failure surfaces — `GameErrorBoundary.componentDidCatch` for
 * render-phase errors and the window `error` listener in `GameCanvas` for the
 * ones thrown inside requestAnimationFrame — and until now both only wrote to
 * a console nobody but the player can see.
 *
 * WHY NOT THE SENTRY SDK: `@sentry/nextjs` is ~90 kB gzipped on the client.
 * The whole point of this game is that it loads and drives; spending that on
 * telemetry for a hobby racer is the wrong trade. Sentry's ingestion endpoint
 * is a documented HTTP API and a DSN is a public credential, so this posts the
 * envelope directly in about forty lines and adds no dependency and no bytes
 * when unconfigured.
 *
 * Set `NEXT_PUBLIC_SENTRY_DSN` to turn it on. With it unset everything below
 * short-circuits to a console line, which is exactly the behaviour before.
 */

const DSN = process.env.NEXT_PUBLIC_SENTRY_DSN ?? "";
const RELEASE = process.env.NEXT_PUBLIC_COMMIT_SHA ?? "dev";

export interface ReportContext {
  /** Where it came from: "boundary" | "raf" | anything else useful. */
  source: string;
  /** Realm/mode/car if a race was running. Never anything identifying. */
  tags?: Record<string, string | undefined>;
  extra?: Record<string, unknown>;
}

/**
 * A DSN is `https://<key>@<host>/<projectId>`. Parsed once; a malformed one
 * disables reporting rather than throwing on every error.
 */
function parseDsn(dsn: string): { url: string; key: string } | null {
  try {
    const u = new URL(dsn);
    const projectId = u.pathname.replace(/^\//, "");
    if (!u.username || !projectId) return null;
    return {
      url: `${u.protocol}//${u.host}/api/${projectId}/envelope/`,
      key: u.username,
    };
  } catch {
    return null;
  }
}

const target = DSN ? parseDsn(DSN) : null;

/**
 * An error thrown inside the render loop is thrown SIXTY TIMES A SECOND. A
 * reporter without a cap turns one bug into a self-inflicted flood — of the
 * quota, and of the player's uplink. Cap the session, and never send the same
 * message twice.
 */
const MAX_PER_SESSION = 8;
let sent = 0;
const seen = new Set<string>();

function eventId(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
}

/**
 * Log an error, and ship it if a DSN is configured.
 *
 * Always returns void and never throws: a failure in the reporter must never
 * become a second failure on top of the one it is reporting.
 */
export function reportError(err: unknown, ctx: ReportContext): void {
  const message = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error ? err.stack : undefined;

  // The console line is the part that always happens. It is what a developer
  // reads when someone pastes their console, DSN or no DSN.
  console.error(`[fantasy-racer] ${ctx.source}:`, err, ctx.extra ?? "");

  if (!target || typeof fetch === "undefined") return;
  const key = `${ctx.source}:${message}`;
  if (seen.has(key) || sent >= MAX_PER_SESSION) return;
  seen.add(key);
  sent++;

  const id = eventId();
  const now = Date.now() / 1000;
  const header = JSON.stringify({ event_id: id, sent_at: new Date().toISOString() });
  const item = JSON.stringify({ type: "event" });
  const payload = JSON.stringify({
    event_id: id,
    timestamp: now,
    platform: "javascript",
    level: "error",
    release: RELEASE,
    environment: process.env.NODE_ENV,
    logger: "fantasy-racer",
    // No stack-frame parsing: the raw stack in `extra` is legible in the
    // Sentry UI and saves shipping a parser to every visitor.
    exception: {
      values: [{ type: err instanceof Error ? err.name : "Error", value: message }],
    },
    tags: { source: ctx.source, ...ctx.tags },
    extra: { stack, ...ctx.extra },
    request: { url: typeof location !== "undefined" ? location.href : undefined },
  });

  void fetch(`${target.url}?sentry_key=${target.key}&sentry_version=7`, {
    method: "POST",
    body: `${header}\n${item}\n${payload}`,
    // text/plain avoids a CORS preflight; Sentry's ingest accepts it.
    headers: { "Content-Type": "text/plain;charset=UTF-8" },
    keepalive: true,       // the tab may be closing right behind the crash
    mode: "cors",
  }).catch(() => {
    // Reporting the failure of the reporter is not a thing worth doing.
  });
}

/** True when errors are actually going somewhere. Shown in the pause menu. */
export const reportingEnabled = Boolean(target);
