/**
 * Prove #105's cabin surface reached the live renderer, and that it stopped
 * where the node said it must.
 *
 * Three claims, and **none of them is about pixels** — every check below reads
 * scene-graph and material state. A probe here cannot see whether a rim reads
 * or a reflection is distracting; that is the contact sheet's and the
 * principal's, which is #104's finding and #98's rule. What these can do is
 * prove the mechanism the look depends on is present, wired and reversible:
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
 * 4. **#204's additions reached the cabin.** The `face` mid-tone is on real
 *    fittings, the canopy glass carries the scenes' environment under the same
 *    gate and on the same rotation, and the six lamp pools are light added
 *    rather than surfaces shaded.
 */
import { guardedOrigin, launchChromium, tally } from "./probe-guard.mjs";
import { gameUrl } from "./lib/game-url.mjs";

const ORIGIN =
	process.env.PROBE_ORIGIN ?? process.argv[2] ?? "http://localhost:5173";
const VIEWPORTS = [
	{ name: "desktop", width: 1280, height: 760 },
	{ name: "narrow", width: 390, height: 844 },
];

await guardedOrigin(ORIGIN);
const browser = await launchChromium();
const { check, watch, exit } = tally();

/** The cabin as the page holds it: every mesh under the `cockpit` group. */
function state() {
	const game = window.__seelite;
	let cockpit = null;
	game.cabinScene.traverse((object) => {
		if (object.name === "cockpit") cockpit = object;
	});
	if (!cockpit) return { found: false };
	/** One material, flattened to what this probe asks about. */
	const describe = (material) => ({
		type: material.type,
		material: material.name,
		blending: material.blending,
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
	// Name **and** visibility: the quality gate turns the key light off with
	// `visible`, so a probe that only listed names would report "both lights
	// present" at either setting and check nothing.
	const lights = [];
	cockpit.traverse((object) => {
		if (object.isLight)
			lights.push({ name: object.name, visible: object.visible });
	});
	// **Every plated fitting's UVs, not just the deck's.** This probe advertises
	// catching a dropped `plateCockpitUVs` return value, and an earlier version
	// could not: it read the three shared textures off a shared material, which
	// every fitting carries whether or not its own UVs were ever written, and
	// measured a span on `scanner-deck` alone. A fitting built from a bare
	// `chamferedBox` has the zero-filled `uv` attribute the primitive allocates,
	// so its span is exactly 0 — that is the tell, and it is per mesh.
	const spans = [];
	let deckSpan = null;
	cockpit.traverse((object) => {
		if (!object.isMesh) return;
		const material = Array.isArray(object.material)
			? object.material[0]
			: object.material;
		// Only the lit fittings go through the projection; the lamps and the
		// glass are unplated by design.
		if (material?.type !== "MeshStandardMaterial" || !material.map) return;
		const uv = object.geometry.getAttribute("uv");
		if (!uv) {
			spans.push({ name: object.name || "(unnamed)", span: null });
			return;
		}
		let min = Number.POSITIVE_INFINITY;
		let max = Number.NEGATIVE_INFINITY;
		for (let i = 0; i < uv.count; i++) {
			min = Math.min(min, uv.getX(i));
			max = Math.max(max, uv.getX(i));
		}
		const span = max - min;
		// The fitting's own largest extent **on the axes the u coordinate can
		// take**, in the cabin's kilometres. `boxProjectUVs` writes u from `y` on
		// the two faces that most face x and from `x` everywhere else, so the
		// widest u run is `max(x, y)` — never z. Taking the largest of all three
		// put the throttle track's 14 m depth against its 2.2 m u span and made
		// this check red on a correct build.
		object.geometry.computeBoundingBox();
		const box = object.geometry.boundingBox;
		const extent = Math.max(box.max.x - box.min.x, box.max.y - box.min.y);
		spans.push({ name: object.name || "(unnamed)", span, extent });
		if (object.name === "scanner-deck") deckSpan = span;
	});
	// #204's glass: its explicit environment, and whether it is turned onto the
	// star with the scene's. A basic material reads no `scene` field, so both
	// are `main.ts`'s to keep, and a pane left on the bake's own rotation would
	// reflect a star that is not there.
	let glass = null;
	cockpit.traverse((object) => {
		if (object.name !== "canopy-glass") return;
		const m = object.material;
		const a = m.envMapRotation;
		const b = game.cabinScene.environmentRotation;
		glass = {
			envMap: Boolean(m.envMap),
			reflectivity: m.reflectivity,
			rotationMatches:
				Math.abs(a.x - b.x) < 1e-9 &&
				Math.abs(a.y - b.y) < 1e-9 &&
				Math.abs(a.z - b.z) < 1e-9,
		};
	});
	return { found: true, meshes, lights, spans, deckSpan, glass };
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

/** `THREE.AdditiveBlending`'s value; the probe reads materials off the page and
 *  has no `three` import of its own to name it from. */
const ADDITIVE_BLENDING = 2;

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
	await page.goto(gameUrl(ORIGIN), { waitUntil: "load" });
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
	// Four finishes, still four — #204 added `face`. A repaint is the failure
	// #101 shipped once and it is invisible to every other assertion here.
	check(
		`${viewport.name}: the four cabin finishes stay distinct`,
		new Set(structural.map((mesh) => mesh.dial)).size === 4,
	);
	check(
		// And **not** on the deck — `COCKPIT_FINISHES.face` says why.
		`${viewport.name}: #204's face mid-tone is on the console tops and off the deck`,
		["console-top-port", "console-top-starboard"].every((name) =>
			high.meshes.some(
				(mesh) => mesh.name === name && mesh.material === "cockpit-face",
			),
		) &&
			high.meshes.some(
				(mesh) =>
					mesh.name === "scanner-deck" && mesh.material === "cockpit-metal",
			),
	);
	// **The advertised failure mode, guarded for every fitting.** An earlier
	// version read the three shared textures off a shared material — which every
	// fitting carries whether or not its own UVs were written — and measured a
	// span on `scanner-deck` alone. A dropped `plateCockpitUVs` return passed all
	// twelve checks.
	//
	// A span of zero is not the test either: that catches a bare `chamferedBox`,
	// whose `uv` attribute is zero-filled, and *passes* a bare `BoxGeometry`,
	// whose unwrap is a perfectly respectable 0..1. That defect was built and
	// watched pass before this replaced it.
	//
	// What both break is the invariant the projection exists for: UVs in
	// kilometres over a shared panel, so `span / extent` is **near enough the
	// same number on every fitting**, whatever its size. A normalised unwrap
	// gives span 1 on a 32 m deck and span 1 on a 0.8 m bezel — a fortyfold
	// disagreement. No constant is restated; the ratios are only compared with
	// each other.
	//
	// **"Near enough", and the tolerance is derived rather than fitted.** The
	// widest u run on a chamfered form is the extent *less its two cuts*, because
	// the faces carrying u along the long axis are the ones inset by the chamfer.
	// `chamferedBox` clamps the cut to a quarter of the smallest half-extent, and
	// a half-extent is at most half the extent, so `2c <= extent / 4` and the
	// ratio can fall to three quarters of ideal — a spread bound of 4/3. That is
	// worst-case geometry, not a measurement: the cabin's actual spread is 1.10,
	// its thinnest fitting a 2.8 m sliver whose 0.125 m cuts take 9% of its own
	// u run. Anything approaching 40 is the defect this is for.
	const ratios = high.spans.map((fitting) => fitting.span / fitting.extent);
	const spread = Math.max(...ratios) / Math.min(...ratios);
	check(
		`${viewport.name}: every plated fitting is projected at one panel size`,
		high.spans.length > 1 && Number.isFinite(spread) && spread < 4 / 3,
	);
	check(
		`${viewport.name}: the deck carries a few real seams — neither a grid nor none`,
		// **Both ends, and an earlier version had only one.** Banded at
		// `> 0 && < 1` this refused the grid direction and passed a deck with no
		// seam at all, which is half the ruling — "sparse" is a count above zero,
		// not merely below eleven.
		//
		// The lower bound is one plate width in tile units, which is
		// `COCKPIT_PLATING.pitchPx / COCKPIT_MAP_SIZE` = 1/8: below it, no seam
		// crosses the deck. That is a restatement, and a deliberate one — it is
		// the profile's *layout* ratio, fixed by this node, rather than
		// `COCKPIT_PANEL_KM`, which is the tunable figure the earlier band wrongly
		// pinned and which can now move freely between these two ends.
		high.deckSpan > 1 / 8 && high.deckSpan < 1,
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
		`${viewport.name}: the canopy glass carries the environment, turned onto the star`,
		high.glass?.envMap === true &&
			high.glass.reflectivity > 0 &&
			high.glass.rotationMatches,
	);
	// Six, one under each lamp, and light *added*: a basic material in additive
	// blending, which nothing lights and #201's walk leaves out.
	check(
		`${viewport.name}: six lamp pools, added light rather than shaded surfaces`,
		(() => {
			const pools = high.meshes.filter(
				(mesh) => mesh.name === "cockpit-lamp-pool",
			);
			return (
				pools.length === 6 &&
				pools.every((mesh) => !mesh.lit && mesh.blending === ADDITIVE_BLENDING)
			);
		})(),
	);
	check(
		`${viewport.name}: the cabin carries its own fill and #105's warm key`,
		high.lights.some((l) => l.name === "cockpit-light" && l.visible) &&
			high.lights.some((l) => l.name === "cockpit-key-light" && l.visible),
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
		// **The term this node added, and the one it did not.** #105's key light
		// was gated when it was a point light in `nearScene` and cost every
		// standard material in the frame (since #651 only the cabin's); the
		// pre-existing fill is the cabin's own lighting and stays, which is what
		// `settings.ts` promises the player.
		`${viewport.name}: low drops #105's key light and keeps the cabin's fill`,
		low.lights.some((l) => l.name === "cockpit-key-light" && !l.visible) &&
			low.lights.some((l) => l.name === "cockpit-light" && l.visible),
	);
	check(
		// The scenes carry no environment at low, so a pane reflecting one would
		// be the only surface in the frame that did.
		`${viewport.name}: low takes the canopy's reflection away with the scenes'`,
		low.glass?.envMap === false,
	);
	check(
		`${viewport.name}: low leaves the lamps alone`,
		low.meshes.filter((mesh) => mesh.name === "cockpit-lamp").length ===
			high.meshes.filter((mesh) => mesh.name === "cockpit-lamp").length &&
			high.meshes.filter((mesh) => mesh.name === "cockpit-lamp").length === 6,
	);
	await page.evaluate(() => window.__seelite.settings.set("quality", "high"));
	const restored = await page.evaluate(state);
	check(
		`${viewport.name}: high puts the seam map, the key light and the reflection back`,
		structuralOf(restored).every((mesh) => mesh.normalMap) &&
			restored.lights.some(
				(l) => l.name === "cockpit-key-light" && l.visible,
			) &&
			restored.glass?.envMap === true,
	);

	await page.close();
}

await browser.close();
exit();
