import { expect, test } from "bun:test";
import { systemIndexOfKey } from "../src/carrier-key";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { projectNavTargets } from "../src/cockpit";
import { AttitudeFollower } from "../src/attitude-hold";
import { ORBIT_ASTERN } from "../src/chase-orbit";
import { DockingComputer } from "../src/docking-computer";
import {
	EJECT_IDLE,
	type EjectHold,
	idleEjectHold,
	stepEjectHold,
} from "../src/eject";
import { keyDispatch } from "../src/key-dispatch";
import {
	NO_ATTITUDE,
	bodyAccelerationBound,
	bodyVelocity,
	makeWorld,
} from "../src/sim";
import {
	type DisplayContact,
	DIVERT_LABEL,
	isDisplayContact,
	relativeLabel,
	trafficDivertCue,
} from "../src/display-contact";
import { trafficPresence } from "../src/traffic-engagement";
import { range } from "../src/units";
import {
	CANISTER_RADIUS_KM,
	CANISTER_SCOOP_SPEED_KMS,
	CARGO_CONTACT_COLOUR,
	scoops,
} from "../src/raider-wreck";
import { length, sub, v3 } from "../src/vec3";
import {
	gameClass as game,
	gameMethodSource as method,
	gameMethods as methods,
	mainSource as source,
} from "./lib/game-methods";
import { repoPath } from "./lib/source-scan";

// Execute the actual Game methods without constructing WebGL or copying their
// implementation into a fixture. TypeScript's parser keeps nested braces safe.
// `tests/lib/game-methods.ts` owns the parse and the transpile.

test("Navigation evaluates ETA for a selectable contact absent from the generated world", () => {
	const world = makeWorld(42);
	const contact = {
		id: "review-hull",
		name: "Kestrel",
		kind: "ship",
		pos: v3(10, 0, 0),
		radiusKm: 0.02,
		color: 0,
		velocity: v3(),
		standing: null,
		scannerClass: "unknown",
	};
	const subject = Object.assign(
		Object.create(
			methods(["navRows"], { projectNavTargets, ETA_INTERVAL_S: 1 }),
		),
		{
			world,
			headLook: "left",
			leftTab: "Navigation",
			targetId: contact.id,
			navEtaAt: -Infinity,
			navEtaCache: new Map(),
			navFilter: { kinds: [], query: "" },
			selectable: () => [contact],
			bodyFor: (id: string) => (id === contact.id ? contact : null),
			timeToBody: (body: unknown) => {
				expect(body).toBe(contact);
				return 5;
			},
		},
	);
	expect(world.system.byId.has(contact.id)).toBe(false);
	expect(subject.navRows()[0].etaSeconds).toBe(5);
});

test("selection includes contacts without putting them in generated bodies or masses", () => {
	const world = makeWorld(42);
	const before = [...world.system.bodies];
	const contact = {
		id: "review-hull",
		name: "Kestrel",
		kind: "ship",
		pos: v3(),
		radiusKm: 0.02,
		color: 0,
		velocity: v3(),
		standing: null,
		scannerClass: "unknown",
	};
	const subject = Object.assign(
		Object.create(
			methods(["selectable", "masses"], {
				bodyVelocity,
				bodyAccelerationBound,
			}),
		),
		{
			world,
			contacts: [contact],
			selectableCache: null,
			massesCache: null,
			massesAt: NaN,
		},
	);
	expect(subject.selectable()).toContain(contact);
	expect(
		subject.masses().some((body: { id: string }) => body.id === contact.id),
	).toBe(false);
	expect(world.system.bodies).toEqual(before);
	expect(world.system.byId.has(contact.id)).toBe(false);
	for (const name of ["buildBodies", "nearestOfKind", "updateHud"]) {
		expect(method(name)).not.toContain("this.contacts");
		expect(method(name)).not.toContain("this.selectable(");
	}
});

