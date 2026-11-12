/** https://github.com/jcfischer/seelite/issues/1235 — fly before attributing pinned AO cost to a pilot. */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { cpus, loadavg } from "node:os";
import { resolve } from "node:path";
import { createServer } from "vite";
import { seededShuffler } from "./lib/measurement.mjs";
import { summarizeStationRockCost } from "./lib/station-rock-cost.mjs";
import { gameUrl } from "./lib/game-url.mjs";
import { assertPlayersRenderer } from "./lib/players-renderer.mjs";
import { holdProbeLockOrExit } from "./lib/probe-lock.mjs";
import { bootedGame, guardedOrigin, launchChromium } from "./probe-guard.mjs";

const output = resolve(
	process.env.OUTPUT ?? "/tmp/seelite-station-rock-ao-1235",
);
const port = Number(process.env.PORT ?? 5203);
const world = Number(process.env.WORLD ?? 0x5ee11e);
const fixtures = JSON.parse(
	process.env.FIXTURES ?? '[{"system":173,"kind":"charted"}]',
);
const qualities = (process.env.QUALITIES ?? "high,low").split(",");
const aa = Number(process.env.ANTIALIAS ?? 2);
const dt = Number(process.env.DT ?? 0.1);
const route = process.env.ROUTE ?? "free-cruise";
const blocks = Number(process.env.BLOCKS ?? 6);
const repeats = Number(process.env.REPEATS ?? 6);
const burstFrames = Number(process.env.BURST_FRAMES ?? 16);
const orderSeed = Number(process.env.ORDER_SEED ?? 1235);
const maxLoad = Number(process.env.MAX_LOAD ?? 5);
for (const [name, value] of Object.entries({ blocks, repeats, burstFrames })) {
	if (!Number.isSafeInteger(value) || value < 1)
		throw new Error(`invalid ${name}`);
}
if (!["normal", "free-cruise"].includes(route))
	throw new Error("invalid route");
if (!qualities.length || qualities.some((q) => !["high", "low"].includes(q)))
	throw new Error("invalid quality");
if (!Number.isFinite(maxLoad) || maxLoad <= 0)
	throw new Error("invalid quiet-host limit");
if (!Array.isArray(fixtures) || fixtures.length === 0)
	throw new Error("no flight fixtures");
if (!Number.isFinite(aa) || ![0, 2, 4].includes(aa))
	throw new Error("invalid antialias setting");
