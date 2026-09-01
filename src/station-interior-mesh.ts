/**
 * The drawn station interior — `docs/specs/docking.md` §13, as geometry.
 *
 * **The mirror of `station-interior.ts`, never a second author of it.** Every
 * dimension here comes off the `StationInterior` the sim built: the shell spans
 * the volume that module declares, and a berth's plate is drawn at the centre
 * the traversal parks a ship on. A figure re-derived here is exactly the class
 * of error the two-tier split exists for — a bay drawn at a size the docking
 * law does not use is invisible to every headless test.
 *
 * **Authored in kilometres, in the aperture frame.** Local +Z is the outward
 * aperture axis, +X the phase-zero `across` and +Y the `up` that goes with it,
 * which is the basis `main.ts` aims a station on and the one `slotBasis`
 * returns. `buildStationForm` puts this inside the spinner, so a berth turns
 * with the station for free.
 *
 * **The interior is unpressurized and there is no door** (§13.1). Nothing here
 * closes the mouth: the aperture frame and the name shield stay visible from
 * every berth, which is what makes the route back to space recognisable and
 * what #138's docked gate got wrong.
 */

import * as THREE from "three";
import type { StationType } from "./station";
import type { Berth, StationInterior } from "./station-interior";
import { STATION_VISUALS, type StationDetailLevel } from "./station-visuals";

/**
 * What `main.ts` looks for when it fills a name shield with pixels.
 *
 * **Here rather than in `station-mesh.ts`, which re-exports it.** Both plates
 * are built from this module's side of the wall now — the mouth plate by the
 * aperture and the interior plaque by the bulkhead below — and the module that
 * builds a tagged object is the one that should own its tag. A copy in each
 * would be two strings a rename could separate.
 */
export const NAMEPLATE_NAME = "station-nameplate";

/** The group the whole interior hangs off, so a probe can find it and a form
 *  can be built without one. */
export const INTERIOR_GROUP_NAME = "station-interior";

/**
 * How thick the interior's plates are, as a multiple of the shell's smaller
 * half-extent. Thin: these are decks and bulkheads, not blocks, and every one
 * of them is seen edge-on from somewhere in the bay.
 *
 * Exported so `tests/station-interior-mesh.test.ts` reads it rather than
 * carrying a hand-copy — a tolerance typed into a test is one that stays green
 * against a figure the module no longer uses.
 */
export const PLATE_FACTOR = 0.06;

/**
 * The shell's surface: five slabs, two-sided.
 *
 * **It was one `BackSide` box, and its sixth face was a lid.** A closed box
 * renders the inside of *every* face, so what a pilot saw where the mouth
 * should be was a flat panel the size of the bay's cross-section — and no lit
 * rim on the bulkhead could help, because the rim was behind the lid. Four
 * walls and a back, each seated inside the declared extent so the five together
 * still span exactly the volume the sim declares, and `DoubleSide` because a
 * wall the camera can be on either side of has no near face to cull.
 *
 * **Lambert rather than Standard**, for the reason `station-mesh.ts`'s throat
 * material carries: PBR on the surface that fills the canopy while docked costs
 * enough of the frame under SwiftShader to turn a probe's *"the simulation keeps
 * running"* row red. The cost is stated rather than discovered — this surface
 * takes no `scene.environment`, so it is lit by the star, the hemisphere and
 * the bay's own emissives.
 */
function shellMaterial(type: StationType): THREE.Material {
	return new THREE.MeshLambertMaterial({
		color: SHELL_COLOR[type],
		// **`DoubleSide`, since the shell became five slabs.** One closed box
		// wanted `BackSide` so its near faces were culled; a wall the camera can
		// be on either side of has no near face to cull, and a `FrontSide` slab
		// seen from the wrong side is a hole in the room.
		side: THREE.DoubleSide,
		// **A dim self-glow, because nothing else lights the inside.** The star is
		// outside the hull and `scene.environment` reaches standard materials
		// only, so a purely reflective bay is whatever the hemisphere gives it —
		// a flat grey that reads, through the opening from outside, as a panel
		// rather than a hole. A working bay is lit; this is that light without a
		// second `PointLight` per station, which is the frame cost #99 owns.
		emissive: SHELL_COLOR[type],
		emissiveIntensity: AMBIENT_GLOW,
	});
}

/**
 * How much of its own colour an interior surface emits.
 *
 * Low: enough that the bay reads as a lit room from inside and as an opening
 * from outside, and not so much that it reads as a light box. Judged on the
 * canonical frames, which is the only instrument for it.
 */
const AMBIENT_GLOW = 0.45;

/** §13.4's interior treatments, as the one thing a colour can carry: how dirty
 *  and how cold the plating reads. Warm and clean for the habitat, cold and
 *  coarse for the yard, sooted for the refinery, bare for the outpost. */
const SHELL_COLOR: Record<StationType, number> = {
	trade: 0x2f3742,
	shipyard: 0x252b33,
	refinery: 0x2a241f,
	outpost: 0x23262a,
};

/** The structure inside the bay — ribs, brackets, cradle arms. One material per
 *  role, shared: none of them is ever mutated. */
