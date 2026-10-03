/**
 * `flight-model.md` §3.8.1's two cues in the running game (#621): the firing
 * vents drawn at their throats, and the saturated marker pulsing.
 *
 *   npm run probe:one probe-vent-display
 *
 * The state is the real sim's: `scripts/lib/vent-state.mjs` hands the ship a
 * speed above the cap and a spin above its envelope with the assist on and
 * runs the game's own `step`, so the retro and attitude vents fire and both
 * families saturate because the assist says so. That half is read off the
 * game; **every claim about what is drawn reads painted pixels**.
 *
 * - **a firing vent lights its throat**: the frame drawn from the sim's firing
 *   table against the same frame with nothing firing, sampled at each lit
 *   throat as Three.js projects it through the camera that drew it.
 * - **a vent that does not fire stays dark**: the same difference at the
 *   throats the table left out, away from the lit ones. Its arm can read
 *   non-zero — it is the same subtraction — so a plume set that lit every
 *   throat fails it.
 * - **the plumes are the hull's and hide with it** in the cockpit, where the
 *   hull is the camera.
 * - **the pulse dims the marker in its own tone**: the overlay at the pulse's
 *   peak against its trough, at the nose cross and at the prograde marker —
 *   the trough's alpha is the floor's share of the peak's and the colour of
 *   the strongest pixel does not move.
 * - **a turn in cruise is a vent turn (#647)**: in a real cruise leg, a spin
 *   past the envelope with the assist on fires the attitude vents and nothing
 *   else, the game's own table carries them, the angular cue latches and the
 *   linear one does not, and the plumes paint them. Before #647 a cruise turn
 *   was heard and neither drawn nor cued.
 *
 * This is a default-layout probe (#381 D11): `v` is the view toggle in the
 * shipped layout, and the rows read the view back, so a dead key fails them.
 */
import {
	bootedGame,
	guardedOrigin,
	launchChromium,
	tally,
} from "./probe-guard.mjs";
import { gameUrl } from "./lib/game-url.mjs";
import { holdCruiseTurnState, holdVentState } from "./lib/vent-state.mjs";

const ORIGIN =
	process.env.PROBE_ORIGIN ?? process.argv[2] ?? "http://localhost:5173";
const URL = gameUrl(
	ORIGIN,
	{ seed: 47, raider: "off" },
	{ override: process.env.PROBE_URL },
);
/** Off the stern, where the hull hides every vent but the drive. */
const ORBIT = 0.9;
/** A throat brightened when some pixel within this many of it rose by
 *  `LIT_DELTA` codes of luma; it stayed dark when none rose by `DARK_DELTA`. */
const SAMPLE_PX = 4;
const LIT_DELTA = 24;
const DARK_DELTA = 8;
/** An unlit throat is only judged this far from every lit one, so a lit
 *  puff's spread is not read as the unlit vent's. */
const CLEAR_OF_LIT_PX = 40;

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

const state = await page.evaluate(holdVentState, {
	overCap: 2,
	spin: 2.5,
	steps: 6,
});
check(
	"the sim's own step fires vents and saturates both families",
	state.lit.length > 0 && state.cue?.linear && state.cue?.angular,
	`${state.hull}, ${state.speedOverCap.toFixed(2)}x the cap, ${state.lit.length} vents firing, cue ${JSON.stringify(state.cue)}`,
);

await setView("chase");
await page.evaluate((orbit) => {
	window.__seelite.chaseYaw = orbit;
}, ORBIT);
await frames();

/**
 * One harness for every pixel row (sage round 2): a frame drawn from a firing
 * table, read in the task that drew it — the drawing buffer is not preserved —
 * against the same frame with nothing firing, as a per-pixel luma rise. The
 * game's own table is put back after.
 */
