# Exact multi-probe runner receipt

Run date: 2026-09-19. Producing head:
`068c9b164a9e51d967bcf8e776dbc2c605cc7d5f`.

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
probing http://127.0.0.1:58832 (dev server) — 2 probes, 1 at a time
     filtered by PROBE_FILES probe-boot.mjs,probe-key-dispatch.mjs: 52 of 54 probes were not run.

ok   probe-boot.mjs (85.7s)
ok   probe-key-dispatch.mjs (11.4s)

2/2 gating probes passed in 97s — PARTIAL RUN, PROBE_FILES probe-boot.mjs,probe-key-dispatch.mjs: 52 of 54 probes were not run.
     This is not a pass for the suite. Run `npm run probe` for that.
```
