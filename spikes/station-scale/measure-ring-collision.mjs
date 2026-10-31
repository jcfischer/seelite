import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpus, loadavg } from "node:os";
import { readFile, realpath, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { median, seededShuffler, separation } from "../../scripts/lib/measurement.mjs";

const roots = [await realpath(process.argv[2]), await realpath(process.cwd())];
const output = process.argv[3] ?? "spikes/station-scale/evidence-ring/collision.json";
const load = (root, name) => import(pathToFileURL(resolve(root, `src/${name}.ts`)).href);
const report = { startedAt: new Date().toISOString(), load: loadavg(), cpu: cpus()[0]?.model, cores: cpus().length, blocks: 12, iterations: 100, orderSeed: 1145, dt: 0.1, arms: [], results: [] };
const axes = { x: { x: 1, y: 0, z: 0 }, y: { x: 0, y: 1, z: 0 }, z: { x: 0, y: 0, z: 1 } };
const pose = (xyz) => ({ origin: { x: xyz[0], y: xyz[1], z: xyz[2] }, ...axes });
const zero = { x: 0, y: 0, z: 0 };
const cases = [
	{ name: "approach-clear", from: [0, 0, 0.95], to: [0, 0, 0.75] },
	{ name: "outer-rim-strike", from: [0.82, 0, 0.255], to: [0.62, 0, 0.255] },
	{ name: "front-rim-strike", from: [0.57, 0, 0.60], to: [0.57, 0, 0.40] },
	{ name: "rim-flyby", from: [0.73, 0.1, 0.40], to: [0.73, -0.1, 0.40] },
];
const arms = [];
for (const [index, root] of roots.entries()) {
	const collision = await load(root, "collision");
	const proxyModule = await load(root, "station-proxy");
	const { HULL_SPECS } = await load(root, "hull");
	const proxy = proxyModule.stationProxy("trade", "b", 7, 7);
	const primitives = proxyModule.proxySolids(proxy).spinning;
	const angle = 2 * Math.PI * 2 / 60 * report.dt;
	const solid = { primitives, start: pose([0, 0, 0]), end: { origin: zero, x: { x: Math.cos(angle), y: Math.sin(angle), z: 0 }, y: { x: -Math.sin(angle), y: Math.cos(angle), z: 0 }, z: axes.z }, velStart: zero, velEnd: zero };
	const ship = collision.shipPrimitives(HULL_SPECS.courier, false);
	const run = (fixture) => {
		const velocity = { x: (fixture.to[0] - fixture.from[0]) / report.dt, y: (fixture.to[1] - fixture.from[1]) / report.dt, z: (fixture.to[2] - fixture.from[2]) / report.dt };
		return collision.sweepShip({ primitives: ship, start: pose(fixture.from), end: pose(fixture.to), velStart: velocity, velEnd: velocity }, [solid], report.dt);
	};
	const bytes = await readFile(resolve(root, "src/models/trade-ring.glb"));
	report.arms.push({ name: index ? "branch" : "main", root, ref: execFileSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8" }).trim(), hullBoxes: proxyModule.tradeProxyBoxes("b").length, proxyPrimitives: primitives.length, assetSha256: createHash("sha256").update(bytes).digest("hex") });
	arms.push(run);
}
const shuffle = seededShuffler(report.orderSeed);
for (const fixture of cases) {
	const times = [[], []];
	const facts = [];
	const order = [];
	for (const run of arms) {
		let result;
		for (let i = 0; i < 20; i++) result = run(fixture);
		facts.push({ impacts: result.impacts.length, ghosts: result.ghosts.length, end: result.pos });
		if (!Object.values(result.pos).every(Number.isFinite)) throw Error("non-finite collision result");
		if (fixture.name === "outer-rim-strike" && result.impacts.length === 0) throw Error("strike fixture missed the hull");
		if (fixture.name === "approach-clear" && result.impacts.length !== 0) throw Error("clear approach hit the hull");
	}
	for (let block = 0; block < report.blocks; block++)
		for (const index of shuffle([0, 1])) {
			order.push(index);
			let impacts = 0;
			const started = performance.now();
			for (let i = 0; i < report.iterations; i++) impacts += arms[index](fixture).impacts.length;
			const ms = (performance.now() - started) / report.iterations;
			if (!Number.isFinite(ms) || ms <= 0 || impacts !== facts[index].impacts * report.iterations) throw Error("invalid collision block");
			times[index].push(ms);
		}
	report.results.push({ ...fixture, facts, order, times, medians: times.map(median), ranges: times.map((xs) => [Math.min(...xs), Math.max(...xs)]), branchSlowerPairs: separation(times[1], times[0]) });
	console.log(fixture.name, times.map(median));
}
report.finalLoad = loadavg();
report.finishedAt = new Date().toISOString();
await writeFile(output, JSON.stringify(report, null, 2) + "\n");
