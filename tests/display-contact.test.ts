import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { projectNavTargets } from "../src/cockpit";
import { bodyAccelerationBound, bodyVelocity, makeWorld } from "../src/sim";
import {
	type DisplayContact,
	isDisplayContact,
	relativeLabel,
} from "../src/display-contact";
import {
	CANISTER_RADIUS_KM,
	CANISTER_SCOOP_SPEED_KMS,
	CARGO_CONTACT_COLOUR,
	scoops,
} from "../src/raider-wreck";
import { length, sub, v3 } from "../src/vec3";
import { repoPath } from "./lib/source-scan";

// Execute the actual Game methods without constructing WebGL or copying their
// implementation into a fixture. TypeScript's parser keeps nested braces safe.
const source = ts.createSourceFile(
	"main.ts",
	readFileSync(repoPath("src/main.ts"), "utf8"),
	ts.ScriptTarget.Latest,
	true,
);
const game = source.statements.find(
	(node): node is ts.ClassDeclaration =>
		ts.isClassDeclaration(node) && node.name?.text === "Game",
);
function method(name: string) {
	const member = game?.members.find(
		(node) =>
			ts.isMethodDeclaration(node) && node.name.getText(source) === name,
	);
	if (!member) throw new Error(`Missing Game.${name}`);
	return member.getText(source);
}
function methods(names: string[], bindings: Record<string, unknown> = {}) {
	const js = ts.transpileModule(
		`class Subject { ${names.map(method).join("\n")} }`,
		{ compilerOptions: { target: ts.ScriptTarget.ES2022 } },
	).outputText;
	return new Function(
		...Object.keys(bindings),
		`${js}; return Subject.prototype;`,
	)(...Object.values(bindings));
}

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
		legalStatus: null,
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
		legalStatus: null,
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
		legalStatus: null,
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
		legalStatus: null,
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
		restVel: v3(),
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

test("a jump or a reset takes the cargo contacts with the canisters", () => {
	const clear = method("clearFlightSession");
	const dropped = clear.indexOf("this.canisters = [];");
	const synced = clear.indexOf("this.syncCargoContacts();");
	expect(dropped).toBeGreaterThanOrEqual(0);
	// After the list is emptied, so the sync sees no canisters and unregisters
	// every contact — and here rather than on the next step, because
	// `performJump` refreshes the scanner before any step runs, and a reset
	// while docked returns through `stepDockPhase` before the sync would run
	// (sage #353).
	expect(synced).toBeGreaterThan(dropped);
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