const provenance = {
	head: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
	sourceSha256: createHash("sha256")
		.update(await readFile(new URL(import.meta.url)))
		.digest("hex"),
	startedAt: new Date().toISOString(),
};
const release = await holdProbeLockOrExit("station rock AO flight");
const host = { cores: cpus().length, before: loadavg(), samples: [] };
if (host.before[0] > maxLoad) {
	release();
	throw new Error(`host is not quiet: load ${host.before[0]} > ${maxLoad}`);
}
await mkdir(output, { recursive: true });
const server = await createServer({
	server: {
		host: "127.0.0.1",
		port,
		strictPort: true,
		hmr: false,
		watch: null,
	},
	cacheDir: "node_modules/.vite-station-rock-ao",
});
let browser;
const errors = [];
const results = [];
try {
	await server.listen();
	const origin = `http://127.0.0.1:${port}`;
	await guardedOrigin(origin);
	browser = await launchChromium({ headless: false });
	for (const fixture of fixtures) {
		for (const quality of qualities) {
			const page = await browser.newPage({
				viewport: { width: 1440, height: 900 },
				deviceScaleFactor: 2,
			});
			page.on("pageerror", (error) => errors.push(error.message));
			await page.goto(
				gameUrl(origin, {
					seed: fixture.world ?? world,
					system: fixture.system,
					"no-save": true,
					mining: true,
					raider: "off",
				}),
			);
			await bootedGame(page, 180000);
			const renderer = await assertPlayersRenderer(page, "measure flown AO");
			const flight = await page.evaluate(fly, {
				...fixture,
				quality,
				aa,
				dt,
				route,
				burstFrames,
			});
			if (flight.qualifyingFrames) {
				const times = { field: [], none: [] };
				const shuffle = seededShuffler(orderSeed);
				for (const arm of ["field", "none"])
					await page.evaluate(
						([a, n]) => window.__timeFlight(a, n),
						[arm, repeats],
					);
				for (let b = 0; b < blocks; b++) {
					host.samples.push(loadavg());
					if (host.samples.at(-1)[0] > maxLoad)
						throw new Error("quiet-host condition lost during blocks");
					for (const arm of shuffle(["field", "none"]))
						times[arm].push(
							await page.evaluate(
								([a, n]) => window.__timeFlight(a, n),
								[arm, repeats],
							),
						);
				}
				Object.assign(flight, summarizeStationRockCost(quality, times));
				flight.timing = {
					blocks,
					repeats,
					orderSeed,
					burstFrames,
					times,
					method:
						"short clock-held render burst after each full flight replay; CPU submission plus GPU completion, readPixels-drained; not a timer query",
				};
				await page.evaluate(() => window.__timeFlight("field", 1));
				flight.replays = await page.evaluate(() => window.__flightReplays);
			}
			const name = `${fixture.world ?? world}-${fixture.system}-${fixture.kind}-${quality}-aa${aa}-dt${dt}`;
			await page.evaluate(() => window.__seelite.updateCockpit());
			await page.screenshot({ path: `${output}/${name}.png` });
			await writeFile(
				`${output}/${name}.json`,
				JSON.stringify(flight, null, 2),
			);
			const { samples, ...summary } = flight;
			results.push({ fixture, quality, renderer, ...summary });
			console.log(JSON.stringify(results.at(-1)));
			await page.close();
		}
	}
} finally {
	await browser?.close();
	await server.close();
	host.after = loadavg();
	await writeFile(
		`${output}/summary.json`,
		JSON.stringify(
			{ provenance, host, aa, dt, route, errors, results },
			null,
			2,
		),
	);
	release();
}
if (errors.length) throw new Error(`page errors: ${errors.join("; ")}`);
if (host.after[0] > maxLoad)
	throw new Error(
		`quiet-host condition lost: load ${host.after[0]} > ${maxLoad}`,
	);
console.log(`flight evidence: ${output}/summary.json`);

