// Experiment 4: RFC runtime flow, step 4 — do real oxlint Rust rules behave
// correctly against the faithful virtual source, and do their diagnostics map
// back to the original file?
//
// Setup: a .gts where
//  - `SomeButton` is imported and used ONLY inside <template>
//  - `unusedThing` is imported and never used
//  - a `debugger` statement sits in a class method
//
// Expected on the Glint-generated virtual TS, using stock oxlint:
//  - no-unused-vars: flags `unusedThing`, does NOT flag `SomeButton`
//    (the faithful transform makes template usage visible to Rust rules —
//    the property a masking or eval()-bag virtual source cannot provide)
//  - no-debugger: flags the statement; its span maps back to the exact
//    original offset via the Volar mappings

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
import { SomeButton } from "./button";
import { unusedThing } from "./unused";

export default class Demo extends Component {
  inc() {
    debugger;
  }

  <template>
    <SomeButton @onClick={{this.inc}} />
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
  out = execFileSync("npx", [
    "oxlint", "--format", "json",
    "-A", "all", "-D", "no-unused-vars", "-D", "no-debugger",
    virtualPath,
  ], { encoding: "utf8" });
} catch (e) {
  out = e.stdout; // oxlint exits non-zero when it finds errors
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

console.log("=== oxlint (Rust rules) on the Glint virtual source ===");
for (const d of diagnostics) {
  const span = d.labels?.[0]?.span ?? {};
  const orig = mapToOriginal(span.offset ?? 0);
  const where = orig === null ? "[unmapped -> suppress]" : `demo.gts:${lineCol(orig)}`;
  console.log(`  ${where} ${d.code}: ${d.message}`);
  if (orig !== null) console.log(`    original text at mapped offset: ${JSON.stringify(source.slice(orig, orig + 12))}`);
}

const flagged = (name) => diagnostics.some((d) => d.message.includes(`'${name}'`));
console.log("\n=== correctness checks ===");
console.log(`unusedThing flagged by no-unused-vars: ${flagged("unusedThing")} (expected true)`);
console.log(`SomeButton flagged by no-unused-vars: ${flagged("SomeButton")} (expected false — used only in <template>, visible via faithful transform)`);
console.log(`debugger flagged and mapped: ${diagnostics.some((d) => d.code.includes("no-debugger") && mapToOriginal(d.labels?.[0]?.span?.offset) !== null)} (expected true)`);
