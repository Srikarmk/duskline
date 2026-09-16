import type { MetadataRoute } from "next";

/**
 * Web app manifest — what makes "Add to Home Screen" produce an app rather
 * than a bookmark.
 *
 * `display: fullscreen` matters more here than it looks: in a normal browser
 * tab a phone gives up 15-20% of the screen to the URL bar and the home
 * indicator, and the HUD is laid out against the full viewport. Installed, the
 * game gets the whole panel.
 *
 * `orientation: landscape` because the road runs into the distance — portrait
 * gives you a tall slice of sky and almost no road ahead.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Duskline",
    short_name: "Duskline",
    description:
      "A browser racing game. Ten road cars, twelve worlds, and an endless neon highway.",
    start_url: "/",
    display: "fullscreen",
    orientation: "landscape",
    background_color: "#07070b",
    theme_color: "#07070b",
    categories: ["games"],
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    screenshots: [
      { src: "/previews/realm-bay.jpg", sizes: "800x450", type: "image/jpeg", form_factor: "wide" },
    ],
  };
}
