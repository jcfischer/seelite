# seelite

**Live: [seelite.pages.dev](https://seelite.pages.dev)** — add `?seed=42` to pin
a world.

A browser-based game inspired by **Elite (1984)** — trade, fight, and explore a
seeded procedural galaxy from your ship. No on-foot gameplay; the player is
always the ship.

Sibling project of [seekolous](https://github.com/jcfischer/seekolous), from
which it vendors the engine-agnostic core (seeded RNG streams, simplex noise,
WebAudio synth FX, the probe/test harness) — copied in, diverging freely. What
crossed, what was adapted and what was deliberately left behind is recorded in
[`docs/reuse-manifest.md`](docs/reuse-manifest.md).

Stack: **TypeScript + Vite + Three.js**, static bundle, no backend, procedural
everything.

## Running it

```bash
npm install
npm run dev            # then open the URL it prints; add ?seed=42 to pin a world
```

Fly with **W/S** or **↑/↓** (pitch), **A/D** or **←/→** (yaw), **Q/E** (roll),
**Shift/Ctrl** (throttle).

A **game controller** works too, and the sticks are analog where a key has one
speed: right stick to fly, left stick to roll, triggers to trim the throttle,
and the d-pad and face buttons to work the consoles. `docs/gamepad.md` has the
table and what the pad cannot do.

## Checks

Two tiers, and the split is the point. Anything that is arithmetic gets asserted
headlessly and cheaply; anything that only means something in front of a running
renderer gets a browser.

```bash
npm test               # headless: seeded generation, the float64 sim, module boundaries
npm run probe          # browser: boots its own dev server, runs the probe suite
npm run build          # tsc --noEmit && vite build
npm run format         # biome
```

Both tiers gate on pull requests (`.github/workflows/`).

## Deploying

`main` publishes to [seelite.pages.dev](https://seelite.pages.dev) via
`.github/workflows/ci.yml`, whose deploy stage runs on `main` alone — a pull
request or a branch run gets the test stage and publishes nothing. The Pages
project is **direct upload**, not
Cloudflare's Git integration — a direct-upload project cannot be converted
later, so the deploy is driven from CI to get push-to-deploy without committing
to a project shape.

The deploy stage is inert unless `CLOUDFLARE_API_TOKEN` is set as a repository
secret: it emits a warning and skips, so the build, typecheck and test gates
work regardless. `CLOUDFLARE_ACCOUNT_ID` is already set. To deploy by hand:

```bash
npm run build
npx wrangler pages deploy dist --project-name=seelite --branch=main
```

## Architecture

The load-bearing decision so far is how to render and simulate at astronomical
scale, researched in
[`docs/research/space-scale-rendering.md`](docs/research/space-scale-rendering.md):

- **Sim space** is float64 kilometres, in `src/sim.ts`, which cannot import
  Three.js. The scene graph is display only — nothing reads a position back out
  of it.
- **The camera never moves.** It sits at the origin and only rotates; every
  entity is placed at `simPos - simCameraPos` each frame.
- **Three depth layers**, drawn back to front with depth cleared between:
  background stars, far bodies at 1/100,000 scale, near objects at 1:1 km.

`docs/research/elite-1984-mechanics.md` carries the recovered original game
mechanics — seeds, market formulas, ratings, docking.

## Status

Charting and building. The work map lives on this repo's issue tracker — find it
via the `orienteer:map` label. Decisions resolved so far are indexed on the map
itself; open decisions include the flight model, galaxy and system generation,
and the economy.
