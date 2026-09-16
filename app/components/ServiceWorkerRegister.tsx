"use client";

import { useEffect } from "react";

/**
 * Registers the service worker in production only.
 *
 * Dev is excluded deliberately: a worker intercepting requests in front of
 * Next's dev server produces failures that look like code bugs and are not,
 * and HMR and the worker's cache disagree constantly.
 *
 * Registration failing is not an error worth showing anyone — it means no
 * offline support, and the game works fine without it.
 */
export default function ServiceWorkerRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;
    // Never on localhost, even from a production build.
    //
    // A service worker is scoped to an ORIGIN, not to a build. `next start` on
    // localhost:3000 installs one that cache-firsts /_next/static/** — and it
    // keeps serving those chunks to the DEV server on the same port
    // afterwards. The result is a dev server that silently serves pre-edit
    // code: methods you deleted are still there, guards you added do nothing,
    // and `rm -rf .next` plus a hard reload does not clear it. That cost most
    // of a debugging session once. Nothing about offline support is worth
    // testing on localhost anyway.
    if (/^(localhost|127\.0\.0\.1|\[::1\])$/.test(window.location.hostname)) return;
    // After load, so registration never competes with the first render for
    // bandwidth on the one thing that matters — getting the game on screen.
    const register = () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    };
    if (document.readyState === "complete") register();
    else {
      window.addEventListener("load", register);
      return () => window.removeEventListener("load", register);
    }
  }, []);

  return null;
}