const structureMaterial = (type: StationType) =>
	new THREE.MeshLambertMaterial({
		color: STRUCTURE_COLOR[type],
		emissive: STRUCTURE_COLOR[type],
		emissiveIntensity: AMBIENT_GLOW,
	});

const STRUCTURE_COLOR: Record<StationType, number> = {
	trade: 0x424c59,
	shipyard: 0x3a424c,
	refinery: 0x3d332a,
	outpost: 0x343a41,
};

/** An unlit emissive, which is what every light in this bay is: a strip that
 *  reads at its own brightness whatever the star is doing. */
const glowMaterial = (color: number) =>
	new THREE.MeshBasicMaterial({ color, toneMapped: false });

/**
 * The four rectangles that fill the gap between an outer half-extent and an
 * inner one, as `[width, height, x, y]`.
 *
 * One rule, two consumers: the mouth bulkhead is the wall the opening is cut
 * in, and the lane-edge strips are the lit rim of that opening. Both are "the
 * four sides of a rectangle", and two hand-written four-entry tables encode
 * that rule twice — which is two places a sign error can live.
 *
 * The rails run the full outer width and the uprights fill what is left, so the
 * four pieces tile the frame without overlapping at the corners.
 *
 * Exported because `station-mesh.ts`'s coamings are the same rule: a frame
 * around an aperture, which had been a slab spanning it.
 */
export function ringAround(
	outer: { across: number; up: number },
	inner: { across: number; up: number },
): [number, number, number, number][] {
	const lipUp = outer.up - inner.up;
	const lipAcross = outer.across - inner.across;
	return [
		[outer.across * 2, lipUp, 0, (outer.up + inner.up) / 2],
		[outer.across * 2, lipUp, 0, -(outer.up + inner.up) / 2],
		[lipAcross, inner.up * 2, (outer.across + inner.across) / 2, 0],
		[lipAcross, inner.up * 2, -(outer.across + inner.across) / 2, 0],
	];
}

/**
 * One unit box for the whole bay, scaled per part.
 *
 * **A bay is fifty-odd meshes and each one had its own vertex buffer.** Every
 * station in the game now carries one, where before only the slot-bearing forms
 * carried a recess — so a geometry per part is a per-station cost that scales
 * with the berth count. A box is the one shape where scale is exact: it is an
 * affine map of the unit cube, so `Box3.setFromObject` and the connectivity
 * check read the same numbers either way.
 */
const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1);

const box = (
	w: number,
	h: number,
	d: number,
	material: THREE.Material,
	name: string,
) => {
	const mesh = new THREE.Mesh(UNIT_BOX, material);
	mesh.scale.set(w, h, d);
	mesh.name = name;
	return mesh;
};

/**
 * Tag a part so `setStationDetail` drops it below the near band.
 *
 * **The bay is fifty-odd meshes and none of them was tagged**, so a station on
 * the far side of a system submitted its berth brackets and its window panes at
 * full count behind a hull nothing can see them through. The furniture and the
 * fittings go; the shell, the bulkhead, the lit rim and the shield stay, because
 * they are the room rather than what is in it, and because the mouth reads as an
 * opening at range only if what is behind it is drawn.
 *
 * `station-mesh.ts`'s own `detail()` is private to that module and this one may
 * not import it — it would be a cycle. The key is the contract, which
 * `tests/station-interior-mesh.test.ts` pins.
 */
const atFullDetail = <T extends THREE.Object3D>(object: T): T => {
	object.userData.minDetail = "full" satisfies StationDetailLevel;
	return object;
};

/**
 * One station's interior.
 *
 * `interior` is the sim's catalogue and `nameTexture` is the renderer's job
 * (E10), so this module contains no `document` reference at all — the plaque is
 * geometry here and `main.ts` fills its `map`, exactly as it already does for
 * the exterior plate and the cockpit's text.
 */
