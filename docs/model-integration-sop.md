# Authored-model integration SOP

Use this workflow when bringing an approved model study into production, including
ships, station exteriors, cockpits and station interiors. The goal is to discover
shipping, geometry and performance problems before repeated review rounds.

Read this alongside [CLAUDE.md](../CLAUDE.md) and the live
[machine map #1](https://github.com/jcfischer/seelite/issues/1). The map remains
the authority for constraints, delivery order, review stopping and authorization;
CLAUDE.md owns verification commands and probe selection. This document adds the
model-specific sequence, not an alternative merge gate.

## 1. Establish the integration contract

- Read the live integration node, accepted design handoff and current main.
  Follow the map's claim, branch and isolated-worktree workflow. A design PR may
  be a handoff rather than a merge-ready production change.
- Record the accepted design commit and appearance approval. Preserve that
  checkpoint; do not restart visual exploration to improve a historical judge
  score. Production appearance still needs the principal's in-game approval.
- Record the intended form/variant mapping, units and axes, docking frame,
  authoritative envelope, collision owner, moving parts and resource ownership.
  Resolve dimension or gameplay-policy decisions before building around them.
- Inspect current shared integration code. Starting points include
  `src/model-urls.ts`, `src/courier-hull.ts`, `src/longwall-model.ts`,
  `src/authored-levels.ts`, `src/ship-detail.ts`, `src/coriolis-flight.ts` and
  `src/interior-install.ts`. Verify their current interfaces; old handoffs may
  recommend paths or blocking loaders that have since been replaced.
- Choose one representative model for the first complete integration. For a
  family, prove the shared path with it before extending to the remaining forms.
  Separately exercise exceptions such as rotating habitats and articulated ports.

**Exit evidence:** one short contract in the integration receipt; unresolved
principal decisions are explicit, not hidden inside adapter code.

## 2. Prepare the shipping asset before broad integration

- Keep editable sources, targets and historical review artifacts in `spikes/`.
  Produce runtime exports through the current production asset pipeline. Inspect
  the actual build output: review assets must not leak into deployment.
- Check every emitted file against the deployment host's current limit before
  review and again before delivery. The #883 failure was a 27,963,660-byte GLB
  exceeding Pages' 25 MiB limit. Treat that as a regression case, not proof that
  every future host has the same limit. A successful Vite build alone is not a
  deployment-size check. Prefer an automated build-output guard over a manual
  size check repeated across model PRs; if absent, record the explicit check.
- Decode the shipping asset through the production loader in geometry tests.
  Exercise compression and any quantization transforms, not only source meshes.
  Verify units once, world-space bounds, topology/retained surfaces, aperture and
  collision containment. Use triangle surfaces where vertices alone cannot
  establish clearance; include relevant rotations and assembly seeds.
- Distinguish lossless encoding from quantization. Verify exact round trips for
  lossless claims; quantify tolerated deviation for lossy steps. Keep an asset
  checksum and a reproducible preparation command.
- Do not globally scale a model to repair a local docking-opening mismatch.
  Adapt the flight export to authoritative geometry or obtain an explicit ruling
  on changing that geometry. Check the procedural fallback fits too.

**Exit evidence:** deployable export, loader-backed geometry checks, file sizes
and explicit geometric tolerances. Do this before expensive browser suites.

## 3. Prove one complete production integration

Use the same material/assembly helpers in the viewer and game where they express
the same design. Do not fork accepted assembly code into two independently
maintained implementations.

Exercise the applicable paths on the production bundle:

| Path | Evidence required |
| --- | --- |
| Boot and cold download | Current boot-set contract, progress/retry behavior, no accidental new blocking asset |
| Background installation | Procedural fallback, bounded construction/upload work, a completed swap and measured cold-install stalls |
| Interrupted or failed load | Deliberate fallback/retry behavior; no false success or unhandled rejection |
| Postcard/export | Waits for required models; failure is surfaced rather than silently exporting an unintended fallback |
| Flight and traffic | Player and NPC representations, mounts/lights, approach, dock and launch, collision and clearance |
| Jump/system change during install | Old work cannot install into or retain ownership of the wrong system |
| Repeated rebuild and teardown | Shared geometry/materials survive as intended; instances, lights and callbacks are released once |
| Rotation and render-layer changes | Game-clock ownership, correct moving frames and no unexpected shader/light-count churn |

Mark irrelevant rows with a reason. Reuse existing readiness predicates and
test seams. A delay in milliseconds is not evidence that a model has settled.
Distinguish a settled measurement fixture from a cold-install test: waiting for
settlement must not erase the stall the latter is supposed to detect.

**Exit evidence:** one model works end to end. Extend this proven path to the
rest of the family, preserving per-model geometry and performance checks.

## 4. Choose the production LOD policy from measurements

Agree the applicable performance and visual budgets before tuning. Measure the
procedural baseline, Full and candidate reduced representations in the same
built scene, with fixed seed, camera, viewport, quality and renderer. Shuffle
measurement-arm order where timing comparisons could otherwise measure drift.

Include the player's close view, several nearby traffic ships or fittings,
approach/docked views, and distance transitions in both directions. Record:

- runtime bytes, load/decode/install phases and cold-install frame stalls;
- actual draw calls and submitted triangles, not mesh counts called draw calls;
- steady frame-time distribution and measurement conditions;
- visual transition evidence at the real camera/FOV/resolution, including the
  nearer boundary allowed by hysteresis;
- scope of geometric error checks, including direction and sampling coverage.

Triangle reduction does not establish a speedup. Interior Auto LOD reduced
triangles but split instance batches and added calls; uniform LOD1 was the
accepted production choice. Treat that as evidence for measuring each workload,
not a rule that every model should use LOD1. Traffic and the player's ship may
need different policies.

A simplifier's target or self-reported error is not an independent bound on the
exported surface. Sampled deviations and a few headings support claims about
those samples, not a global maximum. Retain full geometry for authoritative
measurements where the model contract requires it.

**Exit evidence:** measured policy, production captures and any principal
tradeoff ruling, settled before the main review loop.

## 5. Verify in increasing scope

Follow CLAUDE.md's mandatory selector before browser probes and its canonical
selected runner. A selector fallback to all must not be manually narrowed.

During implementation, use meaningful geometry/unit tests and selected browser
coverage to resolve specific defects. The ordinary PR browser gate is smoke plus
affected contracts, selected by the repository (#891). Reserve a full suite for
the selector's broad/unknown-impact fallback, explicit node criteria, release or
weekly regression coverage. Rerun affected checks after fixes; do not rerun broad
suites merely to rewrite a receipt.

Keep Sage and browser suites sequential. Measure GPU performance without another
suite or capture competing for the machine. Record renderer, machine/load, build
SHA, asset checksum and fixture. Investigate a red alone before attributing it
to contention; if it persists, compare with current main in its own checkout.
Report a baseline failure and any waiver explicitly rather than calling it green.

Capture the canonical views and obtain production appearance approval. A viewer
at vsync-limited 60 FPS proves neither production headroom nor in-game acceptance.

## 6. Make review converge

- Before dispatch, confirm the configured reviewer is available and that the
  supported invocation can produce a complete, parsed report. A failed lens is
  incomplete review infrastructure, not a source defect to fix with a code edit.
  Repair/rerun through the supported workflow; do not call a partial round clean.
- Submit the production contract and measurements with the first review. Check
  known failure classes above yourself rather than using Sage to discover them
  one at a time.
- Maintain a disposition for each substantive finding: verified/fixed, declined
  with evidence, or awaiting a principal ruling. Reference that disposition when
  a finding repeats, and reassess it if code or evidence changes.
- Annotate genuine physical/Blender terminology exceptions narrowly using the
  repository's supported glossary mechanism. Do not rename valid API/domain
  terms or suppress the whole glossary to clear repeated false positives.
- Batch related fixes, check that each edit actually landed, then verify the
  affected behavior and review the resulting head under the delivery SOP.
- Apply the map's review stopping rule. Repeated optional refactors, historical
  prose and already-dispositioned terminology must not manufacture another code
  iteration. A substantive runtime defect, unsupported acceptance claim or
  missing review lens still needs resolution. Record the actual verdict and any
  explicit override; do not relabel them as approval.

## 7. Keep one current receipt and deliver

Use one integration receipt under `docs/receipts/`. Put the current summary first;
retain older measurements as clearly dated history. Add a short supersession
pointer to prototype handoffs whose scope statements would otherwise contradict
the integration. Preserve historical evidence rather than rewriting it as fresh.

Link detailed measurements from the PR, specs and handoff. Avoid copying volatile
figures and approval claims into several places. Correct a false claim where it
was published. Before delivery, check final diff scope, build artifacts, latest
applicable verification/review and production approval under the live SOP.
After an authorized merge/deploy, verify publication and model loading; CI green
is not proof that the asset was accepted by the host.

Receipt skeleton:

```markdown
# Model integration: <node / family>

## Current result
- Design PR/accepted commit; integration head; shipped asset checksums.
- Production mapping, geometry owners and shared adapters used.
- Production LOD/loading policy and principal rulings.
- Remaining limitations or unresolved gates.

## Asset and geometry preflight
- Preparation command, output sizes, deployment-limit check.
- Production-loader checks, units/axes, bounds, aperture/collision fit.
- Encoding guarantees and measured tolerances.

## Runtime and performance evidence
- Applicable lifecycle rows and results.
- Baseline/Full/candidate measurements; fixture and machine conditions.
- Captures, transitions and scope of error claims.

## Delivery evidence
- Tests and selected/full browser coverage, each tied to its code revision.
- Review head, complete/failed lenses, finding dispositions and final verdict.
- Principal in-game approval; changelog decision under the map's rule.
- Waivers, deployment verification or explicitly pending work.

## Historical measurements
- Dated earlier results, each marked with what superseded it.
```

## Existing handoffs: starting risks, not live status

This table records the 2026-10-11 review. Recheck each PR and its integration node
before acting. It neither assigns work nor authorizes a merge.

| Design handoff | First integration work |
| --- | --- |
| [Porter #799](https://github.com/jcfischer/seelite/pull/799), [Bollard #802](https://github.com/jcfischer/seelite/pull/802) | Shipping export, envelope/fallback fit and traffic LOD. Porter is the suggested first reusable ship integration. |
| [Seven ships #829](https://github.com/jcfischer/seelite/pull/829) | Prove a simpler hull first; then habitats/capitals, rotor phase and clearance. Existing LODs still need production-camera and multi-ship measurements. |
| [Stations #826](https://github.com/jcfischer/seelite/pull/826), [refineries #817](https://github.com/jcfischer/seelite/pull/817) | Prove one form's docking, collision, loading and interior connection before extending the family. |
| [Shipyards #811](https://github.com/jcfischer/seelite/pull/811) | Handoff reports a 102×66 m display aperture versus 120×70 m production slot, and approximately 34–80 MiB review GLBs. Adapt the flight export before broad integration. |
| [Discovery #816](https://github.com/jcfischer/seelite/pull/816) | Settle authoritative dimensions and runtime budget; handoff reports a 35.6 MB prototype GLB. |

## Evidence behind this workflow

- [Interiors #864](https://github.com/jcfischer/seelite/pull/864): eight review
  rounds; LOD batching/default changes, background-install stalls, light-pool
  changes, failed review lenses and repeated glossary findings.
- [Interior deployment fix #883](https://github.com/jcfischer/seelite/pull/883):
  oversized runtime asset discovered after the integration merged.
- [Courier #828](https://github.com/jcfischer/seelite/pull/828) and
  [miner #836](https://github.com/jcfischer/seelite/pull/836): ten rounds each,
  including traffic cost, loading contracts and unsupported LOD-error claims.
- [Coriolis #791](https://github.com/jcfischer/seelite/pull/791) and
  [cockpit #794](https://github.com/jcfischer/seelite/pull/794): shipping-loader
  geometry checks, reproducible export and shared viewer/game adoption helpers.
- [Probe timing #884](https://github.com/jcfischer/seelite/pull/884): deterministic
  state handles can shorten setup; measurements still need truthful coverage and
  machine conditions. Existing waits that measure real elapsed behavior remain.
