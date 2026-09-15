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
