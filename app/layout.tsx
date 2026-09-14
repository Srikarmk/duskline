import type { Metadata } from "next";
import "./globals.css";

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
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
