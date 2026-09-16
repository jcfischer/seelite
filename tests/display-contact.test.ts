import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { projectNavTargets } from "../src/cockpit";
import { bodyAccelerationBound, bodyVelocity, makeWorld } from "../src/sim";
import { type DisplayContact, isDisplayContact } from "../src/display-contact";
import { CANISTER_RADIUS_KM } from "../src/raider-wreck";
import { dot, length, scale, sub, v3 } from "../src/vec3";
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
				CARGO_CONTACT_COLOUR: 0x96f0aa,
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

test("every body kind has a place in the selection order, cargo included", () => {
	const declared = readFileSync(repoPath("src/sim.ts"), "utf8").match(
		/export type BodyKind =([^;]+);/,
	);
	const kinds = (declared?.[1].match(/"[a-z]+"/g) ?? []).map((quoted) =>
		quoted.slice(1, -1),
	);
	expect(kinds).toContain("cargo");
	// `order[a.kind]` is typed, so a missing key is a build error rather than a
	// comparator returning NaN — this row says which kinds that covers.
	const selectable = method("selectable");
	for (const kind of kinds) expect(selectable).toContain(`${kind}: `);
});

test("the selected target carries a closing speed, positive while the range shrinks", () => {
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
					"targetClosingKms",
					"targetBody",
					"bodyFor",
					"velocityOf",
					"targetVelocity",
				],
				{ bodyVelocity, isDisplayContact, v3, dot, length, scale, sub },
			),
		),
		{ world, targetId: contact.id, selectable: () => [contact] },
	);
	// Overhauling it by 2 km/s closes; drifting slower than it opens.
	expect(subject.targetClosingKms()).toBeCloseTo(2, 10);
	world.ship.vel = v3(-1, 0, 0);
	expect(subject.targetClosingKms()).toBeCloseTo(-2, 10);
	subject.targetId = null;
	expect(subject.targetClosingKms()).toBeNull();
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
