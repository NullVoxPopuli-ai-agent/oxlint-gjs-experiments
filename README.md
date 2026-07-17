# oxlint-gjs-experiments

Feasibility experiments for supporting Ember `.gjs`/`.gts` under the Oxlint language-plugin RFC ([oxc-project/oxc#21936](https://github.com/oxc-project/oxc/discussions/21936)), from the perspective of [ember-eslint-parser](https://github.com/ember-tooling/ember-eslint-parser) / [eslint-plugin-ember](https://github.com/ember-cli/eslint-plugin-ember) (context: [ember-eslint-parser#208](https://github.com/ember-tooling/ember-eslint-parser/issues/208)).

```bash
npm install
node 1-static-schema-walker.mjs
node 2-transform-contract.mjs
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
- The lint/type-faithful transform for gjs/gts is [Glint](https://github.com/typed-ember/glint) v2's Volar-based codegen (virtual TS where every template identifier is a real typed reference, plus Volar mappings) — the architecture the RFC already cites.
- `content-tag`'s `parse()` API yields exact template byte ranges (43% of this sample file), which is all a masking / "shadow source" fallback needs for the remaining 57% to be identity-mapped.