export function buildStationInterior(
	type: StationType,
	interior: StationInterior,
): THREE.Group {
	// **Two presentations, and the sim already decided which** (#165). A pad
	// role has no enclosure to draw: no shell, no mouth bulkhead, no end wall.
	// Dispatched here rather than branched inside each part, because half the
	// parts below have no pad counterpart at all and a body full of
	// `if (bay)` would read as one room with pieces missing.
	if (interior.presentation === "pad") return buildPadDeck(type, interior);
	const group = new THREE.Group();
	group.name = INTERIOR_GROUP_NAME;
	const visuals = STATION_VISUALS[type];
	const structure = structureMaterial(type);
	const depth = interior.mouthAxialKm - interior.endAxialKm;
	const centreZ = (interior.mouthAxialKm + interior.endAxialKm) / 2;
	const plate =
		Math.min(interior.halfAcrossKm, interior.halfUpKm) * PLATE_FACTOR;

	// **The room itself, as five walls rather than one box — because a box has
	// six.** `BackSide` on a closed box renders the inside of *every* face, and
	// the sixth is a lid across the mouth: from inside the bay the way out was a
	// flat panel the exact size of the bay's cross-section, which is what a
	// launch frame showed and what no lit rim could fix, because the rim was
	// behind it.
	//
	// Five meshes rather than a `Plane` each, so the walls keep a thickness and
	// the connectivity check has something to overlap.
	const shellFace = shellMaterial(type);
	const wall = plate * 0.8;
	// Each wall sits **inside** the declared extent — its outer face on the
	// surface the catalogue names — so the five together span exactly the volume
	// the sim declares and a berth's apron overlaps the wall it is bolted to.
	const inset = wall / 2;
	for (const [w, h, d, x, y, z, name] of [
		[
			interior.halfAcrossKm * 2,
			wall,
			depth,
			0,
			-interior.halfUpKm + inset,
			centreZ,
			"interior-shell",
		],
		[
			interior.halfAcrossKm * 2,
			wall,
			depth,
			0,
			interior.halfUpKm - inset,
			centreZ,
			"interior-shell",
		],
		[
			wall,
			interior.halfUpKm * 2,
			depth,
			-interior.halfAcrossKm + inset,
			0,
			centreZ,
			"interior-shell",
		],
		[
			wall,
			interior.halfUpKm * 2,
			depth,
			interior.halfAcrossKm - inset,
			0,
			centreZ,
			"interior-shell",
		],
		[
			interior.halfAcrossKm * 2,
			interior.halfUpKm * 2,
			wall,
			0,
			0,
			interior.endAxialKm + inset,
			"interior-shell-back",
		],
	] as const) {
		const face = box(w, h, d, shellFace, name);
		face.position.set(x, y, z);
		group.add(face);
	}

	// **The mouth is a hole in a bulkhead, not the open end of a box.** The bay
	// is wider than the aperture, so what an arriving ship flies through is a
	// rectangle cut in the near wall — and it is that wall the interior name
	// shield is mounted on, facing every berth.
	for (const [w, h, x, y] of ringAround(
		{ across: interior.halfAcrossKm, up: interior.halfUpKm },
		{ across: interior.laneHalfAcrossKm, up: interior.laneHalfUpKm },
	)) {
		if (w <= 0 || h <= 0) continue;
		const panel = box(w, h, plate, structure, "interior-bulkhead");
		// **Sunk a tenth of a plate behind the mouth**, not flush with it: the
		// aperture bars straddle the plane and overlap this panel laterally, and
		// two coplanar front faces there z-fight — the symptom is a slot that
		// flickers as the station turns, which reads as the aperture not being
		// there.
		panel.position.set(x, y, interior.mouthAxialKm - plate * 0.6);
		group.add(panel);
	}

	// The lane's own edge, lit: four strips on the bulkhead around the opening,
	// so the way out is the brightest line in the bay from anywhere in it.
	//
	// **Proud of the bulkhead, and wide enough to read from the back of the
	// bay.** One plate deep and one plate wide it was a hairline: from a berth
	// the opening showed as a grey panel hung on a wall rather than as the way
	// out, which is the half of §13.1 a parked pilot has to be able to see. Two
	// and a half plates of width is about 17 m of lit border on a 120 m opening.
	//
	// **Part proud, part buried.** Seated flush with the panel's mid-plane they
	// are inside it and draw nothing; seated wholly in the lip they are adrift,
	// because `tests/station-mesh.test.ts`'s connectivity check shrinks every
	// part before testing contact and a graze is not a joint. Straddling the
	// panel's inner face is both.
	const laneGlow = glowMaterial(visuals.strobeColor);
	for (const [w, h, x, y] of ringAround(
		{
			across: interior.laneHalfAcrossKm + plate * 2.5,
			up: interior.laneHalfUpKm + plate * 2.5,
		},
		{ across: interior.laneHalfAcrossKm, up: interior.laneHalfUpKm },
	)) {
		const strip = box(w, h, plate * 1.2, laneGlow, "interior-lane-edge");
		strip.position.set(x, y, interior.mouthAxialKm - plate * 1.3);
		group.add(strip);
	}

	// **E9/E11's shield, on the bay's end bulkhead, facing the mouth.**
	//
	// It sat on the throat's end wall before #128 shortened the throat, and #131
	// records that it then drew zero pixels from inside, undiagnosed and still
	// undiagnosed: what changed is the geometry around the plate rather than an
	// account of the old frame. This is the same wall, four times further back
	// and square to the lane — 405 m of bay against a 105 m throat on the trade
	// station: an arriving ship flies
	// straight at it down the transit lane, which is the one view in the game
	// where a station's name is read from inside it.
	//
	// **Not over the mouth**, which was built and withdrawn: a lintel above the
	// opening is where a sign belongs on a door, and from a berth aimed at that
	// opening it measured zero — the opening subtends most of the view and the
	// plate sits outside it.
	const shieldW = interior.laneHalfAcrossKm * 1.2;
	const shieldH = shieldW * 0.28;
	const shield = box(
		shieldW,
		shieldH,
		// Thick enough to straddle the back wall rather than graze it: the wall
		// is four fifths of a plate and the connectivity check shrinks both.
		plate * 1.6,
		new THREE.MeshBasicMaterial({
			color: 0xffffff,
			transparent: true,
			// Nothing until the renderer supplies one (E10): an untextured plate
			// is invisible rather than a white rectangle.
			opacity: 0,
		}),
		NAMEPLATE_NAME,
	);
	// Half in the back wall and half proud of it — a plate sunk into the
	// bulkhead draws nothing, which is exactly #131's symptom, and one merely
	// touching it is not joined to anything.
	shield.position.set(0, 0, interior.endAxialKm + plate * 0.8);
	group.add(shield);

	// One flood-colour glow and one accent for every berth in the bay, hoisted
	// for the reason `laneGlow` is: eight identical materials are eight draw
	// batches where one would do.
	const guide = glowMaterial(visuals.floodColor);
	const accent = glowMaterial(visuals.heatColor);
	for (const berth of interior.berths)
		group.add(atFullDetail(buildBerth(berth, plate, structure, guide, accent)));

	group.add(atFullDetail(buildRoleFittings(type, interior, plate, structure)));
	return group;
}

