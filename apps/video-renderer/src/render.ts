import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { CardNewsManifest } from "./types";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "../../..");

async function main() {
  const inputPath = argValue("--input") || argValue("-i");
  if (!inputPath) throw new Error("Usage: npm run render -- --input exports/social/<tenant>/<package>.render.json");
  const absoluteInput = resolve(projectRoot, inputPath);
  if (!existsSync(absoluteInput)) throw new Error(`manifest not found: ${absoluteInput}`);
  const manifest = JSON.parse(readFileSync(absoluteInput, "utf8")) as CardNewsManifest;
  const entryPoint = resolve(__dirname, "index.ts");
  const serveUrl = await bundle({ entryPoint });
  const composition = await selectComposition({
    serveUrl,
    id: "CardNewsShort",
    inputProps: manifest,
  });
  const outputDir = resolve(projectRoot, manifest.output?.directory || "exports/social/videos");
  mkdirSync(outputDir, { recursive: true });
  const outputLocation = resolve(outputDir, manifest.output?.filename || `${safeFile(manifest.package_id || manifest.title)}.mp4`);
  await renderMedia({
    composition,
    serveUrl,
    codec: "h264",
    outputLocation,
    inputProps: manifest,
  });
  console.log(JSON.stringify({ ok: true, outputLocation }, null, 2));
}

function argValue(name: string): string {
  const index = process.argv.indexOf(name);
  return index >= 0 ? String(process.argv[index + 1] || "") : "";
}

function safeFile(value: string): string {
  return value.replace(/[^0-9A-Za-z._-]+/g, "-").replace(/-+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "short";
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exitCode = 1;
});
