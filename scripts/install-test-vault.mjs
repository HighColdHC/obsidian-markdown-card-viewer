import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";

const target = path.resolve("test-vault/.obsidian/plugins/markdown-card-viewer");
await mkdir(target, { recursive: true });
for (const file of ["main.js", "styles.css", "manifest.json"]) {
  await copyFile(path.resolve(file), path.join(target, file));
}
console.log(`Installed plugin build into ${target}`);
