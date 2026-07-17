// Experiment 2: Can existing Ember tooling produce the RFC's TransformResult
// (virtual TS sourceText + mappings to the original file)?
//
// Candidate: content-tag (Rust/napi, Ember's build-time <template> transform).
// It emits valid JS/TS plus a source map — but it demonstrates why "build
// output" is the wrong virtual source for linting:
//   1. It reprints the whole file (swc), so nothing outside templates is
//      byte-identical; every JS diagnostic needs mapping.
//   2. Template bodies become opaque strings whose scope access goes through
//      an eval() bag — template identifier references are invisible in the
//      virtual source, so unused/undef analysis over it is wrong.
//
// The semantically faithful transform for gjs/gts is Glint v2's Volar-based
// codegen (virtual TS where every template identifier is a real typed
// reference, plus Volar mappings) — the same architecture the RFC cites.
//
// content-tag's parse() API is still useful: it yields exact template byte
// ranges, which is all a masking/"shadow source" fallback needs.

import { Preprocessor } from "content-tag";

const source = `import Component from "@glimmer/component";
import { on } from "@ember/modifier";
import { SomeButton } from "./button";

const Greeting = <template>
  <h1 aria-label="greeting">Hello, {{@name}}!</h1>
</template>;

export default class Demo extends Component<{ Args: { name: string } }> {
  count = 0;
  inc = () => this.count++;

  <template>
    <Greeting @name={{@name}} />
    {{#if this.count}}<SomeButton {{on "click" this.inc}} />{{/if}}
  </template>
}
`;

const p = new Preprocessor();
const result = p.process(source, { filename: "demo.gts", inline_source_map: false });
console.log("=== virtual source (content-tag process) ===");
console.log(result.code);
console.log("=== source map present:", Boolean(result.map));

const occurrences = p.parse(source, { filename: "demo.gts" });
console.log("\n=== template occurrences (byte ranges in original) ===");
for (const o of occurrences) {
  console.log(`  type=${o.type} range=[${o.range.startByte}, ${o.range.endByte}] contentRange=[${o.contentRange.startByte}, ${o.contentRange.endByte}]`);
}
const templateBytes = occurrences.reduce((a, o) => a + (o.range.endByte - o.range.startByte), 0);
console.log(`\noriginal length=${source.length}, template bytes=${templateBytes} (${Math.round((templateBytes / source.length) * 100)}%)`);
console.log(`identity-mappable bytes under a masking fallback: ${source.length - templateBytes}`);
