# Independent Dream Loop Pro review — utility roles, round 2

Reviewer: Codex independent visual judge. Both targets and `.dream-loop/round-2-final/{raider,prospector}/hero.png` inspected with view_image. Root `/Users/fischer/work/cyphr/spark/seelite/.worktrees/seelite-827`. Same strict rubric as round 1; target fidelity, not change effort, determines scores.

| Role | Composition /3 | Lighting /3 | Materials /3 | Details /1 | Total /10 | Previous |
|---|---:|---:|---:|---:|---:|---:|
| raider | 1.85 | 1.30 | 1.25 | 0.30 | **4.70** | 3.95 |
| prospector | 1.75 | 1.35 | 1.30 | 0.35 | **4.75** | 4.30 |

Both improved, neither close to target approval. Raider gains primarily from larger framing and stepped main body. Prospector gains from spine casing and drill detail. Shared structural problems remain, and repeating detail primitives will not resolve them.

## Raider: changes and repeated gaps

Framing is substantially better. The nose is now deeper and blunt; the deck has meaningful tiering. These respond to round 1. However, target shoulder structures still do not exist as distinct masses: the central form remains essentially one terraced hull with two rear nacelles. Target has an armored forward flank on each side, separated from a narrower raised spine by deep mechanical channels. Those flanks carry substantial weapons and converge into a short sturdy nose.

1. **Recompose the hull into separate volumes.** Build a narrow raised center spine, two low forward shoulder bodies and rear engine pods. Leave deep channels between spine and shoulders; bridge them with short bent piping and brackets. The current broad solid connecting terraces suppress the target's industrial machinery character.
2. **Replace the gun primitive.** Current guns still read as a cuboid plus two short nozzles. Target has long, heavy paired barrel assemblies, sleeves, breeches and mount rails. Make each visible gun roughly twice current length and substantially deeper, integrate it with the shoulder rather than putting a box on a roof. It should look like a weapon in a flat gray render.
3. **Shorten the uninterrupted forward taper.** Current nose occupies too much bare tapered surface. Carry the shoulder masses and vents forward, raise the nose underside and create its short rectangular terminal face with grille and lamps.
4. **Rebuild cockpit seating.** Current canopy is oversized glass stuck above the hull with dark/open-looking triangular gaps at its base. Target glass is inset in a thick segmented armored frame and continues into a smaller lower forward pane. Build a complete solid cabin shell around the glazing; fit it to the hull surface.
5. **Replace the checkerboard material assignment.** The alternating small red/cream/gray tiles are more regular than round 1 and much more regular than target. Target's mostly graphite armor has a few large coherent red/cream bands. Assign color by designed armor region, then put subtle seams/wear within it. Do not randomize each face or tile independently.
6. **Light structural recesses.** Target has directional metallic edge highlights, dark occluded channels and warm utility lamps. Capture still has uniform diffuse visibility and almost no lively local light. Once the cavities exist, use restrained occlusion/contact shadows and distinct roughness for pipes, armor and glass. More ambient brightness will reduce fidelity.

## Prospector: changes and repeated gaps

Spine casing and side machinery now replace some of the bare cylinder. Drill rings and a protective element are present. Framing improved but remains noticeably smaller than target (about 71% image width versus roughly 91%). The subject still feels like shallow pods attached to a long pipe, whereas target is a stocky chain of large fitted machinery.

1. **Compress and thicken the assembly.** Reduce the empty longitudinal gap between middle pods and cabin, increase central machinery depth, and increase pod height. Build dark substantial endcaps, collars and piston connectors at the pod faces. Target's machinery fills most of the silhouette; current thin parallel rails leave the middle visually skeletal.
2. **Replace the repeated spine segments.** Current evenly spaced top vent units and repeated pale strips are still a conveyor-belt pattern. Build 3–4 unequal armored machinery blocks with stepped profiles, black collars and offset grilles. Integrate pipes into these blocks instead of running two perfectly straight rails the entire length.
3. **Make cabin a complete industrial module.** Enlarge its armored cheeks and lower body, give it a short blunt snout, and inset two-tier glazing into a structural shell. The canopy currently has the same unsupported/glass-on-top appearance as raider. Target cabin has substantial yellow upper armor, cream side band and dark lower machinery.
4. **Replace drill silhouette, not just surface.** Current end remains a small blunt cylindrical fitting. Target is a large tapering sequence of cutter cones/rings ending at a fine point, with a broad toothed chuck and 3–4 visible cradle prongs. Build that outline explicitly and enlarge the drill's diameter relative to the cab. Add heavy under-cabin hose loops to explain the connection.
5. **Reduce repeated grille fences.** Current full-side strip vents are identical across every pod. Target is broad cream/yellow armor with smaller localized vents and dark mechanical endcaps. Move several grilles to top/end faces and return pod side area to coherent plate bands.
6. **Improve material grouping and light.** Cream/ochre distribution is recognizable but excessively tile-based, and glass is flat gray-teal. Use broad cream bands, dirt concentrated around joints, metal highlights on collars and several warm work lamps. Target sensor mast is a built assembly; current black stick with bright cube should become a bracketed mast with separate sensor face, but this is below hull/cab/drill in priority.

## Architectural recommendation

The same primitive vocabulary appears across both ships: chamfered boxes, universal hatch stamps, long pipes, repeated grille faces, planar canopies and independently colored plate cells. That vocabulary is imposing its own look over the approved targets. Introduce explicit role-level assemblies rather than continuing to decorate the current envelope:

- An armored cabin builder with solid cheeks, window recesses and lower glazing.
- A channel-separated raider hull plan with dedicated gun assemblies and forward shoulders.
- A prospector machinery plan of unequal deep modules, piston/collar junctions and a conical drill assembly.
- Material regions tied to structural plates/bands, independent of seam tessellation.

First compare a clay or single-gray render against target silhouette and major shadow masses. Only after those match should hatch/bolt/texture detail be expanded. Next iteration should prioritize these structural changes over tiny details.