test("only selection and scanner read the contact list; other sites register producers", () => {
	const readers = new Set<string>();
	for (const member of game!.members) {
		if (!ts.isMethodDeclaration(member) && !ts.isConstructorDeclaration(member))
			continue;
		const name = ts.isConstructorDeclaration(member)
			? "constructor"
			: member.name.getText(source);
		const visit = (node: ts.Node) => {
			if (
				ts.isPropertyAccessExpression(node) &&
				node.expression.kind === ts.SyntaxKind.ThisKeyword &&
				node.name.text === "contacts"
			) {
				const parent = node.parent;
				const registers =
					ts.isPropertyAccessExpression(parent) && parent.name.text === "push";
				if (!registers) readers.add(name);
			}
			ts.forEachChild(node, visit);
		};
		visit(member);
	}
	expect([...readers].sort()).toEqual([
		"refreshScannerContacts",
		"registerContact",
		"selectable",
		"unregisterContact",
	]);
});

test("target lookup and velocity follow the live contact, while bodies keep orbital velocity", () => {
	const world = makeWorld(42);
	const contact: DisplayContact = {
		id: "review-hull",
		name: "Kestrel",
		kind: "ship",
		pos: v3(10, 0, 0),
		radiusKm: 0.02,
		color: 0,
		velocity: v3(1, 2, 3),
		standing: null,
		scannerClass: "unknown",
	};
	const subject = Object.assign(
		Object.create(
			methods(["bodyFor", "targetBody", "velocityOf", "targetVelocity"], {
				bodyVelocity,
				isDisplayContact,
				v3,
			}),
		),
		{
			world,
			targetId: contact.id,
			selectable: () => [contact],
		},
	);
	expect(subject.targetBody()).toBe(contact);
	expect(subject.targetVelocity()).toEqual(v3(1, 2, 3));
	contact.velocity = v3(4, 5, 6);
	expect(subject.targetVelocity()).toEqual(v3(4, 5, 6));
	subject.targetId = world.system.bodies[0].id;
	expect(subject.targetVelocity()).toEqual(
		bodyVelocity(world.system, subject.targetId, world.gameTime),
	);
	subject.targetId = null;
	expect(subject.targetBody()).toBeNull();
	expect(subject.targetVelocity()).toEqual(v3());
});

test("a live canister is a selectable cargo contact, and losing it drops the lock", () => {
	const canisters = [
		{ id: "cargo-a", commodity: "food", pos: v3(1, 0, 0), vel: v3(0, 1, 0) },
		{ id: "cargo-b", commodity: "furs", pos: v3(2, 0, 0), vel: v3(0, 0, 1) },
	];
	const subject = Object.assign(
		Object.create(
			methods(["syncCargoContacts", "registerContact", "unregisterContact"], {
				CANISTER_RADIUS_KM,
				CARGO_CONTACT_COLOUR,
			}),
		),
		{
			canisters,
			cargoContacts: new Map(),
			contacts: [] as DisplayContact[],
			selectableCache: ["stale"],
			targetId: null as string | null,
		},
	);

	subject.syncCargoContacts();
	expect(subject.contacts.map((c: DisplayContact) => c.id)).toEqual([
		"cargo-a",
		"cargo-b",
	]);
	const first = subject.contacts[0];
	expect(first.kind).toBe("cargo");
	expect(first.radiusKm).toBe(CANISTER_RADIUS_KM);
	expect(first.velocity).toEqual(v3(0, 1, 0));
	// A membership change invalidates the selection cache, or the marker
	// overlay walks a list the canister is not in.
	expect(subject.selectableCache).toBeNull();

	// A frame with the same canisters moves them and registers nothing new.
	subject.selectableCache = ["stale"];
	canisters[0].pos = v3(5, 0, 0);
	subject.syncCargoContacts();
	expect(subject.contacts).toHaveLength(2);
	expect(subject.contacts[0].pos).toEqual(v3(5, 0, 0));
	expect(subject.selectableCache).toEqual(["stale"]);

	// Scooped or expired: the contact goes, and so does a lock on it.
	subject.targetId = "cargo-a";
	subject.canisters = [canisters[1]];
	subject.syncCargoContacts();
	expect(subject.contacts.map((c: DisplayContact) => c.id)).toEqual([
		"cargo-b",
	]);
	expect(subject.targetId).toBeNull();
	expect(subject.selectableCache).toBeNull();
});

test("the body-kind union carries cargo, which the selection order is typed against", () => {
	const declared = readFileSync(repoPath("src/sim.ts"), "utf8").match(
		/export type BodyKind =([^;]+);/,
	);
	// Only the union membership: `order[a.kind]` in `selectable` is indexed by
	// the whole `BodyKind`, so a kind with no place in that map is a build
	// error, and a row walking the source for each kind finds nothing tsc does
	// not already catch while breaking on a reformat (sage #353).
	expect(declared?.[1]).toContain('"cargo"');
});

