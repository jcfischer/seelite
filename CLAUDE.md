# seelite

A browser-playable classic-Elite (1984) trade–fight–explore loop. TypeScript +
Vite + Three.js, static bundle, no backend, no runtime network requests.

## Read the map first

Work on this repo is planned as a **work-graph map**, and the map is the
authority on what to build and how:

```bash
soma graph node 1          # the map: destination, constraints, notes, decisions
soma graph frontier 1      # what is takeable right now
```

Its **Constraints** section binds every answer — an option that violates one is
not on the table. Its **Notes** section carries the delivery SOP (claim →
branch → worktree → TDD → PR → sage review → merge), when to stop reviewing, and
the repo's verification culture. Do not restate either here; read them there, so
there is one authoritative copy rather than two that drift.

The `orienteer` skill walks the map. Every graph operation is a `soma graph`
verb — never reach past them to `gh issue` for node lifecycle, because the verbs
carry the rules.

This file exists because it is **tracked**, so it is present in every git
worktree the SOP tells you to create. Per-agent memory is not: a worktree is its
own project scope and loads none of it.

## Verification, both tiers

Anything arithmetic gets a headless test; anything rendered or spatial gets a
browser probe. A change is not done until both are green.

```bash
npm test                   # bun, headless — sim logic, generators, unit scheme
npm run probe              # starts a dev server, runs every browser probe
npm run probe:one <name>   # one probe
npx tsc --noEmit           # no errors
npm run format:check       # biome, no fixes applied
npm run build              # tsc + vite build
```

`scripts/probe-guard.mjs` refuses to measure a dev server that is not serving
this working tree — the failure it prevents is a probe passing against someone
else's checkout on the same port.

## Things that will bite you

- **`src/units.ts` and `src/vec3.ts` are leaves.** They import nothing, and
  `tests/headless.test.ts` asserts it. A value import into either can close an
  import cycle or drag a renderer into the headless tier.
- **`src/sim.ts` must not import Three.js.** The authoritative world is float64
  kilometres outside the scene graph; the scene graph is display only, and
  nothing reads a position back out of an `Object3D`.
- **A body's render layer is its distance, not its kind** — near within
  `HANDOFF_KM` of the camera, far beyond it, with a hysteresis band. Anything
  that adds a drawn object inherits this rather than picking a layer.
- **Per-system RNG streams.** One shared generator couples every system to every
  other system's draw count. Add a domain tag rather than reusing one; reusing a
  tag silently correlates the two draws.
- **Probes read constants off the page** (`window.__seelite.units`) instead of
  restating them. A probe with its own copy of a constant goes falsely red when
  the module changes it.
- **The probe registry authorises no `command` or `url` probes for this repo.** A
  work-graph node declaring one will refuse to close until the adopter declares
  it.

## Stack

TypeScript, bun for tests, npm-compatible lockfile, biome for formatting,
Playwright for probes. No Python. Procedural everything — no downloaded assets;
audio synthesised via WebAudio, textures generated at load.
