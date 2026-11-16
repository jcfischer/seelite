/**
 * The firing vents on NPC hulls (node #637): each NPC flight keeps the table
 * its Hull step fired, and one plume set per drawn hull draws it.
 */
import { describe, expect, test } from "bun:test";
import * as THREE from "three";
import { carrierKey } from "../src/carrier-key";
import { createCombatEnemy, stepCombatEnemy } from "../src/combat-enemy";
import {
	type DuelPilot,
	type Raider,
	raiderAtDrop,
	stepDuel,
} from "../src/duel";
import { HULL_SPECS, type HullId } from "../src/hull";
import { NpcPlumes } from "../src/npc-plumes";
import { fullCondition } from "../src/ship-condition";
import { buildShipMesh } from "../src/ship-mesh";
import { type VentLevels, steadyFrame } from "../src/sim";
import { engage, stepEngagement } from "../src/traffic-engagement";
import { v3 } from "../src/vec3";
import { buildVentPlumes } from "../src/vent-plumes";

const DT = 1 / 60;
const FORWARD = v3(0, 0, -1);
const NO_SHOT = { fired: false, damage: 0 };

function pilot(): DuelPilot {
	const ship = { pos: v3(0, 0, 0), vel: v3(0, 0, 0) };
	return {
		ship,
		nose: FORWARD,
		aimOrigin: ship.pos,
		aimNose: FORWARD,
		hull: fullCondition("courier").hull,
		frame: steadyFrame(v3()),
		solids: [],
	};
}

const lit = (firing: VentLevels): string[] =>
	Object.entries(firing)
		.filter(([, level]) => (level ?? 0) > 0)
		.map(([slot]) => slot);

/** Every lit slot is one of the hull's own vents, at a level in (0, 1]. */
function expectOwnVents(firing: VentLevels, hull: HullId) {
	const slots = new Set(HULL_SPECS[hull].vents.map((v) => v.slot));
	for (const [slot, level] of Object.entries(firing)) {
		expect(slots.has(slot as never)).toBe(true);
		expect(level ?? 0).toBeGreaterThanOrEqual(0);
		expect(level ?? 0).toBeLessThanOrEqual(1);
	}
}

describe("an NPC flight keeps the vents its Hull step fired", () => {
	test("a spawned ship has fired nothing", () => {
		expect(raiderAtDrop(v3(0, 0, -5), pilot().ship, 3).firing).toEqual({});
		expect(createCombatEnemy(pilot().ship, FORWARD).firing).toEqual({});
	});

	test("the duel's raider, turning and closing, keeps a non-empty table of its own vents", () => {
		// Dropped off to one side, nosed away: the first steps must turn it
		// and drive it, so its vents fire.
		let raider: Raider = {
			flight: {
				...raiderAtDrop(v3(4, 0, -6), pilot().ship, 11),
				nose: v3(1, 0, 0),
			},
			condition: fullCondition("raider"),
		};
		let seen = 0;
		for (let i = 0; i < 30; i++) {
			raider = stepDuel(raider, pilot(), NO_SHOT, DT).raider;
			expectOwnVents(raider.flight.firing, "raider");
			if (lit(raider.flight.firing).length > 0) seen++;
		}
		expect(seen).toBeGreaterThan(0);
	});

	test("an engaged carrier keeps its own hull's table, not the raider's", () => {
		let carrier = engage(
			{
				key: carrierKey(1, "station-trade/traffic-00"),
				hullId: "freighter",
				pos: v3(0, 0, -3),
				vel: v3(),
				nose: v3(1, 0, 0),
				up: null,
				voyageOrdinal: 0,
			},
			17,
			{ assaultAlreadyCharged: false, byPilot: true },
		);
		expect(carrier.flight.firing).toEqual({});
		let seen = 0;
		for (let i = 0; i < 30; i++) {
			carrier = stepEngagement(carrier, pilot(), NO_SHOT, DT).engagement;
			expectOwnVents(carrier.flight.firing, "freighter");
			if (lit(carrier.flight.firing).length > 0) seen++;
		}
		expect(seen).toBeGreaterThan(0);
	});

	test("the combat rig's striker keeps its table too", () => {
		const p = pilot();
		let enemy = createCombatEnemy(p.ship, FORWARD, 5);
		let seen = 0;
		for (let i = 0; i < 30; i++) {
			enemy = stepCombatEnemy(
				enemy,
				p.ship,
				FORWARD,
				{
					targetHull: 100,
					targetEnergy: 100,
					targetHeatLocked: false,
					playerHull: 100,
				},
				false,
				DT,
			).state;
			if (lit(enemy.firing).length > 0) seen++;
		}
		expect(seen).toBeGreaterThan(0);
	});
});