test("the selected target reads the speed the scoop gate checks, not the rate along the line", () => {
	const world = makeWorld(42);
	const contact: DisplayContact = {
		id: "cargo-a",
		name: "FOOD",
		kind: "cargo",
		pos: v3(10, 0, 0),
		radiusKm: CANISTER_RADIUS_KM,
		color: 0,
		velocity: v3(1, 0, 0),
		standing: null,
		scannerClass: "unknown",
	};
	world.ship.pos = v3();
	world.ship.vel = v3(3, 0, 0);
	const subject = Object.assign(
		Object.create(
			methods(
				[
					"targetRelativeKms",
					"targetBody",
					"bodyFor",
					"velocityOf",
					"targetVelocity",
				],
				{ bodyVelocity, isDisplayContact, v3, length, sub },
			),
		),
		{ world, targetId: contact.id, selectable: () => [contact] },
	);
	// Overhauling it along the line: both quantities agree here, which is why
	// the wrong one survived a round.
	expect(subject.targetRelativeKms()).toBeCloseTo(2, 10);

	// **The case that tells them apart** (sage #353): flying across the line to
	// the canister. The rate along the line is zero whatever the crossing speed,
	// and a panel showing it read `0.00` in the last hundred metres — exactly
	// where the gate was refusing.
	contact.velocity = v3();
	world.ship.vel = v3(0, 2, 0);
	expect(subject.targetRelativeKms()).toBeCloseTo(2, 10);

	// And it is the gate's own quantity, not merely a magnitude: the readout
	// and `scoops` turn over at the same speed.
	const canister = {
		id: "cargo-a",
		commodity: "food",
		tonnes: 1,
		pos: v3(),
		vel: v3(),
		frameBodyId: null,
		restsAt: 0,
		expiresAt: 0,
	};
	world.ship.pos = v3();
	world.ship.vel = v3(0, CANISTER_SCOOP_SPEED_KMS + 0.01, 0);
	expect(subject.targetRelativeKms()).toBeCloseTo(
		CANISTER_SCOOP_SPEED_KMS + 0.01,
		10,
	);
	expect(scoops(canister, world.ship)).toBe(false);
	world.ship.vel = v3(0, CANISTER_SCOOP_SPEED_KMS - 0.01, 0);
	expect(subject.targetRelativeKms()).toBeCloseTo(
		CANISTER_SCOOP_SPEED_KMS - 0.01,
		10,
	);
	expect(scoops(canister, world.ship)).toBe(true);

	subject.targetId = null;
	expect(subject.targetRelativeKms()).toBeNull();
});

/** A subject that runs the real `clearFlightSession`, with the eject's
 *  control held or not (`ejectDown`). */
function teardownSubject(ejectHold: EjectHold, ejectDown: boolean) {
	return Object.assign(
		Object.create(
			methods(
				[
					"clearFlightSession",
					"dropPointer",
					"syncCargoContacts",
					"registerContact",
					"unregisterContact",
				],
				// `QUIET_GUN` is assigned by the teardown and asserted by nothing
				// here; this row is about what stays registered.
				// `beginScanHold` for the same reason: the teardown clears the scan
				// charge with it, and an extracted method runs on this list of
				// globals and nothing else.
				{
					CANISTER_RADIUS_KM,
					CARGO_CONTACT_COLOUR,
					NO_ATTITUDE,
					QUIET_GUN: null,
					QUIET_WEAPONS: null,
					SILENT_WEAPONS: null,
					beginScanHold: () => ({ key: null, chargeS: 0 }),
					// And the eject's hold (node #703), which the teardown idles: the
					// real law, so a row can hold what it keeps.
					idleEjectHold,
					// The teardown recentres the chase orbit (node #691).
					ORBIT_ASTERN,
				},
			),
		),
		{
			canisters: [
				{ id: "cargo-a", commodity: "food", pos: v3(1, 0, 0), vel: v3() },
			],
			cargoContacts: new Map(),
			contacts: [] as DisplayContact[],
			// The teardown disengages it (#596); a plain field once took the write.
			dockingComputer: new DockingComputer(),
			computerFollower: new AttitudeFollower(),
			flickMeter: { reset() {} },
			selectableCache: null,
			targetId: null as string | null,
			ejectHold,
			ejectDown: () => ejectDown,
		},
	);
}

