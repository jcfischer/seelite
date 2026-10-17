import {
	migrateEquipment,
	equipmentNames,
	stockLoadout,
	moduleRow,
} from "../src/loadout";
/**
 * What a death costs the pilot (#660, built by node #704): commander in,
 * commander out, for each cause — the pod's eject (D2) and a death without
 * one (D6) — with the journal's half (D3) inside both; the eject warning's
 * threshold against the hostile weapon table (D12); the wake; and the Wanted
 * case D6 owes a check on (sage round 2 on #707).
 */
import { describe, expect, test } from "bun:test";
import { carrierKey } from "../src/carrier-key";
import {
	EJECT_REACTION_S,
	EJECT_WARNING_HULL,
	EJECT_WARNING_WINDOW_S,
	HOSTILE_WEAPONS,
	deathWake,
	ejectWarningDue,
	ejectWarningText,
	parseDeathWake,
	stepEjectWarning,
	wakeText,
} from "../src/death-cost";
import { EJECT_HOLD_S, EJECT_IDLE, stepEjectHold } from "../src/eject";
import { generateGalaxy } from "../src/galaxy";
import { commanderAfterDeath } from "../src/holdings";
import {
	HULL_IDS,
	HULL_SPECS,
	type HullId,
	PLAYER_BASELINE_HULL,
} from "../src/hull";
import {
	FUGITIVE_HEAT,
	HEAT_CAP,
	HEAT_HALF_LIFE_S,
	WANTED_HEAT,
	dockingRefusedByLaw,
	legalStandingAt,
} from "../src/legal";
import { ESCAPE_POD } from "../src/market";
import {
	LOST_WITH_SHIP_REASON,
	entrustedTonnesAboard,
	requestAction,
} from "../src/requests";
import {
	type CommanderRecord,
	newCommanderRecord,
	parseSave,
	serializeSave,
} from "../src/save-envelope";
import {
	HULL_KILL_TOLERANCE,
	PULSE_LASER,
	applyDamage,
	fullCondition,
	stepCondition,
} from "../src/ship-condition";
import { STARTING_CREDITS } from "../src/station-commerce";
import { MAX_DT } from "../src/units";
import type { LegalStatus } from "../src/world-state";
import { advanceTo, newWorld } from "../src/world-state";
import { firstOffer, firstProcurementOffer } from "./helpers/job-board";

const SYSTEMS = generateGalaxy(0x5ee11e, 0).systems;
const { offers, offer: courier } = firstOffer(SYSTEMS, "courier");
const at = (ref: (typeof courier)["requester"]) => ({
	galaxyIndex: ref.galaxyIndex,
	carrierKey: ref.carrierKey,
});
const ctx = {
	now: 60,
	docked: at(courier.requester),
	cargo: {},
	holdRoomT: 200,
	standing: "clean" as const,
	equipment: [] as readonly string[],
};

const LAUNCH_HULL = "freighter";
const FITTED = ["Docking Computer", ESCAPE_POD, "Large Cargo Bay"];

/** The commander as it launched: a bought hull, three fittings, the pilot's
 *  own Food with its basis, a running courier with its consignment aboard,
 *  banked ladder credit, a tank part-spent. */
const launched = (): CommanderRecord => {
	const base = newCommanderRecord(LAUNCH_HULL, {
		chargeAu: HULL_SPECS[LAUNCH_HULL].chargeAu / 2,
	});
	const accepted = requestAction(
		base.requests,
		offers,
		"accept",
		courier.id,
		ctx,
	);
	expect(accepted.ok).toBe(true);
	const tracked = requestAction(
		accepted.state,
		offers,
		"track",
		courier.id,
		ctx,
	).state;
	return {
		...base,
		requests: tracked,
		state: {
			...base.state,
			credits: 5432,
			cargo: { Food: 6 },
			loadout: migrateEquipment(LAUNCH_HULL, [...FITTED]).loadout,
			fuelLy: HULL_SPECS[LAUNCH_HULL].tankLy / 3,
		},
		ladders: {
			...base.ladders,
			banked: { combat: 7, trade: 40, exploration: 3 },
			basis: { Food: { units: 6, cr: 30 } },
			playedS: 600,
		},
	};
};

/** The commander at the death: the leg moved its credits and its play log. */
const dyingFrom = (launch: CommanderRecord): CommanderRecord => ({
	...launch,
	state: { ...launch.state, credits: 9999 },
	ladders: { ...launch.ladders, playedS: 1800 },
});