/**
 * The four faces' orientation, as the basis a berth's parts are laid out in:
 * `outward` is the berth's own normal and `beam` the direction its clear beam
 * runs. In a bay the clear length always runs along the bay.
 *
 * **On a pad the surface is the deck and the run is the berth's own nose**
 * (#165). All four faces then share one `outward` — the aperture axis — so the
 * face no longer decides the basis and the berth's `parkedNose` does. Read off
 * the catalogue rather than switched on the face for this module's standing
 * reason: the sim decided where the ship points, and a second table here is a
 * second author of it.
 */
function berthBasis(berth: Berth) {
	if (berth.normal.axial !== 0) {
		const outward = new THREE.Vector3(0, 0, Math.sign(berth.normal.axial));
		const along = new THREE.Vector3(
			berth.parkedNose.across,
			berth.parkedNose.up,
			berth.parkedNose.axial,
		);
		// **`outward × along`, and the order is the whole of it.** `buildBerth`
		// recovers the run as `beam × outward`, and `(a × b) × b = −a` for an
		// orthonormal pair — so building the beam the other way round handed it
		// `−parkedNose`, and every pad berth's asymmetric furniture (the service
		// boom stands at one end) faced backwards against the ship parked on it.
		// It was written the wrong way with a comment claiming it came back
		// right, which is the shape of error a comment cannot catch.
		return { outward, beam: new THREE.Vector3().crossVectors(outward, along) };
	}
	switch (berth.face) {
		case "deck":
			return {
				outward: new THREE.Vector3(0, 1, 0),
				beam: new THREE.Vector3(1, 0, 0),
			};
		case "overhead":
			return {
				outward: new THREE.Vector3(0, -1, 0),
				beam: new THREE.Vector3(1, 0, 0),
			};
		case "port":
			return {
				outward: new THREE.Vector3(1, 0, 0),
				beam: new THREE.Vector3(0, 1, 0),
			};
		default:
			return {
				outward: new THREE.Vector3(-1, 0, 0),
				beam: new THREE.Vector3(0, 1, 0),
			};
	}
}

/**
 * One berth: the surface a ship settles onto, the frame that holds it there, and
 * the light that says where it is.
 *
 * **Authored in the berth's own frame**, not in the bay's. The group carries a
 * basis — local X across the berth's beam, local Y out from its surface, local Z
 * along the lane — so every part below is a plain triple and the four faces need
 * no axis test between them. The previous build swizzled each part's dimensions
 * against `outward` and `beam` at four separate sites, and one of those ternaries
 * chose between two identical values.
 *
 * **The family changes presentation and parked pose, never the interaction**
 * (§13.2) — which is why the only thing that branches on it is what is drawn. A
 * deck pad, a bracketed wall shelf and a recessed cradle are three ways of
 * holding the same ship in the same place.
 *
 * The first version of this was five axis-aligned boxes and read, flown, as a
 * cross painted on a flat wall. What a berth needs to read is depth — an apron
 * standing off its wall inside a raised kerb — and machinery: chocks where a
 * hull's feet land, a service boom reaching over its spine, and a lit outline
 * that says the bay is a place a ship goes rather than a panel.
 */