test("a jump or a reset takes the cargo contacts with the canisters", () => {
	const subject = teardownSubject(EJECT_IDLE, false);
	subject.syncCargoContacts();
	subject.targetId = "cargo-a";
	subject.selectableCache = ["stale"];
	expect(subject.contacts).toHaveLength(1);

	// **Run the teardown, rather than reading its source order** (sage #353).
	// The claim is about what a jump or a reset leaves registered, and an
	// ordering assertion never executes it: `performJump` refreshes the scanner
	// before any step runs, and a reset while docked returns through
	// `stepDockPhase` before a step could sync.
	subject.clearFlightSession();
	expect(subject.canisters).toEqual([]);
	expect(subject.contacts).toEqual([]);
	expect(subject.cargoContacts.size).toBe(0);
	expect(subject.targetId).toBeNull();
	expect(subject.selectableCache).toBeNull();
});

test("a jump keeps a spent eject hold spent while its key is still down", () => {
	// Sage round 6: `performJump` lets go of no key, so a teardown that wrote
	// the idle hold back forgot a spent eject with the key still down, and the
	// arrival ejected again with no release made.
	const spent: EjectHold = { heldS: 0, spent: true };
	const held = teardownSubject(spent, true);
	held.clearFlightSession();
	expect(held.ejectHold).toEqual(spent);
	// A part-filled hold starts over: no fill is banked across the jump.
	const arming = teardownSubject({ heldS: 0.4, spent: false }, true);
	arming.clearFlightSession();
	expect(arming.ejectHold).toEqual(EJECT_IDLE);
	// And a release made before the jump is a release.
	const released = teardownSubject(spent, false);
	released.clearFlightSession();
	expect(released.ejectHold).toEqual(EJECT_IDLE);
});

test("the relative-speed label is a magnitude with no direction word", () => {
	expect(relativeLabel(0.44)).toBe(" · REL 0.44 km/s");
	expect(relativeLabel(0)).toBe(" · REL 0.00 km/s");
	// The separator is the label's, so nothing selected leaves no dangling
	// bullet — and the instrument asks for its own spacing.
	expect(relativeLabel(null)).toBe("");
	expect(relativeLabel(0.44, "  ")).toBe("  REL 0.44 km/s");
});

test("the cockpit target instrument carries REL, not only the hidden console copy", () => {
	const instruments = method("updateInstruments");
	// The blocker of sage #353: the figure reached `state.target`, which
	// live-cockpit writes into an `.lc-panel` that is `display: none` unless the
	// pilot turns their head to a console. This instrument is painted on every
	// frame in front of them.
	expect(instruments).toContain("relativeLabel(");
	expect(instruments).toContain("this.targetRelativeKms()");
	// And it is in the repaint key, or the canvas keeps the previous frame's
	// figure while the number moves.
	const secondary = instruments.indexOf("const targetSecondary");
	const key = instruments.indexOf("const key =");
	expect(secondary).toBeGreaterThanOrEqual(0);
	expect(key).toBeGreaterThan(secondary);
	expect(instruments.slice(key)).toContain("${targetSecondary}");
});

test("cruise snapshots a moving contact before combat integrates the frame", () => {
	const step = method("step");
	const snapshot = step.indexOf("let contactTargetAtFrameStart");
	const combat = step.indexOf("this.combatRig?.step");
	const cruise = step.indexOf("this.stepCruise(dt, contactTargetAtFrameStart)");
	expect(snapshot).toBeGreaterThanOrEqual(0);
	expect(combat).toBeGreaterThan(snapshot);
	expect(cruise).toBeGreaterThan(combat);
	expect(method("stepCruise")).toContain(
		"contactTargetAtFrameStart?.id === target.id",
	);
});

