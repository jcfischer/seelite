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
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
	GAME_TIME_S,
	SEED,
	VIEWPORT,
	VIEWS,
	contactSheet,
} from "./lib/view-set.mjs";
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
 * parent commit says so. `--label before` is still accepted, because a working
 * tree with uncommitted changes is the normal case for the *after* half.
 */
function gitRef() {
	try {
		return execFileSync("git", ["rev-parse", "--short", "HEAD"], {
			encoding: "utf8",
		}).trim();
	} catch {
		return "no-git";
	}
}

const REF = gitRef();
const LABEL = arg("label", REF);
const OUT = arg("out", "view-set");

/** Renderers that are not the player's. A refusal, per the header. */
const SOFTWARE = /swiftshader|llvmpipe|software|mesa offscreen/i;

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

// A shader that fails to link is reported through `console.error` and the scene
// carries on drawing something. Here that would be a sheet of plausible frames
// of the wrong build, so it is fatal rather than counted.
page.on("console", (m) => {
	if (m.type() !== "error") return;
	if (!/shader|glsl|link status|validate_status/i.test(m.text())) return;
	console.error(
		`\n  shader error — the sheet would be of a broken build:\n  ${m.text().slice(0, 400)}`,
	);
	process.exitCode = 1;
});
page.on("pageerror", (e) => {
	console.error(`\n  page error: ${e.message}`);
	process.exitCode = 1;
});

await installViewPlacement(page);
await page.goto(`${ORIGIN}/?seed=${SEED}`, { waitUntil: "load" });
await bootedGame(page);
// Once, before anything is placed. The clock then runs; what holds each framing
// is that the camera is placed co-moving with its subject, not that time stops.
await page.evaluate((t) => window.__startClockAt(t), GAME_TIME_S);

const renderer = await page.evaluate(() => {
	const gl = window.__seelite.renderer.getContext();
	const ext = gl.getExtension("WEBGL_debug_renderer_info");
	return ext
		? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)
		: gl.getParameter(gl.RENDERER);
});
if (SOFTWARE.test(renderer)) {
	await browser.close();
	throw new Error(
		`refusing to capture through a software rasteriser (${renderer}).\n` +
			"The sheet is judged by eye, and this is not the renderer the player gets —\n" +
			"bloom, tone mapping and mip-sampled surfaces all differ from ANGLE Metal.\n" +
			"Run this on a machine with a display; there is deliberately no headless mode.",
	);
}

/** Put the game in a view. Through the key, not the field, so the transition the
 *  game runs on a real toggle runs here too — `v` also resets head-look. */
async function setView(want) {
	const now = await page.evaluate(() => window.__seelite.view);
	if (now === want) return;
	await page.keyboard.press("v");
	await page.waitForFunction((w) => window.__seelite.view === w, want);
}

async function place(shot) {
	if (shot.kind === "station-axis") {
		const id = `station-${shot.station}`;
		await page.evaluate(
			async ([bodyId, radii]) =>
				window.__viewAlongAxis(bodyId, window.__radiusOf(bodyId) * radii, {
					comoving: true,
				}),
			[id, shot.radii],
		);
		return id;
	}
	if (shot.kind === "body-offset") {
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
	}
	if (shot.kind === "deep-sky") {
		await page.evaluate(async () => {
			const g = window.__seelite;
			const d = window.__emptiestDirection();
			const p = g.world.ship.pos;
			await window.__lookAt({
				x: p.x + d.x * 1e9,
				y: p.y + d.y * 1e9,
				z: p.z + d.z * 1e9,
			});
		});
		return "empty sky";
	}
	throw new Error(`unknown shot kind: ${shot.kind}`);
}

const dir = join(OUT, LABEL);
await mkdir(dir, { recursive: true });

const captured = [];
for (const view of VIEWS) {
	await setView(view.shot.view);
	const subject = await place(view.shot);
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
	await page.screenshot({ path: join(OUT, file) });
	captured.push({ name: view.name, file, subject });
	console.log(
		`  ${view.name.padEnd(20)} ${view.shot.view.padEnd(8)} ${subject}`,
	);
}

await browser.close();

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

/**
 * Every run present in the output directory, newest last.
 *
 * The sheet is rebuilt from what is on disk rather than from this run alone, so
 * capturing an `after` beside an existing `before` produces the pair without
 * either capture knowing about the other.
 */
const runs = [];
for (const entry of (await readdir(OUT, { withFileTypes: true })).sort(
	(a, b) => (a.name < b.name ? -1 : 1),
)) {
	if (!entry.isDirectory()) continue;
	try {
		runs.push(
			JSON.parse(
				await readFile(join(OUT, entry.name, "manifest.json"), "utf8"),
			),
		);
	} catch {
		// A directory with no manifest is not a run — someone's scratch folder, or
		// a capture that died before it wrote one. Skipping it is right; failing
		// on it would make an unrelated folder break the sheet.
	}
}
await writeFile(join(OUT, "index.html"), contactSheet(runs));

console.log(
	`\n  ${captured.length} views → ${dir}\n  renderer: ${renderer}\n  sheet: ${join(OUT, "index.html")} (${runs.length} run${runs.length === 1 ? "" : "s"})`,
);
