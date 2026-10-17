# Handoff checks — Codex

Checks ran at `afeeef5c69385cb5c888bae5c138d862aa8f4ed7`, with main `30781f3` merged cleanly. The approved model remains byte-for-byte unchanged from visual checkpoint `720c928`; only handoff prose and these receipts follow it within the courier study directory.

- `model-test.txt`: two explicit exported-model tests pass, 3,705 assertions.
- `probe-selection.txt`: initial semantic selection (7).
- `probe-run.txt`: the canonical runner selected 9 on its own evaluation and all 9 passed in 146 seconds using Apple M1 Pro hardware. This is partial evidence: 87 of 96 production probes were not run. No manual narrowing was applied.
- Production build, format and lint checks passed. Build output contains no courier-hull study paths.
- The strict isolated viewer typecheck and final hardware viewer evidence are recorded in `../flagship-pass-19/`.

The full headless run and GitHub CI status are reported on PR #805. This receipt does not assert full production browser coverage, Sage approval, in-game visual approval or deployment. The receiving agent owns those integration gates.