function buildBerth(
	berth: Berth,
	plate: number,
	structure: THREE.Material,
	guide: THREE.Material,
	accent: THREE.Material,
	/** How far to seat the whole assembly *into* its own surface, kilometres.
	 *  Zero in a bay, where the shell wall is inset instead; a plate's worth on
	 *  a pad, where the surface is the deck a ship stands on and cannot be
	 *  lifted off the catalogue's plane. */
	seatKm = 0,
): THREE.Group {
	const group = new THREE.Group();
	group.name = `berth-${berth.id}`;
	const { outward, beam } = berthBasis(berth);
	// Right-handed by construction: local Z is whatever completes the pair, which
	// for a wall berth is the lane run mirrored. A berth is symmetric along the
	// lane, so the mirror shows only in which end the boom stands at.
	const along = new THREE.Vector3().crossVectors(beam, outward);
	group.setRotationFromMatrix(
		new THREE.Matrix4().makeBasis(beam, outward, along),
	);
	// The wall itself: the berth's centre pushed back down its own normal by half
	// the clear height, which is where the sim says the surface is.
	group.position
		.set(berth.centre.across, berth.centre.up, berth.centre.axial)
		.addScaledVector(outward, -berth.clearHeightKm / 2 - seatKm);

	const B = berth.clearBeamKm;
	const L = berth.clearLengthKm;
	const H = berth.clearHeightKm;
	const p = plate;
	const at = (mesh: THREE.Mesh, x: number, y: number, z: number) => {
		mesh.position.set(x, y, z);
		group.add(mesh);
		return mesh;
	};

	// **The apron**, standing proud of the wall rather than flush with it. Wider
	// than the clear beam by a lip, so the bay has an edge to read against.
	at(box(B * 1.08, p * 1.4, L * 1.04, structure, "berth-pad"), 0, p * 0.7, 0);

	// A raised kerb down each long side. This is what turns a plate into a bay:
	// from any angle but straight on, the apron now has a section.
	for (const side of [-1, 1])
		at(
			box(p * 0.7, p * 2.4, L * 1.04, structure, "berth-kerb"),
			side * B * 0.54,
			p * 1.2,
			0,
		);

	// The lit outline: two rails down the apron and two cross bars at its ends,
	// in the role's own work-light colour — §13.4's rule that light identifies
	// role and nothing else.
	//
	// **Every part on the apron reaches down to the wall.** Sitting on top of
	// it, they overlapped it by a tenth of a plate — and
	// `tests/station-mesh.test.ts`'s connectivity check shrinks a part by up to
	// a quarter of its own extent before testing contact, so a light strip laid
	// on a deck is not joined to it. Inlaid instead, which is where a floor
	// light belongs anyway.
	for (const side of [-1, 1])
		at(
			box(p * 0.35, p * 1.7, L * 0.86, guide, "berth-guide"),
			side * B * 0.38,
			p * 0.85,
			0,
		);
	for (const end of [-1, 1])
		at(
			box(B * 0.72, p * 1.7, p * 0.35, guide, "berth-guide"),
			0,
			p * 0.85,
			end * L * 0.43,
		);

	// **Chocks**, where a hull's feet come down. Four of them, inboard of the
	// kerbs, because a ship parks between them rather than on them.
	for (const side of [-1, 1])
		for (const end of [-1, 1])
			at(
				box(p * 1.1, p * 2.8, p * 1.1, structure, "berth-chock"),
				side * B * 0.3,
				p * 1.4,
				end * L * 0.26,
			);

	// **The service boom**: a post at one end of the berth and an arm reaching
	// over where the ship's spine will be, with a lit head at its tip. It is the
	// one part that says a berth is worked at rather than merely landed on.
	at(
		box(p * 0.8, H * 0.5, p * 0.8, structure, "berth-boom"),
		-B * 0.6,
		H * 0.25,
		-L * 0.42,
	);
	at(
		box(B * 0.78, p * 0.7, p * 0.7, structure, "berth-boom"),
		-B * 0.21,
		H * 0.48,
		-L * 0.42,
	);
	at(
		box(p * 0.6, p * 0.6, p * 0.6, accent, "berth-boom-head"),
		B * 0.18,
		H * 0.46,
		-L * 0.42,
	);

	// **The berth's mark**, as tally stubs rather than as text: this module has
	// no `document` and may not build a texture (E10), and a number a pilot can
	// count is worth more inside a bay than a glyph they cannot read.
	const tally =
		1 + (berth.band === "deep" ? 1 : 0) + (berth.family === "cradle" ? 1 : 0);
	for (let i = 0; i < tally; i++)
		at(
			box(p * 0.3, p * 1.7, p * 0.9, accent, "berth-tally"),
			B * 0.42 - i * p * 0.55,
			p * 0.85,
			L * 0.46,
		);

	if (berth.family === "wall" || berth.family === "cradle")
		// **A backing frame at the head of the berth.** A wall-side berth is an
		// alcove, and what makes it one is that it has a back.
		at(
			box(B * 1.08, H * 0.5, p * 0.9, structure, "berth-backing"),
			0,
			H * 0.25,
			-L * 0.56,
		);

	if (berth.family === "cradle")
		// **Two horns curving in over the hull**, three segments each. A cradle is
		// the one family that holds a ship rather than resting it, and a pair of
		// straight posts read as a shelf with rails.
		for (const side of [-1, 1])
			for (let k = 0; k < 3; k++) {
				const angle = ((k + 0.5) / 3) * Math.PI * 0.44;
				const arm = box(
					p * 0.8,
					H * 0.26,
					p * 0.8,
					structure,
					"berth-cradle-arm",
				);
				arm.rotation.z = -side * angle;
				at(
					arm,
					side * B * 0.55 * Math.cos(angle),
					H * 0.52 * Math.sin(angle),
					0,
				);
			}
	return group;
}

/**
 * The bay's own structure: four corner rails and three transverse hoops.
 *
 * **Role-independent, and it is here so the lane check covers it.** A bare box
 * has no scale — the walls read as a painted backdrop until something crosses
 * them at a known size, which is the same argument #102 makes for a station's
 * exterior clutter.
 *
 * The hoops sit **between** the depth bands and clear of both, so they frame the
 * berths rather than run through them, and every segment hugs a wall: a hoop
 * that spanned the middle would be geometry the scripted traversal flies
 * through, which is the one thing §13.1's lane is for.
 */
