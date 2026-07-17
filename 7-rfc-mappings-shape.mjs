// Experiment 7: simulate the RFC's Mappings interface directly.
//
// The RFC's example mappings are entries of
//   { virtualStart, virtualEnd, originalStart, originalEnd }
// This experiment converts Glint's Volar CodeMappings
// (sourceOffsets/generatedOffsets/lengths arrays) into that exact shape, then
// exercises both translation directions the RFC needs:
//
//  - virtual -> original: diagnostic reporting (runtime flow step 6)
//  - original -> virtual: rule/service queries about a source position
//  - round-trip: original -> virtual -> original must be the identity for
//    every mapped offset
//  - unmapped virtual offsets (generated Glint plumbing) return null,
//    triggering the RFC's suppression rule

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
    <p>{{this.count}}</p>
  </template>
}
`;

const glintConfig = loadConfig(fixtures);
const code = new VirtualGtsCode(glintConfig, ts.ScriptSnapshot.fromString(source), "glimmer-ts");
const embedded = code.embeddedCodes[0];
const virtual = embedded.snapshot.getText(0, embedded.snapshot.getLength());

// ---- convert Volar CodeMappings to the RFC's shape ----------------------
const rfcMappings = [];
for (const m of embedded.mappings) {
  for (let i = 0; i < m.sourceOffsets.length; i++) {
    if (m.lengths[i] === 0) continue; // zero-length anchors carry no range
    rfcMappings.push({
      virtualStart: m.generatedOffsets[i],
      virtualEnd: m.generatedOffsets[i] + m.lengths[i],
      originalStart: m.sourceOffsets[i],
      originalEnd: m.sourceOffsets[i] + m.lengths[i],
    });
  }
}
rfcMappings.sort((a, b) => a.virtualStart - b.virtualStart);

console.log("=== mappings in the RFC's shape ===");
for (const m of rfcMappings) console.log(`  ${JSON.stringify(m)}`);

// ---- the two translation functions the RFC implies -----------------------
function virtualToOriginal(offset) {
  for (const m of rfcMappings) {
    if (offset >= m.virtualStart && offset <= m.virtualEnd) {
      return m.originalStart + (offset - m.virtualStart);
    }
  }
  return null;
}
function originalToVirtual(offset) {
  for (const m of rfcMappings) {
    if (offset >= m.originalStart && offset <= m.originalEnd) {
      return m.virtualStart + (offset - m.originalStart);
    }
  }
  return null;
}

// ---- exercise both directions -------------------------------------------
console.log("\n=== original -> virtual (template identifier) ===");
const countInOriginal = source.indexOf("this.count}}") + "this.".length;
const v = originalToVirtual(countInOriginal);
console.log(`  original ${countInOriginal} (${JSON.stringify(source.slice(countInOriginal, countInOriginal + 5))}) -> virtual ${v} (${JSON.stringify(virtual.slice(v, v + 5))})`);

console.log("\n=== virtual -> original (identity region: the import) ===");
const importInVirtual = virtual.indexOf("@glimmer/component");
const o = virtualToOriginal(importInVirtual);
console.log(`  virtual ${importInVirtual} -> original ${o} (${JSON.stringify(source.slice(o, o + 18))})`);

console.log("\n=== unmapped virtual offset (generated Glint plumbing) ===");
const plumbing = virtual.indexOf("__glintDSL__.emitElement");
console.log(`  virtual ${plumbing} (${JSON.stringify(virtual.slice(plumbing, plumbing + 24))}) -> ${virtualToOriginal(plumbing)} (RFC: suppress diagnostic)`);

console.log("\n=== round-trip original -> virtual -> original over every mapped offset ===");
let checked = 0;
let failures = 0;
for (const m of rfcMappings) {
  for (let off = m.originalStart; off <= m.originalEnd; off++) {
    const there = originalToVirtual(off);
    const back = there === null ? null : virtualToOriginal(there);
    checked++;
    if (back !== off) {
      failures++;
      if (failures <= 3) console.log(`  FAIL ${off} -> ${there} -> ${back}`);
    }
  }
}
console.log(`  ${checked} offsets checked, ${failures} round-trip failures`);
