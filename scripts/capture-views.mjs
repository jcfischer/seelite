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
import { assertPlayersRenderer } from "./lib/players-renderer.mjs";
import { installViewFraming } from "./lib/view-placement.mjs";
import {
	assertServingThisTree,
	bootedGame,
	installViewPlacement,
	launchChromium,
} from "./probe-guard.mjs";

const ORIGIN = process.env.PROBE_ORIGIN ?? "http://localhost:5173";

/** `--out`, `--label` and `--quality`, both `--k v` and `--k=v`. Small enough to read here;
 *  `probe-args.mjs` parses a different grammar for a different runner. */
function arg(name, fallback) {
	const argv = process.argv.slice(2);
	const eq = argv.find((a) => a.startsWith(`--${name}=`));
	if (eq) return eq.slice(name.length + 3);
	const i = argv.indexOf(`--${name}`);
	if (i < 0) return fallback;
	const value = argv[i + 1];
	if (!value || value.startsWith("-"))
		throw new Error(`--${name} requires a value`);
	return value;
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
const QUALITY = arg("quality", null);
if (QUALITY !== null && QUALITY !== "high" && QUALITY !== "low")
	throw new Error(`--quality must be high or low, got ${QUALITY}`);

/** Apply an explicitly requested quality after every boot. The setting persists
 * across the refinery seed navigation, but writing it again there makes the
 * capture's renderer state an observation rather than an assumption. */
async function applyCaptureQuality(page) {
	if (QUALITY === null) return;
	await page.evaluate((quality) => {
		window.__seelite.settings.set("quality", quality);
	}, QUALITY);
}

/**
 * The seed the page is currently booted on, and the door every view goes
 * through to change it.
 *
 * **Hoisted out of the `berth` placer, and the reason is an ordering trap that
 * placer left behind.** A view that names its own seed navigates, and a
 * navigation re-runs the init scripts and re-boots the game — so every view
 * *after* it was captured on that view's world, not on `SEED`. Nothing went
 * wrong only because the one seed-declaring view was second to last and the
 * view after it navigates to the workbench anyway. That is a property of the
 * list's order, held by no check, and the next seed-declaring view added
 * anywhere else in the list would have silently re-seeded the frames below it.
 *
 * Restoring is the same act as declaring: a view with no `seed` wants `SEED`,
 * so it navigates back if the page is somewhere else, and nothing at any
 * position in the list depends on what ran before it. (A *jump* is what
 * `CONTEXT.md` reserves for moving between star systems; this is a page load.)
 *
 * `__rememberBootPosition` is re-run on every navigation, because one resets
 * the ship to the arrival point and drops what the previous boot remembered —
 * `deep-sky` reads it, and it is only safe at any position in the list if
 * every boot leaves one behind.
 */
let currentSeed = null;
async function ensureSeed(page, seed) {
	if (currentSeed === seed) return;
	await page.goto(`${ORIGIN}/?seed=${seed}`, { waitUntil: "load" });
	await bootedGame(page);
	await applyCaptureQuality(page);
	await page.evaluate(() => window.__rememberBootPosition());
	await page.evaluate((t) => window.__startClockAt(t), GAME_TIME_S);
	currentSeed = seed;
}

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
	berth: async (page, shot) => {
		const id = `station-${shot.station}`;
		await page.evaluate(
			async ([stationId, berthId, opts]) =>
				window.__parkInBerth(stationId, berthId, opts),
			[
				id,
				shot.berth,
				{
					stopAtArrivalFraction: shot.at,
					headLook: shot.headLook,
					launch: shot.launch,
				},
			],
		);
		return `${id} · ${shot.berth}`;
	},
	"workbench-interior": async (page, shot) => {
		// **It navigates**, which is why the set puts it last: every view above
		// needs the game and this one needs the game not to be there. The
		// workbench is query-gated and constructs no `Game` at all.
		await page.goto(`${ORIGIN}/?model-viewer=station`, { waitUntil: "load" });
		await page.waitForSelector("#model-viewer canvas");
		// **The fifth element is destructured, and it was not.** `variant` was
		// passed in the array and read as a free identifier inside the browser,
		// which is a `ReferenceError` at the last view of the set — so `npm run
		// views` has thrown before writing a manifest, and the sheet #98 makes
		// the gate has been uncapturable, since `95ba0ca` (#257) added it. It is
		// out of this node's scope and fixed here anyway: nothing else can put a
		// before/after pair in front of the principal.
		await page.evaluate(
			async ([asset, radii, azimuth, elevation, variant]) =>
				window.__frameWorkbenchInterior(
					asset,
					radii,
					azimuth,
					elevation,
					variant,
				),
			[
				shot.asset,
				shot.radii,
				shot.azimuth ?? 0,
				shot.elevation ?? 0,
				shot.variant ?? "a",
			],
		);
		return `workbench · ${shot.asset} ${shot.variant ?? "a"} interior`;
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

/**
 * Which tree the server is serving — refused if it is not this one, and kept,
 * because the sheet prints it.
 *
 * **The value is the point here and not only the refusal.** A probe asserts
 * numbers a later reader can re-derive; a contact sheet is looked at by a
 * person with no way to tell which checkout the pixels came from. #123's
 * wrong-tree capture was caught by an arithmetic tell in a *probe*, not by
 * anyone looking at the sheet it produced. So the declaration goes into the
 * manifest and onto the sheet beside this process's own git ref: when the two
 * disagree, the frames were taken of something other than what was captured.
 *
 * There is no file list any more — the guard used to fingerprint one and the
 * four modules with no top-level numeric constants were unguardable, which for
 * this script meant the cockpit interior and the planet shaders. A declaration
 * is a property of the server, so that gap closed with it.
 */
const served = await assertServingThisTree(ORIGIN);

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
await applyCaptureQuality(page);
currentSeed = SEED;
let renderer;
const captured = [];
try {
	// The refusal itself is `lib/players-renderer.mjs`, shared with
	// `measure-light-cost.mjs`. What it protects here is that the sheet is judged
	// by eye, and a frame from anything but the player's renderer is the wrong
	// picture — bloom, tone mapping and mip-sampled surfaces all differ from
	// ANGLE Metal.
	renderer = await assertPlayersRenderer(page, "capture");
	// Before anything moves: `deep-sky` is specified as being at the arrival
	// point, and the ship starts on it.
	await page.evaluate(() => window.__rememberBootPosition());
	// Once, before anything is placed. The clock then runs; what holds each
	// framing is that the camera is placed co-moving with its subject, not that
	// time stops.
	await page.evaluate((t) => window.__startClockAt(t), GAME_TIME_S);

	await mkdir(join(OUT, LABEL), { recursive: true });

	for (const view of VIEWS) {
		// **Not on the workbench**, which has no view cycle: `v` there is an
		// unbound key, so `setView` would press it eight times and then throw
		// about a view the game does not have — on a page that is not the game.
		if (view.shot.kind !== "workbench-interior") {
			// Before the view is set, because a page load resets the game to the
			// cockpit and would undo it.
			await ensureSeed(page, view.shot.seed ?? SEED);
			await setView(page, view.shot.view);
		} else {
			// The workbench is not the game and carries no seed. Its own
			// navigation leaves the page somewhere `ensureSeed` cannot reason
			// about, so the next view — there is none today — starts by navigating.
			currentSeed = null;
		}
		const subject = await PLACERS[view.shot.kind](page, view.shot);
		// **Again, after placing**, because placing can move the view. The
		// refinery frame came back as the docked station console filling a frame
		// declared `chase` — diagnosed then as the seed navigation, which now
		// happens above this loop body rather than inside a placer, and left
		// standing because `berth` also *docks*, and a docked session owns the
		// screen for a reason that has nothing to do with a reload. Idempotent,
		// so every other view pays one property read for it.
		if (view.shot.kind !== "workbench-interior")
			await setView(page, view.shot.view);
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
		/**
		 * **No frame is written while a cube bake is still filling** (#208).
		 *
		 * A bake draws one face a frame and a system holds up to fourteen bakeable
		 * bodies, so a capture taken three frames after a placement finds every
		 * planet on the *procedural* program. The sheet would then show the before
		 * build twice, `views:diff` would read 0.00%, and the honest reading of
		 * that is "no change" — which is the one lie a before/after sheet cannot
		 * survive, and it fails in the direction that looks like success.
		 *
		 * Waited on rather than driven, so the game's own loop is what advances it.
		 * Absent on the workbench page, which constructs no `Game`.
		 */
		await page.waitForFunction(
			() => (window.__seelite?.bakeQueue?.length ?? 0) === 0,
			undefined,
			{ timeout: 60_000 },
		);
		/**
		 * And every bakeable body in the world is actually drawn from its cube.
		 *
		 * An empty queue says the schedule finished, not that the band chose the
		 * cube — a planet inside two radii is procedural by design and must not
		 * fail this. So the refusal is narrowed to bodies the band *did* put on the
		 * baked path: it catches a body whose bake was dropped and never restarted,
		 * which is the state a handoff bug leaves behind and the one a frame cannot
		 * be judged in.
		 */
		const unbaked = await page.evaluate(() => {
			const g = window.__seelite;
			if (!g) return [];
			const out = [];
			for (const [id, visual] of g.bodyVisuals)
				if (visual.canBake() && visual.bakedFacePx() === 0) out.push(id);
			return out;
		});
		if (unbaked.length > 0)
			throw new Error(
				`${view.name}: ${unbaked.join(", ")} can bake and hold no cube — the ` +
					'frame would show the procedural program under an "after" label',
			);
		const file = `${LABEL}/${view.name}.png`;
		// Read at the shutter, not at the top of the run: the clock is normalised
		// and then left to run, so each frame has its own. The sheet prints the
		// span, because a caption claiming a fixture property the frames do not
		// have is the one lie the gate cannot survive.
		// **Optional, because a workbench frame has no world.** `?model-viewer=`
		// constructs no `Game` at all — that is the whole point of the gate — so
		// there is no clock to read and `null` is the honest answer. The sheet's
		// span filters them, which is the same path a run captured before the
		// clock was recorded takes.
		const gameTime = await page.evaluate(
			() => window.__seelite?.world.gameTime ?? null,
		);
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
	/**
	 * The tree the *server* said it was serving, beside `gitRef`, which is the
	 * tree this *process* was run from. Two fields rather than one because the
	 * failure they exist for is exactly the two disagreeing — a capture script
	 * run in one checkout against a dev server left running in another.
	 */
	served,
	capturedAt: new Date().toISOString(),
	renderer,
	seed: SEED,
	quality: QUALITY ?? "default",
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
