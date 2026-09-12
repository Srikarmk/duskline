import { writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * DEV-ONLY. Writes a realm preview JPEG into public/previews.
 *
 * The realm cards on the home screen show /previews/realm-<id>.jpg and fall
 * back to a CSS gradient when the file is missing — which is why every realm
 * added after the original eight was a flat colour swatch on the picker. The
 * art is a render of the realm itself, so the cheapest way to produce it is to
 * let the running game take the shot and post it here, rather than shuttling a
 * hundred kilobytes of base64 back out through the console.
 *
 * Refuses to run in production; nothing ships that can write to disk.
 */
export async function POST(req: Request) {
  if (process.env.NODE_ENV === "production") {
    return new Response("disabled", { status: 403 });
  }
  const { id, jpeg } = (await req.json()) as { id?: string; jpeg?: string };
  if (!id || !jpeg || !/^[a-z0-9_-]+$/.test(id)) {
    return new Response("bad request", { status: 400 });
  }
  const out = path.join(process.cwd(), "public", "previews", `realm-${id}.jpg`);
  await writeFile(out, Buffer.from(jpeg, "base64"));
  return Response.json({ ok: true, bytes: jpeg.length, path: `previews/realm-${id}.jpg` });
}
