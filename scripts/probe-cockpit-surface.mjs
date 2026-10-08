/**
 * Prove #792's authored cabin reached the live renderer, and that it stopped
 * where #105 said a cabin must.
 *
 * **None of these is about pixels** — every check reads scene-graph and
 * material state. Whether the cabin looks right is the principal's, who
 * accepted it on 2026-10-08. What these can do is prove the mechanism the look
 * depends on is present, wired and reversible:
 *
 * 1. **The model landed, adopted.** `cockpit-model.ts` restores the palette
 *    the exporter drops and gives every mapped material its bump; a cabin built
 *    from an unadopted clone renders, in white, with nothing going red.
 * 2. **Nothing readable became a lit surface.** A reflection on a housing is
 *    atmosphere; the same reflection on the glass a player reads velocity
 *    through is a regression. That is closed by material *class* — three's
 *    environment and lights reach `MeshStandardMaterial` and nothing else — so
 *    the readable surfaces are named and held unlit here.
 * 3. **The quality gate is live.** #99's finding: a setting that only takes
 *    effect on reload cannot be judged. Toggled in the page, checked in it.
 *
 * #105's and #204's procedural rows — the shared plating, its seam map and
 * panel size, the four finishes, the face mid-tone, the rail lamps and their
 * pools, the canopy glass — went with the procedural cabin in #792.
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

/** The cabin as the page holds it: every drawn thing under the `cockpit` group. */
function state() {
	const game = window.__seelite;
	let cockpit = null;
	game.cabinScene.traverse((object) => {
		if (object.name === "cockpit") cockpit = object;
	});
	if (!cockpit) return { found: false };
	const first = (object) =>
		Array.isArray(object.material) ? object.material[0] : object.material;
	const meshes = [];
	cockpit.traverse((object) => {
		if (!object.isMesh && !object.isLine && !object.isLineLoop) return;
		const material = first(object);
		if (!material) return;
		meshes.push({
			name: object.name,
			lit: material.type === "MeshStandardMaterial",
			map: Boolean(material.map),
		});
	});
	// Name **and** visibility: the quality gate turns the key light off with
	// `visible`, so a probe that only listed names would report "present" at
	// either setting and check nothing.
	const lights = [];
	cockpit.traverse((object) => {
		if (object.isLight)
			lights.push({ name: object.name, visible: object.visible });
	});
	// The adopted model's own materials: mapped, bumped, and tinted off white.
	const model = cockpit.getObjectByName("authored-cockpit");
	const authored = [];
	model?.traverse((object) => {
		if (!object.isMesh) return;
		const m = first(object);
		if (m?.type !== "MeshStandardMaterial" || !m.map) return;
		authored.push({
			name: object.name,
			bump: m.bumpMap === m.map,
			tinted: m.color.getHex() !== 0xffffff,
		});
	});
	return { found: true, model: Boolean(model), meshes, lights, authored };
}

/** The surfaces a player *reads*. Named rather than derived, because the
 *  claim is about these specific ones and a derived set would grow silently.
 *  The model's painted labels and key caps are matched by prefix. */
const READABLE = [
	"scanner",
	"flight-instrument",
	"target-instrument",
	"scanner-reference-line",
	"screen-radar",
	"screen-flight",
	"screen-systems",
	"screen-target",
];
const PAINTED = (name) => name.startsWith("label-") || name.startsWith("key-");

for (const viewport of VIEWPORTS) {
	const page = await browser.newPage({ viewport });
	watch(page, viewport.name);
	await page.goto(gameUrl(ORIGIN), { waitUntil: "load" });
	await page.waitForFunction(() => Boolean(window.__seelite));

	const high = await page.evaluate(state);
	check(`${viewport.name}: the cabin is in the cabin scene`, high.found);
	check(
		`${viewport.name}: the authored model is the cabin, adopted`,
		high.model &&
			high.authored.length > 0 &&
			high.authored.every((mesh) => mesh.bump && mesh.tinted),
		`${high.authored?.length} mapped meshes`,
	);
	// **The node's line, made checkable.** Not "no reflection is visible" — a
	// probe cannot see that — but "none of these is a material the environment
	// or a light can reach at all", which is the mechanism.
	const painted = high.meshes.filter((m) => PAINTED(m.name));
	check(
		`${viewport.name}: no surface a player reads is a lit material`,
		READABLE.every((name) => {
			const mesh = high.meshes.find((m) => m.name === name);
			return mesh && !mesh.lit;
		}) &&
			painted.length > 0 &&
			painted.every((m) => !m.lit),
		`${painted.length} painted labels and keys`,
	);
	check(
		`${viewport.name}: the throttle fill stays a readout, not a plated surface`,
		high.meshes.some(
			(mesh) => mesh.name === "throttle-fill" && mesh.lit && !mesh.map,
		),
	);
	check(
		`${viewport.name}: the cabin carries its three console lamps, the warm key among them`,
		["cockpit-light", "cockpit-key-light", "cockpit-centre-light"].every(
			(name) => high.lights.some((l) => l.name === name && l.visible),
		),
	);

	// The gate, in the page, without a reload.
	await page.evaluate(() => window.__seelite.settings.set("quality", "low"));
	const low = await page.evaluate(state);
	check(
		// #105's key light is gated because a point light costs every standard
		// material in its scene; the cabin's other lamps are its own lighting and
		// stay, which is what `settings.ts` promises the player.
		`${viewport.name}: low drops the key light and keeps the cabin's other lamps`,
		low.lights.some((l) => l.name === "cockpit-key-light" && !l.visible) &&
			low.lights.some((l) => l.name === "cockpit-light" && l.visible) &&
			low.lights.some((l) => l.name === "cockpit-centre-light" && l.visible),
	);
	await page.evaluate(() => window.__seelite.settings.set("quality", "high"));
	const restored = await page.evaluate(state);
	check(
		`${viewport.name}: high puts the key light back`,
		restored.lights.some((l) => l.name === "cockpit-key-light" && l.visible),
	);

	await page.close();
}

await browser.close();
exit();
