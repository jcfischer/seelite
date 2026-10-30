# Cockpit text surfaces

The cabin names a readout with a `screen-<source>` mesh. Its UV corners are
top-left `(0, 0)`, top-right `(1, 0)`, and bottom-left `(0, 1)`. Node transforms
apply before the game derives the screen frame. Names must be unique. Empty
screens, missing UV corners, and duplicate names fail at the model boundary.

One screen can serve several sources: `screen-<a>+<b>` serves `a` and `b`
(`cockpitScreenFor`). Its sources share one face and stack in the order the
game writes them, as on the fallback. A source may be named by one screen
only; two screens that name the same source fail at the model boundary.

`cockpitScreenFrames` discovers all names. There is no required screen list.
`cockpitCanvasFace` mounts faces directly on those frames at a fixed stand-off
in cabin kilometres, and `cockpit-text.ts` owns their text
rendering. Canvas dimensions follow the screen aspect, so a portrait screen
does not stretch a landscape texture. Plain text wraps at word boundaries on
portrait faces before the font fit. Readings update while the pilot looks
at another console. Static `label-*` and `key-*` meshes remain equipment labels.

| Source | Reading |
| --- | --- |
| `radar` | Scanner and contact hologram |
| `flight` | Speed and velocity reference |
| `target` | Target, designation, range, ETA and relative speed |
| `status` | MODE, THR, ASSIST and CHARGE |
| `lasers` | Armed fire group |
| `combat` | Shields, heat, hull temperature and fuel scooping |
| `course` | Set course |
| `ore` | Mined ore, fragments and hold |
| `survey` | Selected rock's survey reading |
| `notices` | Scoop, offence, mining and escape-pod messages |
| `prompt` | Cruise, jump, docking and first-day guidance |
| `clearance` | Docking clearance or its refusal |
| `missiles` | Missile lock, incoming warning and ECM |
| `controls` | First-day flight controls |
| `prototype-combat` | The optional combat study's readings |

The current base has no live drill or anchor producer. A model may already
name `screen-drill` and `screen-anchor`; they stay dark until such producers
exist. Any other screen without a live producer also stays unpowered,
including the courier's `screen-systems`.

## Missing surfaces

`screen-fallback` is the one fallback console. The game combines unmatched
text sources there and fits their lines within that opaque face. Missing radar,
flight and target screens receive separate parts of the same console through
`routeCockpitSources`; text uses the remaining part. If the model omits even
the fallback, the game supplies an opaque emergency console below the forward
sightline, at `emergencyConsoleFrame()` in cabin coordinates. No missing source
falls back to the glass.

The courier GLB, authored in `spikes/courier-cockpit/build_model.py`, has
one centre display set into the dashboard brow (`screen-fallback`, which
carries `status` and every source without a screen) and a housing on each
side pod with one shared screen: `screen-notices+lasers` and
`screen-ore+survey`. Its original screens and static captions
remain. World markers, target labels, the reticle and docking geometry keep
their spatial positions; they are bearings rather than stationary readouts.
Chase view retains its existing spatial cues and event notices.

## Verification

`tests/cockpit-text.test.ts` decodes the shipped courier and
`scripts/fixtures/cockpit-text-cabin.glb` through the GLTF loader. The second
fixture has moved, differently sized survey and ore screens, no flight screen,
an unpowered systems screen and a fallback. It represents a different cabin
contract without integrating the miner study or seat switching.

`probe-live-cockpit.mjs` compares actual face pixels with the complete reading
and a source-omitted control. The status checks vary live flight state at both
viewports. It also installs the alternate GLB through `Game.buildCockpit`,
checks visible ore and survey faces, reads the missing flight instrument on its
fallback, and checks the unpowered systems material. The fixture stays inside
the cabin camera planes. The combat, missile, fire-group and notice probes read the new face
canvases. Glass-band and translucent-plate layout assertions are superseded by
the opaque physical faces; simulation projection tests remain in the unit tier.

The courier before/after capture and changelog sentence require the principal's
approval before merge. Passing automated checks does not supply that approval.