function buildBayFrame(
	group: THREE.Group,
	interior: StationInterior,
	plate: number,
	structure: THREE.Material,
): void {
	const depth = interior.mouthAxialKm - interior.endAxialKm;
	const centreZ = (interior.mouthAxialKm + interior.endAxialKm) / 2;
	const x = interior.halfAcrossKm - plate * 0.6;
	const y = interior.halfUpKm - plate * 0.6;

	// Corner rails, the bay's full depth: the edges of the room.
	for (const sx of [-1, 1])
		for (const sy of [-1, 1]) {
			const rail = box(
				plate * 1.4,
				plate * 1.4,
				depth * 0.98,
				structure,
				"interior-rail",
			);
			rail.position.set(sx * x, sy * y, centreZ);
			group.add(rail);
		}

	// Hoops at the two band gaps and behind the deep band, so none of them lands
	// on a berth. Read off the catalogue rather than spaced by eye.
	const bands = [
		...new Set(interior.berths.map((berth) => berth.centre.axial)),
	].sort((a, b) => b - a);
	const stations = [
		(interior.mouthAxialKm + bands[0]) / 2,
		...bands.slice(0, -1).map((z, i) => (z + bands[i + 1]) / 2),
		(bands[bands.length - 1] + interior.endAxialKm) / 2,
	];
	for (const z of stations) {
		for (const sy of [-1, 1]) {
			const beam = box(
				x * 2,
				plate * 1.2,
				plate * 1.2,
				structure,
				"interior-rib",
			);
			beam.position.set(0, sy * y, z);
			group.add(beam);
		}
		for (const sx of [-1, 1]) {
			const post = box(
				plate * 1.2,
				y * 2,
				plate * 1.2,
				structure,
				"interior-rib",
			);
			post.position.set(sx * x, 0, z);
			group.add(post);
		}
	}
}

/** What a role's fittings are built against: the bay, its own materials, and
 *  the two derived lengths every one of them uses. */
interface FittingContext {
	group: THREE.Group;
	interior: StationInterior;
	visuals: (typeof STATION_VISUALS)[StationType];
	structure: THREE.Material;
	plate: number;
	depth: number;
	backZ: number;
}

/**
 * §13.4's interior identity, as the fittings that make one role's bay different
 * from another's at a glance.
 *
 * **A `Record<StationType, …>` for `station.ts`'s reason**, and because the four
 * bodies share nothing but the context: a fifth station type adds a table entry
 * and the type stops the build until it does, where a chain of `if (type ===
 * …)` blocks would compile with none.
 *
 * They hang off the walls behind the berth line and never enter the transit
 * lane, which `tests/station-interior-mesh.test.ts` asserts rather than trusts —
 * with a control that moves a part onto the axis to prove the check can fail.
 */
const ROLE_FITTINGS: Record<StationType, (ctx: FittingContext) => void> = {
	// Warm windows down both walls, high: a habitat seen from inside, and cargo
	// markings on the back bulkhead.
	trade: ({ group, interior, visuals, plate, depth, backZ }) => {
		const windows = glowMaterial(visuals.windowColor);
		for (const side of [-1, 1])
			for (let i = 0; i < 4; i++) {
				const pane = box(
					plate * 0.3,
					plate * 0.5,
					depth * 0.11,
					windows,
					"interior-window",
				);
				pane.position.set(
					side * (interior.halfAcrossKm - plate * 0.4),
					interior.halfUpKm - plate * (1 + i * 0.9),
					interior.endAxialKm + depth * (0.25 + i * 0.16),
				);
				group.add(pane);
			}
		const marking = box(
			interior.laneHalfAcrossKm,
			plate * 0.3,
			plate * 0.3,
			glowMaterial(visuals.heatColor),
			"interior-marking",
		);
		marking.position.set(0, -interior.laneHalfUpKm, backZ);
		group.add(marking);
	},

	// Gantries spanning the bay behind the berth line, with cold work light.
	shipyard: ({ group, interior, visuals, structure, plate, depth }) => {
		for (const fraction of [0.35, 0.72]) {
			const z = interior.endAxialKm + depth * fraction;
			const beam = box(
				interior.halfAcrossKm * 2 * 0.96,
				plate * 0.6,
				plate * 0.6,
				structure,
				"interior-gantry",
			);
			beam.position.set(0, interior.halfUpKm - plate, z);
			group.add(beam);
			const flood = box(
				interior.halfAcrossKm,
				plate * 0.25,
				plate * 0.25,
				glowMaterial(visuals.floodColor),
				"interior-flood",
			);
			flood.position.set(0, interior.halfUpKm - plate * 1.5, z);
			group.add(flood);
		}
	},

	// Pipes along both walls and a heat glow at the back — the role's exterior
	// grammar carried inside.
	refinery: ({ group, interior, visuals, structure, plate, depth, backZ }) => {
		for (const side of [-1, 1])
			for (let i = 0; i < 2; i++) {
				const pipe = new THREE.Mesh(
					new THREE.CylinderGeometry(
						plate * 0.22,
						plate * 0.22,
						depth * 0.8,
						6,
					),
					structure,
				);
				pipe.rotation.x = Math.PI / 2;
				pipe.position.set(
					side * (interior.halfAcrossKm - plate * 0.4),
					-interior.halfUpKm + plate * (1 + i * 0.8),
					interior.endAxialKm + depth * 0.45,
				);
				pipe.name = "interior-pipe";
				group.add(pipe);
			}
		const heat = box(
			interior.laneHalfAcrossKm * 1.2,
			plate * 0.5,
			plate * 0.4,
			glowMaterial(visuals.heatColor),
			"interior-heat",
		);
		heat.position.set(0, 0, backZ);
		group.add(heat);
	},

	// Exposed conduits and one neutral light: sparse, because that is what an
	// outpost is.
	outpost: ({ group, interior, visuals, structure, plate, depth, backZ }) => {
		for (let i = 0; i < 3; i++) {
			const conduit = box(
				plate * 0.25,
				plate * 0.25,
				depth * 0.7,
				structure,
				"interior-conduit",
			);
			conduit.position.set(
				-interior.halfAcrossKm + plate * 0.5,
				interior.halfUpKm - plate * (0.6 + i * 0.5),
				interior.endAxialKm + depth * 0.5,
			);
			group.add(conduit);
		}
		const lamp = box(
			plate * 0.8,
			plate * 0.25,
			plate * 0.25,
			glowMaterial(visuals.strobeColor),
			"interior-lamp",
		);
		lamp.position.set(0, interior.halfUpKm - plate * 0.5, backZ);
		group.add(lamp);
	},
};

