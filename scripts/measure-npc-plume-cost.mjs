/**
 * What node #637's NPC plumes cost a frame with several hulls firing.
 *
 *   npm run dev                                   # in one shell
 *   node scripts/measure-npc-plume-cost.mjs       # in another
 *
 * The state is the probe's (`scripts/lib/npc-vent-state.mjs`): the duel's
 * raider flown by the real step, the clock held and the player off its stern
 * in the cockpit. `EXTRA` more raider hulls are then built beside it, each with
 * its own plume set, as engaged Traffic would add them. **The hulls are drawn
 * in both arms**, so the difference is the plumes and not the meshes:
 *
 * - `quiet` — every hull's table empty. The raider's set is drawn and lights
 *   nothing; the extra sets are hidden, as `NpcPlumes` builds none for a hull
 *   that has never fired.
 * - `firing` — every vent of every hull at full level, the worst a table can
 *   ask, and each set rewritten every frame on an advancing clock, so the
 *   arm pays the CPU write as well as the draw.
 *
 * Each arm is a block of `FRAMES` renders fenced by a 1x1 `readPixels` (the one
 * fence that fences on ANGLE Metal, `docs/pitfalls.md`), shuffled from a printed
 * seed and reported as medians with the Mann-Whitney pairing count
 * (`lib/measurement.mjs`). The renderer is asserted and printed: a frame cost
 * that does not name its lane is not a figure (map constraint, #435). So is
 * the machine's load, because a figure read beside another suite measures the
 * suite.
 */
import os from "node:os";
import { gameUrl } from "./lib/game-url.mjs";
import { median, seededShuffler, separation } from "./lib/measurement.mjs";
import { holdNpcVentState } from "./lib/npc-vent-state.mjs";
import { assertPlayersRenderer } from "./lib/players-renderer.mjs";
import { SEED, VIEWPORT } from "./lib/view-set.mjs";
import {
	bootedGame,
	guardedOrigin,
	launchChromium,
	tally,
} from "./probe-guard.mjs";

const ORIGIN = process.env.PROBE_ORIGIN ?? "http://localhost:5173";
const FRAMES = 60;
const BLOCKS = 12;
/** Hulls beside the raider: with it, `EXTRA + 1` firing. */
const EXTRA = Number(process.env.EXTRA ?? 5);
const SHUFFLE_SEED = Number(process.env.SHUFFLE_SEED ?? 637);

const origin = await guardedOrigin(ORIGIN);
const browser = await launchChromium({ headless: false });
const page = await browser.newPage({
	viewport: VIEWPORT,
	deviceScaleFactor: 2,
});
const { watch, exit } = tally();
watch(page);
await page.goto(gameUrl(origin, { seed: SEED, raider: "off" }));
await bootedGame(page);
const renderer = await assertPlayersRenderer(page, "measure");
const loadBefore = os.loadavg()[0];

await page.evaluate(() => {
	window.__seelite.view = "cockpit";
});
const state = await page.evaluate(holdNpcVentState, {
	steps: 20,
	behindKm: 0.2,
});
if (state.lit.length === 0)
	throw new Error("measure: the raider fired no vent through its own step");

