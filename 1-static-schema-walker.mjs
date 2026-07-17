// Experiment 1: Can the Oxlint RFC's static visitorKeys schema (nodes + unions,
// generated specialized walkers) describe and traverse a real gjs/gts AST?
//
// gjs/gts ASTs (as produced by ember-estree / ember-eslint-parser) are standard
// ESTree with Glimmer* nodes grafted in at original-file offsets.
//
// Method:
//  1. Parse a representative .gts with ember-estree.
//  2. Reference traversal: dynamic ESLint-style walk using visitorKeys
//     (ts-estree keys + glimmerVisitorKeys). Count nodes per type.
//  3. RFC-style traversal: derive a static {nodes, unions} schema from the
//     tree, generate per-type walkers via `new Function` (as the RFC
//     proposes: direct calls for single-type fields, switch dispatch for
//     unions), walk again.
//  4. Compare visit counts. Report every place a Glimmer node sits in an
//     ESTree position — i.e. which base ESTree unions a language plugin
//     would need to extend.

import { toTree, glimmerVisitorKeys } from "ember-estree";
import { visitorKeys as tsKeys } from "@typescript-eslint/visitor-keys";

const source = `
import Component from "@glimmer/component";
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
    {{#if this.count}}
      <SomeButton {{on "click" this.inc}}>
        {{#each @items as |item index|}}
          <li data-index={{index}}>{{item.label}}</li>
        {{/each}}
      </SomeButton>
    {{/if}}
    {{yield}}
  </template>
}
`;

const tree = toTree(source, { fileName: "demo.gts" });
const allKeys = { ...tsKeys, ...glimmerVisitorKeys };

// ---------- 2. reference dynamic walk ----------
const refCounts = new Map();
const glimmerParents = new Map(); // "ParentType.field" -> Set of Glimmer child types
function dynWalk(node, parentType, field) {
  if (!node || typeof node.type !== "string") return;
  refCounts.set(node.type, (refCounts.get(node.type) ?? 0) + 1);
  if (node.type.startsWith("Glimmer") && parentType && !parentType.startsWith("Glimmer")) {
    const k = `${parentType}.${field}`;
    if (!glimmerParents.has(k)) glimmerParents.set(k, new Set());
    glimmerParents.get(k).add(node.type);
  }
  const keys = allKeys[node.type];
  if (!keys) {
    console.log(`  !! no visitorKeys for ${node.type} (leaf-tolerated by dynamic walk, fatal for generated walkers)`);
    return;
  }
  for (const key of keys) {
    const v = node[key];
    if (Array.isArray(v)) for (const c of v) dynWalk(c, node.type, key);
    else if (v && typeof v === "object") dynWalk(v, node.type, key);
  }
}
dynWalk(tree.program, null, null);

// ---------- 3. RFC-style static schema + generated walkers ----------
// Derive schema: for each (type, field), the set of child types observed.
// Sets of size > 1 are unions.
const fieldTypes = new Map();
(function derive(node) {
  if (!node || typeof node.type !== "string") return;
  if (!fieldTypes.has(node.type)) fieldTypes.set(node.type, new Map());
  const fmap = fieldTypes.get(node.type);
  for (const key of allKeys[node.type] ?? []) {
    const v = node[key];
    const kids = Array.isArray(v) ? v : v ? [v] : [];
    for (const c of kids) {
      if (!c || typeof c.type !== "string") continue;
      if (!fmap.has(key)) fmap.set(key, new Set());
      fmap.get(key).add(c.type);
      derive(c);
    }
  }
})(tree.program);

const walkers = {};
const rfcCounts = new Map();
const visit = (type) => rfcCounts.set(type, (rfcCounts.get(type) ?? 0) + 1);
for (const [type, fmap] of fieldTypes) {
  const lines = [`cb(${JSON.stringify(type)});`];
  for (const key of allKeys[type] ?? []) {
    const types = fmap.get(key);
    if (!types) continue;
    const dispatch = types.size === 1
      ? `walkers[${JSON.stringify([...types][0])}](c, walkers, cb)`
      : `(walkers[c.type] || (() => { throw new Error("union miss: " + c.type + " in ${type}.${key}"); }))(c, walkers, cb)`;
    lines.push(`{ const v = node[${JSON.stringify(key)}];
      if (Array.isArray(v)) { for (const c of v) if (c) ${dispatch}; }
      else if (v) { const c = v; ${dispatch}; } }`);
  }
  walkers[type] = new Function("node", "walkers", "cb", lines.join("\n"));
}
walkers[tree.program.type](tree.program, walkers, visit);

// ---------- 4. compare ----------
let mismatches = 0;
for (const [type, n] of refCounts) {
  if (rfcCounts.get(type) !== n) {
    mismatches++;
    console.log(`MISMATCH ${type}: dynamic=${n} generated=${rfcCounts.get(type) ?? 0}`);
  }
}
const glimmerTypes = [...refCounts.keys()].filter((t) => t.startsWith("Glimmer"));
const total = (m) => [...m.values()].reduce((a, b) => a + b, 0);
console.log(`node types visited: ${refCounts.size} (${glimmerTypes.length} Glimmer types)`);
console.log(`total nodes: dynamic=${total(refCounts)} generated=${total(rfcCounts)}, mismatches=${mismatches}`);
console.log(`\nGlimmer nodes in ESTree parent positions (base unions a plugin must extend):`);
for (const [k, v] of glimmerParents) console.log(`  ${k} -> ${[...v].join(", ")}`);
console.log(`\nGlimmer types: ${glimmerTypes.join(", ")}`);

// Spans: grafted nodes carry original-file offsets, so diagnostics reported
// from the native AST need no mapping.
const h1 = (function find(n) {
  if (!n || typeof n !== "object") return null;
  if (n.type === "GlimmerElementNode" && n.tag === "h1") return n;
  for (const k of allKeys[n.type] ?? []) {
    const v = n[k];
    for (const c of Array.isArray(v) ? v : [v]) {
      const r = find(c);
      if (r) return r;
    }
  }
  return null;
})(tree.program);
console.log(`\n<h1> span check: range=${JSON.stringify(h1.range)} source.slice=${JSON.stringify(source.slice(h1.range[0], h1.range[0] + 25))}...`);
