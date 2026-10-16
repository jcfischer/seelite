# Node #755 — terran footprint octaves

The live terran program extends continent, ridged mountain, moisture and cap-edge
fields. The shared helpers continue the existing coordinate recurrence and halve
amplitude per octave, normalising the fractional last octave with the same weight.
The warp and terrain bake retain their original fields. No RNG domain changes.

Footprint is fragment distance × target pixel angle / grazing cosine, in body
radii, with a cosine floor of 0.1. Each field applies its own frequency. The
draw callback reads the actual target height and camera projection, including
the half-resolution prepass, adaptive resolution and postcard targets.
`terrainCoordinates` is the seam for a later camera-local ground frame.

Low's uniform cap is 0; High terran's interim cap is 6. Other classes receive 0.
The cap fades from full at 1.6R to zero at 2R. Low and cameras at or beyond 2R
select the original program: merely returning the old fBm through a new helper
changed one display code in one channel on ANGLE Metal. Both programs are warmed
before approach, including the half-target variant. Relief policy stays as shipped;
the close production terran path remains screen-space.

## Verification

- `tests/planet-footprint.test.ts`: 8 tests, including generated helper arithmetic
  at fractional and capped octave counts, zero-weight equality, quality mapping,
  actual draw-target height, base-program selection, splice logs and warm-up.
- GPU lane: ANGLE Metal / Apple M1 Pro. `probe-planet-footprint`: 33/33 checks.
  All nine classes match the original shared source at cap zero. Terran cap zero
  matches its original fields at 1.2, 1.5, 2, 3 and 20R. Repeat differences are
  zero. Cap 0 versus 6 differs at 1.2/1.5R and is identical at 2/3/20R.
  The actual GLSL helpers match base fBm exactly for coarse footprints and cap
  zero, before framebuffer quantisation. Half-target pixel angle is exactly twice
  the full target's. All four field splices report landed in mesh userData.
- `probe-planet-surfaces`: 114/114 checks; includes the pre-warm regression.
- `probe-planets`: passing gallery contract. These are manually selected affected
  probes, not a full browser-suite or PR-gate pass.
- Typecheck, formatting, lint, wiring and production build checked locally.
  The single final `npm test` run on this host passed: 6,354 tests, 0 failures,
  across 364 files (721.22 s).

## Eye gate and handoff

`npm run probe:one -- probe-planet-footprint` on the hardware lane launches headed
Chromium and writes `view-set/footprint-octaves/index.html`, PNG pairs and metrics.
Left is cap 0 (base fields), right is cap 6, with all other settings fixed. It uses
the canonical placers for planet-fill, planet-terminator, station-horizon and
planet-boundary, reading horizon framing facts before capture. It does not capture
the entire canonical view set or claim the remaining system-view comparisons.

On the final capture, fill and terminator have zero delta and zero repeat noise.
Mean absolute channel deltas are 0.09646 at station-horizon and 0.03020 at
planet-boundary (0–255 display codes); both repeat controls are zero. This proves
an effect, not legibility. The agent inspected these frames without seeing obvious
precision banding; this is not an exhaustive precision measurement. The principal's
yes on coast, mountain, vegetation and ice-line legibility remains required by
`cp-seelite-footprint-octaves-terran` and `ranger:needs-eye`.

The supervisor owns push, PR, Sage, final browser selection and the principal's
merge. The selector's working-diff diagnostic falls back to all probes because
`src/main.ts` is shared runtime. No graph node has been changed or closed.
This is detail tuning of an existing surface, not a new mechanic or screen under
the public changelog's definition of major.
