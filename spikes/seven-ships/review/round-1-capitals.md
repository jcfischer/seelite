# Independent visual review — capitals, round 1

Compared each approved `spikes/seven-ships/<role>/target.png` with `.dream-loop/round-1/<role>/hero.png` in `seelite-827`. All four images inspected with view_image. Scores concern target fidelity, not whether the meshes are usable. Neither reaches the 8/10 gate.

| Role | Composition /3 | Lighting /3 | Materials /3 | Details /1 | Total /10 |
|---|---:|---:|---:|---:|---:|
| Carrier | 1.4 | 1.5 | 1.0 | 0.2 | 4.1 |
| Dreadnought | 1.2 | 1.3 | 0.9 | 0.15 | 3.55 |

## Shared highest-impact fixes

1. Match framing first. Targets occupy almost the entire horizontal frame and roughly y=140–880. Current ships occupy only x≈365–1300 and y≈325–890, with a large empty upper-left field. Increase projected hull size approximately 1.5× and center its visual bounds; preserve diagonal orientation. Then re-evaluate silhouette at equal scale.
2. Rebuild the silhouette and large structural hierarchy before adding texture. Both implementations read as nearly the same uninterrupted octagonal tube with superficial ribs. The targets use heavy broad projecting armor arches, interrupted shoulders, inset machinery belts, raised deck structures and heavily articulated bows. Round details cannot compensate for missing middle-scale masses.
3. Replace uniform square panel grids and undifferentiated mottling with surface-specific panel composition. Target panels vary in size and value, have restrained edge wear, fasteners, recesses and layered plates; current surfaces repeat identical cells and broad dirty noise. Reduce random large blotches, especially on carrier white paint, and place wear at seams and corners.
4. Add lit mechanical recesses and contact shadows. Current exposure is readable, but top surfaces are flat beige/gray and small fittings barely cast convincing separation. Targets have crisp lit bevels, dark cavities, warm slit lights and subtly reflective exposed metal. Darken deck/roof materials rather than globally darkening the whole scene.
5. Restore scale evidence: small bridge windows, multiple thin conduits, fixture clusters, rails, gantries and restrained tiny lights. Current single large cockpit glazing and isolated miniatures make both hulls appear toy-like.

## Carrier

### Composition and geometry

- Basic elongated carrier direction, rear pods and open bow are present, but the target has a substantially heavier, layered near-side wall and a much richer shoulder profile.
- Roof currently resembles a thin oversized rectangular lid hovering over a tube. Replace it with an integrated dark flight deck, inset into thick bordered shoulders with side rails and stepped machinery; reduce the exposed beige square-grid field.
- Target ribs are wide armor frames around broad curved/chamfered white bays; current skinny black strips have conspicuous repeated mustard clips. Widen frames, add bevel planes and differentiated large junction blocks; recess the bays between them.
- Bridge must become a stepped multi-tier island with dark wraparound narrow windows, adjacent housings and antenna/dome cluster. Current tiny wedge cockpit is insufficient.
- Bow opening needs thick chamfered armor, dark inset nested jambs and asymmetric corner equipment. Current thin yellow outline and flat gray front frame lack mass.
- Hangar interior is a mostly empty box with an X on the floor. Add upper yellow gantry, overhead cross-bracing, deep side equipment walls, catwalk/rail tiers, floor lane markings and a visible tiny craft; create visible occlusion/depth inside.
- Rear pods need broad light armored faces, dark chamfered endcaps and prominent warm inset vertical lights; current grille-dominated repeated pods do not match.

### Lighting and materials

- Flight deck should be charcoal asphalt/paint with thin paired gold lane markings, not pale gray grid tiles.
- Target light hull paint is ivory with local gray patch plates and sparse ochre accents. Current generalized speckling and evenly spaced yellow brackets replace intentional plate variation.
- Increase local shadows beneath deck fixtures, rib edges and hangar gantries. Use warm restrained emissive fixtures inside the hangar, not only edge lines.
- Add distinct black rubber/dark steel conduits with small brass couplers along the side; current single pale pipe does not reproduce the dense two-to-three-height machinery belt.

### Details

Missing deck edge guardrails, painted runway junctions, crane structures, dome, vent housings on upper chamfers, stacked side service modules, window recesses, rim lamps and hangar machinery. Target small deck craft appear as legible designed objects; current tiny surface lumps lack recognizable scale and arrangement.

## Dreadnought

### Composition and geometry

- Current silhouette is an unbroken flat-roof container with tapered cap. Target has repeated broad raised armor arches framing deep top weapon wells and a stepped armored spine; this is the dominant missing hierarchy.
- Cut or construct the visible upper weapon wells, elevate surrounding ribs above the main roof and put large twin-barrel turret assemblies between them. Current tiny blocks on the planar roof fail the warship silhouette entirely.
- Widen major transverse armor bands and introduce beveled shoulders. Target bands form structural hoops with irregular blocks and small warm lights, not thin strapped pipes.
- Reshape bow as layered tapered armor cheeks around a recessed axial weapon. Current flat cap with a protruding metal donut is especially unlike the target. Add concentric inner chamber rings, bronze interior, dark supporting collar, flanking vertical housings and the recessed upper twin-barrel emplacement.
- Make bridge a much larger tiered superstructure around the aft-middle roof, with multiple levels, recessed windows, machinery behind and a raised dark spine forward. Current single low cockpit wedge cannot convey flagship scale.
- Rear engine pods should be distinct broad cylindrical/faceted barrels with banded segmented armor and warm ring seams. Current repeated small grille boxes blend with carrier geometry.

### Lighting and materials

- Target upper body is predominantly dark graphite with irregular ivory armor panels; current roof is a huge light gray plane. Assign deliberate dark/light plate groups across top and bow; avoid uniform rows of identical values.
- Rust-red accents in target are larger worn bands and panels, while current small repeated square tabs read decorative. Scale and locate these accents on actual large armor transitions.
- Nose aperture needs warm metallic depth and interior bounce light. Current monochrome dark ring gives no sense of a powerful recessed mechanism.
- Strengthen deep shadows under hoops/weapon wells and warm inset running lights in multiple organized rows. Maintain visible charcoal side surfaces.
- Replace uniform dark square side grid with varying plate widths, recessed machinery panels, small bolts and exposed narrow pipe runs.

### Details

Missing credible large gun housings, paired long barrels, armored turret collars, edge lamps, intermediate bridge blocks, inset side mechanical boxes, coil/coupler segments and forward weapon supports. Stars are much sparser in both current images than targets; secondary to the ships, but still a fidelity gap.

## Suggested next pass order

Camera fit → dreadnought roof/weapon-well rebuild → carrier integrated dark flight deck and substantial hangar → broad structural ribs and stepped bridges → purposeful plate palette → mechanical tiers and local warm lights → small markings and wear.
