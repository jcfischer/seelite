/**
 * The firing vents on an NPC hull in the running game (node #637): the duel's
 * raider, drawn from its own firing table, as `probe-vent-display.mjs` reads
 * the player's (#621).
 *
 *   npm run probe:one probe-npc-vents
 *
 * The state is the real sim's: `scripts/lib/npc-vent-state.mjs` flies a cruise
 * leg, forces a raider ahead, lets the game's own `step` interdict and fly the
 * duel, then holds the clock and places the player off the raider's stern.
 * The table the raider fired is read off the game; **every claim about what is
 * drawn reads painted pixels**.
 *
 * - **the raider fires from its own Hull step**: the encounter's contact
 *   carries a non-empty table, and every slot in it is one of the raider
 *   hull's vents.
 * - **one plume set beside the raider's hull**: a sibling of its mesh in the
 *   mesh's own scene, not the player's set and not under the hull's root.
 * - **a firing vent, fired alone, lights its own throat** on the raider: the
 *   frame drawn from that slot against the same frame with nothing firing,
 *   sampled at the throat as the camera that drew it projects it.
 * - **a vent the table did not fire stays dark**: the same difference at the
 *   raider's other throats, away from the lit ones.
 * - **a hull no longer drawn loses its plumes**: the raider taken out of view,
 *   its set is gone and its points have left the scene.
 */
import {
	bootedGame,
	guardedOrigin,
	launchChromium,
	tally,
} from "./probe-guard.mjs";
import { gameUrl } from "./lib/game-url.mjs";
import { holdNpcVentState } from "./lib/npc-vent-state.mjs";

const ORIGIN =
	process.env.PROBE_ORIGIN ?? process.argv[2] ?? "http://localhost:5173";
const URL = gameUrl(
	ORIGIN,
	{ seed: 47, raider: "off" },
	{ override: process.env.PROBE_URL },
);
/** Off the raider's stern, kilometres: its 63.5 m hull a quarter of the frame. */
const BEHIND_KM = 0.2;
/** Duel steps flown before the clock is held. */
const STEPS = 20;
/** As `probe-vent-display.mjs`: a throat brightened when some pixel within
 *  `SAMPLE_PX` rose by `LIT_DELTA` codes of luma; stayed dark under
 *  `DARK_DELTA`; an unlit throat is judged only `CLEAR_OF_LIT_PX` from every
 *  lit one. */
const SAMPLE_PX = 4;
const LIT_DELTA = 24;
const DARK_DELTA = 8;
const CLEAR_OF_LIT_PX = 40;
/** A slot is fired alone at full level, so the row asks whether its throat is
 *  drawn, not whether the sim's level that frame was large enough to see. */
const ALONE_LEVEL = 1;

await guardedOrigin(ORIGIN);
const browser = await launchChromium();
const { check, watch, exit } = tally();
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
watch(page);
await page.goto(URL, { waitUntil: "load" });
await bootedGame(page);

const frames = (n = 2) =>
	page.evaluate(async (n) => {
		for (let i = 0; i < n; i++)
			await new Promise((r) => requestAnimationFrame(() => r()));
	}, n);
async function setView(want) {
	for (let i = 0; i < 8; i++) {
		if ((await page.evaluate(() => window.__seelite.view)) === want) return;
		await page.keyboard.press("v");
		await frames();
	}
	throw new Error(`could not reach the ${want} view`);
}

await setView("cockpit");
const state = await page.evaluate(holdNpcVentState, {
	steps: STEPS,
	behindKm: BEHIND_KM,
});
const slots = await page.evaluate(async (hull) => {
	const { HULL_SPECS } = await import("/src/hull.ts");
	return HULL_SPECS[hull].vents.map((v) => v.slot);
}, state.hull);
check(
	"the duel's raider fires vents from its own Hull step",
	!state.absent &&
		state.lit.length > 0 &&
		state.lit.every((v) => slots.includes(v.slot)),
	`${state.name} (${state.hull}): ${state.lit.map((v) => `${v.slot} ${v.level.toFixed(2)}`).join(", ") || "nothing firing"}`,
);

/**
 * One harness for every pixel row: a frame drawn with the raider's contact
 * carrying `table`, read in the task that drew it, against the same frame with
 * nothing firing, as a per-pixel luma rise. The player's own table is emptied
 * so its plumes cannot contribute; the raider's table is put back after.
 */
await page.evaluate(() => {
	const g = window.__seelite;
	g.ventFiring = {};
	const scratch = document.createElement("canvas");
	const ctx = scratch.getContext("2d", { willReadFrequently: true });
	const frame = (table) => {
		const src = g.renderer.domElement;
		scratch.width = src.width;
		scratch.height = src.height;
		g.encounterView.firing = table;
		g.render(0);
		ctx.drawImage(src, 0, 0);
		return ctx.getImageData(0, 0, src.width, src.height).data;
	};
	window.__npcVentRise = (table) => {
		const kept = g.encounterView.firing;
		const lit = frame(table);
		const quiet = frame({});
		g.encounterView.firing = kept;
		g.render(0);
		const W = scratch.width;
		const H = scratch.height;
		const rise = new Float32Array(W * H);
		for (let i = 0; i < rise.length; i++) {
			const k = 4 * i;
			rise[i] =
				0.2126 * (lit[k] - quiet[k]) +
				0.7152 * (lit[k + 1] - quiet[k + 1]) +
				0.0722 * (lit[k + 2] - quiet[k + 2]);
		}
		return { rise, W, H };
	};
});

