/**
 * Stations are solid: a ship stops at a station's hull, at a pad berth and at a // glossary-ignore: pad
 * shipyard boom (`collision.md` §9.2.1, §9.2.2, node #663).
 *
 *   npm run dev                         # in one shell
 *   node scripts/probe-collision.mjs    # in another
 *
 * **§9.2.1 is `docking.md` §9.2.4's run, re-pointed.** That row flew a hull-face
 * approach — inside check 2's cone, outside the aperture — and asserted a
 * failed entry, which proved check 5. With the hull solid the same approach
 * stops at the hull and never reaches the plane, so it proves that collision
 * works, under the name that says so. Check 5 keeps its headless rows.
 *
 * **§9.2.2 is where a too-generous proxy would show**: the pad's deck and its // glossary-ignore: pad
 * berths, and the Gantry's booms, are the sparse parts of the selected forms,
 * and a box that wraps them is an invisible wall nothing headless can see
 * (§11, joint 5). So each row casts from the stopped hull box's fore-face
 * centre along the ship's nose onto the **drawn** station, then prints the
 * distance to that face — the figure a person judges a wall by. The probe
 * asserts the stop; it prints the gap.
 *
 * Seed 42, system 8: a trade station, a refinery and a shipyard. Each run is
 * flown by the game's own `step` with the assist off and the throttle shut, so
 * the ship coasts in at a closing speed this file sets relative to the station
 * — at `V_GATE`, which bound 1 of §3 makes survivable for every hull. Every
 * figure (the gate, the restitution, the damage law, the axis, the plane, the
 * berth) is read off `window.__seelite`.
 */
import {
	bootedGame,
	guardedOrigin,
	launchChromium,
	tally,
} from "./probe-guard.mjs";
import { gameUrl } from "./lib/game-url.mjs";

const ORIGIN =
	process.env.PROBE_ORIGIN ?? process.argv[2] ?? "http://localhost:5173";
const SEED = 42;
const SYSTEM = 8;
const origin = await guardedOrigin(ORIGIN);
const browser = await launchChromium();
const { check, watch, exit } = tally();

/**
 * Coast at a station of `type` from a station-relative start, nose down the
 * docking axis, and step until the ship has met it and a second has passed.
 * `where` names the start: `face` (§9.2.1), `berth` (a pad's first berth) or // glossary-ignore: pad
 * `static` (a member of a shipyard's static frame, at `perch`). `system`
 * defaults to the one system above; a shipyard row names the system whose
 * shipyard is built in the form it is about (node #746).
 */
