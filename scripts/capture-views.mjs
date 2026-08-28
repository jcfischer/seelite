/**
 * Capture the canonical view set — the second half of #98's gate.
 *
 *   npm run dev                                  # in one shell
 *   npm run views                                # in another
 *   npm run views -- --label before              # name the run yourself
 *   open view-set/index.html
 *
 * A visual node posts a before/after against this sheet, and the principal says
 * yes or no to it. That is the whole gate the repo was missing: #35 and #36 both
 * closed green on numeric probes and produced the look now being changed, and
 * #36's own receipt records that every rendered form of its outline rule was
 * measuring bloom. A number could not fail on *this looks flat*. A person can.
 *
 * Which views, and why each one, is `scripts/lib/view-set.mjs`. This file is the
 * browser half: pin the world, place the camera, take the picture.
 *
 * ## Headed, and it refuses rather than falling back
 *
 * Every other browser script in this repo renders through **SwiftShader** —
 * `launchChromium` passes plain defaults and no GPU flags, so the same scene
 * measures 16.8 fps headless against 371 fps headed on an M1 Pro (#98). For a
 * frame *cost* that makes a probe number relative. For an **image** it is worse:
 * the gate is a human judging a picture, and SwiftShader and ANGLE Metal do not
 * produce the same picture — bloom thresholds, tone mapping and anything reading
 * a mip chain can all differ.
 *
 * So a headless sheet would have the principal approving a renderer no player
 * ever sees, which is a subtler version of the failure #98 exists to stop. This
 * script launches headed and then **checks what it actually got**, because
 * `headless: false` is a request and a machine with no display is a real thing.
 * A software rasteriser is a refusal, not a warning: a warning above a folder of
 * PNGs is a warning nobody reads once the images are open.
 *
 * The cost is that this cannot run in CI. It already could not — the probes do
 * not run there either (`CLAUDE.md`, #14) — so nothing is given up.
 *
 * ## Not a probe
 *
 * It asserts nothing about the pixels and exits 0 whenever it captured what it
 * was asked for. `probe-all` only collects `probe-*.mjs`, so the name keeps it
 * out of the suite; `check-launcher-wiring.mjs` exempts it from the `tally()`
 * rule for the same reason it exempts `shot-ships.mjs`.
 */
import { execFileSync } from "node:child_process";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
	GAME_TIME_S,
	SEED,
	SHOT_KINDS,
	VIEWPORT,
	VIEWS,
	contactSheet,
} from "./lib/view-set.mjs";
import { installViewFraming } from "./lib/view-placement.mjs";
import {
	bootedGame,
	guardedOrigin,
	installViewPlacement,
	launchChromium,
} from "./probe-guard.mjs";

const ORIGIN = process.env.PROBE_ORIGIN ?? "http://localhost:5173";

/** `--out` and `--label`, both `--k v` and `--k=v`. Small enough to read here;
 *  `probe-args.mjs` parses a different grammar for a different runner. */
function arg(name, fallback) {
	const argv = process.argv.slice(2);
	const eq = argv.find((a) => a.startsWith(`--${name}=`));
	if (eq) return eq.slice(name.length + 3);
	const i = argv.indexOf(`--${name}`);
	return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("-")
		? argv[i + 1]
		: fallback;
}

/**
 * The run's name, defaulting to the ref it was captured at.
 *
 * A before/after pair is two captures of the same seven views at two commits,
 * and naming each after its commit is what stops the pair being mislabelled —
 * the sheet prints it, so a shot claiming to be "after" while sitting at the
 * parent commit says so.
 *
 * `-dirty` matters more than it looks. The *after* half is normally captured
 * with the change still uncommitted, so a bare short ref would name the parent
 * commit for frames that are not of it — a label that reads precise and is
 * wrong, which is worse than a vague one.
 */
function gitRef() {
	try {
		const at = (args) => execFileSync("git", args, { encoding: "utf8" }).trim();
		const sha = at(["rev-parse", "--short", "HEAD"]);
		return at(["status", "--porcelain"]) ? `${sha}-dirty` : sha;
	} catch {
		return "no-git";
	}
}

