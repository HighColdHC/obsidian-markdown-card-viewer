import { mkdir, readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";

const run = promisify(execFile);
const manifest = JSON.parse(await readFile("manifest.json", "utf8"));
const outputDirectory = path.resolve("dist");
const output = path.join(
  outputDirectory,
  `markdown-card-viewer-${manifest.version}.zip`
);

await mkdir(outputDirectory, { recursive: true });
await run("zip", [
  "-j",
  "-FS",
  output,
  "main.js",
  "manifest.json",
  "styles.css"
]);
console.log(`Created release archive: ${output}`);
