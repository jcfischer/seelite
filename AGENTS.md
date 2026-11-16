# Codex substrate dispatch — canonical SOP is `CLAUDE.md`

<!-- Intentionally maintained by this repository, not projected by Soma. -->

Read and follow `CLAUDE.md` as the repository SOP, including its mandatory
browser-probe selection step before running probes for a pull request.

## Claude audit authorization

The principal authorizes audits with Claude, including sending relevant project
transcripts, decision trails and supporting evidence to Claude for review. This
authorization persists across sessions; do not ask again. Exclude credentials,
secrets and unrelated private information.

## Rules and what enforces them

Each rule came from a mistake Sage review caught in at least two PRs. A rule
whose mistake can no longer happen is dropped.

| Rule | Enforced by | Proven on |
| --- | --- | --- |
| A `CONTEXT.md` `_Avoid_` alias is a word that means only that concept; a word with another sense in the code is a prose sentence beside the term, not an `_Avoid_` entry. | docs only (Sage's glossary lens matches aliases without their sense) | 37c9cdcf: PR #561 replay 53 -> 14 findings, PR #285 44 -> 1 |
| A doc comment sits directly on what it documents. | `seelite/no-stacked-docs` (`scripts/eslint/no-stacked-docs.mjs`), `tests/eslint-no-stacked-docs.test.ts` | 238535ac `src/main.ts:2258` (PR #1005), 1540cb94 `scripts/lib/decode-glb.ts:5` (PR #836) |
| A function takes at most five positional parameters; group the rest into an object. | ESLint `max-params` with the `eslint-suppressions.json` ratchet | bb03be27 `src/field-discovery.ts:39` (PR #1202) |
| A ternary does not nest; use `if`, a lookup or a named helper. | ESLint `no-nested-ternary` with the `eslint-suppressions.json` ratchet | 61e00655 `scripts/measure-planet-cost.mjs:1354` (PR #1141), 2772b080 `src/main.ts:9764` (PR #1127) |