test("a scan that has not started does not announce a scan in progress", () => {
	// The wiring's own row, because the instrument cannot tell the two apart:
	// `SCANNING 0%` and `UNKNOWN` are both painted at the same slot in the same
	// font, and a canvas that says a scan is running when the nose is simply not
	// on the target teaches a pilot to distrust the cell.
	const readout = method("computeScanFacts");
	expect(readout).toContain("this.scanHold.chargeS > 0");
	// And a completed charge must not sit on the glass at 100 either: the cell
	// gives the standing back, which is what keeps the age moving.
	expect(readout).toContain("this.scanHold.chargeS < SCAN_CHARGE_S");
});

test("the charge is broken by leaving flight, not paused by it", () => {
	// §4's rule is the module's, and the module keeps it; what the module cannot
	// say is where the game stops feeding it frames. `stepScan` runs on the
	// normal-flight tail only, so every route off that tail has to break the hold
	// explicitly — otherwise a pilot who started a five-second count, went to
	// cruise or docked, and came back with the nose on the same ship would find
	// the charge banked across a gap in which no attention was paid at all.
	expect(method("engageCruise")).toContain("beginScanHold()");
	// The docked branch of `step` is the other way off the tail, and it is the
	// same failure the pointer delta in that branch was fixed for.
	const step = method("step");
	expect(step).toContain("this.scanHold = beginScanHold()");
});

test("one place names a carrier, and one place derives what the loop needs", () => {
	// The drawn name is a function of a seed and an instance ordinal; two call
	// sites spelling that out is one refactor away from the glass and the console
	// drawing different ships. And the per-actor presentation loop must not pay
	// for a manifest it never prints.
	expect(method("drawnName")).toContain("carrierName(");
	expect(method("updateInstruments")).toContain("this.drawnName(scan.actor)");
	expect(method("scanConsoleRow")).toContain("this.drawnName(actor)");
	expect(method("updateTrafficPresentation")).toContain(
		"this.recordedStanding(actor)",
	);
	expect(method("recordedStanding")).not.toContain("carrierReading(");
	// The glass and the console share one frame's derivation, because the
	// manifest is an RNG draw and they ask for the same one every frame.
	expect(method("scanConsoleRow")).toContain("scan: ScanFacts");
	expect(method("scanReadout")).toContain("this.scanFacts");
});

test("the scan cone is measured on the sightline the pilot aims with", () => {
	// `nose()` is the ship's rotation and `weaponAim()` the camera's; the repo
	// says so beside `forwardOf`, and the guns already fire along the camera's.
	// The scan shipped measuring the cone from the hull, and the only way to find
	// it was to sit in the cockpit and aim at something.
	const step = method("stepScan");
	expect(step).toContain("this.weaponAim()");
	expect(step).not.toContain("scanConeHeld(\n\t\t\t\tthis.nose()");
	expect(step).not.toContain("this.nose(),\n\t\t\t\tnormalizeOr");
	// And the cue reads the same two predicates the hold does, through the module,
	// so the two cannot drift apart.
	expect(method("scanStandoffNow")).toContain("scanStandoff(");
	expect(method("scanStandoffNow")).toContain("this.weaponAim()");
});

// ---------------------------------------------------------------------------
// #395. A struck civilian is off its schedule, and nothing anywhere said so. The
// sim was right — H3 has it fleeing from the first frame the beam lands, and H3d
// diverts it the frame the hull gives way — and the glass was silent. Two rows
// own that: the word the mark carries, and the one predicate that decides whether
// it carries it at all.
// ---------------------------------------------------------------------------
test("a carrier flying its route on time carries no state word at all", () => {
	// Absence is the reading. A traffic contact that has been left alone shows
	// nothing beside its name, so the word cannot be a decoration that is always
	// there and means nothing.
	expect(trafficDivertCue("flying", 40)).toBe(null);
	expect(trafficDivertCue("absent", 40)).toBe(null);
});

test("a carrier off its schedule carries the word and how far its station is", () => {
	const cue = trafficDivertCue("parked-home", 40.25);
	expect(cue).toContain(DIVERT_LABEL);
	expect(cue).toContain(range(40.25));
});

test("with no station to point at it says the fact and no figure", () => {
	// A missing station position is a `null`, not a 0.
	expect(trafficDivertCue("parked-home", null)).toBe(DIVERT_LABEL);
});