async function fly({ kind, quality, aa, dt, route, burstFrames }) {
	const A = await import("/src/asteroid-field.ts");
	const T = await import("/src/rock-target.ts");
	const O = await import("/src/occlusion.ts");
	const C = await import("/src/cruise.ts");
	const M = await import("/src/occlusion-mesh.ts");
	const g = window.__seelite;
	if (!(dt > 0 && dt <= g.units.MAX_DT)) throw new Error("invalid flight dt");
	g.clockHeld = true;
	g.keys.clear();
	g.settings.set("quality", quality);
	g.settings.set("ao", "on");
	g.settings.set("antialias", aa);
	g.setOcclusion();
	if (kind !== "charted")
		throw new Error("this instrument requires a charted refinery departure");
	g.view = "cockpit";
	g.setHeadLook("forward");
	g.render(0);
	const draw = g.fields.find((d) => d.plan.profile === kind);
	if (draw?.shapes !== "authored") throw new Error("authored field missing");
	const rock = draw.rocks.reduce((a, b) => (a.radiusKm > b.radiusKm ? a : b));
	const rockId = T.rockTargetId(draw.plan, rock.slot);
	const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
	const current = () =>
		T.resolveRock([draw], rockId, g.world.ship.pos, g.world.gameTime);
	const startedAt = g.world.gameTime;
	const impactsBefore = g.collisionImpacts;
	const samples = [];
	let frame = 0;
	let qualifyingFrames = 0;
	let fillingFrames = 0;
	let lastOpen = null;
	let firstClosed = null;
	const record = () => {
		const ref = current();
		const cam = g.cameraPos();
		const d = distance(cam, ref.pos);
		const rad = Math.asin(Math.min(1, rock.radiusKm / d));
		const filling = rad * 2 >= (g.nearCamera.fov * Math.PI) / 180;
		const gate = g.occlusionState;
		if (gate.pinned) throw new Error("occlusion was pinned");
		const sample = {
			frame: frame++,
			at: g.world.gameTime,
			pos: { ...g.world.ship.pos },
			camera: { ...cam },
			regime: g.regime,
			velocity: { ...g.world.ship.vel },
			speedKms: g.cruiseSpeedKms,
			aoEnabled: g.gtaoPass.enabled,
			rockDistanceKm: d,
			surfaceKm: d - rock.radiusKm,
			filling,
			gate,
			aoPending: g.occlusionGate.ao.pending,
		};
		samples.push(sample);
		if (gate.aoOpen) lastOpen = sample;
		else if (lastOpen && !firstClosed) firstClosed = sample;
		if (filling) fillingFrames++;
		if (filling && gate.aoOpen && g.gtaoPass.enabled) qualifyingFrames++;
		return sample;
	};
	let departure = null;
	if (kind === "charted") {
		const station = g.world.system.byId.get(draw.plan.hostId);
		const mesh = g.stationVisuals.get(station.id).root;
		const subject = M.subjectOf(mesh);
		const ref = current();
		const d = distance(station.pos, ref.pos);
		const radiusKm = (subject.radiusKm / mesh.scale.x) * station.radiusKm;
		const offset = radiusKm * 1.9;
		g.world.ship.pos = {
			x: station.pos.x + ((ref.pos.x - station.pos.x) / d) * offset,
			y: station.pos.y + ((ref.pos.y - station.pos.y) / d) * offset,
			z: station.pos.z + ((ref.pos.z - station.pos.z) / d) * offset,
		};
		g.world.ship.vel = g.velocityOf(station.id);
		const V = g.nearScene.position.constructor;
		const aim = A.rockPose(draw.plan, rock, g.world.gameTime + dt).pos;
		g.orientation.setFromUnitVectors(
			new V(0, 0, -1),
			new V(
				aim.x - g.world.ship.pos.x,
				aim.y - g.world.ship.pos.y,
				aim.z - g.world.ship.pos.z,
			).normalize(),
		);
		g.updateLocalFrameBody();
		for (let i = 0; i < O.OCCLUSION.gate.openFrames + 1; i++) g.render(0);
		departure = record();
		if (!departure.gate.aoOpen)
			throw new Error("station departure did not open AO");
	}
	const initial = {
		world: structuredClone(g.world),
		commerceWorld: g.commerceWorld,
		condition: structuredClone(g.condition),
		orientation: g.orientation.clone(),
		chargeAu: g.chargeAu,
	};
	const tape = [];
	if (kind === "charted" && route === "free-cruise") {
		g.targetId = draw.plan.id;
		g.engageCruise();
	}
	const approachStart = record();
	const V = g.nearScene.position.constructor;
	let settled = 0;
	let largestTurnRad = 0;
	for (let t = 0; t < 600; t += dt) {
		const ref = current();
		const cam = g.cameraPos();
		const aim =
			route === "free-cruise"
				? A.rockPose(draw.plan, rock, g.world.gameTime + dt).pos
				: ref.pos;
		const d = distance(cam, aim);
		const orientation = g.orientation
			.clone()
			.setFromUnitVectors(
				new V(0, 0, -1),
				new V(aim.x - cam.x, aim.y - cam.y, aim.z - cam.z).normalize(),
			);
		if (t > 0) {
			const turn = g.orientation.angleTo(orientation);
			largestTurnRad = Math.max(largestTurnRad, turn);
			if (turn > Math.min(...Object.values(g.flownPerformance.angularMax)) * dt)
				throw new Error("reference pilot exceeded the hull turn rate");
		}
		g.orientation.copy(orientation);
		if (route === "free-cruise") {
			if (g.regime === "cruise") g.targetId = g.world.system.contents.star.id;
			const masses = g.masses();

			const end = (throttle) =>
				C.advanceCruise({
					pos: g.world.ship.pos,
					nose: g.nose(),
					throttle,
					dt,
					masses,
					target: null,
					params: g.cruiseParams,
					chargeAu: g.chargeAu,
				}).pos;
			let lo = 0;
			let hi = 1;
			if (distance(g.world.ship.pos, end(1)) > d - 1.2 * rock.radiusKm) {
				for (let i = 0; i < 32; i++) {
					const mid = (lo + hi) / 2;
					if (
						distance(g.world.ship.pos, end(mid)) <
						Math.max(0, d - 1.2 * rock.radiusKm)
					)
						lo = mid;
					else hi = mid;
				}
				g.setThrottle(lo);
			} else g.setThrottle(1);
			if (g.regime !== "cruise") g.setThrottle(0);
		} else
			g.setThrottle(Math.max(0, Math.min(1, (d - 1.2 * rock.radiusKm) / 10)));
		tape.push({ orientation: g.orientation.toArray(), throttle: g.throttle });
		g.step(dt);
		g.render(dt);
		const sample = record();
		if (g.collisionImpacts !== impactsBefore)
			throw new Error(
				`approach struck a solid: ${JSON.stringify({ impact: g.lastCollisionImpact, sample, departure })}`,
			);
		if (sample.filling && route === "free-cruise") break;
		if (sample.filling) settled++;
		else settled = 0;
		if (settled >= 60) break;
	}
	if (settled < 60 && !(route === "free-cruise" && fillingFrames > 0))
		throw new Error(
			`approach never held a frame-filling rock: ${JSON.stringify(samples.slice(-3))}`,
		);
	if (qualifyingFrames) {
		if (kind !== "charted" || route !== "free-cruise")
			throw new Error("replay requires charted departure");
		const savedFields = g.fields;
		window.__flightReplays = { field: 0, none: 0 };
		window.__timeFlight = (arm, count) => {
			const gl = g.renderer.getContext();
			const pixel = new Uint8Array(4);
			let ms = 0;
			for (let repeat = 0; repeat < count; repeat++) {
				const impacts = g.collisionImpacts;
				g.world = structuredClone(initial.world);
				g.selectableCache = null;
				g.massesAt = NaN;
				g.commerceWorld = initial.commerceWorld;
				g.condition = structuredClone(initial.condition);
				g.orientation.copy(initial.orientation);
				g.chargeAu = initial.chargeAu;
				g.regime = "normal";
				g.spoolLeftS = 0;
				g.proximityFrameBodyId = null;
				g.rates = { pitch: 0, yaw: 0, roll: 0 };
				g.occlusionGate = O.CLOSED_GATES;
				g.fieldDraws = arm === "field" ? savedFields : [];
				for (const field of savedFields) field.root.visible = arm === "field";
				g.render(0);
				for (let i = 0; i < O.OCCLUSION.gate.openFrames; i++) g.render(0);
				if (!g.occlusionState.aoOpen || g.occlusionState.pinned)
					throw new Error("replay departure gate invalid");
				g.targetId = draw.plan.id;
				g.engageCruise();
				for (let i = 0; i < tape.length; i++) {
					if (g.regime === "cruise")
						g.targetId = g.world.system.contents.star.id;
					g.orientation.fromArray(tape[i].orientation);
					g.setThrottle(tape[i].throttle);
					g.step(dt);
					if (i === tape.length - 1) {
						gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
						const start = performance.now();
						for (let burst = 0; burst < burstFrames; burst++) {
							g.render(0);
							if (!g.occlusionState.aoOpen || g.occlusionState.pinned)
								throw new Error("AO closed in timed burst");
						}
						gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
						ms += performance.now() - start;
					} else g.render(dt);
				}
				if (
					g.collisionImpacts !== impacts ||
					distance(g.cameraPos(), samples.at(-1).camera) > 0.001 ||
					!g.occlusionState.aoOpen ||
					g.occlusionState.pinned
				)
					throw new Error(
						`flight replay diverged: ${JSON.stringify({ impacts: g.collisionImpacts - impacts, camera: g.cameraPos(), expected: samples.at(-1), gate: g.occlusionState })}`,
					);
				window.__flightReplays[arm]++;
			}
			return ms / (count * burstFrames);
		};
	}
	return {
		startedAt,
		endedAt: g.world.gameTime,
		field: draw.plan.id,
		profile: kind,
		rockSlot: rock.slot,
		radiusKm: rock.radiusKm,
		rockCount: draw.rocks.length,
		fov: g.nearCamera.fov,
		departure,
		approachStart,
		lastOpen,
		firstClosed,
		final: samples.at(-1),
		qualifyingFrames,
		fillingFrames,
		frames: samples.length,
		largestTurnRad,
		addedFrameMs: null,
		verdict: qualifyingFrames
			? "reached: cost measurement required"
			: "not reached on this flight",
		samples,
	};
}