/** The record a death writes has to be one the reload can parse. */
const parses = (commander: CommanderRecord) =>
	parseSave(serializeSave({ world: advanceTo(newWorld(7), 120), commander }))
		.commander;

describe("#660 D2 — an eject: the hold and the pod go, the ship stays", () => {
	const launch = launched();
	const after = commanderAfterDeath(launch, dyingFrom(launch), "eject");

	test("the launch hull, every other fitting, the launch credits, tank and charge", () => {
		expect(after.state.hull).toBe(LAUNCH_HULL);
		expect(equipmentNames(after.state.loadout)).toEqual(
			equipmentNames(launch.state.loadout).filter(
				(item) => item !== ESCAPE_POD,
			),
		);
		expect(after.state.credits).toBe(5432);
		expect(after.state.fuelLy).toBe(launch.state.fuelLy);
		expect(after.chargeAu).toBe(launch.chargeAu);
		expect(after.dockedAt).toBe(launch.dockedAt);
	});

	test("the hold is empty: the pilot's cargo, its basis and the consignment", () => {
		expect(after.state.cargo).toEqual({});
		expect(after.ladders.basis).toEqual({});
		expect(entrustedTonnesAboard(after.requests)).toBe(0);
	});

	test("ladders keep the launch's rungs and the dying play log (#183, #581)", () => {
		expect(after.ladders.banked).toEqual(launch.ladders.banked);
		expect(after.ladders.visited).toEqual(launch.ladders.visited);
		expect(after.ladders.playedS).toBe(1800);
	});

	test("the record parses: the reload can boot it", () => {
		const read = parses(after);
		expect(read.state).toEqual(after.state);
		expect(read.requests.byId[courier.id].status).toBe("failed");
	});
});

describe("#660 D3 — the consignment's job fails, and nothing is owed", () => {
	for (const cause of ["eject", "destroyed"] as const)
		test(`${cause}: failed with the reason on the board, untracked, takeable again`, () => {
			const launch = launched();
			const after = commanderAfterDeath(launch, dyingFrom(launch), cause);
			const job = after.requests.byId[courier.id];
			expect(job.status).toBe("failed");
			expect(job.outcomeReason).toBe(LOST_WITH_SHIP_REASON);
			expect(after.requests.trackedRequestId).toBeNull();
			// Nothing is owed: the credits are the launch's, untouched.
			expect(after.state.credits).toBe(launch.state.credits);
			const again = requestAction(
				after.requests,
				offers,
				"accept",
				courier.id,
				ctx,
			);
			expect(again.ok).toBe(true);
		});

	test("procurement is the pilot's own errand: it survives, set back", () => {
		const { offers: shelf, offer: purchase } = firstProcurementOffer(
			SYSTEMS,
			"Food",
			0,
		);
		const base = newCommanderRecord(PLAYER_BASELINE_HULL);
		const taken = requestAction(base.requests, shelf, "accept", purchase.id, {
			...ctx,
			docked: at(purchase.requester),
		});
		expect(taken.ok).toBe(true);
		const launch = { ...base, requests: taken.state };
		const after = commanderAfterDeath(launch, launch, "destroyed");
		expect(after.requests.byId[purchase.id].status).toBe("accepted");
	});
});

describe("#660 D6 — a death without ejecting: the ship goes", () => {
	const launch = launched();
	const after = commanderAfterDeath(launch, dyingFrom(launch), "destroyed");

	test("a stock courier, no fittings, an empty hold, a full tank and charge", () => {
		expect(after.state.hull).toBe(PLAYER_BASELINE_HULL);
		expect(after.state.loadout).toEqual(stockLoadout(PLAYER_BASELINE_HULL));
		expect(after.state.cargo).toEqual({});
		expect(entrustedTonnesAboard(after.requests)).toBe(0);
		expect(after.state.fuelLy).toBe(HULL_SPECS[PLAYER_BASELINE_HULL].tankLy);
		expect(after.chargeAu).toBe(HULL_SPECS[PLAYER_BASELINE_HULL].chargeAu);
	});

	test("the launch credits are kept, and the leg's are not", () => {
		expect(after.state.credits).toBe(5432);
	});

	test("rungs and banked credit are untouched (#183)", () => {
		expect(after.ladders.banked).toEqual(launch.ladders.banked);
		expect(after.ladders.playedS).toBe(1800);
	});

	test("a pod fitted and not launched is lost with the rest (D4)", () => {
		expect(equipmentNames(launch.state.loadout)).toContain(ESCAPE_POD);
		expect(equipmentNames(after.state.loadout)).not.toContain(ESCAPE_POD);
	});

	test("the record parses, at the launch station", () => {
		const read = parses(after);
		expect(read.state).toEqual(after.state);
		expect(read.chargeAu).toBe(after.chargeAu);
		expect(read.dockedAt).toBe(launch.dockedAt);
	});

	test("a pilot with nothing is not stranded: a courier and the courier floor", () => {
		const broke = {
			...newCommanderRecord(PLAYER_BASELINE_HULL),
			state: {
				...newCommanderRecord(PLAYER_BASELINE_HULL).state,
				credits: 0,
			},
		};
		const woke = commanderAfterDeath(broke, broke, "destroyed");
		expect(woke.state.credits).toBe(0);
		expect(woke.state.fuelLy).toBeGreaterThan(0);
		// An entrusted job takes no credits to accept.
		const take = requestAction(woke.requests, offers, "accept", courier.id, {
			...ctx,
			holdRoomT: HULL_SPECS[PLAYER_BASELINE_HULL].holdT,
		});
		expect(courier.operand.entrusted).toBe(true);
		expect(take.ok).toBe(true);
		expect(STARTING_CREDITS).toBeGreaterThan(0);
	});
});