const coast = async ({ type, where, gates, system = SYSTEM, perch = null }) => {
	const page = await browser.newPage({ viewport: { width: 900, height: 620 } });
	watch(page);
	await page.goto(gameUrl(origin, { seed: SEED, system }));
	await bootedGame(page);
	const r = await page.evaluate(
		async ({ type, where, gates, perch }) => {
			const g = window.__seelite;
			const THREE = await import("/node_modules/.vite/deps/three.js");
			const station = g.world.system.contents.stations.find(
				(s) => s.type === type,
			);
			if (!station) return { error: `no ${type} at seed/system` };
			const id = station.id;
			const { add, sub, scale, dot, cross, length } = await import(
				"/src/vec3.ts"
			);
			const unit = (a) => scale(a, 1 / length(a));
			const snap = g.dockingSnapshot(id);
			if (!snap) return { error: `no snapshot of ${id}` };
			function startOf(where, snap, g, perch) {
				const axis = snap.axis;
				// The phase-zero basis: the static frame, and a pad's only one. // glossary-ignore: pad
				const across0 = unit(
					sub(snap.reference, scale(axis, dot(snap.reference, axis))),
				);
				const up0 = cross(axis, across0);
				const deg = g.dockingTolerances.AXIS_TOLERANCE_DEG;
				let rel;
				let label;
				if (where === "face") {
					// Three quarters of the way to check 2's cone edge, as §9.2.4 flew
					// it: inside the cone, four times outside the slot. // glossary-ignore: slot
					const off = 0.75 * snap.planeKm * Math.tan((deg * Math.PI) / 180);
					rel = add(scale(axis, snap.planeKm + 0.5), scale(across0, off));
					label = `${(off * 1000).toFixed(0)} m off the axis`;
				} else if (where === "berth") {
					const berth = g.interiorOf(id).berths[0];
					const c = berth.centre;
					rel = add(
						add(scale(across0, c.across), scale(up0, c.up)),
						scale(axis, c.axial + 0.3),
					);
					label = `over berth ${berth.id}`;
				} else {
					// Over a member of a shipyard's static frame, at a perch the
					// row names per form (node #746): `axialKm` out along the axis
					// and `upKm` out along the static `up`.
					rel = add(scale(axis, perch.axialKm), scale(up0, perch.upKm));
					label = perch.label;
				}
				return { rel, label };
			}
			const { rel, label } = startOf(where, snap, g, perch);
			const axis = snap.axis;
			const gate = g.dockingTolerances.V_GATE_KMS;
			function foreFaceGapKm(g, id) {
				// Along the ship's nose from its fore-face centre. The
				// near layer draws at 1:1, placed about the camera.
				const box = g.flownSolid[0];
				if (box.kind !== "box") throw new Error("player has no hull box");
				const shipNose = g.nose();
				const shipUp = g.shipUp();
				// The fore face's centre, including the measured origin offset.
				// Casting only against the station needs no self-hit offset.
				const foreFace = add(
					g.world.ship.pos,
					add(
						add(
							scale(cross(shipNose, shipUp), box.centre.x),
							scale(shipUp, box.centre.y),
						),
						scale(shipNose, box.centre.z + box.half[2]),
					),
				);
				const cam = g.cameraSimPos;
				const from = sub(foreFace, cam);
				const root = g.stationVisuals.get(id)?.root;
				if (root) {
					root.updateMatrixWorld(true);
					const caster = new THREE.Raycaster(
						new THREE.Vector3(from.x, from.y, from.z),
						new THREE.Vector3(shipNose.x, shipNose.y, shipNose.z),
					);
					const hit = caster
						.intersectObject(root, true)
						.find((h) => h.face && h.object.visible);
					return hit ? hit.distance : null;
				}
				return null;
			}
			const body = g.world.system.byId.get(id);
			const carried = g.stationVelocity(id);
			const nose = scale(axis, -1);
			g.resetDock();
			g.dockingComputer.disengage();
			g.regime = "normal";
			g.assist = false;
			g.setThrottle(0);
			g.rates = { pitch: 0, yaw: 0, roll: 0 };
			g.setAttitude(nose, snap.basis.up);
			g.world.ship.pos = add(body.pos, rel);
			g.world.ship.vel = add(carried, scale(nose, gates * gate));
			g.condition = structuredClone(snap.conditionFull);
			g.lastEntry = null;
			const start = { ...g.condition };
			const impactsBefore = g.collisionImpacts;
			const dt = g.units.MAX_DT;
			let metAt = null;
			let outwardAfterKms = null;
			let lowestAxialKm = Number.POSITIVE_INFINITY;
			let gapKm = null;
			const limit = Math.round((0.6 / (gates * gate) + 2) / dt);
			for (let i = 0; i < limit; i++) {
				g.step(dt);
				g.render(dt);
				const now = g.world.system.byId.get(id).pos;
				const shipRel = sub(g.world.ship.pos, now);
				const vRel = sub(g.world.ship.vel, g.stationVelocity(id));
				lowestAxialKm = Math.min(lowestAxialKm, dot(shipRel, axis));
				if (metAt === null && g.collisionImpacts > impactsBefore) {
					metAt = i * dt;
					outwardAfterKms = dot(vRel, axis);
					gapKm = foreFaceGapKm(g, id);
				}
				if (g.dead || g.dockedAt) break;
				if (metAt !== null && i * dt > metAt + 1) break;
			}
			const impact = g.lastCollisionImpact;
			return {
				id,
				formId: station.formId,
				label,
				metAtS: metAt,
				impacts: g.collisionImpacts - impactsBefore,
				impact,
				outwardAfterKms,
				lowestAxialKm,
				planeKm: snap.planeKm,
				gapKm,
				entry: g.lastEntry,
				docked: g.dockedAt !== null && g.dockedAt !== undefined,
				dead: g.dead,
				foreSpent: start.fore - g.condition.fore,
				hullSpent: start.hull - g.condition.hull,
				law: {
					RESTITUTION: g.collisionLaw.RESTITUTION,
					damage: g.collisionLaw.impactDamage(gates * gate),
				},
				closingAskedKms: gates * gate,
			};
		},
		{ type, where, gates, perch },
	);
	await page.close();
	return r;
};

const fmt = (km) => (km === null ? "none" : `${(km * 1000).toFixed(1)} m`);