const placed = await page.evaluate(() => {
	const g = window.__seelite;
	const set = g.npcPlumes.of(g.raiderMesh);
	return {
		built: Boolean(set),
		sibling: Boolean(set) && set.object.parent === g.raiderMesh.parent,
		underRoot: g.raiderMesh.getObjectByName("vent-plumes") !== undefined,
		notPlayers: Boolean(set) && set.object !== g.ventPlumes.object,
		sets: g.npcPlumes.size,
	};
});
check(
	"one plume set beside the raider's hull, a sibling of its mesh and not the player's",
	placed.built && placed.sibling && !placed.underRoot && placed.notPlayers,
	JSON.stringify(placed),
);

const plumes = await page.evaluate(
	([samplePx, clearPx, aloneLevel]) => {
		const g = window.__seelite;
		const firing = { ...g.encounterView.firing };
		const set = g.npcPlumes.of(g.raiderMesh);
		const object = set.object;
		object.updateMatrixWorld(true);
		const { W, H } = window.__npcVentRise({});
		const near = ({ rise }, x, y) => {
			let most = 0;
			for (let dy = -samplePx; dy <= samplePx; dy++)
				for (let dx = -samplePx; dx <= samplePx; dx++) {
					const px = Math.round(x) + dx;
					const py = Math.round(y) + dy;
					if (px < 0 || py < 0 || px >= W || py >= H) continue;
					most = Math.max(most, rise[py * W + px]);
				}
			return most;
		};
		const throats = set.throats.map((t) => {
			const p = t.at
				.clone()
				.applyMatrix4(object.matrixWorld)
				.project(g.nearCamera);
			return {
				slot: t.slot,
				on: (firing[t.slot] ?? 0) > 0,
				x: (p.x * 0.5 + 0.5) * W,
				y: (1 - (p.y * 0.5 + 0.5)) * H,
				visible: p.z < 1 && Math.abs(p.x) < 0.98 && Math.abs(p.y) < 0.98,
			};
		});
		const onScreen = throats.filter((t) => t.visible);
		const litThroats = onScreen.filter((t) => t.on);
		const unlit = onScreen.filter(
			(t) =>
				!t.on &&
				litThroats.every((l) => Math.hypot(l.x - t.x, l.y - t.y) > clearPx),
		);
		const alone = [...new Set(litThroats.map((t) => t.slot))].flatMap(
			(slot) => {
				const diff = window.__npcVentRise({ [slot]: aloneLevel });
				return litThroats
					.filter((t) => t.slot === slot)
					.map((t) => ({ slot, rise: near(diff, t.x, t.y) }));
			},
		);
		const all = window.__npcVentRise(firing);
		return {
			onScreen: onScreen.length,
			lit: alone,
			unlit: unlit.map((t) => ({ slot: t.slot, rise: near(all, t.x, t.y) })),
		};
	},
	[SAMPLE_PX, CLEAR_OF_LIT_PX, ALONE_LEVEL],
);
{
	const brightened = plumes.lit.filter((t) => t.rise >= LIT_DELTA);
	// Some throats are behind the hull from the stern, and a point is
	// depth-tested; most of those in frame are not.
	check(
		"a raider vent, fired alone, lights its own throat's pixels",
		plumes.lit.length > 0 && brightened.length * 2 >= plumes.lit.length,
		`${brightened.length} of ${plumes.lit.length} lit throats in frame (${plumes.onScreen} on screen) rose ≥ ${LIT_DELTA} codes: ${plumes.lit.map((t) => `${t.slot} ${t.rise.toFixed(0)}`).join(", ")}`,
	);
}
{
	const worst = Math.max(0, ...plumes.unlit.map((t) => t.rise));
	check(
		"a raider vent its table did not fire stays dark",
		plumes.unlit.length > 0 && worst < DARK_DELTA,
		`${plumes.unlit.length} unlit throats clear of the lit ones, worst rise ${worst.toFixed(1)} codes: ${plumes.unlit.map((t) => `${t.slot} ${t.rise.toFixed(0)}`).join(", ")}`,
	);
}

{
	// Taken out of view, as a kill or a rout takes it: the encounter's view
	// goes, so the hull leaves the scene, and its plumes with it.
	const gone = await page.evaluate((litDelta) => {
		const g = window.__seelite;
		const firing = { ...g.encounterView.firing };
		const { rise: before } = window.__npcVentRise(firing);
		let roseBefore = 0;
		for (const d of before) if (d >= litDelta) roseBefore++;
		const view = g.encounterView;
		const set = g.npcPlumes.of(g.raiderMesh);
		g.encounterView = null;
		g.render(0);
		const result = {
			roseBefore,
			setAfter: Boolean(g.npcPlumes.of(g.raiderMesh)),
			objectParented: Boolean(set?.object.parent),
			raiderParented: Boolean(g.raiderMesh.parent),
		};
		g.encounterView = view;
		g.render(0);
		return result;
	}, LIT_DELTA);
	check(
		"a raider no longer drawn loses its plume set, and its points leave the scene",
		gone.roseBefore > 0 &&
			!gone.setAfter &&
			!gone.objectParented &&
			!gone.raiderParented,
		JSON.stringify(gone),
	);
}

await browser.close();
exit();