/** The role's fittings, in a group of their own so the lane check has a subject
 *  and the renderer has one handle. */
function buildRoleFittings(
	type: StationType,
	interior: StationInterior,
	plate: number,
	structure: THREE.Material,
): THREE.Group {
	const group = new THREE.Group();
	group.name = "interior-fittings";
	const depth = interior.mouthAxialKm - interior.endAxialKm;
	buildBayFrame(group, interior, plate, structure);
	ROLE_FITTINGS[type]({
		group,
		interior,
		visuals: STATION_VISUALS[type],
		structure,
		plate,
		depth,
		backZ: interior.endAxialKm + plate,
	});
	return group;
}

/** How thick this module draws a plate, kilometres. One expression, because a
 *  pad's deck face is derived from it and `tests/station-mesh.test.ts` reads
 *  that face back rather than carrying a hand-copy of the arithmetic. */
const plateOf = (interior: StationInterior): number =>
	Math.min(interior.halfAcrossKm, interior.halfUpKm) * PLATE_FACTOR;

/**
 * How far a pad's berth furniture is seated **into** the deck, as a multiple of
 * a plate.
 *
 * **The deck's face is the berth surface the catalogue names, exactly**, and
 * this is what pays for that. `buildBerth` lays every part *up* from the
 * surface it is given, so a deck flush with that surface and a berth sitting on
 * top of it are two boxes that graze — and
 * `tests/station-mesh.test.ts`'s connectivity check shrinks a part by up to 4 m
 * before testing contact, so a berth laid on a deck is a loose island.
 *
 * A bay solves the same problem the other way, by seating each shell wall
 * *inside* the declared extent so the apron overlaps it. A pad cannot: its
 * "wall" is the surface a ship stands on, and lifting it clear of the
 * catalogue's plane would put a slab through every parked hull — an outpost's
 * berth admits a 30 m freighter whose belly sits *at* the surface, so a deck
 * 7.5 m proud of it would be 7.5 m inside the ship (sage round 5).
 */
const PAD_SEAT_FACTOR = 0.8;

/** How far a pad's berth furniture drops below the deck, kilometres. */
const padSeatKm = (interior: StationInterior): number =>
	plateOf(interior) * PAD_SEAT_FACTOR;

/**
 * A pad role's drawn interior: a deck at the aperture plane with its berths
 * standing on it (#165).
 *
 * **The deck is a ring, and the hole in it is the approach corridor.**
 * `tests/station-mesh.test.ts`'s corridor row forbids any part of the station
 * in the cylinder in front of the aperture, so the one thing a landing deck may
 * not do is span the volume a ship descends through — the lane's floor is the
 * form's own surface, seen through the ring. Everything drawn here is outside
 * that cylinder by construction, which is also what lets the deck stand proud
 * of the plane rather than being pressed flat under a 10 cm tolerance.
 *
 * **The deck's top face is one wall thickness proud of the berth surface**,
 * which is exactly the relationship a bay's shell has with the berths bolted to
 * it: `buildBerth` lays every part down from the surface the catalogue names,
 * so a plate flush with that surface would leave each berth a loose island.
 * `tests/station-mesh.test.ts`'s connectivity check shrinks parts by up to 4 m
 * before testing contact, and the embedded depth is what beats it.
 */
