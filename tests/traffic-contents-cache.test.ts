import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { compareCarrierKeys, systemIndexOfKey } from "../src/carrier-key";
import {
	buildHaulerPlans,
	haulerAvailability,
	inboundCandidates,
} from "../src/inter-system-traffic";
import { makeWorld } from "../src/sim";
import { generateContents, type SystemContents } from "../src/system";
import { newWorld } from "../src/world-state";
import { type TrafficActor } from "../src/station-traffic";

test("Game reuses cold foreign contents in warm voyage queries and clears them on system entry", () => {
	// Run the actual methods without Game's WebGL/DOM construction. Only the
	// generation and route seams are instrumented; the cache logic is production.
	const source = ts.createSourceFile(
		"main.ts",
		readFileSync(new URL("../src/main.ts", import.meta.url), "utf8"),
		ts.ScriptTarget.Latest,
		true,
	);
	const game = source.statements.find(
		(node): node is ts.ClassDeclaration =>
			ts.isClassDeclaration(node) && node.name?.text === "Game",
	)!;
	const names = ["ensureTrafficActors", "trafficVoyages", "trafficContentsFor"];
	const members = names.map((name) => {
		const member = game.members.find(
			(node) =>
				ts.isMethodDeclaration(node) && node.name.getText(source) === name,
		);
		if (!member) throw new Error(`Missing Game.${name}`);
		return member.getText(source);
	});
	const world = makeWorld(47);
	const foreign = world.galaxy.systems.find(
		(r) => r.index !== world.system.record.index,
	)!;
	let generations = 0;
	const bindings = {
		generateContents: (record: Parameters<typeof generateContents>[0]) => {
			generations++;
			return generateContents(record);
		},
		buildHaulerPlans,
		inboundCandidates,
		haulerAvailability,
		compareCarrierKeys,
		systemIndexOfKey,
		routeVoyages: (
			_g: unknown,
			_p: unknown,
			_i: number,
			_t: number,
			get: (i: number) => SystemContents,
		) => get(foreign.index),
	};
	const js = ts.transpileModule(`class Subject { ${members.join("\n")} }`, {
		compilerOptions: { target: ts.ScriptTarget.ES2022 },
	}).outputText;
	const prototype = new Function(
		...Object.keys(bindings),
		`${js}; return Subject.prototype;`,
	)(...Object.values(bindings));
	const subject = Object.assign(Object.create(prototype), {
		world,
		commerceWorld: newWorld(47),
		trafficSystemIndex: -1,
		trafficContentsCache: new Map(),
		trafficHaulers: new Map(),
		trafficPreviousRoutes: new Map(),
		trafficColdActors: new Set(),
		clearTrafficPresentation() {},
		refreshColdTraffic() {},
	});
	subject.ensureTrafficActors();
	expect(subject.trafficActors.length).toBeGreaterThan(0);
	expect(
		subject.trafficActors.every(
			(a: TrafficActor) =>
				systemIndexOfKey(a.key) === world.system.record.index,
		),
	).toBe(true);
	expect(subject.trafficInbound.length).toBeGreaterThan(0);
	expect(
		subject.trafficInbound.every(
			(a: TrafficActor) =>
				systemIndexOfKey(a.key) !== world.system.record.index,
		),
	).toBe(true);
	const actor: TrafficActor = [...subject.trafficHaulers.values()][0].actor;
	const first = subject.trafficVoyages(actor, 1000);
	const coldGenerations = generations;
	for (let tick = 1; tick <= 40; tick++) {
		expect(subject.trafficVoyages(actor, 1000 + tick / 10)).toBe(first);
		subject.ensureTrafficActors();
	}
	expect(generations).toBe(coldGenerations);
	expect(subject.trafficContentsFor(world.system.record.index)).toBe(
		world.system.contents,
	);
	// Enter another system without constructing a second Game; none of the
	// previous entry's generated references may survive in its contents cache.
	const previous = new Map(subject.trafficContentsCache);
	world.system = {
		...world.system,
		record: foreign,
		contents: generateContents(foreign),
	};
	subject.ensureTrafficActors();
	expect(subject.trafficContentsFor(foreign.index)).toBe(world.system.contents);
	for (const [index, contents] of subject.trafficContentsCache)
		expect(contents).not.toBe(previous.get(index));
});
