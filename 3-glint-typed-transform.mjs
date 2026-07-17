// Experiment 3: Does Glint v2's Volar codegen actually fit the RFC's
// TransformResult, and does it support type-aware linting?
//
// Uses @glint/core (v2, Volar-based) directly:
//  1. Build a VirtualGtsCode for a .gts source containing a deliberate type
//     error inside a <template> ({{this.cuont}} — typo for this.count).
//  2. Show the embedded virtual TS: template identifiers are real typed
//     references (not strings), i.e. the semantically faithful virtual source
//     the RFC requires — contrast with content-tag's eval() bags (experiment 2).
//  3. Show the Volar CodeMappings (sourceOffsets/generatedOffsets/lengths —
//     the RFC's Mappings shape).
//  4. Type-check the virtual TS with vanilla `ts.createProgram` and map the
//     diagnostic inside the template back to original-file coordinates using
//     only the mappings.

import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import ts from "typescript";
import { loadConfig, VirtualGtsCode } from "@glint/core";

const dir = path.dirname(url.fileURLToPath(import.meta.url));
const fixtures = path.join(dir, "fixtures");

// Minimal glint project config (tsconfig with a "glint" key).
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
    <p>{{this.cuont}}</p>
  </template>
}
`;

const glintConfig = loadConfig(fixtures);
const snapshot = ts.ScriptSnapshot.fromString(source);
const code = new VirtualGtsCode(glintConfig, snapshot, "glimmer-ts");

const embedded = code.embeddedCodes[0];
const virtual = embedded.snapshot.getText(0, embedded.snapshot.getLength());

console.log("=== virtual TS (Glint v2 codegen), template region ===");
const tplStart = virtual.indexOf("static {");
console.log(virtual.slice(tplStart === -1 ? 0 : tplStart, tplStart === -1 ? 800 : tplStart + 500));

console.log("\n=== faithful-reference check ===");
console.log(`virtual source contains a real reference to 'cuont':`, /\bcuont\b/.test(virtual));
console.log(`virtual source contains no eval():`, !virtual.includes("eval("));

console.log("\n=== Volar mappings (RFC Mappings shape) ===");
for (const m of embedded.mappings.slice(0, 6)) {
  console.log(`  sourceOffsets=${JSON.stringify(m.sourceOffsets)} generatedOffsets=${JSON.stringify(m.generatedOffsets)} lengths=${JSON.stringify(m.lengths)}`);
}
console.log(`  ... (${embedded.mappings.length} mappings total)`);

// ---- type-check the virtual TS and map the diagnostic back ----
const virtualName = path.join(fixtures, "demo.virtual.ts");
const host = ts.createCompilerHost({ strict: true });
const origGetSourceFile = host.getSourceFile.bind(host);
host.getSourceFile = (name, langVersion, ...rest) =>
  name === virtualName
    ? ts.createSourceFile(name, virtual, langVersion, true)
    : origGetSourceFile(name, langVersion, ...rest);
host.fileExists = (f) => f === virtualName || ts.sys.fileExists(f);
host.readFile = (f) => (f === virtualName ? virtual : ts.sys.readFile(f));

const program = ts.createProgram([virtualName], { strict: true, noEmit: true, skipLibCheck: true }, host);
const diags = ts.getPreEmitDiagnostics(program).filter((d) => d.file?.fileName === virtualName);

function mapToOriginal(generatedOffset) {
  for (const m of embedded.mappings) {
    for (let i = 0; i < m.generatedOffsets.length; i++) {
      const gStart = m.generatedOffsets[i];
      const len = m.lengths[i];
      if (generatedOffset >= gStart && generatedOffset <= gStart + len) {
        return m.sourceOffsets[i] + (generatedOffset - gStart);
      }
    }
  }
  return null; // unmapped => RFC says suppress
}

console.log("\n=== TS diagnostics on virtual source, mapped back via mappings ===");
for (const d of diags) {
  const orig = mapToOriginal(d.start);
  const msg = ts.flattenDiagnosticMessageText(d.messageText, " ");
  if (orig === null) {
    console.log(`  [unmapped -> suppress] TS${d.code}: ${msg}`);
  } else {
    const { line, character } = (() => {
      const before = source.slice(0, orig).split("\n");
      return { line: before.length, character: before.at(-1).length + 1 };
    })();
    console.log(`  demo.gts:${line}:${character} TS${d.code}: ${msg}`);
    console.log(`  original text at mapped offset: ${JSON.stringify(source.slice(orig, orig + 10))}`);
  }
}
