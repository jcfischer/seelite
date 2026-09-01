/**
 * Prove #105's cabin surface reached the live renderer, and that it stopped
 * where the node said it must.
 *
 * Three claims, and only the middle one is about pixels:
 *
 * 1. **The plating landed.** A profile, a UV writer and a material patch can all
 *    be right in the headless tier while the maps never reach a material — the
 *    generator is lazy and `plateCockpitUVs` hands back a *new* geometry, so a
 *    dropped return value leaves a fitting unplated with nothing going red.
 * 2. **Nothing readable became a lit surface.** The node's sharpest constraint
 *    is that a reflection landing on a console bezel is atmosphere and the same
 *    reflection on the glass a player reads velocity through is a regression.
 *    That is currently closed by material *class* — three's environment and
 *    lights reach `MeshStandardMaterial` and nothing else — which is a fact
 *    about the cabin rather than a rule anyone wrote down. This is where it is
 *    written down, so swapping one of those five materials for a lit one fails
 *    here instead of on a sheet six nodes later.
 * 3. **The quality gate is live.** #99's finding: a reload puts the ship
 *    somewhere else, so a setting that only takes effect on reload cannot be
 *    judged. Toggled in the page, checked in the page.
 */
import { guardedOrigin, launchChromium, tally } from "./probe-guard.mjs";

const ORIGIN =
	process.env.PROBE_ORIGIN ?? process.argv[2] ?? "http://localhost:5173";
const VIEWPORTS = [
	{ name: "desktop", width: 1280, height: 760 },
	{ name: "narrow", width: 390, height: 844 },
];

/*
 * Both modules, and **what the guard can and cannot see** — the same caveat
 * `probe-ship-visuals.mjs` records. probe-guard fingerprints a module by its
 * top-level numeric constants, so what `cockpit-surface.ts` contributes is
 * `COCKPIT_PANEL_KM` and `COCKPIT_MAP_SIZE`. `COCKPIT_PLATING`,
 * `COCKPIT_FINISHES`, `COCKPIT_LAMP` and `COCKPIT_KEY_LIGHT` are all nested and
 * the guard reads none of them: a dev server serving another checkout whose
 * profile or lamp figures differ would still pass. `COCKPIT_CHAMFER_KM` is
 * top-level and is read.
 */
await guardedOrigin(ORIGIN, ["src/main.ts", "src/cockpit-surface.ts"]);
const browser = await launchChromium();
const { check, watch, exit } = tally();

/** The cabin as the page holds it: every mesh under the `cockpit` group. */
function state() {
	const game = window.__seelite;
	let cockpit = null;
	game.nearScene.traverse((object) => {
		if (object.name === "cockpit") cockpit = object;
	});
	if (!cockpit) return { found: false };
	/** One material, flattened to what this probe asks about. */
	const describe = (material) => ({
		type: material.type,
		lit: material.type === "MeshStandardMaterial",
		map: Boolean(material.map),
		roughnessMap: Boolean(material.roughnessMap),
		metalnessMap: Boolean(material.metalnessMap),
		normalMap: Boolean(material.normalMap),
		finish: material.userData?.finish ?? null,
		// The rendered dial, which is what a repaint would collapse.
		dial: `${material.roughness?.toFixed?.(4)}/${material.metalness?.toFixed?.(4)}`,
	});
	const meshes = [];
	cockpit.traverse((object) => {
		if (!object.isMesh && !object.isLine && !object.isLineLoop) return;
		const material = Array.isArray(object.material)
			? object.material[0]
			: object.material;
		if (!material) return;
		meshes.push({ name: object.name, ...describe(material) });
	});
	const lights = [];
	cockpit.traverse((object) => {
		if (object.isLight) lights.push(object.name);
	});
	// A fitting's UVs, read off the page rather than restated: the largest UV
	// span on the scanner deck is what says a plate is a size.
	let deckSpan = null;
	cockpit.traverse((object) => {
		if (object.name !== "scanner-deck") return;
		const uv = object.geometry.getAttribute("uv");
		let min = Number.POSITIVE_INFINITY;
		let max = Number.NEGATIVE_INFINITY;
		for (let i = 0; i < uv.count; i++) {
			min = Math.min(min, uv.getX(i));
			max = Math.max(max, uv.getX(i));
		}
		deckSpan = max - min;
	});
	return { found: true, meshes, lights, deckSpan };
}

