// Experiment 5: the RFC's "Consumption" section — can an eslint-plugin-ember
// template rule run unchanged under the RFC's rule model (a visitor keyed by
// native node types, context.report against nodes)?
//
// The rule below is a direct port of eslint-plugin-ember's
// `template-no-obsolete-elements` check (visitor shape identical to the RFC's
// `VElement` example). The runner is a minimal ESLint-style dispatcher:
// enter/`:exit` callbacks driven by visitorKeys.
//
// Expected: reports land on <marquee> and <blink> with original-file spans;
// <SomeButton> and <p> are untouched.

import { toTree, glimmerVisitorKeys } from "ember-estree";
import { visitorKeys as tsKeys } from "@typescript-eslint/visitor-keys";

const source = `import { SomeButton } from "./button";

<template>
  <p>fine</p>
  <marquee>obsolete</marquee>
  <SomeButton />
  {{#if true}}<blink>also obsolete</blink>{{/if}}
</template>
`;

// -- the rule, RFC-style ------------------------------------------------
const OBSOLETE = new Set(["applet", "basefont", "blink", "center", "font", "isindex", "marquee"]);

const rule = {
  create(context) {
    return {
      GlimmerElementNode(node) {
        if (OBSOLETE.has(node.tag)) {
          context.report({ node, message: `Do not use obsolete element <${node.tag}>` });
        }
      },
    };
  },
};

// -- minimal ESLint-style runner over the native AST ---------------------
const allKeys = { ...tsKeys, ...glimmerVisitorKeys };
const reports = [];
const context = { report: (r) => reports.push(r) };
const visitor = rule.create(context);

(function walk(node) {
  if (!node || typeof node.type !== "string") return;
  visitor[node.type]?.(node);
  for (const key of allKeys[node.type] ?? []) {
    const v = node[key];
    if (Array.isArray(v)) for (const c of v) walk(c);
    else if (v && typeof v === "object") walk(v);
  }
  visitor[`${node.type}:exit`]?.(node);
})(toTree(source, { fileName: "demo.gjs" }).program);

// -- verify: reports carry original-file spans ---------------------------
const lineCol = (offset) => {
  const before = source.slice(0, offset).split("\n");
  return `${before.length}:${before.at(-1).length + 1}`;
};

console.log("=== reports (original-file coordinates, no mapping needed) ===");
for (const r of reports) {
  const [start] = r.node.range;
  console.log(`  demo.gjs:${lineCol(start)} ${r.message}`);
  console.log(`    original text at span: ${JSON.stringify(source.slice(start, start + 12))}`);
}
console.log(`\nreport count: ${reports.length} (expected 2: <marquee>, <blink>)`);
