# Exact multi-probe runner receipt

Run date: 2026-09-19. Producing head:
`80af642032ee314b2063f0ffd44d3e5b829320d2`.

The current `check:wiring` gate is already red on `main` under #376, so this
receipt invokes `probe-all.mjs` directly and bypasses only that known preflight.
It verifies the selector's authenticated exact-name handoff and the real shared
dev-server/browser runner; it is partial evidence, not a full-suite pass.

```sh
env -i PATH="$PATH" HOME="$HOME" TMPDIR="${TMPDIR:-/tmp}" \
  PROBE_SELECTION=1 \
  PROBE_FILES=probe-boot.mjs,probe-key-dispatch.mjs \
  node scripts/probe-all.mjs
```

```text
probing http://127.0.0.1:53273 (dev server) — 2 probes, 1 at a time
     filtered by PROBE_FILES probe-boot.mjs,probe-key-dispatch.mjs: 51 of 53 probes were not run.

ok   probe-boot.mjs (75.4s)
ok   probe-key-dispatch.mjs (11.2s)

2/2 gating probes passed in 87s — PARTIAL RUN, PROBE_FILES probe-boot.mjs,probe-key-dispatch.mjs: 51 of 53 probes were not run.
     This is not a pass for the suite. Run `npm run probe` for that.
```