test("a station beside the pilot prints zero, because zero is the reading", () => {
	// This row exists because the round before it got this backwards. §5.4 said the
	// cue must never print `HOME 0.0 km`, a guard was written to match, and the
	// reasoning sounded careful: a zero says the station is right here while the word
	// says the ship is gone. It is only true if the pilot is nowhere near the
	// station — and the ordinary divert happens *at* a station, where the body is
	// tens of metres off and `range` renders that as `0.0 km`. For that pilot it is
	// not a contradiction, it is the answer.
	//
	// Suppressing it costs more than a figure: `DIVERTING` alone already means *there
	// is no station to point at*, so a suppressed zero would wear the same face as a
	// missing station, and the glass has no other way to separate `here` from
	// `unlocatable`. One string, one meaning.
	expect(trafficDivertCue("parked-home", 0.04)).toContain("HOME 0.0 km");
	expect(trafficDivertCue("parked-home", 0)).toContain("HOME 0.0 km");
	// And `null` — the actual unknown — is still the word alone.
	expect(trafficDivertCue("parked-home", null)).toBe(DIVERT_LABEL);
});

/**
 * The gate, run from `Game`'s own method text rather than a copy of it.
 *
 * `from` is the origin the label's ranges are measured from, which the method now
 * takes as an argument instead of reading `world.ship.pos`: on the glass it is
 * `camPos`, so that a mark's name-range and its `HOME` figure answer to one point
 * and cannot round apart in chase view. A test that hands it a position is therefore
 * testing the rule the browser cannot — the probe has no honest way to name the
 * camera in world kilometres, so the exact arithmetic lives here.
 */
function divertCueOf(over: Record<string, unknown> = {}, from = v3()) {
	const key = "7:trade:3";
	const subject = Object.assign(
		Object.create(
			methods(["selectedDivertCue", "homeStationKm"], {
				trafficDivertCue,
				systemIndexOfKey,
				trafficPresence,
				length,
				sub,
			}),
		),
		{
			targetId: key,
			trafficSelected: () => true,
			trafficEngagements: new Map([[key, {}]]),
			carrierCondition: () => ({
				condition: "repairing",
				recovery: { kind: "repair" },
			}),
			trafficActorByKey: () => ({ key, homeStationId: "S1" }),
			world: {
				system: {
					record: { index: 7 },
					bodies: [{ kind: "station", id: "S1", pos: v3(0, 40, 0) }],
				},
				ship: { pos: v3() },
			},
			...over,
		},
	);
	return (subject as any).selectedDivertCue(from);
}

test("the word reads the row's presence, and an operational row carries no word", () => {
	// **What this row can hold and what it cannot.** It holds the glass's rule: the
	// word follows `trafficPresence` and nothing else. That the presence turns on
	// the same tick the hull gives way is H3c, and it is `stepEngagement`'s — held
	// in `tests/traffic-engagement.test.ts` on a rig that runs the strike, and in
	// the browser by `probe-traffic-engagement.mjs`, which reads the mark on the
	// frame before the divert and on the frame of it. A stub that flips a
	// `condition` here would not notice those two ticks coming apart, so this row
	// does not pretend to watch them.
	expect(divertCueOf()).toContain(DIVERT_LABEL);
	expect(
		divertCueOf({ carrierCondition: () => ({ condition: "operational" }) }),
	).toBe(null);
});

test("a carrier already standing in its berth is not running", () => {
	// No engagement means it is not being flown. Drawn in the berth, it is found,
	// not fleeing — and `HOME 0.0 km` beside it would be a lie about a distance
	// nobody is travelling. That half is #365's surface, not this line's.
	expect(divertCueOf({ trafficEngagements: new Map() })).toBe(null);
});

test("the word is the carrier's state, not this engagement's event", () => {
	// A pilot who lost a struck carrier over the horizon, reacquired it, and fired
	// again meets it on its way home with its shields whole. The word has to be
	// there for them, because the ship is off its schedule — which is a fact about
	// the carrier, not a report on what the last trigger did. So the gate reads
	// presence and the engagement and **nothing about a hull at all**: the same
	// word, whether the row's hull is spent or untouched.
	const offSchedule = (hull: number, hullMax: number) =>
		divertCueOf({
			carrierCondition: () => ({
				condition: "repairing",
				recovery: { kind: "repair" },
				hull,
				hullMax,
			}),
		});
	expect(offSchedule(1, 215)).toContain(DIVERT_LABEL);
	expect(offSchedule(215, 215)).toContain(DIVERT_LABEL);
});

