import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(process.argv[2] ?? "test-vault");

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.name === ".obsidian") continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await walk(fullPath));
    else files.push(fullPath);
  }
  return files;
}

const files = (await walk(root)).sort();
const digest = createHash("sha256");
for (const file of files) {
  digest.update(path.relative(root, file));
  digest.update("\0");
  digest.update(await readFile(file));
  digest.update("\0");
}
console.log(JSON.stringify({ root, files: files.length, sha256: digest.digest("hex") }));