const REF = gitRef();
const LABEL = arg("label", REF);
const OUT = arg("out", "view-set");

/** Renderers that are not the player's. A refusal, per the header. */
const SOFTWARE = /swiftshader|llvmpipe|software|mesa offscreen/i;

/**
 * Both directions between the declared shot kinds and the placers built for
 * them: a kind with no placer, and a placer nothing declares.
 *
 * `tests/view-set.test.ts` holds `SHOT_KINDS` but cannot see this file, so the
 * loop is closed here instead. It runs before the browser is launched, so a
 * mismatch costs no headed window.
 */
function assertPlacersCover(placers) {
	const declared = new Set(SHOT_KINDS);
	const built = new Set(Object.keys(placers));
	const missing = [...declared].filter((k) => !built.has(k));
	const extra = [...built].filter((k) => !declared.has(k));
	if (missing.length || extra.length)
		throw new Error(
			"shot kinds and placers disagree — " +
				`${missing.length ? `no placer for ${missing.join(", ")}; ` : ""}` +
				`${extra.length ? `no SHOT_KINDS entry for ${extra.join(", ")}` : ""}`,
		);
}

/** One placer per shot kind. Each returns the subject it framed, for the log. */
const PLACERS = {
	"station-axis": async (page, shot) => {
		const id = `station-${shot.station}`;
		await page.evaluate(
			async ([bodyId, radii]) =>
				window.__viewAlongAxis(bodyId, window.__radiusOf(bodyId) * radii, {
					comoving: true,
				}),
			[id, shot.radii],
		);
		return id;
	},
	"body-offset": async (page, shot) => {
		const id = await page.evaluate((name) => {
			if (name !== "largest-planet") return name;
			const planets = window.__seelite.world.system.bodies.filter(
				(b) => b.kind === "planet",
			);
			// Largest, because the terminator is what this view is for and a bigger
			// disc shows more of it. Ties broken by id so the choice is the same
			// every run — an unordered pick would reframe the shot between captures.
			planets.sort((a, b) => b.radiusKm - a.radiusKm || (a.id < b.id ? -1 : 1));
			return planets[0].id;
		}, shot.body);
		await page.evaluate(
			async ([bodyId, radii, deg]) => window.__sunOffset(bodyId, radii, deg),
			[id, shot.radii, shot.sunAngleDeg],
		);
		return id;
	},
	"deep-sky": async (page) => {
		// Back to the arrival point first. Turning the camera alone left the ship
		// wherever the previous view had put it, which made one view of a
		// *canonical* set a function of the order of the array above it.
		await page.evaluate(async () => {
			await window.__returnToBootPosition();
			const g = window.__seelite;
			const d = window.__emptiestDirection();
			const p = g.world.ship.pos;
			await window.__lookAt({
				x: p.x + d.x * 1e9,
				y: p.y + d.y * 1e9,
				z: p.z + d.z * 1e9,
			});
		});
		return "arrival point, empty sky";
	},
};
assertPlacersCover(PLACERS);

/**
 * Put the game in a view, through the key rather than the field.
 *
 * `v` runs the transition the game runs on a real toggle — it also resets
 * head-look — and assigning `game.view` would skip it. Bounded rather than a
 * single press: `v` cycles, and a third view arriving later would turn a wrong
 * frame into a `waitForFunction` timeout, which reads as a hung browser and not
 * as the one-line cause it is.
 */
const VIEW_CYCLE_LIMIT = 8;
async function setView(page, want) {
	for (let i = 0; i <= VIEW_CYCLE_LIMIT; i++) {
		if ((await page.evaluate(() => window.__seelite.view)) === want) return;
		await page.keyboard.press("v");
		await page
			.waitForFunction((w) => window.__seelite.view !== w, undefined, {
				timeout: 500,
			})
			.catch(() => {});
	}
	throw new Error(
		`the view cycle never reached "${want}" in ${VIEW_CYCLE_LIMIT} presses of v — ` +
			"the view set names a view the game does not have",
	);
}