const setup = await page.evaluate(async (extra) => {
	const g = window.__seelite;
	const { HULL_SPECS } = await import("/src/hull.ts");
	const { buildShipMesh } = await import("/src/ship-mesh.ts");
	const { NpcPlumes } = await import("/src/npc-plumes.ts");
	const hull = g.raiderContact.shipType;
	const all = Object.fromEntries(
		HULL_SPECS[hull].vents.map((v) => [v.slot, 1]),
	);
	const raider = g.raiderMesh;
	const scene = raider.parent;
	const plumes = new NpcPlumes();
	const roots = [];
	for (let i = 0; i < extra; i++) {
		const root = buildShipMesh(hull, HULL_SPECS[hull].variant).root;
		const angle = (2 * Math.PI * i) / extra;
		// A ring a quarter-hull-length to three hull-lengths round the raider,
		// in front of the camera, so every set is in frame.
		root.position.set(
			raider.position.x + 0.09 * Math.cos(angle),
			raider.position.y + 0.06 * Math.sin(angle),
			raider.position.z,
		);
		root.quaternion.copy(raider.quaternion);
		scene.add(root);
		plumes.draw(root, hull, all, 0);
		roots.push(root);
	}
	let t = 0;
	window.__plumeArm = (arm, frames) => {
		const gl = g.renderer.getContext();
		const firing = arm === "firing";
		g.encounterView.firing = firing ? all : {};
		for (const root of roots) {
			const set = plumes.of(root);
			set.object.visible = firing;
		}
		const frame = () => {
			t += 1 / 60;
			if (firing) for (const root of roots) plumes.of(root).update(all, t);
			g.render(0);
		};
		frame();
		const sync = new Uint8Array(4);
		const started = performance.now();
		for (let i = 0; i < frames; i++) frame();
		gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, sync);
		return (performance.now() - started) / frames;
	};
	// **The arms must differ on screen**, or a null difference is a frame that
	// drew no plume at all. Painted pixels between one frame of each arm.
	window.__plumePainted = () => {
		const src = g.renderer.domElement;
		const scratch = document.createElement("canvas");
		scratch.width = src.width;
		scratch.height = src.height;
		const ctx = scratch.getContext("2d", { willReadFrequently: true });
		const read = (arm) => {
			window.__plumeArm(arm, 0);
			ctx.drawImage(src, 0, 0);
			return ctx.getImageData(0, 0, src.width, src.height).data;
		};
		const quiet = read("quiet");
		const firing = read("firing");
		let rose = 0;
		for (let i = 0; i < quiet.length; i += 4) {
			const d =
				0.2126 * (firing[i] - quiet[i]) +
				0.7152 * (firing[i + 1] - quiet[i + 1]) +
				0.0722 * (firing[i + 2] - quiet[i + 2]);
			if (d >= 24) rose++;
		}
		return { rose, of: quiet.length / 4 };
	};
	const set = g.npcPlumes.of(raider);
	return {
		hull,
		throats: set ? set.throats.length : 0,
		points: set ? set.object.geometry.getAttribute("position").count : 0,
		sets: 1 + roots.length,
	};
}, EXTRA);

const painted = await page.evaluate(() => window.__plumePainted());
if (painted.rose === 0)
	throw new Error("measure: the firing arm painted no plume pixel");

const arms = { quiet: [], firing: [] };
const shuffle = seededShuffler(SHUFFLE_SEED);
for (let b = 0; b < BLOCKS; b++)
	for (const arm of shuffle(Object.keys(arms)))
		arms[arm].push(
			await page.evaluate(
				([arm, frames]) => window.__plumeArm(arm, frames),
				[arm, FRAMES],
			),
		);
const loadAfter = os.loadavg()[0];
await browser.close();

const fmt = (x) => x.toFixed(3);
console.log(`renderer: ${renderer}`);
console.log(
	`load (1 min) ${loadBefore.toFixed(1)} before, ${loadAfter.toFixed(1)} after, on ${os.cpus().length} cores`,
);
console.log(
	`${setup.sets} ${setup.hull} hulls firing, ${setup.throats} throats and ${setup.points} points a set; ${BLOCKS} blocks of ${FRAMES} frames per arm, shuffle seed ${SHUFFLE_SEED}, ${VIEWPORT.width}x${VIEWPORT.height} @2x`,
);
console.log(
	`firing paints ${painted.rose} pixels (${((100 * painted.rose) / painted.of).toFixed(2)}% of the frame) ≥ 24 codes brighter than quiet`,
);
for (const [arm, xs] of Object.entries(arms))
	console.log(
		`${arm.padEnd(7)} median ${fmt(median(xs))} ms  range ${fmt(Math.min(...xs))}–${fmt(Math.max(...xs))}`,
	);
const delta = median(arms.firing) - median(arms.quiet);
console.log(
	`firing − quiet: ${fmt(delta)} ms (${fmt(delta / setup.sets)} ms a set), firing slower in ${separation(arms.firing, arms.quiet)} pairings`,
);
exit();
