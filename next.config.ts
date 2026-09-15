import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  env: {
    // Stamps every crash report with the commit it came from, so a report is
    // traceable to a diff. Vercel sets VERCEL_GIT_COMMIT_SHA at build time;
    // locally this is just "dev".
    NEXT_PUBLIC_COMMIT_SHA: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "dev",
  },
};

export default nextConfig;