/**
 * The renderer, and a refusal unless it can be *shown* to be the player's.
 *
 * Two ways to fail, and both are refusals rather than warnings. A name matching
 * a known software rasteriser is the obvious one. The other is subtler and was
 * a real hole: without `WEBGL_debug_renderer_info` the only readable name is the
 * generic `gl.RENDERER`, which on a masked or unlisted software stack says
 * nothing and passes a substring test. A name match cannot prove hardware, so an
 * unreadable name is treated as unproven and refused — the whole point of this
 * script is that the principal is looking at the renderer they fly.
 */
async function assertPlayersRenderer(page) {
	const gpu = await page.evaluate(() => {
		const gl = window.__seelite.renderer.getContext();
		const ext = gl.getExtension("WEBGL_debug_renderer_info");
		return {
			unmasked: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : null,
			generic: gl.getParameter(gl.RENDERER),
		};
	});
	const renderer = gpu.unmasked ?? gpu.generic;
	const refusal = !gpu.unmasked
		? `cannot read the real renderer — WEBGL_debug_renderer_info is unavailable, and "${gpu.generic}" does not say what is drawing`
		: SOFTWARE.test(renderer)
			? `this is a software rasteriser (${renderer})`
			: null;
	if (refusal)
		throw new Error(
			`refusing to capture: ${refusal}.\n` +
				"The sheet is judged by eye, and a frame from anything but the player's\n" +
				"renderer is the wrong picture — bloom, tone mapping and mip-sampled\n" +
				"surfaces all differ from ANGLE Metal. Run this on a machine with a\n" +
				"display; there is deliberately no headless mode.",
		);
	return renderer;
}

/**
 * Rebuild the sheet from every run on disk, oldest first.
 *
 * From disk rather than from this run alone, so capturing an `after` beside an
 * existing `before` produces the pair without either capture knowing about the
 * other. Ordered by `capturedAt` and not by directory name: the labels are git
 * refs by default, whose alphabetical order is meaningless, and even the
 * documented `before`/`after` pair sorts the wrong way round by name.
 *
 * **The stale sheet is removed before the new one is built.** `contactSheet`
 * throws on a run missing a view, and a throw that leaves the previous complete
 * `index.html` in place hands the reviewer a whole-looking sheet of an older
 * capture — which is the exact failure the throw exists to prevent, one step
 * further along.
 */
async function rebuildSheet(out) {
	const runs = [];
	for (const entry of await readdir(out, { withFileTypes: true })) {
		if (!entry.isDirectory()) continue;
		try {
			runs.push(
				JSON.parse(
					await readFile(join(out, entry.name, "manifest.json"), "utf8"),
				),
			);
		} catch {
			// A directory with no manifest is not a run — someone's scratch folder,
			// or a capture that died before it wrote one. Skipping it is right;
			// failing on it would make an unrelated folder break the sheet.
		}
	}
	runs.sort((a, b) => (a.capturedAt < b.capturedAt ? -1 : 1));
	await rm(join(out, "index.html"), { force: true });
	await writeFile(join(out, "index.html"), contactSheet(runs));
	return runs;
}

// One file per surface the set is pointed at, so an edit to any of them cannot
// be captured green against a dev server serving a different checkout.
//
// Two of the seven views' subjects are missing from this list, and that is a
// gap rather than a choice. The guard fingerprints a file by its top-level
// numeric constants and refuses one that has none — which `cockpit.ts`,
// `live-cockpit.ts`, `planet-shaders.ts` and `planet-classes.glsl.ts` all are.
// So the cockpit interior and the planet shaders can change under a stale
// server and this capture will not notice. #105 is where the cockpit's own
// constants land; this list should gain it there.
await guardedOrigin(ORIGIN, [
	"src/main.ts",
	"src/ship-mesh.ts",
	"src/station-mesh.ts",
]);

const browser = await launchChromium({ headless: false });
const page = await browser.newPage({ viewport: VIEWPORT });

