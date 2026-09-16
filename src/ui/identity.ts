/**
 * Who the player is.
 *
 * Two routes in: Google, or guest. Guest is the default and always works —
 * nobody should have to authenticate to drive a car in a browser. Google only
 * buys you a name and avatar that follow you between devices, so it is offered
 * and never required.
 *
 * Google here is Google Identity Services, which needs only a PUBLIC client
 * id (`NEXT_PUBLIC_GOOGLE_CLIENT_ID`) — no secret, no server callback, no
 * session store. That is the right trade for this: a full OAuth server flow
 * would mean secrets, a database of users and a token lifecycle, for a
 * leaderboard name. The id token is decoded client-side for the display name
 * only; it is never trusted as an authorisation of anything.
 */

import { read, write, remove } from "./storage";

export type IdentityKind = "guest" | "google";

export interface Identity {
  kind: IdentityKind;
  /** What goes on the board. */
  name: string;
  /** Google's `sub`, or a locally-generated id for guests. Stable per device. */
  id: string;
  picture?: string;
}

const KEY = "identity";

export function loadIdentity(): Identity | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = read(KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Identity;
    return v && typeof v.name === "string" ? v : null;
  } catch {
    return null;
  }
}

export function saveIdentity(id: Identity | null): void {
  if (typeof window === "undefined") return;
  try {
    if (id) write(KEY, JSON.stringify(id));
    else remove(KEY);
  } catch {
    // storage blocked — the session still works, it just will not persist
  }
}

/**
 * Claim the next guest number from the shared counter.
 *
 * Falls back to a local id when no KV store is configured, because a
 * per-instance counter on serverless would hand the same "RACER 7" to
 * different people — a number that is not actually a sequence is worse than
 * an obviously local one.
 */
export async function createGuest(): Promise<Identity> {
  try {
    const res = await fetch("/api/guest", { method: "POST" });
    if (res.ok) {
      const j = (await res.json()) as { shared: boolean; number?: number };
      if (j.shared && typeof j.number === "number") {
        return { kind: "guest", name: `RACER ${j.number}`, id: `g:${j.number}` };
      }
    }
  } catch {
    // offline or unconfigured — fall through
  }
  const local = Math.floor(1000 + Math.random() * 9000);
  return { kind: "guest", name: `RACER ${local}`, id: `l:${local}` };
}

export const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? "";
export const googleConfigured = GOOGLE_CLIENT_ID.length > 0;

/** Decode the display fields out of a Google id token. Presentation only. */
function decodeIdToken(jwt: string): { name?: string; picture?: string; sub?: string } {
  try {
    const payload = jwt.split(".")[1];
    const binary = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    // atob gives bytes-as-latin1. A name with any non-ASCII character in it —
    // which is most of the world — needs those bytes decoded as UTF-8.
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return {};
  }
}

type GsiWindow = Window & {
  google?: {
    accounts: {
      id: {
        initialize(o: { client_id: string; callback: (r: { credential: string }) => void }): void;
        prompt(): void;
      };
    };
  };
};

let gsiLoading: Promise<void> | null = null;
function loadGsi(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if ((window as GsiWindow).google?.accounts?.id) return Promise.resolve();
  gsiLoading ??= new Promise<void>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client";
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Could not reach Google sign-in"));
    document.head.appendChild(s);
  });
  return gsiLoading;
}

/** Opens Google's own prompt. Resolves null if the player dismisses it. */
export async function signInWithGoogle(): Promise<Identity | null> {
  if (!googleConfigured) {
    throw new Error("Google sign-in is not configured for this deployment.");
  }
  await loadGsi();
  const g = (window as GsiWindow).google;
  if (!g) throw new Error("Google sign-in failed to load.");
  return new Promise<Identity | null>((resolve) => {
    let settled = false;
    g.accounts.id.initialize({
      client_id: GOOGLE_CLIENT_ID,
      callback: (r) => {
        settled = true;
        const p = decodeIdToken(r.credential);
        resolve({
          kind: "google",
          name: (p.name ?? "PLAYER").slice(0, 14).toUpperCase(),
          id: p.sub ?? "google",
          picture: p.picture,
        });
      },
    });
    g.accounts.id.prompt();
    // The prompt can be dismissed without any callback firing, and a promise
    // that never settles would wedge the button forever.
    window.setTimeout(() => { if (!settled) resolve(null); }, 60_000);
  });
}
