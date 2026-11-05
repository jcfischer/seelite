# Node #1170: death-warning paint

Measured 2026-11-05 on the hardware lane, ANGLE Metal / Apple M5 Pro.
Base: `0ac662f10629ab0066cda17654f90f366d0a7d30` (`origin/main`).

## Diagnosis

The warning is amber. The reported mean was measured on the wrong canvas.
`77ad6fd0` (node #1151, PR #1158) moved cockpit text to model-owned screens.
In cockpit view, `drawReadoutNotice` does not paint the overlay, but
`drawEjectNotice` still records `ejectWarningRender.text`.
`presentCockpitReadouts` writes the sentence to `notices` with the action
colour `rgba(255, 196, 110, 0.95)`. The courier routes it to
`readout-notices+lasers-mount`, shared with the cyan laser label.
This routing is already present at the reported main ref `ec561ec5`.

`dda0b64c` (PR #1176), already in this branch's base, repaired the probe's
sampling: read the notices texture instead of the overlay, and count amber
pixels rather than averaging every changed colour. The unchanged probe passed
37/37 here on retry: 20,374 changed texels, 9,539 amber, zero jitter.
Its first run stopped at an unrelated 20-second post-death boot timeout in arm 3,
before reaching the warning (124.5 seconds, peak load 15.0).
The complete retry took 214.8 seconds, peak load 16.4.

The original **219 pixels and exact RGB mean** also reproduce with **no
warning**, a full hull (100), no fitted pod, and no state changes. Take five
successive overlay `getImageData` captures, separated by four animation frames:

| Consecutive reads | Changed pixels | Mean R | Mean G | Mean B |
| --- | ---: | ---: | ---: | ---: |
| 1 → 2 | 0 | 0 | 0 | 0 |
| 2 → 3 | 219 | 166.46575342465752 | 193.82648401826484 | 180.10502283105023 |
| 3 → 4 | 0 | 0 | 0 | 0 |
| 4 → 5 | 0 | 0 | 0 | 0 |

Creating the overlay context with `willReadFrequently: true` **before boot**
removes the residual: all four comparisons are zero. Asking for that option
on an already-created context, as the old probe did, cannot change its creation
attributes. This isolates a readback-induced canvas backend transition, consistent
with Chromium's [read-count fallback to CPU](https://chromium.googlesource.com/chromium/src/third_party/+/d624335823bcd33e7b27565e62cb8b1af4dcf7c9/blink/renderer/modules/canvas/canvas2d/base_rendering_context_2d.cc#815).
The old jitter arm compared reads 1 and 2, so it missed the transition before
read 3. Neither its zero jitter nor the string record established warning paint.

A separate paired capture on the same page showed the notices face moving
20,374 texels when the warning was removed, with zero amber in the resulting
control. The overlay also reproduced the same unrelated 219-pixel residual.
The captured full game frame and notices texture were opened and inspected;
the sentence is amber on the left cockpit screen. No game paint was changed.

## Repeating the residual measurement

Use a fresh hardware page with the normal probe helpers: `gameUrl(origin,
{seed: 42, "no-save": true})`, `bootedGame(page)`, then wait for
`!window.__seelite.clockHeld`. Before any overlay readback, evaluate:

```js
const canvas = document.getElementById("overlay");
const ctx = canvas.getContext("2d");
const captures = [];
for (let n = 0; n < 5; n++) {
  for (let frame = 0; frame < 4; frame++)
    await new Promise(requestAnimationFrame);
  captures.push(ctx.getImageData(0, 0, canvas.width, canvas.height).data);
}
return captures.slice(1).map((after, index) => {
  const before = captures[index];
  let moved = 0;
  const rgb = [0, 0, 0];
  for (let i = 0; i < before.length; i += 4) {
    const delta = [0, 1, 2, 3].reduce(
      (sum, c) => sum + Math.abs(after[i + c] - before[i + c]), 0);
    if (delta < 24) continue;
    moved++;
    rgb.forEach((_, c) => { rgb[c] += after[i + c]; });
  }
  return { moved, rgb: rgb.map(sum => sum / (moved || 1)) };
});
```

For the intervention arm, use another fresh page and call `page.addInitScript`
**before navigation** with:

```js
const getContext = HTMLCanvasElement.prototype.getContext;
HTMLCanvasElement.prototype.getContext = function (type, options) {
  return getContext.call(this, type,
    type === "2d" && this.id === "overlay"
      ? { ...options, willReadFrequently: true }
      : options);
};
```

This intervention is diagnostic only; it changes no game source or WebGL lane.

## Repair and verification

The remaining classifier also accepted refusal red (`255,110,96`): all 300 red
pixels in the new regression test counted as amber before the repair. The shared
probe helper now additionally requires `G > B + 40`, alongside the existing
`R > B + 60` and `R >= G`. Intended amber has an 86-code G–B separation before
alpha blending; refusal red has only 14. The 200-pixel floor and fourfold jitter
margin are unchanged. Headless tests also reject green, cyan, white, absent
paint, missing faces and mismatched capture sizes.

The live warning arm removes only the warning's text entry, then repaints only
that entry in refusal red, and finally restores the original writer. Each
injection must intercept the warning, the red control must paint more than 200
changed pixels, both negative controls must fail the same colour gate, and the
restored amber must pass. Other lines on the shared screen remain present.
The original recovery, voice and no-save assertions remain intact.

No death-probe quarantine was installed in the supplied main base. Its repaired
warning passes there, so adding an obsolete quarantine would hide a working
gate. The unrelated node #975 entry remains untouched. This is probe work,
not a major player-visible change under `src/changelog.ts`.

### Final-head evidence and remaining boot failure

At implementation commit `0d81dfb2`, the selector chose death plus the three
standard smoke probes. Only death was run under the worker's focused-probe SOP.
The full browser suite was not run.

The normal final-head live command stopped before its first assertion at the
existing `bootedGame(page)` 20-second limit on three cold-server runs
(22.2, 22.0 and 21.5 seconds total). A run against a guarded warm server also
stopped there (21.8 seconds). No game source, boot helper or timeout was changed.
An independent ordinary boot completed in 18.386 seconds; a warm-up page took
21.544 seconds. The earlier main-base run also hit a post-death boot timeout,
and the main-base retry passed all 37 original assertions, as recorded above.
The new colour helper is imported by the browser only in arm 6, long after
these initial boot failures.

To inspect the changed contract despite that setup failure, the exact arm-6
source was evaluated separately with a 60-second **diagnostic setup** budget.
All six warning checks passed on hardware:

| Capture | Changed texels | Amber texels |
| --- | ---: | ---: |
| Warning against whole-hull control | 20,374 | 9,438 |
| Repeat warning (jitter) | 0 | 0 |
| Warning removed | 0 | 0 |
| Warning painted refusal red | 20,279 | 0 |
| Original amber writer restored | 20,374 | 9,479 |

Both negative controls intercepted four warning writes. The voice counts stayed
1 / 1 / 2 across the original crossings, and the no-pod/healed records cleared.
The separate diagnostic does not cover recovery arms and is **not** a pass of
the normal live command. Final-head full-probe acceptance remains limited by
the boot timeout; no thresholds were weakened to report it green.

The build (including typecheck and bundle-size checks), format, lint and
comment gates passed. The focused headless test passed 3/3 with 20 assertions,
after first failing on the old refusal-red classification.

The required single final `npm test` run passed on this host: **7,452 pass,
0 fail**, 17,075,320 assertions across 461 files, in 1,177.37 seconds.
No browser or other check from this worker ran alongside it.
