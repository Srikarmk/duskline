import type { Metadata } from "next";
import { Orbitron, Rajdhani } from "next/font/google";
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
  "A browser racing game. Ten road cars, twelve worlds, and an endless neon highway. No install, no account.";

export const metadata: Metadata = {
  title: "Fantasy Racer — drive it in your browser",
  description: DESCRIPTION,
  applicationName: "Fantasy Racer",
  openGraph: {
    type: "website",
    title: "Fantasy Racer",
    description: DESCRIPTION,
    siteName: "Fantasy Racer",
    images: [{ url: "/previews/realm-bay.jpg", width: 800, height: 450, alt: "Sunset Bay causeway at dusk" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Fantasy Racer",
    description: DESCRIPTION,
    images: ["/previews/realm-bay.jpg"],
  },
  robots: { index: true, follow: true },
};

export const viewport = {
  themeColor: "#07070b",
  // Lock the visual viewport. Without this a phone renders at a 980px layout
  // width and scales down, so the HUD is unreadable; and pinch-zoom on a game
  // canvas is never intentional, it is a mis-grab mid-corner.
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover" as const,
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${orbitron.variable} ${rajdhani.variable}`}>
      <body>{children}</body>
    </html>
  );
}
