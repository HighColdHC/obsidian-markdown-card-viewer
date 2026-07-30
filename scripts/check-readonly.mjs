import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const forbidden = [
  "vault.create(",
  "vault.createBinary(",
  "vault.createFolder(",
  "vault.modify(",
  "vault.modifyBinary(",
  "vault.append(",
  "vault.delete(",
  "vault.rename(",
  "vault.copy(",
  "vault.trash(",
  "vault.adapter.write(",
  "vault.adapter.writeBinary(",
  "vault.adapter.mkdir(",
  "vault.adapter.remove(",
  "vault.adapter.rename(",
  "fileManager.renameFile(",
  "fileManager.processFrontMatter("
];
const allowedWriter = path.normalize("src/infoos/vault-materializer.ts");

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await walk(fullPath));
    else if (entry.name.endsWith(".ts")) files.push(fullPath);
  }
  return files;
}

const violations = [];
for (const file of await walk("src")) {
  const source = await readFile(file, "utf8");
  for (const token of forbidden) {
    if (source.includes(token) && path.normalize(file) !== allowedWriter) {
      violations.push(`${file}: write API outside managed materializer ${token}`);
    }
  }
}

if (violations.length > 0) {
  console.error(violations.join("\n"));
  process.exit(1);
}

console.log("Vault write boundary check passed.");