/**
 * A page fault seen at any point in the run, or null.
 *
 * A shader that fails to link is reported through `console.error` and the scene
 * carries on drawing *something*, so a capture over that build produces seven
 * plausible frames and a complete-looking sheet. The first version of this set
 * `process.exitCode = 1` and kept going, which is the same failure the header
 * refuses a software rasteriser over: an exit code above a folder of PNGs is a
 * warning nobody reads once the images are open.
 *
 * **It catches one class, not "a broken build".** The filter is the same narrow
 * one `tally()` uses, and narrow on purpose — a capture is not a lint pass, and
 * failing on any console error would make an unrelated warning elsewhere in the
 * page stop the run. A texture that fails to decode, a lost context, or a
 * renderer error phrased differently all get through and reach the sheet. That
 * is the same bargain every probe in this repo makes, and the reason the sheet's
 * reader is a person.
 */
let fault = null;
const faulted = (what) => {
	if (!fault) fault = what;
	console.error(`\n  ${what}`);
};
page.on("console", (m) => {
	if (m.type() !== "error") return;
	if (!/shader|glsl|link status|validate_status/i.test(m.text())) return;
	faulted(
		`shader error — the sheet would be of a broken build: ${m.text().slice(0, 400)}`,
	);
});
page.on("pageerror", (e) => faulted(`page error: ${e.message}`));

await installViewPlacement(page);
await installViewFraming(page);
await page.goto(`${ORIGIN}/?seed=${SEED}`, { waitUntil: "load" });
await bootedGame(page);
let renderer;
const captured = [];
try {
	renderer = await assertPlayersRenderer(page);
	// Before anything moves: `deep-sky` is specified as being at the arrival
	// point, and the ship starts on it.
	await page.evaluate(() => window.__rememberBootPosition());
	// Once, before anything is placed. The clock then runs; what holds each
	// framing is that the camera is placed co-moving with its subject, not that
	// time stops.
	await page.evaluate((t) => window.__startClockAt(t), GAME_TIME_S);

	await mkdir(join(OUT, LABEL), { recursive: true });

	for (const view of VIEWS) {
		await setView(page, view.shot.view);
		const subject = await PLACERS[view.shot.kind](page, view.shot);
		// Three settle frames. The near/far handoff has a hysteresis band and the
		// station surface is built lazily, so the first frame after a jump can be
		// drawn before either has caught up.
		await page.evaluate(
			() =>
				new Promise((r) => {
					let n = 3;
					const tick = () => (n-- ? requestAnimationFrame(tick) : r());
					requestAnimationFrame(tick);
				}),
		);
		const file = `${LABEL}/${view.name}.png`;
		// Read at the shutter, not at the top of the run: the clock is normalised
		// and then left to run, so each frame has its own. The sheet prints the
		// span, because a caption claiming a fixture property the frames do not
		// have is the one lie the gate cannot survive.
		const gameTime = await page.evaluate(() => window.__seelite.world.gameTime);
		await page.screenshot({ path: join(OUT, file) });
		captured.push({ name: view.name, file, subject, gameTime });
		console.log(
			`  ${view.name.padEnd(20)} ${view.shot.view.padEnd(8)} ${subject}`,
		);
	}
} finally {
	// Every exit, not just the renderer refusal — a throw from a placer or a
	// screenshot used to leave a headed Chromium window standing on the desktop.
	await browser.close();
}

const dir = join(OUT, LABEL);

// A fault means every frame above is of a build that did not link. The PNGs are
// already on disk by now — they are written inside the loop — so the run
// directory goes with the sheet rather than being left for the next reader to
// find. Removing `index.html` too is the point: leaving a prior complete one
// standing is exactly what `rebuildSheet` refuses to do.
if (fault) {
	await rm(dir, { recursive: true, force: true });
	await rm(join(OUT, "index.html"), { force: true });
	throw new Error(
		`the page faulted during capture — the run and the sheet were removed: ${fault}`,
	);
}

const manifest = {
	label: LABEL,
	gitRef: REF,
	capturedAt: new Date().toISOString(),
	renderer,
	seed: SEED,
	views: captured,
};
await writeFile(
	join(dir, "manifest.json"),
	`${JSON.stringify(manifest, null, "\t")}\n`,
);

const runs = await rebuildSheet(OUT);

console.log(
	`\n  ${captured.length} views → ${dir}\n  renderer: ${renderer}\n  sheet: ${join(OUT, "index.html")} (${runs.length} run${runs.length === 1 ? "" : "s"})`,
);
