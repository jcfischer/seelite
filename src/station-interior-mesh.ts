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
import { STATION_VISUALS } from "./station-visuals";

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
 */
const PLATE_FACTOR = 0.06;

/**
 * The shell.
 *
 * `BackSide` on one box is what makes it a room — the near faces are culled, so
 * from inside it is four walls, a deck, an overhead and a back bulkhead, in one
 * draw call, with the cross-section the sim declared rather than six wall
 * meshes whose positions could drift from it.
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
		side: THREE.BackSide,
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

const box = (
	w: number,
	h: number,
	d: number,
	material: THREE.Material,
	name: string,
) => {
	const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
	mesh.name = name;
	return mesh;
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
	const group = new THREE.Group();
	group.name = INTERIOR_GROUP_NAME;
	const visuals = STATION_VISUALS[type];
	const structure = structureMaterial(type);
	const depth = interior.mouthAxialKm - interior.endAxialKm;
	const centreZ = (interior.mouthAxialKm + interior.endAxialKm) / 2;
	const plate =
		Math.min(interior.halfAcrossKm, interior.halfUpKm) * PLATE_FACTOR;

	// The room itself.
	const shell = box(
		interior.halfAcrossKm * 2,
		interior.halfUpKm * 2,
		depth,
		shellMaterial(type),
		"interior-shell",
	);
	shell.position.z = centreZ;
	group.add(shell);

	// **The mouth is a hole in a bulkhead, not the open end of a box.** The bay
	// is wider than the aperture, so what an arriving ship flies through is a
	// rectangle cut in the near wall — and it is that wall the interior name
	// shield is mounted on, facing every berth.
	const lipAcross = interior.halfAcrossKm - interior.laneHalfAcrossKm;
	const lipUp = interior.halfUpKm - interior.laneHalfUpKm;
	// **Sunk a tenth of a plate behind the mouth**, not flush with it: the
	// aperture bars straddle the plane and overlap this panel laterally, and two
	// coplanar front faces there z-fight — the symptom is a slot that flickers
	// as the station turns, which reads as the aperture not being there.
	const bulkheadZ = interior.mouthAxialKm - plate * 0.6;
	for (const [w, h, x, y] of [
		[
			interior.halfAcrossKm * 2,
			lipUp,
			0,
			(interior.halfUpKm + interior.laneHalfUpKm) / 2,
		],
		[
			interior.halfAcrossKm * 2,
			lipUp,
			0,
			-(interior.halfUpKm + interior.laneHalfUpKm) / 2,
		],
		[
			lipAcross,
			interior.laneHalfUpKm * 2,
			(interior.halfAcrossKm + interior.laneHalfAcrossKm) / 2,
			0,
		],
		[
			lipAcross,
			interior.laneHalfUpKm * 2,
			-(interior.halfAcrossKm + interior.laneHalfAcrossKm) / 2,
			0,
		],
	] as const) {
		if (w <= 0 || h <= 0) continue;
		const panel = box(w, h, plate, structure, "interior-bulkhead");
		panel.position.set(x, y, bulkheadZ);
		group.add(panel);
	}

	// The lane's own edge, lit: four strips on the bulkhead around the opening,
	// so the way out is the brightest line in the bay from anywhere in it.
	//
	// **Seated in the lip rather than centred on the boundary.** A strip
	// straddling the lane's edge overlaps the panel it is mounted on by half its
	// own thickness, and `tests/station-mesh.test.ts`'s connectivity check —
	// which shrinks every part before testing contact, so a graze does not count
	// as a joint — reported all four adrift. Flush against the opening and
	// wholly inside the lip is both a real joint and where a lit edge belongs.
	const laneGlow = glowMaterial(visuals.strobeColor);
	const edge = plate;
	for (const [w, h, x, y] of [
		[interior.laneHalfAcrossKm * 2, edge, 0, interior.laneHalfUpKm + edge / 2],
		[
			interior.laneHalfAcrossKm * 2,
			edge,
			0,
			-(interior.laneHalfUpKm + edge / 2),
		],
		[edge, interior.laneHalfUpKm * 2, interior.laneHalfAcrossKm + edge / 2, 0],
		[
			edge,
			interior.laneHalfUpKm * 2,
			-(interior.laneHalfAcrossKm + edge / 2),
			0,
		],
	] as const) {
		// **Half proud of the bulkhead, half buried in it.** Seated flush with
		// the panel's mid-plane they are inside it and draw nothing; the panel
		// spans a plate ending at `mouth − 1.1·plate`, so centring on that face
		// leaves a real joint behind and a lit edge in front.
		const strip = box(w, h, plate * 0.6, laneGlow, "interior-lane-edge");
		strip.position.set(x, y, interior.mouthAxialKm - plate * 1.1);
		group.add(strip);
	}

	// **E9/E11's shield, on the bay's end bulkhead, facing the mouth.**
	//
	// It sat on the throat's end wall before #128 shortened the throat, and #131
	// records that it then drew zero pixels from inside. This is the same wall,
	// forty times further back and square to the lane: an arriving ship flies
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
		plate * 0.5,
		new THREE.MeshBasicMaterial({
			color: 0xffffff,
			transparent: true,
			// Nothing until the renderer supplies one (E10): an untextured plate
			// is invisible rather than a white rectangle.
			opacity: 0,
		}),
		NAMEPLATE_NAME,
	);
	// Proud of the back wall rather than flush with it — a plate sunk into the
	// bulkhead draws nothing, which is exactly #131's symptom.
	shield.position.set(0, 0, interior.endAxialKm + plate);
	group.add(shield);

	for (const berth of interior.berths)
		group.add(buildBerth(type, interior, berth, plate, structure));

	group.add(buildRoleFittings(type, interior, plate, structure));
	return group;
}

/** The four faces' orientation, as the basis a berth's parts are laid out in:
 *  `outward` is the berth's own normal and `beam` the direction its clear beam
 *  runs. The clear length always runs along the bay. */