describe("one plume set per drawn NPC hull", () => {
	const placed = (hull: HullId) => {
		const scene = new THREE.Scene();
		const root = buildShipMesh(hull, HULL_SPECS[hull].variant).root;
		scene.add(root);
		root.position.set(3, -2, 7);
		root.quaternion.setFromEuler(new THREE.Euler(0.3, 1.1, -0.4));
		return { scene, root };
	};

	test("a hull that has never fired builds nothing", () => {
		const { root } = placed("raider");
		const plumes = new NpcPlumes();
		expect(plumes.draw(root, "raider", {}, 1)).toBe(0);
		expect(plumes.size).toBe(0);
		expect(root.parent?.getObjectByName("vent-plumes")).toBeUndefined();
	});

	test("a firing hull gets a sibling set in its own scene that rides its transform", () => {
		const { scene, root } = placed("raider");
		const plumes = new NpcPlumes();
		expect(plumes.draw(root, "raider", { main: 1 }, 1)).toBeGreaterThan(0);
		const set = plumes.of(root);
		expect(set?.object.parent).toBe(scene);
		expect(root.getObjectByName("vent-plumes")).toBeUndefined();
		expect(set?.object.position.equals(root.position)).toBe(true);
		expect(set?.object.quaternion.equals(root.quaternion)).toBe(true);
		// The next frame moves the hull; the set follows.
		root.position.set(-1, 4, 2);
		plumes.draw(root, "raider", { main: 1 }, 1.1);
		expect(set?.object.position.equals(root.position)).toBe(true);
	});

	test("the throats are measured in the hull's own frame, wherever it is placed", () => {
		// Building from a placed root must measure what an unplaced one does,
		// and must leave the root where it was.
		const { scene, root } = placed("freighter");
		const position = root.position.clone();
		const quaternion = root.quaternion.clone();
		const plumes = new NpcPlumes();
		plumes.draw(root, "freighter", { main: 1 }, 0.5);
		expect(root.parent).toBe(scene);
		expect(root.position.equals(position)).toBe(true);
		expect(root.quaternion.equals(quaternion)).toBe(true);
		const fresh = buildVentPlumes(
			buildShipMesh("freighter", HULL_SPECS.freighter.variant).root,
			"freighter",
		);
		const throats = plumes.of(root)?.throats ?? [];
		expect(throats.length).toBe(fresh.throats.length);
		throats.forEach((t, i) => {
			expect(t.slot).toBe(fresh.throats[i].slot);
			expect(t.at.distanceTo(fresh.throats[i].at)).toBeLessThan(1e-9);
		});
	});

	test("one set per hull: two firing hulls, two sets, each lit from its own table", () => {
		const a = placed("raider");
		const b = placed("patrol");
		const plumes = new NpcPlumes();
		plumes.draw(a.root, "raider", { main: 1 }, 2);
		plumes.draw(b.root, "patrol", {}, 2);
		// b has not fired, so it has no set yet.
		expect(plumes.size).toBe(1);
		plumes.draw(b.root, "patrol", { "fore-port-lateral": 1 }, 2.1);
		expect(plumes.size).toBe(2);
		expect(plumes.of(a.root)).not.toBe(plumes.of(b.root));
		expect(plumes.of(b.root)?.object.userData.lit).toBe(1);
	});

	test("a hull no longer drawn loses its set at the end of the frame", () => {
		const { root } = placed("raider");
		const plumes = new NpcPlumes();
		plumes.draw(root, "raider", { main: 1 }, 1);
		plumes.endFrame();
		expect(plumes.size).toBe(1);
		const set = plumes.of(root);
		root.removeFromParent();
		expect(plumes.draw(root, "raider", { main: 1 }, 1.2)).toBe(0);
		expect(set?.object.parent).toBeNull();
		plumes.endFrame();
		expect(plumes.size).toBe(0);
	});
});
