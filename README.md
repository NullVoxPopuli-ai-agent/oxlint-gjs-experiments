# oxlint-gjs-experiments

Feasibility experiments for supporting Ember `.gjs`/`.gts` under the Oxlint language-plugin RFC ([oxc-project/oxc#21936](https://github.com/oxc-project/oxc/discussions/21936)), from the perspective of [ember-eslint-parser](https://github.com/ember-tooling/ember-eslint-parser) / [eslint-plugin-ember](https://github.com/ember-cli/eslint-plugin-ember) (context: [ember-eslint-parser#208](https://github.com/ember-tooling/ember-eslint-parser/issues/208)).

```bash
npm install
node 1-static-schema-walker.mjs
node 2-transform-contract.mjs
node 3-glint-typed-transform.mjs
node 4-rust-rules-on-virtual-source.mjs
node 5-rule-consumption.mjs
```

## Experiment 1: RFC static visitorKeys schema + generated walkers

Parses a representative `.gts` with [ember-estree](https://www.npmjs.com/package/ember-estree) (standard ESTree with `Glimmer*` nodes grafted in at original-file offsets — the same AST shape ember-eslint-parser gives ESLint rules), derives a static `{nodes, unions}` schema, generates per-type walkers with `new Function` exactly as the RFC proposes, and compares against a reference dynamic walk.

Results:

- 82/82 nodes visited, 12 Glimmer node types reached, 0 mismatches. The generated-walker model works for this AST.
- Glimmer nodes appear in **ESTree** positions: `VariableDeclarator.init` and `ClassBody.body` in this sample; also `ExportDefaultDeclaration.declaration` and any Expression position in general. A language plugin therefore needs to extend Oxlint's *base ESTree* unions, not declare a disjoint language — otherwise the generated walkers for base JS nodes never descend into templates.
- Grafted node spans are original-file offsets: diagnostics from the native AST need no mapping.
- `GlimmerElementNodePart` has no visitorKeys entry in current ember-estree — a dynamic walk tolerates that silently; generated walkers would not. Registration-time schema validation would catch this class of bug.

## Experiment 2: TransformResult from existing Ember tooling

Runs [content-tag](https://www.npmjs.com/package/content-tag) (Rust/napi, Ember's build-time `<template>` transform) as a candidate `TransformResult` producer.

Results:

- It emits valid virtual TS plus a source map, but it is build output, not a lint-faithful representation:
  1. the whole file is reprinted (swc), so nothing outside templates is byte-identical;
  2. template bodies become opaque strings whose scope access goes through an `eval()` bag, so template identifier references are invisible to the virtual source — unused/undef analysis over it is wrong.
- The lint/type-faithful transform for gjs/gts is [Glint](https://github.com/typed-ember/glint) v2's Volar-based codegen (virtual TS where every template identifier is a real typed reference, plus Volar mappings) — the architecture the RFC already cites. Experiment 3 verifies this.
- `content-tag`'s `parse()` API yields exact template byte ranges (43% of this sample file), which is all a masking / "shadow source" fallback needs for the remaining 57% to be identity-mapped.

## Experiment 3: type-aware linting via Glint v2 codegen

Constructs `@glint/core` (v2, Volar-based) `VirtualGtsCode` for a `.gts` containing a type error inside a `<template>` (`{{this.cuont}}`, a typo for `this.count`).

Results:

- The embedded virtual TS contains `__glintRef__.this.cuont` — a real typed reference, no `eval()` (contrast Experiment 2).
- `embeddedCodes[0].mappings` are Volar `CodeMapping`s (`sourceOffsets`/`generatedOffsets`/`lengths`) — the RFC's `Mappings` shape as-is.
- Vanilla `ts.createProgram` over the virtual text reports `TS2551: Property 'cuont' does not exist on type 'Demo'. Did you mean 'count'?`, and the mappings alone relocate it to `demo.gts:7:15` — the exact offset of `cuont` in the original file.

This is the RFC's runtime flow, steps 4–6 (virtual source → typed diagnostics → report against the original file), executed end-to-end with already-published Ember tooling.

Note: `typescript` is pinned to 6.x. Glint requires the TS compiler API (peer range `>=5.6.0`); TypeScript 7 (the native port) does not expose that API.

## Experiment 4: real oxlint Rust rules on the virtual source

Runs stock `oxlint` (1.74.0, `--format json`) on the Glint-generated virtual TS for a `.gts` where `SomeButton` is imported and used only inside `<template>`, `unusedThing` is imported and never used, and a `debugger` statement sits in a class method. This is the RFC's runtime-flow step 4 with the actual Rust linter.

Results:

- `no-unused-vars` flags `unusedThing` and does **not** flag `SomeButton` — the faithful transform makes template usage visible to Rust rules, which a masking or `eval()`-bag virtual source cannot provide.
- `no-debugger` fires; its span maps back through the Volar mappings to `demo.gts:7:5`, the exact original offset.

## Experiment 5: the RFC's Consumption model with a real rule

A direct port of eslint-plugin-ember's `template-no-obsolete-elements` check, written exactly in the RFC's rule shape (`create(context)` returning a `GlimmerElementNode(node)` visitor — the RFC's `VElement` example), run by a minimal ESLint-style dispatcher over the native AST.

Results: 2 reports, on `<marquee>` and `<blink>` (one nested inside `{{#if}}`), both carrying original-file spans with no mapping step; `<p>` and `<SomeButton>` untouched.