function berthBasis(berth: Berth) {
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
 * One berth: the surface a ship settles onto, its guide lights, and the
 * furniture its family carries.
 *
 * **The family changes presentation and parked pose, never the interaction**
 * (§13.2) — which is why the only thing that branches on it below is what is
 * drawn. A pad, a bracketed shelf and a recessed cradle with arms are three
 * ways of holding the same ship in the same place.
 */
function buildBerth(
	type: StationType,
	interior: StationInterior,
	berth: Berth,
	plate: number,
	structure: THREE.Material,
): THREE.Group {
	const group = new THREE.Group();
	group.name = `berth-${berth.id}`;
	const visuals = STATION_VISUALS[type];
	const { outward, beam } = berthBasis(berth);
	// The surface itself: the berth's centre pushed back down its own normal by
	// half the clear height, which is where the sim says the wall is.
	const surface = new THREE.Vector3(
		berth.centre.across,
		berth.centre.up,
		berth.centre.axial,
	).addScaledVector(
		new THREE.Vector3(outward.x, outward.y, outward.z),
		-berth.clearHeightKm / 2,
	);

	const across = Math.abs(beam.x) > 0 ? berth.clearBeamKm : plate;
	const up = Math.abs(beam.y) > 0 ? berth.clearBeamKm : plate;
	const pad = box(
		Math.abs(outward.x) > 0 ? plate : across,
		Math.abs(outward.y) > 0 ? plate : up,
		berth.clearLengthKm,
		structure,
		"berth-pad",
	);
	pad.position.copy(surface).addScaledVector(outward, plate / 2);
	group.add(pad);

	// Two guide strips flanking the pad, in the role's own work-light colour —
	// §13.4's rule that light identifies role and nothing else.
	const guide = glowMaterial(visuals.floodColor);
	for (const side of [-1, 1]) {
		const strip = box(
			Math.abs(beam.x) > 0 ? plate * 0.4 : plate * 0.4,
			Math.abs(beam.y) > 0 ? plate * 0.4 : plate * 0.4,
			berth.clearLengthKm * 0.8,
			guide,
			"berth-guide",
		);
		strip.position
			.copy(surface)
			.addScaledVector(outward, plate * 0.9)
			.addScaledVector(beam, (side * berth.clearBeamKm) / 2);
		group.add(strip);
	}

	if (berth.family === "wall" || berth.family === "cradle") {
		// A bracket under the berth, which is what holds a ship off a wall.
		for (const end of [-1, 1]) {
			const arm = box(
				Math.abs(outward.x) > 0 ? berth.clearHeightKm * 0.6 : plate,
				Math.abs(outward.y) > 0 ? berth.clearHeightKm * 0.6 : plate,
				plate,
				structure,
				"berth-bracket",
			);
			arm.position
				.copy(surface)
				.addScaledVector(outward, berth.clearHeightKm * 0.3)
				.addScaledVector(
					new THREE.Vector3(0, 0, 1),
					(end * berth.clearLengthKm) / 2,
				);
			group.add(arm);
		}
	}
	if (berth.family === "cradle") {
		// Two arms rising past the hull, which is what makes a cradle read as one
		// rather than as a shelf.
		for (const side of [-1, 1]) {
			const arm = box(
				Math.abs(beam.x) > 0 ? plate : berth.clearHeightKm,
				Math.abs(beam.y) > 0 ? plate : berth.clearHeightKm,
				plate,
				structure,
				"berth-cradle-arm",
			);
			arm.position
				.copy(surface)
				.addScaledVector(outward, berth.clearHeightKm / 2)
				.addScaledVector(beam, (side * berth.clearBeamKm) / 2);
			group.add(arm);
		}
	}
	return group;
}

/**
 * §13.4's interior identity, as the fittings that make one role's bay different
 * from another's at a glance.
 *
 * They hang off the walls behind the berth line and never enter the transit
 * lane, which `tests/station-interior-mesh.test.ts` asserts rather than trusts.
 */
function buildRoleFittings(
	type: StationType,
	interior: StationInterior,
	plate: number,
	structure: THREE.Material,
): THREE.Group {
	const group = new THREE.Group();
	group.name = "interior-fittings";
	const visuals = STATION_VISUALS[type];
	const depth = interior.mouthAxialKm - interior.endAxialKm;
	const backZ = interior.endAxialKm + plate;

	if (type === "trade") {
		// Warm windows down both walls, high: a habitat seen from inside.
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
		// Cargo markings on the back bulkhead.
		const marking = box(
			interior.laneHalfAcrossKm,
			plate * 0.3,
			plate * 0.3,
			glowMaterial(visuals.heatColor),
			"interior-marking",
		);
		marking.position.set(0, -interior.laneHalfUpKm, backZ);
		group.add(marking);
	}

	if (type === "shipyard") {
		// Gantries spanning the bay behind the berth line, with cold work light.
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
	}

	if (type === "refinery") {
		// Pipes along both walls and a heat glow at the back — the role's
		// exterior grammar carried inside.
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
	}

	if (type === "outpost") {
		// Exposed conduits and one neutral light: sparse, because that is what an
		// outpost is.
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
	}
	return group;
}