/** The rows every stop shares: met the station named, at the speed set,
 *  bounced at RESTITUTION, survived, and paid through the damage path. */
function stopped(what, r) {
	check(
		`${what}: the ship met the station, at the closing speed it was flown at`,
		!r.error &&
			r.metAtS !== null &&
			r.impact?.bodyId === r.id &&
			Math.abs(r.impact.closingKms / r.closingAskedKms - 1) < 0.05,
		JSON.stringify(r),
	);
	check(
		`${what}: no plane was crossed and no entry was evaluated`,
		r.entry === null && !r.docked,
		JSON.stringify(r.entry),
	);
	check(
		`${what}: it bounced off, at RESTITUTION`,
		r.outwardAfterKms !== null &&
			Math.abs(
				r.outwardAfterKms / (r.law.RESTITUTION * r.impact.closingKms) - 1,
			) < 0.15,
		`${r.outwardAfterKms} km/s outward`,
	);
	check(
		`${what}: and survived it, the cost landing on the fore shield`,
		!r.dead &&
			r.hullSpent === 0 &&
			Math.abs(r.foreSpent / r.law.damage - 1) < 0.1,
		JSON.stringify({ fore: r.foreSpent, hull: r.hullSpent, law: r.law.damage }),
	);
}

// §9.2.1 — a ship stops at a hull.
{
	console.log("\n§9.2.1 a ship stops at a station's hull:");
	const r = await coast({ type: "trade", where: "face", gates: 1 });
	console.log(`  ${r.id} ${r.label}: ${JSON.stringify(r)}`);
	stopped("the hull face", r);
	check(
		"the hull face: the ship never reached the aperture plane",
		r.lowestAxialKm > r.planeKm,
		`${r.lowestAxialKm} km against a ${r.planeKm} km plane`,
	);
	console.log(
		`  the ray from the hull box's fore-face centre along the nose: ${fmt(r.gapKm)}`,
	);
}

// §9.2.2 — a ship stops at a pad berth, and at each shipyard form's static // glossary-ignore: pad
// frame (node #746: the Gantry's dorsal boom, the Hangar's slab, the
// Slipway's arc). Seed 42's systems 7, 8 and 1 build the shipyard in forms
// a, b and c, and each row checks the form it met. Every perch is 0.35 km
// above what it comes down onto, inside `coast`'s 0.6 km of travel:
// - the Gantry's boom stands 0.37–0.58 km out along the static `up` and runs
//   forward to 1.15 km; come down onto its front end;
// - the Hangar's slab stands to 0.432 km along `up` and its forward face is
//   at −0.38 km; 0.40 km out clears the hub's swept corners (0.37 km);
// - the Slipway's arc is a 1.283 km ring whose +Z crown is at 0.12 km, and
//   `up` at phase zero points at 0.5π, inside its 0.28π–1.73π sweep.
for (const [type, where, what, system, perch, formId] of [
	["refinery", "berth", "a pad berth", SYSTEM, null, null], // glossary-ignore: pad
	[
		"shipyard",
		"static",
		"a Gantry's boom",
		7,
		{ axialKm: 1.5, upKm: 0.475, label: "over the dorsal boom" },
		"a",
	],
	[
		"shipyard",
		"static",
		"a Hangar's slab",
		8,
		{ axialKm: -0.03, upKm: 0.4, label: "over the slab's forward face" },
		"b",
	],
	[
		"shipyard",
		"static",
		"a Slipway's arc",
		1,
		{ axialKm: 0.47, upKm: 1.283, label: "over the arc's crown" },
		"c",
	],
]) {
	console.log(`\n§9.2.2 a ship stops at ${what}:`);
	const r = await coast({ type, where, gates: 1, system, perch });
	console.log(`  ${r.id} ${r.label}: ${JSON.stringify(r)}`);
	if (formId !== null)
		check(
			`${what}: the system builds its shipyard in form ${formId}`,
			r.formId === formId,
			JSON.stringify(r.formId),
		);
	stopped(what, r);
	// The figure §11's joint 5 is about: how far above the drawn station the
	// proxy stopped it. Printed, not gated — it is the principal's to judge.
	console.log(
		`  the ray from the hull box's fore-face centre along the nose: ${fmt(r.gapKm)}`,
	);
	check(
		`${what}: the fore-face ray meets the drawn station, so the gap is a reading`,
		r.gapKm !== null,
		JSON.stringify(r.gapKm),
	);
}

await browser.close();
exit();
