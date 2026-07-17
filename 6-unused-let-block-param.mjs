// Experiment 6: is an unused {{#let}} block param inside <template> caught by
// oxlint's Rust no-unused-vars via the faithful virtual source?
//
// Glint codegen turns a block param into a real destructured const:
//   const [unusedLocal] = __glintY__.blockParams["default"];
// so this tests whether a scope-flavored template rule
// (eslint-plugin-ember's `template-no-unused-block-params`) is reachable with
// zero native scoping — purely via transform + Rust rule + mappings.
//
// Expected:
//  - `unusedLocal` (bound, never referenced) is flagged, and its span maps
//    back to the exact `|unusedLocal|` position in the original template
//  - `usedLocal` (referenced by `{{usedLocal}}`) is not flagged

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import ts from "typescript";
import { loadConfig, VirtualGtsCode } from "@glint/core";

const dir = path.dirname(url.fileURLToPath(import.meta.url));
const fixtures = path.join(dir, "fixtures");
fs.mkdirSync(fixtures, { recursive: true });
fs.writeFileSync(
  path.join(fixtures, "tsconfig.json"),
  JSON.stringify({
    compilerOptions: { strict: true, module: "esnext", target: "esnext" },
    glint: { environment: "ember-template-imports" },
  }, null, 2),
);

const source = `import Component from "@glimmer/component";

export default class Demo extends Component {
  count = 0;

  <template>
    {{#let this.count as |unusedLocal|}}
      <p>static text</p>
    {{/let}}
    {{#let this.count as |usedLocal|}}
      <p>{{usedLocal}}</p>
    {{/let}}
  </template>
}
`;

const glintConfig = loadConfig(fixtures);
const code = new VirtualGtsCode(glintConfig, ts.ScriptSnapshot.fromString(source), "glimmer-ts");
const embedded = code.embeddedCodes[0];
const virtual = embedded.snapshot.getText(0, embedded.snapshot.getLength());

const virtualPath = path.join(fixtures, "demo.virtual.ts");
fs.writeFileSync(virtualPath, virtual);

let out;
try {
  out = execFileSync("npx", ["oxlint", "--format", "json", "-A", "all", "-D", "no-unused-vars", virtualPath], { encoding: "utf8" });
} catch (e) {
  out = e.stdout;
}
const diagnostics = JSON.parse(out).diagnostics ?? JSON.parse(out);

function mapToOriginal(generatedOffset) {
  for (const m of embedded.mappings) {
    for (let i = 0; i < m.generatedOffsets.length; i++) {
      const g = m.generatedOffsets[i];
      const len = m.lengths[i];
      if (generatedOffset >= g && generatedOffset <= g + len) {
        return m.sourceOffsets[i] + (generatedOffset - g);
      }
    }
  }
  return null;
}
const lineCol = (offset) => {
  const before = source.slice(0, offset).split("\n");
  return `${before.length}:${before.at(-1).length + 1}`;
};

console.log("=== oxlint no-unused-vars on the Glint virtual source ===");
for (const d of diagnostics) {
  const orig = mapToOriginal(d.labels?.[0]?.span?.offset ?? 0);
  const where = orig === null ? "[unmapped -> suppress]" : `demo.gts:${lineCol(orig)}`;
  console.log(`  ${where} ${d.code}: ${d.message}`);
  if (orig !== null) console.log(`    original text at mapped offset: ${JSON.stringify(source.slice(orig, orig + 13))}`);
}

const flagged = (name) => diagnostics.some((d) => d.message.includes(`'${name}'`));
console.log("\n=== correctness checks ===");
console.log(`unusedLocal flagged: ${flagged("unusedLocal")} (expected true)`);
console.log(`usedLocal flagged: ${flagged("usedLocal")} (expected false — referenced by {{usedLocal}})`);