describe("#660 D12 — the warning threshold, derived from the hostile weapon table", () => {
	test("no hull's gun out-fires the table's strongest row", () => {
		// A raider (`duel.ts`) and a carrier returning fire
		// (`traffic-engagement.ts`) fire through `stepCondition`, so a second
		// of its trigger on every hull in the roster is every gun a hostile
		// has today. This catches a hull given a harder-hitting gun there; a
		// weapon fired outside `stepCondition` it cannot see, and that one is
		// added to `HOSTILE_WEAPONS` by hand.
		const strongest = Math.max(...HOSTILE_WEAPONS.map((w) => w.hullDamagePerS));
		for (const hull of HULL_IDS) {
			const gun = stepCondition(fullCondition(hull), 1, true);
			expect(gun.damage, hull).toBeLessThanOrEqual(strongest);
		}
		expect(strongest).toBe(PULSE_LASER.damagePerS);
	});

	test("the window is a second of reaction, the hold, and two longest frames", () => {
		expect(EJECT_REACTION_S).toBe(1);
		expect(EJECT_WARNING_WINDOW_S).toBeCloseTo(
			EJECT_REACTION_S + EJECT_HOLD_S + 2 * MAX_DT,
			12,
		);
		expect(EJECT_WARNING_HULL).toBeCloseTo(
			PULSE_LASER.damagePerS * EJECT_WARNING_WINDOW_S + HULL_KILL_TOLERANCE,
			9,
		);
	});

	/**
	 * Flown in the game's own order (`Game.step`): each frame the eject runs
	 * first — the warning read off the hull the last frame left, the hold
	 * stepped, the pod gone if it completes — and the guns after it. The
	 * strongest hostile gun on a ship with its shields down. The pilot's hand
	 * goes down a second after the frame that first showed the warning, `lag`
	 * of a frame late against the frame clock, and stays down. True when the
	 * eject came before the frame whose hit finishes the hull.
	 */
	const flyToEject = (
		hull: HullId,
		dt: number,
		lag: number,
		warned: (hull: number) => boolean,
	): boolean => {
		let player = { ...fullCondition(hull), fore: 0, aft: 0 };
		let gun = fullCondition("raider");
		let hold = EJECT_IDLE;
		let pressAt: number | null = null;
		for (let n = 1; player.hull > 0; n++) {
			if (n > 3600 / dt) throw new Error(`${hull} never died`);
			const t = n * dt;
			if (pressAt === null && warned(player.hull))
				pressAt = t + EJECT_REACTION_S + lag * dt;
			const down = pressAt !== null && t >= pressAt - 1e-9;
			const step = stepEjectHold(hold, down, dt, null);
			hold = step.hold;
			if (step.event?.kind === "eject") return true;
			const fired = stepCondition(gun, dt, true);
			gun = fired.condition;
			player = applyDamage(player, fired.damage, "fore");
		}
		return false;
	};

	for (const dt of [1 / 60, 1 / 30, MAX_DT])
		test(`a pilot who reacts in a second is out before the last hit, every hull, at dt ${dt.toFixed(3)}`, () => {
			const warned = (hull: number) =>
				ejectWarningDue({
					podFitted: true,
					permadeath: false,
					flying: true,
					alive: true,
					hull,
				});
			for (const hull of HULL_IDS)
				for (const lag of [0, 0.25, 0.5, 0.75, 0.999])
					expect(
						flyToEject(hull, dt, lag, warned),
						`${hull}, a press ${lag} of a frame late`,
					).toBe(true);
		});

	test("one longest frame was not enough: the shipped order loses a ship with it", () => {
		// The control for the row above: the same flight, with a window of one
		// frame, has a hull and an alignment that dies holding the key.
		const oneFrame =
			PULSE_LASER.damagePerS * (EJECT_REACTION_S + EJECT_HOLD_S + MAX_DT) +
			HULL_KILL_TOLERANCE;
		let lost = 0;
		for (const hull of HULL_IDS)
			for (const lag of [0, 0.5, 0.999])
				if (!flyToEject(hull, MAX_DT, lag, (h) => h < oneFrame)) lost++;
		expect(lost).toBeGreaterThan(0);
	});

	test("no pod, no warning; not on the rails or docked; not for a wreck", () => {
		const low = EJECT_WARNING_HULL - 1;
		const base = {
			podFitted: true,
			permadeath: false,
			flying: true,
			alive: true,
			hull: low,
		};
		expect(ejectWarningDue(base)).toBe(true);
		expect(ejectWarningDue({ ...base, podFitted: false })).toBe(false);
		expect(ejectWarningDue({ ...base, flying: false })).toBe(false);
		expect(ejectWarningDue({ ...base, alive: false })).toBe(false);
		expect(ejectWarningDue({ ...base, hull: EJECT_WARNING_HULL })).toBe(false);
	});

	test("never for a permadeath commander, whom an eject does not save", () => {
		// The store restores nothing for them (#89 D7): the pod keeps no ship,
		// so neither the glass nor the voice urges one (`economy-trade.md` §9).
		expect(
			ejectWarningDue({
				podFitted: true,
				permadeath: true,
				flying: true,
				alive: true,
				hull: EJECT_WARNING_HULL - 1,
			}),
		).toBe(false);
	});

	test("the voice is said once per crossing, and again only after it lapses", () => {
		let spoken = false;
		const said: boolean[] = [];
		for (const due of [false, true, true, true, false, true]) {
			const step = stepEjectWarning(spoken, due);
			spoken = step.spoken;
			said.push(step.speak);
		}
		expect(said).toEqual([false, true, false, false, false, true]);
	});

	test("the sentence names the control as bound", () => {
		expect(ejectWarningText("hold Backspace to eject")).toBe(
			"HULL FAILING · HOLD BACKSPACE TO EJECT",
		);
	});
});

