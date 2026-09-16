import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * Cache headers for everything in public/.
   *
   * Vercel serves `public/` with `cache-control: public, max-age=0,
   * must-revalidate`, which means the browser re-checks EVERY file on EVERY
   * visit: 18 textures and 12 preview images, each a conditional round trip
   * returning 304, on every single race. Measured at ~112 ms median each
   * before this. The hashed build output under /_next/static already gets a
   * year and `immutable`; this art was getting nothing.
   *
   * Not `immutable`, though, and not a year: these filenames are stable while
   * their CONTENT can change — regenerating the realm previews or re-running
   * the texture script rewrites them in place. A week of hard caching with a
   * month of stale-while-revalidate gets the round trips out of the way while
   * still picking up new art within a week, and the service worker refreshes
   * its copy in the background regardless.
   */
  async headers() {
    return [
      // One entry per directory rather than a single alternation pattern: the
      // matcher syntax is easy to get subtly wrong, and a header rule that
      // silently matches nothing looks exactly like a header rule that works.
      ...["textures", "models", "previews"].map((dir) => ({
        source: `/${dir}/:file*`,
        headers: [
          { key: "Cache-Control", value: "public, max-age=604800, stale-while-revalidate=2592000" },
        ],
      })),
      {
        // The worker script itself must never be held: a stale sw.js is a
        // stale everything, since it decides what comes from cache.
        source: "/sw.js",
        headers: [{ key: "Cache-Control", value: "no-cache, must-revalidate" }],
      },
    ];
  },
  env: {
    // Stamps every crash report with the commit it came from, so a report is
    // traceable to a diff. Vercel sets VERCEL_GIT_COMMIT_SHA at build time;
    // locally this is just "dev".
    NEXT_PUBLIC_COMMIT_SHA: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "dev",
  },
};

export default nextConfig;