function buildPadDeck(
	type: StationType,
	interior: StationInterior,
): THREE.Group {
	const group = new THREE.Group();
	group.name = INTERIOR_GROUP_NAME;
	const visuals = STATION_VISUALS[type];
	const structure = structureMaterial(type);
	const plate = plateOf(interior);
	// **The sim's figure, not one derived here.** Where the deck's hole is, is
	// the same question as where a berth may stand — both are the approach
	// corridor — so `padHoleHalfKm` is computed once in `station-interior.ts`
	// and read back. A copy of the corridor arithmetic in this module would be
	// the mesh authoring a dimension, which is the thing its header forbids.
	const hole = interior.padHoleHalfKm;
	// **As thick as a berth is tall, which is the outward span the sim
	// declares.** It reaches inward from the deck's face far enough to meet the
	// form's own surface, and the two pad roles differ by 20 m in how far that
	// is — the Warren's terrace sits 20 m behind its aperture plane where an
	// outpost's deck is flush with it.
	const thickness = interior.stagingAxialKm - interior.mouthAxialKm;
	// **The deck's face is the berth surface**, so a parked hull stands on it
	// rather than in it. The berths are seated into it instead (`padSeatKm`).
	const faceZ = interior.mouthAxialKm;

	const deckFace = shellMaterial(type);
	for (const [w, h, x, y] of ringAround(
		{ across: interior.halfAcrossKm, up: interior.halfUpKm },
		{ across: hole, up: hole },
	)) {
		if (w <= 0 || h <= 0) continue;
		const panel = box(w, h, thickness, deckFace, "interior-deck");
		panel.position.set(x, y, faceZ - thickness / 2);
		group.add(panel);
	}

	// The touchdown zone, lit: a square painted round the hole, so the volume a
	// ship comes down through is the brightest line on the deck. It is the pad's
	// answer to the bay's lane edge and it is drawn against the *corridor*
	// rather than the aperture rectangle, because that is the shape the deck
	// itself is cut to.
	const laneGlow = glowMaterial(visuals.strobeColor);
	for (const [w, h, x, y] of ringAround(
		{ across: hole + plate * 2.5, up: hole + plate * 2.5 },
		{ across: hole, up: hole },
	)) {
		const strip = box(w, h, plate * 1.2, laneGlow, "interior-lane-edge");
		strip.position.set(x, y, faceZ - plate * 0.3);
		group.add(strip);
	}

	// **The name, painted on the deck rather than hung on a wall.** E9/E11 put
	// the shield on the bay's end bulkhead, facing an arriving ship down the
	// lane; a pad has no wall to hang it on and no throat to read it from, and
	// the one view every approach shares is the one looking straight down at the
	// deck. It sits on a corner of the ring, where no berth stands.
	const shieldW = interior.laneHalfAcrossKm * 0.8;
	const shieldH = shieldW * 0.28;
	const shield = box(
		shieldW,
		shieldH,
		plate * 1.6,
		new THREE.MeshBasicMaterial({
			color: 0xffffff,
			transparent: true,
			// Nothing until the renderer supplies one (E10).
			opacity: 0,
		}),
		NAMEPLATE_NAME,
	);
	shield.position.set(
		interior.halfAcrossKm * 0.75,
		interior.halfUpKm * 0.75,
		faceZ - plate * 0.4,
	);
	group.add(shield);

	const guide = glowMaterial(visuals.floodColor);
	const accent = glowMaterial(visuals.heatColor);
	const seat = padSeatKm(interior);
	for (const berth of interior.berths)
		group.add(
			atFullDetail(buildBerth(berth, plate, structure, guide, accent, seat)),
		);

	group.add(atFullDetail(buildPadFittings(interior, plate, structure, guide)));
	return group;
}

/**
 * A pad's own furniture: a kerb round the deck's outer edge and a lamp at each
 * corner.
 *
 * **Generic, where a bay's fittings are per-role, and §13.4 is why rather than
 * an omission.** That section's interior treatments are things you hang on a
 * wall — windows, gantries, pipe runs, conduits — and a pad has no wall. What
 * survives is the half of §13.4 that is a rule rather than a list: *light
 * identifies role only*. The kerb takes the role's structure colour, the deck
 * its plating colour and these lamps its flood colour, all three off
 * `STATION_VISUALS`, so a refinery pad and an outpost pad differ by exactly the
 * thing the section says they should.
 */
function buildPadFittings(
	interior: StationInterior,
	plate: number,
	structure: THREE.Material,
	guide: THREE.Material,
): THREE.Group {
	const group = new THREE.Group();
	group.name = "interior-fittings";
	const x = interior.halfAcrossKm;
	const y = interior.halfUpKm;
	const faceZ = interior.mouthAxialKm;
	// A kerb along each edge, seated into the deck for the reason every part in
	// this module is: a rail laid on a surface is not joined to it.
	for (const [w, h, px, py] of ringAround(
		{ across: x, up: y },
		{ across: x - plate * 1.2, up: y - plate * 1.2 },
	)) {
		const kerb = box(w, h, plate * 2, structure, "interior-rail");
		kerb.position.set(px, py, faceZ - plate * 0.4);
		group.add(kerb);
	}
	for (const sx of [-1, 1])
		for (const sy of [-1, 1]) {
			const lamp = box(
				plate * 0.9,
				plate * 0.9,
				plate * 1.6,
				guide,
				"interior-flood",
			);
			lamp.position.set(
				sx * (x - plate * 1.2),
				sy * (y - plate * 1.2),
				faceZ + plate * 0.5,
			);
			group.add(lamp);
		}
	return group;
}