describe("the wake: what the death took", () => {
	const launch = launched();

	test("an eject took the hold and the pod; the ship is named as kept", () => {
		const wake = deathWake("jameson", launch, "eject", false);
		expect(wake).toEqual({
			saveSlot: "jameson",
			cause: "eject",
			hull: LAUNCH_HULL,
			holdT: 6 + courier.operand.tonnes,
			fittingsLost: 1,
			failedJobs: 1,
			firstLife: false,
		});
		const text = wakeText(wake);
		expect(text).toContain("escape pod");
		expect(text).toContain(`the hold (${6 + courier.operand.tonnes} t)`);
		expect(text).toContain(`${LAUNCH_HULL} and its fittings are kept`);
		expect(text).toContain("1 job failed");
	});

	test("a death without one took the ship, its fittings and the hold", () => {
		const wake = deathWake("jameson", launch, "destroyed", false);
		expect(wake.fittingsLost).toBe(FITTED.length);
		const text = wakeText(wake);
		expect(text).toContain("stock courier");
		expect(text).toContain(`your ${LAUNCH_HULL}, 3 fittings and the hold`);
	});

	test("a bare courier with nothing aboard is told so, with no jobs line", () => {
		const bare = newCommanderRecord(PLAYER_BASELINE_HULL);
		expect(deathWake("x", bare, "destroyed", false).fittingsLost).toBe(0);
		const upgraded = {
			...bare,
			state: {
				...bare.state,
				loadout: {
					...bare.state.loadout,
					plant: { ...bare.state.loadout.plant, grade: "A" as const },
				},
			},
		};
		expect(deathWake("x", upgraded, "destroyed", false).fittingsLost).toBe(1);
		const text = wakeText(deathWake("x", bare, "destroyed", false));
		expect(text).toContain("an empty hold");
		expect(text).not.toContain("Requests");
	});

	test("a pilot who never docked is not told they are back where they launched", () => {
		const dying = {
			...newCommanderRecord(PLAYER_BASELINE_HULL),
			state: {
				...newCommanderRecord(PLAYER_BASELINE_HULL).state,
				cargo: { Food: 3 },
			},
		};
		const wake = deathWake("x", dying, "destroyed", true);
		expect(wake.holdT).toBe(3);
		const text = wakeText(wake);
		expect(text).not.toContain("where you launched");
		expect(text).toContain("new commander");
		expect(text).toContain("the hold (3 t)");
	});

	test("the stored wake round-trips, and anything else reads as none", () => {
		const wake = deathWake("jameson", launch, "eject", false);
		expect(parseDeathWake(structuredClone(wake))).toEqual(wake);
		expect(parseDeathWake(null)).toBeNull();
		expect(parseDeathWake("eject")).toBeNull();
		expect(parseDeathWake({ ...wake, cause: "drowned" })).toBeNull();
		expect(parseDeathWake({ ...wake, hull: "zeppelin" })).toBeNull();
		expect(parseDeathWake({ ...wake, failedJobs: -1 })).toBeNull();
		expect(parseDeathWake({ ...wake, firstLife: "no" })).toBeNull();
	});
});

