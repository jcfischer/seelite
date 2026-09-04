import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { projectNavTargets } from "../src/cockpit";
import { bodyAccelerationBound, bodyVelocity, makeWorld } from "../src/sim";
import { type DisplayContact, isDisplayContact } from "../src/display-contact";
import { v3 } from "../src/vec3";
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
	expect([...readers].sort()).toEqual(["refreshScannerContacts", "selectable"]);
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
