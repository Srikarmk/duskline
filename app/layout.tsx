import type { Metadata } from "next";
import { Orbitron, Rajdhani } from "next/font/google";
import ServiceWorkerRegister from "./components/ServiceWorkerRegister";
import "./globals.css";

/**
 * Self-hosted, not a CDN link.
 *
 * These used to be an `@import` from fonts.googleapis.com in globals.css,
 * which sends every visitor's IP to Google before a single pixel is drawn —
 * a third-party request with real privacy implications in the EU, and one
 * that blocks first paint on a round trip to another origin. `next/font`
 * downloads both faces at BUILD time and serves them from this domain, so
 * there is no third-party request at all, and no layout shift either.
 */
const orbitron = Orbitron({
  subsets: ["latin"],
  weight: ["600", "700", "800", "900"],
  variable: "--font-orbitron",
  display: "swap",
});

const rajdhani = Rajdhani({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-rajdhani",
  display: "swap",
});

// Without these, every share link renders as a bare URL with no title, image
// or description — which is most of what decides whether anyone clicks it.
const DESCRIPTION =
  "A browser racing game. Fourteen road cars, twelve worlds, and an endless neon highway. No install, no account.";

export const metadata: Metadata = {
  // Absolute base for the share image. Unset, Next resolved it against
  // whatever host built it — fine on the production URL, wrong on a preview
  // deployment or a custom domain added later.
  metadataBase: new URL("https://playduskline.vercel.app"),
  title: "Duskline — drive it in your browser",
  // Declared so browsers stop asking for /favicon.ico, which does not exist
  // and was the one 404 on every page load.
  icons: { icon: "/icon-192.png", apple: "/icon-192.png" },
  description: DESCRIPTION,
  applicationName: "Duskline",
  openGraph: {
    type: "website",
    title: "Duskline",
    description: DESCRIPTION,
    siteName: "Duskline",
    images: [{ url: "/previews/realm-bay.jpg", width: 800, height: 450, alt: "Sunset Bay causeway at dusk" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Duskline",
    description: DESCRIPTION,
    images: ["/previews/realm-bay.jpg"],
  },
  robots: { index: true, follow: true },
};

export const viewport = {
  themeColor: "#07051a",   // the page's own --ink, so the browser chrome meets it
  // Without width=device-width a phone renders at a 980px layout width and
  // scales down, so the HUD is unreadable.
  //
  // What is NOT here: maximumScale / userScalable. Locking zoom is right for a
  // game canvas — a pinch mid-corner is a mis-grab, not an intention — but it
  // was applied to the whole document, including the setup steps and the
  // leaderboard, which is a WCAG 1.4.4 failure. The lock now lives where it
  // belongs: `touch-action: none` on `.game-stage` in globals.css, which
  // suppresses the gesture on the canvas and nowhere else.
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover" as const,
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${orbitron.variable} ${rajdhani.variable}`}>
      <body>
        {children}
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
