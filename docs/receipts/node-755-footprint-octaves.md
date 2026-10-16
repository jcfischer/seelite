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
select the original program to avoid inactive footprint arithmetic. Both programs
are warmed before approach, including the half-target variant. Relief policy
stays as shipped; the close production terran path remains screen-space.

Round 1 corrected the parity oracle: the probe now forces the footprint source
after the draw hook, including at cap zero and beyond 2R. The earlier 33/33 result
compared the base program with itself on those arms and did not prove the claimed
terran parity. The corrected check reproduced one changed channel at 1.2, 1.5,
1.9999 and 2R on ANGLE Metal. Diagnostic normal output differed even where albedo
matched. Removing the helpers' early return through the original fBm removed this
drift: the footprint helper now always performs the original accumulation and
division, breaking before touching either sum when the extra weight is zero.

## Verification

- `tests/planet-footprint.test.ts`: 9 tests, including generated helper arithmetic
  at fractional and capped octave counts, zero-weight equality, quality mapping,
  actual draw-target height, base-program selection, splice logs and warm-up.
  The probe and tests share a GLSL function-range reader with nested-block and
  malformed-source checks. Targeted planet tests: 101 passing across nine files.
- GPU lane: ANGLE Metal / Apple M1 Pro. `probe-planet-footprint`: 44/44 checks.
  All nine classes match the original shared source without the new helper
  definitions. The forced footprint program at cap zero matches original pixels
  at 1.2, 1.5, 1.9, 1.99, 1.9999, 2, 3 and 20R. Repeat differences are zero.
  Forced High differs at 1.2/1.5/1.9/1.99R and joins original pixels exactly at
  1.9999/2/3/20R. No pixel tolerance was added. Deliberately changing zero-weight
  arithmetic moves 357,385 channels; delaying the fade end to 2.2R moves 19,611
  channels at 2R, proving both detectors see the defects they name.
  The actual GLSL helpers match base fBm exactly for coarse footprints and cap
  zero, before framebuffer quantisation. Half-target pixel angle is exactly twice
  the full target's. All four field splices report landed in mesh userData.
- `probe-planet-surfaces`: 114/114 checks; includes the pre-warm regression.
- `probe-planets`: 69/69 checks. All three affected probes passed in 89 seconds.
  These are manually selected affected probes, not a full browser-suite or
  PR-gate pass.
- Typecheck, formatting, lint, wiring and production build checked locally.
  The single final review-pass `npm test` run on this host passed: 6,355 tests,
  0 failures, across 364 files (704.22 s).

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
`src/main.ts` is shared runtime; the added GLSL reader also triggers the shared
probe-harness fallback. The ranger contract limits this worker to the affected
planet probes. No graph node has been changed or closed.
This is detail tuning of an existing surface, not a new mechanic or screen under
the public changelog's definition of major.

The optional program-selection and prewarm refactors were left out of this
parity repair to keep runtime changes narrow. No frame-time price is claimed;
the cap-0/cap-6 timing baseline remains for the pricing node below #720, which
owns the final cap. The review's shared GLSL scanner suggestion was taken.
