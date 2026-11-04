/**
 * Every ```ts block in the guides and package READMEs runs, so the docs cannot drift from
 * the code. Blocks tagged ```ts browser (they need a DOM) are only type-free text here.
 */
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, expect, it, vi } from "vitest";

const root = new URL("../../../", import.meta.url).pathname;
const tmp = join(root, "packages/agents/.docs-tmp");
const files = [
  ...readdirSync(join(root, "docs")).filter((f) => f.endsWith(".md")).map((f) => `docs/${f}`),
  "packages/engine/README.md", "packages/agents/README.md",
];
const imports: [RegExp, string][] = [
  [/from "umbra-engine"/g, `from "${root}packages/engine/src/index.ts"`],
  [/from "umbra-agents"/g, `from "${root}packages/agents/src/index.ts"`],
];

mkdirSync(tmp, { recursive: true });
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const blocks = files.flatMap((file) =>
  [...readFileSync(join(root, file), "utf8").matchAll(/^```ts\n([\s\S]*?)^```$/gm)].map((m, i) => ({ file, i, code: m[1]! })));

it("finds the docs' code", () => expect(blocks.length).toBeGreaterThan(10));

for (const { file, i, code } of blocks) {
  it(`${file} block ${i + 1} runs`, async () => {
    const path = join(tmp, `${file.replace(/\W/g, "_")}_${i}.ts`);
    writeFileSync(path, imports.reduce((c, [re, to]) => c.replace(re, to), code));
    const logs: unknown[][] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((...a) => { logs.push(a); });
    try { await import(path); } finally { spy.mockRestore(); }
    if (process.env["DOCS_LOG"]) console.log(`${file} #${i + 1}:`, ...logs.map((l) => l.map(String).join(" ")));
  }, 60_000);
}