await page.evaluate(() => {
	const g = window.__seelite;
	const scratch = document.createElement("canvas");
	const ctx = scratch.getContext("2d", { willReadFrequently: true });
	const frame = (table) => {
		const src = g.renderer.domElement;
		scratch.width = src.width;
		scratch.height = src.height;
		g.ventFiring = table;
		g.render(0);
		ctx.drawImage(src, 0, 0);
		return ctx.getImageData(0, 0, src.width, src.height).data;
	};
	window.__ventRise = (table) => {
		const kept = g.ventFiring;
		const lit = frame(table);
		const quiet = frame({});
		g.ventFiring = kept;
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

const plumes = await page.evaluate(
	([samplePx, clearPx]) => {
		const g = window.__seelite;
		const firing = { ...g.ventFiring };
		const object = g.ventPlumes.object;
		object.updateMatrixWorld(true);
		const { W, H } = window.__ventRise({});
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
		const placed = g.ventPlumes.throats.map((t) => {
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
		const onScreen = placed.filter((t) => t.visible);
		const litThroats = onScreen.filter((t) => t.on);
		const unlit = onScreen.filter(
			(t) =>
				!t.on &&
				litThroats.every((l) => Math.hypot(l.x - t.x, l.y - t.y) > clearPx),
		);
		// Every lit slot fired **alone**, so a rise at its throat is its own
		// light and not a neighbour's (sage round 2). A slot with two throats
		// is the main drive's bells, read at each.
		const alone = [...new Set(litThroats.map((t) => t.slot))].flatMap(
			(slot) => {
				const diff = window.__ventRise({ [slot]: firing[slot] });
				return litThroats
					.filter((t) => t.slot === slot)
					.map((t) => ({ slot, rise: near(diff, t.x, t.y) }));
			},
		);
		const all = window.__ventRise(firing);
		return {
			visible: object.visible,
			lit: alone,
			unlit: unlit.map((t) => ({ slot: t.slot, rise: near(all, t.x, t.y) })),
		};
	},
	[SAMPLE_PX, CLEAR_OF_LIT_PX],
);

check(
	"the plumes are drawn in chase, beside the hull",
	plumes.visible === true,
);
{
	const brightened = plumes.lit.filter((t) => t.rise >= LIT_DELTA);
	// Some throats are behind the hull from this side, and a point is
	// depth-tested; most of those in frame are not.
	check(
		"a firing vent, fired alone, lights its own throat's pixels",
		plumes.lit.length > 0 && brightened.length * 2 >= plumes.lit.length,
		`${brightened.length} of ${plumes.lit.length} lit throats in frame rose ≥ ${LIT_DELTA} codes: ${plumes.lit.map((t) => `${t.slot} ${t.rise.toFixed(0)}`).join(", ")}`,
	);
}
{
	const worst = Math.max(0, ...plumes.unlit.map((t) => t.rise));
	check(
		"a vent the table did not fire stays dark",
		plumes.unlit.length > 0 && worst < DARK_DELTA,
		`${plumes.unlit.length} unlit throats clear of the lit ones, worst rise ${worst.toFixed(1)} codes: ${plumes.unlit.map((t) => `${t.slot} ${t.rise.toFixed(0)}`).join(", ")}`,
	);
}

await setView("cockpit");
await frames();
{
	// Painted, not read off a flag (sage round 1).
	const cockpit = await page.evaluate((litDelta) => {
		const firing = { ...window.__seelite.ventFiring };
		const { rise } = window.__ventRise(firing);
		let rose = 0;
		for (const d of rise) if (d >= litDelta) rose++;
		return { firing: Object.keys(firing).length, rose };
	}, LIT_DELTA);
	check(
		"the plumes hide with the hull in the cockpit",
		cockpit.firing > 0 && cockpit.rose === 0,
		`${cockpit.firing} vents firing, ${cockpit.rose} pixels rose ≥ ${LIT_DELTA} codes`,
	);
}

const pulse = await page.evaluate(async () => {
	const g = window.__seelite;
	const { SATURATION_PULSE_HZ } = await import("/src/vent-cue.ts");
	const overlay = document.getElementById("overlay");
	const ctx = overlay.getContext("2d", { willReadFrequently: true });
	const now = g.world.gameTime;
	const v = g.world.ship.vel;
	const speed = Math.hypot(v.x, v.y, v.z);
	const at = (ndc) => ({
		x: (ndc.ndcX * 0.5 + 0.5) * overlay.width,
		y: (1 - (ndc.ndcY * 0.5 + 0.5)) * overlay.height,
	});
	const nose = { x: overlay.width / 2, y: overlay.height / 2 };
	const prograde = at(
		g.markerNdc({ x: v.x / speed, y: v.y / speed, z: v.z / speed }),
	);
	// The strongest pixel in a box round a marker: its alpha and its colour.
	const strongest = (c, r) => {
		const x0 = Math.max(0, Math.round(c.x - r));
		const y0 = Math.max(0, Math.round(c.y - r));
		const box = ctx.getImageData(x0, y0, 2 * r + 1, 2 * r + 1).data;
		let best = { a: 0, rgb: [0, 0, 0] };
		for (let i = 0; i < box.length; i += 4)
			if (box[i + 3] > best.a)
				best = { a: box[i + 3], rgb: [box[i], box[i + 1], box[i + 2]] };
		return best;
	};
	const latched = (onset) => ({
		linear: { onsetS: onset, lastS: now },
		angular: { onsetS: onset, lastS: now },
	});
	const read = (cue) => {
		g.saturationCue = cue;
		g.render(0);
		return {
			nose: strongest(nose, 8),
			prograde: strongest(prograde, 11),
			drawn: g.saturationRender,
		};
	};
	const peak = read(latched(now));
	const trough = read(latched(now - 0.5 / SATURATION_PULSE_HZ));
	const steady = read({ linear: null, angular: null });
	return { peak, trough, steady };
});
{
	// Off the page, as every constant a probe compares against is.
	const floor = await page.evaluate(
		async () => (await import("/src/vent-cue.ts")).SATURATION_PULSE_FLOOR,
	);
	for (const marker of ["nose", "prograde"]) {
		const peak = pulse.peak[marker];
		const trough = pulse.trough[marker];
		const steady = pulse.steady[marker];
		check(
			`the ${marker} marker is painted, at the peak and with no cue`,
			peak.a > 0 && steady.a > 0,
			`peak alpha ${peak.a}, steady ${steady.a}`,
		);
		check(
			`at the trough the ${marker} marker keeps the floor's share of its alpha`,
			peak.a > 0 && Math.abs(trough.a / peak.a - floor) < 0.12,
			`${trough.a}/${peak.a} = ${(trough.a / Math.max(1, peak.a)).toFixed(3)} against ${floor}`,
		);
		check(
			`the ${marker} marker's colour does not move with the pulse`,
			peak.rgb.every((c, i) => Math.abs(c - trough.rgb[i]) <= 12),
			`peak rgb ${peak.rgb.join(",")}, trough ${trough.rgb.join(",")}`,
		);
		check(
			`at the peak the ${marker} marker is the marker with no cue`,
			Math.abs(peak.a - steady.a) <= 2,
			`peak ${peak.a}, steady ${steady.a}`,
		);
	}
}

// A turn in cruise (#647, `flight-model.md` §3.11): the same spin, flown in a
// real cruise leg by the game's own `step`.
const cruise = await page.evaluate(holdCruiseTurnState, {
	spin: 2.5,
	steps: 6,
});
check(
	"a cruise turn past the envelope fires the attitude vents, and only those (#647)",
	cruise.engaged &&
		cruise.stillCruising &&
		cruise.lit.length > 0 &&
		cruise.lit.every((v) => ["pitch", "yaw", "roll"].includes(v.family)),
	`engaged ${cruise.engaged}, still cruising ${cruise.stillCruising}, firing: ${cruise.lit.map((v) => `${v.slot} (${v.family})`).join(", ") || "none"}`,
);
check(
	"a cruise turn past the envelope latches the angular cue and not the linear one (#647)",
	cruise.cue?.angular === true && cruise.cue?.linear === false,
	`cue ${JSON.stringify(cruise.cue)}`,
);
await setView("chase");
await page.evaluate((orbit) => {
	window.__seelite.chaseYaw = orbit;
}, ORBIT);
await frames();
{
	const painted = await page.evaluate(
		([firing, litDelta]) => {
			const { rise } = window.__ventRise(firing);
			let rose = 0;
			for (const d of rise) if (d >= litDelta) rose++;
			return rose;
		},
		[cruise.firing, LIT_DELTA],
	);
	check(
		"the plumes paint a cruise turn's vents in chase (#647)",
		cruise.lit.length > 0 && painted > 0,
		`${cruise.lit.length} vents firing, ${painted} pixels rose ≥ ${LIT_DELTA} codes`,
	);
}

await browser.close();
exit();
