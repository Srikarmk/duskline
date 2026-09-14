/**
 * What this machine can actually run, checked BEFORE the engine is built.
 *
 * The engine assumes WebGL2, float render targets (the HDR composer chain) and
 * a working PMREM pass for image-based lighting. On hardware without them the
 * failure is silent: a black canvas, no error, no way to tell whether the site
 * is broken or the machine is. Checking up front means the player gets a
 * sentence instead of a void.
 *
 * Deliberately cheap — it creates one throwaway context and throws it away.
 */
export interface Capability {
  ok: boolean;
  /** Player-facing explanation when ok is false. */
  reason?: string;
  /** True when the GPU looks weak enough that the heavy settings should start off. */
  lowPower?: boolean;
  renderer?: string;
}

export function checkCapability(): Capability {
  if (typeof window === "undefined") return { ok: true };

  let canvas: HTMLCanvasElement | null = null;
  try {
    canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2");
    if (!gl) {
      // Distinguish "no WebGL at all" from "WebGL1 only" — they have different
      // fixes, and telling someone to update their browser when the real
      // problem is a disabled flag is useless advice.
      const gl1 = canvas.getContext("webgl") || canvas.getContext("experimental-webgl");
      return {
        ok: false,
        reason: gl1
          ? "This browser only supports WebGL 1, and the game needs WebGL 2. A recent Chrome, Edge, Firefox or Safari will work."
          : "WebGL is unavailable. It may be disabled in your browser settings, or blocked by your graphics driver.",
      };
    }

    // The composer renders into a half-float HDR target. Without this extension
    // that target cannot be created and every pass downstream fails.
    if (!gl.getExtension("EXT_color_buffer_half_float") && !gl.getExtension("EXT_color_buffer_float")) {
      return {
        ok: false,
        reason:
          "Your graphics driver does not support floating-point render targets, which the lighting depends on.",
      };
    }

    const dbg = gl.getExtension("WEBGL_debug_renderer_info");
    const renderer = dbg
      ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) ?? "")
      : "";

    // A crude but useful signal. Integrated parts and software fallbacks are
    // the ones that will struggle, and it is better to start them on low
    // settings than to let the first race run at 12 fps and be written off.
    const weak = /swiftshader|llvmpipe|software|microsoft basic|intel.*(hd|uhd) graphics (5|6)/i.test(renderer);
    const fewTextureUnits = (gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS) as number) < 16;

    return { ok: true, lowPower: weak || fewTextureUnits, renderer };
  } catch (e) {
    return { ok: false, reason: `Could not start WebGL: ${(e as Error).message}` };
  } finally {
    // release the probe context rather than leaving it to the GC — browsers cap
    // the number of live WebGL contexts and the real one has to come after it
    if (canvas) {
      const lose = (canvas.getContext("webgl2") as WebGL2RenderingContext | null)
        ?.getExtension("WEBGL_lose_context");
      lose?.loseContext();
      canvas.width = canvas.height = 0;
    }
  }
}