/**
 * The lit cabin surfaces the plating claims cover.
 *
 * **The throttle fill is lit and deliberately not plated** — it is a bar whose
 * length is the reading, and a seam across it would read as a fault in the
 * value. That exclusion is the load-bearing part of every plating check below,
 * so it is written once here rather than repeated at each of them, and it is
 * asserted on its own so the hole is a claim.
 */
const structuralOf = (state) =>
	state.meshes.filter((mesh) => mesh.lit && mesh.name !== "throttle-fill");

/** The five surfaces a player *reads*. Named rather than derived, because the
 *  claim is about these specific ones and a derived set would grow silently. */
const READABLE = [
	"canopy-glass",
	"scanner",
	"flight-instrument",
	"target-instrument",
	"scanner-reference-line",
];

for (const viewport of VIEWPORTS) {
	const page = await browser.newPage({ viewport });
	watch(page, viewport.name);
	await page.goto(ORIGIN, { waitUntil: "load" });
	await page.waitForFunction(() => Boolean(window.__seelite));

	const high = await page.evaluate(state);
	check(`${viewport.name}: the cabin is in the near scene`, high.found);

	const structural = structuralOf(high);
	check(
		`${viewport.name}: every lit cabin surface carries the shared plating`,
		structural.length > 0 &&
			structural.every(
				(mesh) =>
					mesh.map && mesh.roughnessMap && mesh.metalnessMap && mesh.finish,
			),
	);
	check(
		`${viewport.name}: the seam map is cut in at the default quality`,
		structural.every((mesh) => mesh.normalMap),
	);
	// Three finishes, still three. A repaint is the failure #101 shipped once
	// and it is invisible to every other assertion here.
	check(
		`${viewport.name}: the three cabin finishes stay distinct`,
		new Set(structural.map((mesh) => mesh.dial)).size === 3,
	);
	check(
		`${viewport.name}: the deck carries a rare seam rather than a grid`,
		// **Stated without restating the constant.** An earlier version banded
		// this at 0.2–0.9, which is a hand-derivation of `COCKPIT_PANEL_KM`
		// 0.072: a legitimate retune of the panel size would have turned the
		// probe red for no defect, which is exactly the falsely-red failure
		// CLAUDE.md's "probes read constants off the page" entry exists to
		// prevent. What is asserted instead is the *shape* the principal ruled —
		// the cabin's largest surface spans less than one whole tile, so it
		// carries a handful of seams and not a grid — and that a projection ran
		// at all, which a zero span would deny.
		high.deckSpan > 0 && high.deckSpan < 1,
	);
	// **The node's line, made checkable.** Not "no reflection is visible" — a
	// probe cannot see that — but "none of these five is a material the
	// environment or a light can reach at all", which is the mechanism.
	check(
		`${viewport.name}: no surface a player reads is a lit material`,
		READABLE.every((name) => {
			const mesh = high.meshes.find((m) => m.name === name);
			return mesh && !mesh.lit;
		}),
	);
	check(
		`${viewport.name}: the throttle fill stays a readout, not a plated surface`,
		high.meshes.some(
			(mesh) => mesh.name === "throttle-fill" && mesh.lit && !mesh.map,
		),
	);
	check(
		`${viewport.name}: the canopy lamps glow without being plated`,
		high.meshes.some(
			(mesh) => mesh.name === "cockpit-lamp" && !mesh.lit && !mesh.map,
		),
	);
	check(
		`${viewport.name}: the cabin carries its own fill and #105's warm key`,
		high.lights.includes("cockpit-light") &&
			high.lights.includes("cockpit-key-light"),
	);

	// The gate, in the page, without a reload.
	await page.evaluate(() => window.__seelite.settings.set("quality", "low"));
	const low = await page.evaluate(state);
	check(
		`${viewport.name}: low drops the cabin's seam map and keeps the rest`,
		structuralOf(low).every(
			(mesh) => !mesh.normalMap && mesh.map && mesh.roughnessMap,
		),
	);
	check(
		`${viewport.name}: low leaves the lamps and both interior lights alone`,
		low.lights.join(",") === high.lights.join(",") &&
			low.meshes.filter((mesh) => mesh.name === "cockpit-lamp").length ===
				high.meshes.filter((mesh) => mesh.name === "cockpit-lamp").length,
	);
	await page.evaluate(() => window.__seelite.settings.set("quality", "high"));
	const restored = await page.evaluate(state);
	check(
		`${viewport.name}: high puts the seam map back on the same materials`,
		structuralOf(restored).every((mesh) => mesh.normalMap),
	);

	await page.close();
}

await browser.close();
exit();
