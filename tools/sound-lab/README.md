# Sound lab

`npm run sound-lab`, then open http://localhost:3081.

Every clip is rendered in the browser by the game's own `src/game3d/sound.ts`
on an `OfflineAudioContext`, so what you hear is exactly what the game makes,
and it can be measured: peak, RMS, clipped samples, the loop seam of the noise
buffers. Three versions sit side by side:

- **Before** — `sound.ts` at a git ref (default: the last commit before the
  2026-10-21 pass; `-- --before <ref>` to compare against anything else)
- **Synth** — the working tree, synthesis only
- **Recorded** — the working tree with the CC0 takes in `public/sfx`

Use it before and after any change to the audio. Sound cannot be checked by
the compiler or by reading the code, and levels in particular drift: in the
pass that built this, a compressor's automatic make-up gain made everything
4–7 dB louder without anyone touching a gain, and that was only visible here.

`window.lab` in the console exposes `render`, `stats`, `measure` and the scene
list for scripted checks.

## Adding a recorded effect

1. CC0 only, and record the source file in `CREDITS.md`.
2. Trim leading silence (it delays the hit), cut it to what the game plays,
   mono, then `afconvert -f m4af -d aac -b 96000 in.wav out.m4a` on macOS.
3. Add the name and take count to `SAMPLE_TAKES` in `sound.ts`, keep a
   synthesised fallback, and level its gain here against the synth voice.
4. `test:budget` holds `public/sfx` under its ceiling.
