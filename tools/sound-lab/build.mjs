/**
 * Sound lab: render the game's audio offline, before and after, side by side.
 *
 *   npm run sound-lab                  baseline = BASELINE below, then serve
 *   npm run sound-lab -- --before HEAD~3
 *   node tools/sound-lab/build.mjs --no-serve   just write .sound-lab/
 *
 * "Before" is src/game3d/sound.ts at a git ref; "Synth" and "Recorded" are the
 * working tree, without and with public/sfx. The page needs a server rather
 * than file://, because it fetches the recordings.
 */
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

// The last commit before the 2026-10-21 sound pass: the sound that shipped.
const BASELINE = "af16f69";

const args = process.argv.slice(2);
const ref = args.includes("--before") ? args[args.indexOf("--before") + 1] : BASELINE;
const ROOT = process.cwd();
const OUT = path.join(ROOT, ".sound-lab");
const HERE = path.join(ROOT, "tools", "sound-lab");

const STUB = "const readStored = () => null; const writeStored = () => {};";
function toIife(src, name) {
  const withStub = src.replace(
    /^import \{ read as readStored, write as writeStored \} from "@\/src\/ui\/storage";$/m, STUB);
  if (!withStub.includes(STUB)) throw new Error(`storage import not found in ${name}`);
  let js = ts.transpileModule(withStub, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext },
  }).outputText;
  js = js.replace(/^export \{\};?$/m, "").replace(/^export (class|const|function) /gm, "$1 ");
  return `const ${name} = (() => {\n${js}\nreturn Sound;\n})();`;
}

const before = execFileSync("git", ["show", `${ref}:src/game3d/sound.ts`], { encoding: "utf8" });
const after = fs.readFileSync(path.join(ROOT, "src/game3d/sound.ts"), "utf8");
const tpl = fs.readFileSync(path.join(HERE, "template.html"), "utf8");
if (!tpl.includes("/*__SOUNDS__*/")) throw new Error("template placeholder missing");

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(path.join(OUT, "sfx"), { recursive: true });
const page = tpl.replace("/*__SOUNDS__*/", () => `${toIife(before, "OldSound")}\n${toIife(after, "NewSound")}`);
fs.writeFileSync(path.join(OUT, "index.html"), page);
for (const f of fs.readdirSync(path.join(ROOT, "public", "sfx"))) {
  if (f.endsWith(".m4a")) {
    fs.copyFileSync(path.join(ROOT, "public", "sfx", f), path.join(OUT, "sfx", f.replace(/\.m4a$/, ".mp4")));
  }
}
console.log(`sound lab built: before = ${ref}, ${Math.round(page.length / 1024)} kB → .sound-lab/`);

if (!args.includes("--no-serve")) {
  const TYPES = { ".html": "text/html; charset=utf-8", ".mp4": "audio/mp4" };
  const port = 3081;
  createServer((req, res) => {
    const rel = decodeURIComponent((req.url ?? "/").split("?")[0]).replace(/^\/+/, "") || "index.html";
    const file = path.join(OUT, rel);
    if (!file.startsWith(OUT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] ?? "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  }).listen(port, "127.0.0.1", () => console.log(`open http://localhost:${port}`));
}