test("nothing on the glass but an ordinary carrier gets the word", () => {
	expect(
		divertCueOf({
			trafficSelected: () => false,
			trafficEngagements: new Map([["raider", {}]]),
		}),
	).toBe(null);
});

test("the home-station distance is measured from where the label is drawn, not from the hull", () => {
	// The station sits at 40 on one axis; the pilot's eye is a hundred metres up it.
	// Read from the ship this says `40.0 km`; read from the label's own origin it
	// says `39.9`. Only the second agrees with the range printed beside it, which is
	// the whole reason `homeStationKm` takes the origin instead of reaching for the
	// ship: two figures on one label, answering two questions, is a reading a pilot
	// cannot tell apart.
	const cue = divertCueOf({}, v3(0, 0.1, 0));
	expect(cue).toContain("HOME 39.9 km");
	expect(cue).not.toContain("HOME 40.0 km");
	// A station that is not in the system cannot be pointed at.
	expect(
		divertCueOf({
			world: {
				system: { record: { index: 7 }, bodies: [] },
				ship: { pos: v3() },
			},
		}),
	).toBe(DIVERT_LABEL);
});

test("a foreign hauler does not point at a same-id station in this system", () => {
	expect(
		divertCueOf({
			world: {
				system: {
					record: { index: 8 },
					bodies: [{ kind: "station", id: "S1", pos: v3(0, 40, 0) }],
				},
				ship: { pos: v3() },
			},
		}),
	).toBe(DIVERT_LABEL);
});

function ejectReleaseSubject(hold: EjectHold, down = ["backspace"]) {
	const keys = new Set(down);
	const pad = { held: false }; // glossary-ignore: pad
	const subject = Object.assign(
		Object.create(methods(["releasePhysicalKey"], { keyDispatch, EJECT_IDLE })),
		{
			keysPhysicallyDown: keys,
			ejectHold: hold,
			// The release handler asks the aggregate physical control. These are
			// two keyboard sources and the controller; this is not a binding test.
			ejectDown: () => keys.has("backspace") || keys.has("x") || pad.held, // glossary-ignore: pad
		},
	);
	const release = (key: string) =>
		subject.releasePhysicalKey({
			key,
			code: key,
			repeat: false,
			altKey: false,
			ctrlKey: false,
			metaKey: false,
		});
	return { subject, keys, pad, release }; // glossary-ignore: pad
}

test("eject release and repress between frames cancels accumulated confirmation", () => {
	const { subject, keys, release } = ejectReleaseSubject({
		heldS: 0.74,
		spent: false,
	});
	release("Backspace");
	keys.add("backspace"); // No simulation frame between the two input events.
	const next = stepEjectHold(subject.ejectHold, true, 0.02, null);
	expect(next.event).toBe(null);
	expect(next.hold.heldS).toBeCloseTo(0.02);
});

test("eject release and repress between frames arms a fresh spent press", () => {
	const { subject, keys, release } = ejectReleaseSubject({
		heldS: 0.75,
		spent: true,
	});
	release("Backspace");
	keys.add("backspace");
	expect(stepEjectHold(subject.ejectHold, true, 0.75, null).event).toEqual({
		kind: "eject",
	});
});

test("releasing one of two eject keys preserves the hold until the final release", () => {
	const hold = { heldS: 0.4, spent: false };
	const { subject, release } = ejectReleaseSubject(hold, ["backspace", "x"]);
	release("Backspace");
	expect(subject.ejectHold).toBe(hold);
	release("x");
	expect(subject.ejectHold).toEqual(EJECT_IDLE);
});

test("an unrelated key release does not reset a held eject confirmation", () => {
	const hold = { heldS: 0.4, spent: false };
	const { subject, release } = ejectReleaseSubject(hold);
	release("z");
	expect(subject.ejectHold).toBe(hold);
});

test("keyboard release preserves a spent eject while its controller is still down", () => {
	const hold = { heldS: 0.75, spent: true };
	const { subject, pad, release } = ejectReleaseSubject(hold); // glossary-ignore: pad
	pad.held = true; // glossary-ignore: pad
	release("Backspace");
	expect(subject.ejectHold).toBe(hold);
});
