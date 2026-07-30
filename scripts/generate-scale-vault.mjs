import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const count = Number(process.argv[2] ?? 10000);
const root = path.resolve("test-vault/Scale");
await mkdir(root, { recursive: true });

const batchSize = 250;
for (let start = 0; start < count; start += batchSize) {
  const tasks = [];
  for (let index = start; index < Math.min(count, start + batchSize); index += 1) {
    const group = String(index % 40).padStart(2, "0");
    const folder = path.join(root, `Group-${group}`);
    await mkdir(folder, { recursive: true });
    const current = String(index).padStart(5, "0");
    const next = String((index + 1) % count).padStart(5, "0");
    const body = `---\ntype: scale\nindex: ${index}\nrelated: "[[Scale Card ${next}]]"\n---\n\n# Scale Card ${current}\n\nSynthetic read-only performance fixture ${index}.\n\nNext: [[Scale Card ${next}]]\n`;
    tasks.push(writeFile(path.join(folder, `Scale Card ${current}.md`), body));
  }
  await Promise.all(tasks);
}
console.log(`Generated ${count} Markdown files in ${root}`);