/**
 * Sage round 2 on #707: heat survives a death (#654), so a Wanted or Fugitive
 * pilot wakes at the launch station with it. Does the floor hold?
 *
 * It holds for **work**, and for **a berth** with one exception that is
 * bounded. The exception: a launch station that refuses this pilot by law —
 * a shipyard on standing alone, or a trade station or refinery that heard the
 * offence — refuses the docked restore's clearance too, and the pilot wakes
 * in flight beside it (node #658's D2) rather than in its berth. The rows
 * below are what is left to them.
 */
describe("#660 D6 — the Wanted case: the floor for a pilot who keeps their heat", () => {
	const witness = carrierKey(3, "station-trade");
	const elsewhere = carrierKey(3, "station-refinery");
	const fugitive: LegalStatus = {
		heat: HEAT_CAP,
		updatedAt: 0,
		witnesses: [witness],
		assaulted: [],
	};

	test("courier and procurement work reads no standing: a Fugitive takes it", () => {
		expect(legalStandingAt(fugitive, 0)).toBe("fugitive");
		expect(FUGITIVE_HEAT).toBeLessThanOrEqual(HEAT_CAP);
		const take = requestAction(
			newCommanderRecord(PLAYER_BASELINE_HULL).requests,
			offers,
			"accept",
			courier.id,
			{ ...ctx, standing: "fugitive" },
		);
		expect(take.ok).toBe(true);
		const { offers: shelf, offer: purchase } = firstProcurementOffer(
			SYSTEMS,
			"Food",
			0,
		);
		const buy = requestAction(
			newCommanderRecord(PLAYER_BASELINE_HULL).requests,
			shelf,
			"accept",
			purchase.id,
			{ ...ctx, docked: at(purchase.requester), standing: "fugitive" },
		);
		expect(buy.ok).toBe(true);
	});

	test("a trade station or refinery that did not hear the offence gives a berth", () => {
		for (const type of ["trade", "refinery"] as const) {
			expect(
				dockingRefusedByLaw(fugitive, { key: elsewhere, type }, 0),
				type,
			).toBe(false);
			expect(
				dockingRefusedByLaw(fugitive, { key: witness, type }, 0),
				type,
			).toBe(true);
		}
		expect(
			dockingRefusedByLaw(fugitive, { key: elsewhere, type: "shipyard" }, 0),
		).toBe(true);
	});

	test("the worst refusal ends: heat at the cap decays below Wanted in bounded time", () => {
		const boundS = HEAT_HALF_LIFE_S * Math.log2(HEAT_CAP / WANTED_HEAT);
		// About 100 minutes of game clock, at the cap.
		expect(boundS / 60).toBeCloseTo(99.66, 1);
		for (const type of ["trade", "refinery", "shipyard"] as const)
			expect(
				dockingRefusedByLaw(fugitive, { key: witness, type }, boundS + 1),
				type,
			).toBe(false);
	});

	test("and the stock courier wakes with a full tank: another system is a jump away", () => {
		const woke = commanderAfterDeath(launched(), launched(), "destroyed");
		expect(woke.state.fuelLy).toBe(HULL_SPECS[PLAYER_BASELINE_HULL].tankLy);
		expect(woke.state.fuelLy).toBeGreaterThan(0);
	});
});
