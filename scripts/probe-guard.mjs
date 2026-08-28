/**
 * Is the dev server we are about to probe actually serving *this* working tree?
 *
 * Vendored from seekolous (`scripts/probe-guard.mjs`). Two changes: the
 * constant matcher now accepts `export const` (its own note below says why),
 * and the god-game page helper is replaced by `bootedGame`. The history below
 * is seekolous's, kept because it is the argument for the file existing at all
 * — seelite has not paid that cost yet and would rather not.
 *
 * ## Why this exists
 *
 * It was not, for an unknown stretch of one session, and nothing said so. A
 * `npm run dev` left running in a git worktree under `.claude/worktrees/` held
 * port 5173, every probe defaulted to that port, and the results looked
 * plausible throughout — the worktree's checkout was close enough to the branch
 * under test that the numbers were in the right range.
 *
 * It surfaced only because a deliberately broken control kept passing: a banner
 * bound at `flex: 0` still swung 101px, and `MAX_FORESTS = 2` still produced four
 * forests. Three separate "the fix does nothing" conclusions were drawn from that
 * before the port was checked, and every one of them was wrong.
 *
 * A probe that silently measures a different checkout is worse than one that does
 * not run, because it reports numbers either way.
 *
 * ## What it compares
 *
 * Top-level `const NAME = <number>` declarations, between the file on disk and
 * the module the server hands back. Vite strips types and comments but leaves
 * identifiers and numeric literals alone, so these survive transformation — and
 * they are exactly what a probe's expectations are usually written against.
 *
 * It cannot catch every divergence, and does not claim to: two checkouts that
 * differ only inside a function body will pass, and so will one whose sole change
 * is inside a file the guard was not pointed at. What it does catch is the case
 * that actually happened — a whole other checkout on the port — and it catches it
 * on every probe that calls it.
 *
 * "Every probe" is load-bearing and was not true when this was written: it guarded
 * three of the twenty-one that talk to a dev server, while the note above claimed
 * coverage. A safeguard that protects a seventh of the runs and reads as universal
 * is its own kind of false confidence.
 *
 * The one caller without a guard is `probe-all`, and deliberately: given no target
 * it starts its own Vite server from this directory, which cannot be the wrong
 * tree, and given one it spawns probes that each carry this check.
 */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/**
 * The scheme-and-host of a probe URL, without `new URL`.
 *
 * Every probe here declares its own `const URL = ...`, which shadows the global
 * constructor — so reaching for it inside a probe throws "URL is not a
 * constructor" at the one moment this guard is supposed to be explaining
 * something else.
 */
export const originOf = (u) => u.replace(/^(https?:\/\/[^/]+).*$/, "$1");

/**
 * `const NAME = 1.5;` / `const NAME = -3;` / `const NAME = 6e3;` — top level,
 * numeric only.
 *
 * The exponent branch is required, not defensive: esbuild serves `6000` as
 * `6e3`, so a pattern without it reads the served module as *missing* the
 * constant and this guard accuses a correct server of being the wrong tree.
 * The leading-dot branch (`const NAME = .5;`) is the other direction and *is*
 * defensive — a leading-zero strip is a normal minifier move and has not been
 * observed here, but a matcher that silently drops a constant is the failure
 * this file exists to prevent. `Number()` below normalises every form, so they
 * compare equal once matched.
 *
 * **`export const` counts too**, which is seelite's one divergence from
 * seekolous's copy of this file. Its fingerprint files were modules whose
 * tuning constants happened to be private; here the load-bearing numbers are
 * the unit scheme in `src/units.ts`, and every one of them is exported. Without
 * this branch the guard reads that file as declaring no constants at all and
 * throws "point the guard at a file that has some" — refusing to run against a
 * perfectly good server. Vite serves the `export` keyword through unchanged in
 * dev, so both sides of the comparison see the same form.
 */
const CONSTS =
	/^(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*(-?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?)\s*;/gm;

const numericConsts = (source) => {
	const out = new Map();
	for (const [, name, value] of source.matchAll(CONSTS))
		out.set(name, Number(value));
	return out;
};

/**
 * Throws unless the served modules agree with the local files.
 *
 * `files` are repo-relative paths the server can also resolve, e.g.
 * `["src/wind.ts"]`. Pass the ones a probe's expectations actually rest on.
 */
export async function assertServingThisTree(origin, files) {
	const problems = [];
	for (const file of files) {
		let served;
		try {
			const res = await fetch(`${origin}/${file}`);
			if (!res.ok) {
				problems.push(`${file}: server answered ${res.status}`);
				continue;
			}
			served = await res.text();
		} catch (e) {
			problems.push(`${file}: could not fetch — ${e.message}`);
			continue;
		}
		const local = numericConsts(await readFile(file, "utf8"));
		const remote = numericConsts(served);
		// A file with no top-level numeric constants cannot be compared this way,
		// and saying "wrong tree" about it would be a lie. `src/wind.ts` is exactly
		// that — its numbers are class fields, not module constants — and pointing
		// the guard at it produced a confident, wrong accusation on a correct server.
		// That is the failure mode this whole file exists to prevent, so it gets its
		// own message and names the caller's choice rather than the server.
		if (local.size === 0) {
			throw new Error(
				`probe-guard cannot use ${file}: it declares no top-level numeric ` +
					`constants, so there is nothing to compare. Point the guard at a file ` +
					`that has some.`,
			);
		}
		if (remote.size === 0) {
			problems.push(`${file}: served module declared no numeric constants`);
			continue;
		}
		for (const [name, value] of local) {
			if (!remote.has(name)) {
				problems.push(`${file}: ${name} is missing from the served module`);
			} else if (remote.get(name) !== value) {
				problems.push(
					`${file}: ${name} is ${value} here and ${remote.get(name)} there`,
				);
			}
		}
	}
	if (!problems.length) return;
	throw new Error(
		`The dev server at ${origin} is not serving this working tree.\n` +
			problems.map((p) => `  - ${p}`).join("\n") +
			`\n\nMost likely another 'npm run dev' owns that port. Find it with:\n` +
			`  lsof -a -p $(lsof -nP -iTCP:$(echo ${origin} | sed 's/.*://') ` +
			`-sTCP:LISTEN -t | head -1) -d cwd\n` +
			`Then stop it, or point the probe elsewhere with PROBE_ORIGIN.`,
	);
}

/**
 * The whole preamble a probe needs: work out the origin, and refuse to measure
 * anything until the server there is serving this checkout.
 *
 * One call rather than three lines repeated in every probe. The three lines were
 * identical in all of them, which meant a change of guard policy needed
 * synchronised edits across files whose only shared concern is this.
 *
 * Pass the probe's own `ORIGIN` default; `PROBE_URL` overrides it, and only its
 * scheme-and-host is used.
 */
export async function guardedOrigin(origin, files = FINGERPRINT) {
	const resolved = originOf(process.env.PROBE_URL ?? origin);
	await assertServingThisTree(resolved, files);
	return resolved;
}

/**
 * A path becomes an absolute file URL; a package name stays a package name.
 *
 * Node's own rule for what counts as a path: leading `./`, `../`, or `/`.
 * Anything else is a bare specifier and must stay one, or `playwright` would
 * stop resolving through `node_modules`.
 *
 * Relative values resolve against the process's working directory — what someone
 * typing one into a shell means by it. That is a change from `await import(PW)`
 * in the scripts this replaced, which resolved them against `scripts/`; an
 * existing relative `PLAYWRIGHT_DIR` therefore points somewhere new. Absolute
 * values, which is what every usage note here shows, are unaffected.
 */
const specifierFor = (spec) =>
	/^\.{1,2}\//.test(spec) || spec.startsWith("/")
		? pathToFileURL(resolve(spec)).href
		: spec;

/**
 * Node's own message, with what was set in front of it.
 *
 * Node names the specifier it could not resolve, which is usually the useful
 * thing — but not always the operator's: a bare `node_modules/playwright` is a
 * package subpath, so the message names `node_modules`. Prefixing is what makes
 * "the error tells you which variable did this" true for every path through here
 * rather than for the ones that happened to get tested.
 */
const attributed = (e, source) =>
	Object.assign(e, { message: `${source} — ${e.message}` });

/**
 * The playwright module, from a bare name or from a path that may be a directory.
 *
 * A directory needs its entry named, because ESM neither imports a directory nor
 * reads the package's `exports` map for one. `index.mjs` is tried first: that is
 * what playwright's `exports["."].import` points at, so a directory lands on the
 * same module a bare-name import would rather than on the CommonJS entry beside
 * it.
 */
async function importPlaywright(spec, source) {
	const target = specifierFor(spec);
	try {
		return await import(target);
	} catch (e) {
		if (e.code !== "ERR_UNSUPPORTED_DIR_IMPORT") throw attributed(e, source);
		// A bare specifier can be a directory too — a package subpath with no
		// `exports` map, like `playwright/lib`. There is no file path to hang
		// entry names off, so it keeps its own error instead of being fed to
		// `fileURLToPath`, which would throw about the URL rather than about this.
		if (!target.startsWith("file:")) throw attributed(e, source);
	}
	const entries = ["index.mjs", "index.js"];
	for (const entry of entries) {
		const url = `${target}/${entry}`;
		// On disk, not by catching `ERR_MODULE_NOT_FOUND`: an entry raises that
		// same code when *its own* imports are missing, and a half-installed
		// playwright reported as "no index.mjs in it" sends the operator to check
		// a file sitting right there. A present entry keeps its own error — which
		// is the useful one — with the variable named in front of it.
		if (existsSync(fileURLToPath(url)))
			try {
				return await import(url);
			} catch (e) {
				throw attributed(e, source);
			}
	}
	throw new Error(
		`${source} is a directory with no ${entries.join(" or ")} in it — if it is ` +
			`playwright's package root, its entry is named something else, so point ` +
			`the variable at that file instead.`,
	);
}

/**
 * The variables that point this launcher at a playwright, in precedence order.
 *
 * The order is the rule: the first one set wins, so `PLAYWRIGHT_MODULE` is a
 * fallback rather than an override. That matters because setting both is the
 * obvious way to cover a fleet split across the two names, and in that
 * configuration the second is simply ignored.
 *
 * Exported so that tooling checking this policy reads it from here rather than
 * keeping its own copy of the names — which is how the two drift apart.
 */
export const PLAYWRIGHT_ENV_VARS = ["PLAYWRIGHT_DIR", "PLAYWRIGHT_MODULE"];

/**
 * Playwright, however this machine happens to have it. Every script that opens a
 * browser asks here, so a machine needing a different answer needs it once.
 *
 * Each variable names either a package directory or an entry file. Playwright is
 * a devDependency, so leaving them unset and letting the bare name resolve is the
 * normal case; these are the escape hatch for checkouts without one, and a
 * directory works because that is what `_DIR` implies.
 *
 * Outside this file, nothing in the repo names `PLAYWRIGHT_MODULE` — no script,
 * no usage note, no workflow — so deleting the alias would break nothing here.
 * It is kept for the shell profiles and CI configs this repo cannot see, where
 * dropping it would silently stop reading a variable someone still exports.
 *
 * Both module shapes are accepted because a path bypasses the package's `exports`
 * map and lands on the CommonJS entry, where the namespace arrives under
 * `default` instead of as named exports. #147 has the history.
 */
export async function launchChromium(options = {}) {
	// `name` stays null when neither variable is set, so a failure on the bare
	// name says so instead of blaming a variable the operator never typed.
	const name = PLAYWRIGHT_ENV_VARS.find((v) => process.env[v]) ?? null;
	const spec = name ? process.env[name] : "playwright";
	const source = name ? `${name}=${spec}` : 'bare "playwright"';

	const pw = await importPlaywright(spec, source);
	const chromium = pw.chromium ?? pw.default?.chromium;
	if (!chromium)
		// The remedy differs by case: telling someone whose bare name just
		// resolved to install playwright names a problem they do not have.
		throw new Error(
			`${source} resolved to a module with no chromium export — ${
				name
					? `point ${name} at playwright's package directory, or unset it and install playwright here.`
					: `whatever this checkout has under that name is not the browser package.`
			}`,
		);
	return chromium.launch(options);
}

/**
 * Wait until the game has published its handle and drawn at least one frame.
 *
 * The shared version of what every probe needs before it can measure anything.
 * Waiting on `__seelite` alone is not enough: the handle is assigned in the
 * module's top-level code, which runs before the first `requestAnimationFrame`
 * callback, so a probe that stopped there would read a world whose meshes have
 * never been positioned.
 */
export async function bootedGame(page, timeout = 20000) {
	await page.waitForFunction(
		() => window.__seelite && window.__seelite.frames > 0,
		null,
		{ timeout },
	);
}

/**
 * The default pair to fingerprint a checkout with.
 *
 * The question is "is this the same tree?", not "is this probe's own subject
 * current" — so the files are chosen for having many top-level numeric
 * constants rather than for relevance to any one probe. `units.ts` is the unit
 * scheme and `main.ts` the renderer's tuning; between them they carry most of
 * the numbers a probe's expectations rest on. A probe with a sharper interest
 * can pass its own list.
 */
const FINGERPRINT = ["src/units.ts", "src/main.ts"];

/**
 * The check counter, the reporter and the exit summary, in one object.
 *
 * Every probe needs the same three things and the second one copied them
 * verbatim: `let failures = 0; let checks = 0; const check = …`, a `pageerror`
 * handler that counts, and a `${passed}/${total} checks passed` tail with
 * `process.exit(failures ? 1 : 0)`. A third copy was one probe away, and the
 * output format is exactly the kind of thing that gets changed in one file and
 * not the others — after which the runner's summary and the probes' own lines
 * disagree about what a failure looks like.
 *
 * `watch(page)` wires a `pageerror` listener that counts as a failure, because
 * a probe that reads numbers off a game whose loop has thrown will answer most
 * questions with plausible values.
 *
 *   const t = tally();
 *   t.watch(page);
 *   t.check("the thing holds", actual === expected, `got ${actual}`);
 *   t.exit();   // prints the summary, exits 1 if anything failed
 */
export function tally() {
	let failures = 0;
	let checks = 0;
	/**
	 * One definition, because both `watch` and `watchShaders` install it and a
	 * retune that reached one and not the other would leave half the suite on
	 * an older filter. The long note on `watch` documents this listener.
	 */
	const shaderListener = (page, tag) =>
		page.on("console", (message) => {
			if (message.type() !== "error") return;
			const text = message.text();
			if (!/shader|glsl|link status|validate_status/i.test(text)) return;
			checks++;
			failures++;
			console.log(`SHADERERROR ${tag}${text.slice(0, 400)}`);
		});
	return {
		check(label, ok, detail) {
			checks++;
			if (!ok) failures++;
			console.log(
				`${ok ? "  ok  " : " FAIL "} ${label}${detail ? ` — ${detail}` : ""}`,
			);
		},
		/**
		 * The shader listener alone, for a probe that reports page errors its
		 * own way. `probe-planets` collects them in an array and names them at
		 * two milestones rather than one per event, which is a reporting choice
		 * worth keeping; it should not have to give that up to be guarded
		 * against a silent shader failure.
		 */
		watchShaders(page, label) {
			const tag = label ? `${label}: ` : "";
			shaderListener(page, tag);
		},
		watch(page, label) {
			const tag = label ? `${label}: ` : "";
			/**
			 * A shader that fails to compile is not a page error.
			 *
			 * Three.js reports a bad program through `console.error` and carries
			 * on, so a patched material that stopped linking would render — a
			 * fallback, a flat body, nothing at all — while every check in every
			 * probe stayed green. `pageerror` never sees it, because nothing
			 * threw.
			 *
			 * Narrow on purpose: a probe is not a lint pass, and failing on any
			 * console error would make an unrelated warning elsewhere in the
			 * page red here. This matches the one class that is otherwise
			 * silent and is always a defect.
			 *
			 * **Errors only**, and narrowly matched. `warning` is deliberately
			 * excluded: three.js warns `Program Info Log:` on the branch where
			 * the link *succeeded* and the driver merely returned a non-empty
			 * log, which is ordinary on SwiftShader — including it reports a
			 * green tree red.
			 *
			 * **It matches text, so it fails open**: three.js rewords this and
			 * the hole is back. The backstop is one probe —
			 * `probe-station-visuals` asks the GL context for `LINK_STATUS` and
			 * names the rock's own program. Every other probe has this and
			 * nothing else.
			 *
			 * A listener reaches a probe only through `watch` or
			 * `watchShaders`. `check-launcher-wiring.mjs` refuses a probe that
			 * opens pages and installs fewer watches than page-opening sites —
			 * which is what had gone wrong, and is less than "every page": read
			 * its own note for what a source count cannot see. `npm run probe`
			 * runs it first. PR #63 has the history of what was tried here and
			 * reverted.
			 */
			shaderListener(page, tag);
			page.on("pageerror", (e) => {
				// Counted as a check too, not just a failure. Incrementing `failures`
				// alone makes `${checks - failures}/${checks}` report a failing check
				// that was never run — and with enough page errors the numerator goes
				// negative. A thrown page error *is* a failed expectation about the
				// page; it just did not have a label until now.
				checks++;
				failures++;
				console.log(`PAGEERROR ${tag}${e.message}`);
			});
		},
		get failures() {
			return failures;
		},
		exit() {
			console.log(`\n${checks - failures}/${checks} checks passed`);
			process.exit(failures ? 1 : 0);
		},
	};
}

/**
 * Install `window.__recoverCamSim()` in the page: the camera's sim position,
 * recovered from the ship mesh.
 *
 * The camera is at the origin in *render* space and somewhere else entirely in
 * sim space, and `cameraPos` is private. The only honest recovery from outside
 * is through a mesh whose sim position is known: the ship is drawn at
 * `shipSim − camSim`, so `camSim = shipSim − shipMesh`. Both probes need it and
 * both had their own copy, one of which said in a comment that it was a copy.
 *
 * Installed as an **init script** rather than exported as a function to call,
 * because the recovery has to happen in the *same* `page.evaluate` as the mesh
 * positions it is compared against — a separate round trip would recover the
 * camera from one frame and the meshes from the next, and that difference is
 * exactly the quantity under test. An init script puts one definition inside the
 * page, where any evaluate can call it without a second crossing.
 *
 * Call before `page.goto`; it re-runs on every navigation.
 */
export async function installCamSim(page) {
	await page.addInitScript(() => {
		window.__recoverCamSim = () => {
			const g = window.__seelite;
			const m = g && g.nearScene.getObjectByName("ship");
			if (!m) return null;
			return {
				x: g.world.ship.pos.x - m.position.x,
				y: g.world.ship.pos.y - m.position.y,
				z: g.world.ship.pos.z - m.position.z,
			};
		};
	});
}

/**
 * Install the page-side placement helpers a fixed-camera capture needs.
 *
 * `__placeShipAt` and `__viewAlongAxis` were written inside
 * `probe-station-visuals.mjs` and lived there alone until #104 needed the same
 * two. They are here rather than copied for the reason `installCamSim` is here:
 * a second copy is a second thing to retune, and the copy that does not get
 * retuned is the one that goes quietly wrong.
 *
 * The rest are #104's, and each closes a hole the station probe never had:
 *
 * - `__startClockAt` — body positions are `f(systemSeed, gameTime)`, so two
 *   captures that boot to different clocks compare two different worlds. It
 *   normalises the start and nothing more; the note on it has why holding the
 *   clock down instead is actively harmful.
 * - `__radiusOf` — the apparent size of a subject is what makes two shots
 *   comparable, and a station's is its *silhouette*, not its core radius. The
 *   two differ by a factor of three on a shipyard.
 * - `__lookAt` — `__viewAlongAxis` can only point at a station's aperture. Half
 *   the view set is pointed at something else.
 * - `__sunOffset` — places the camera at a stated angle between the subject and
 *   the star. That angle is the single largest thing deciding what a surface
 *   looks like, and #99's fill exists because of what the frame looks like at
 *   180 degrees of it.
 * - `__emptiestDirection` — the backdrop is the only subject with no position to
 *   aim at, so it is aimed at by *absence*: the heading furthest from the star
 *   and every body.
 *
 * Call before `page.goto`; it re-runs on every navigation.
 */
export async function installViewPlacement(page) {
	await page.addInitScript(() => {
		const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
		const norm = (v) => {
			const l = Math.hypot(v.x, v.y, v.z);
			return { x: v.x / l, y: v.y / l, z: v.z / l };
		};

		window.__meshOfBody = (id) =>
			window.__seelite.nearScene.getObjectByName(id) ??
			window.__seelite.farScene.getObjectByName(id) ??
			null;

		/**
		 * Put the ship at a sim point, optionally moving with something.
		 *
		 * `vel` defaults to zero, which is what every caller wanted before #104
		 * and is still right for a subject the size of a planet. It is wrong for a
		 * station: `Game.stationVelocity`'s own docstring says why — at 1 AU the
		 * station is carried at ~30 km/s, so a ship parked at zero sim velocity is
		 * closing on it at three hundred times the docking gate. Over the four
		 * frames a shot takes that moved a camera placed 7.44 km out to 0.66 km,
		 * measured while building the view set.
		 */
		window.__placeShipAt = async (pos, vel) => {
			const g = window.__seelite;
			g.world.ship.pos = pos;
			g.world.ship.vel = vel ?? { x: 0, y: 0, z: 0 };
			await frame();
			await frame();
		};

		/** Put the camera on a station's aperture axis at `rangeKm` and look back
		 *  down it — the view a docking approach has, and the one viewpoint
		 *  defined for all three types. The axis comes from `poseOfStation`. */
		window.__viewAlongAxis = async (bodyId, rangeKm, opts) => {
			const g = window.__seelite;
			const body = g.world.system.bodies.find((b) => b.id === bodyId);
			const pose = g.poseOfStation(bodyId);
			// Opt-in rather than the default, because the probes that had this
			// helper first are measuring against the range they set and a silent
			// change of what "parked" means would move their numbers.
			const vel = opts?.comoving ? g.stationVelocity(bodyId) : undefined;
			await window.__placeShipAt(
				{
					x: body.pos.x + pose.axis.x * rangeKm,
					y: body.pos.y + pose.axis.y * rangeKm,
					z: body.pos.z + pose.axis.z * rangeKm,
				},
				vel,
			);
			const from = g.nearScene.position.clone().set(0, 0, -1);
			const to = g.nearScene.position
				.clone()
				.set(-pose.axis.x, -pose.axis.y, -pose.axis.z);
			g.orientation.setFromUnitVectors(from, to);
			await frame();
		};

		/**
		 * Start both runs of a before/after pair from the same world clock.
		 *
		 * One assignment, not a standing hold. Holding it every frame was tried
		 * first and is worse than not pinning at all: with the clock nailed down
		 * the bodies are re-placed at the same `t` each frame while the ship keeps
		 * its own state, and a camera placed 7.44 km off a station ended up 0.66 km
		 * off it — on its hull — in four frames. What actually holds a framing is
		 * placing the camera *co-moving* with its subject, which `__placeShipAt`
		 * now does; the clock only has to start in the same place.
		 *
		 * So the clock runs during a capture. The cost is bounded and small: the
		 * script paces itself the same way on both runs, and what moves in the
		 * seconds it takes is orbital phase measured in tens of kilometres against
		 * subjects framed from hundreds.
		 */
		window.__startClockAt = async (t) => {
			window.__seelite.world.gameTime = t;
			await frame();
			await frame();
		};

		window.__bodyById = (id) =>
			window.__seelite.world.system.bodies.find((b) => b.id === id) ?? null;

		window.__radiusOf = (id) => {
			const g = window.__seelite;
			const body = window.__bodyById(id);
			if (!body) return null;
			return body.kind === "station"
				? g.visualOfStation(id).silhouetteKm
				: body.radiusKm;
		};

		/** Turn the camera from where the ship already is toward a sim point. */
		window.__lookAt = async (target) => {
			const g = window.__seelite;
			const p = g.world.ship.pos;
			const d = norm({
				x: target.x - p.x,
				y: target.y - p.y,
				z: target.z - p.z,
			});
			const from = g.nearScene.position.clone().set(0, 0, -1);
			const to = g.nearScene.position.clone().set(d.x, d.y, d.z);
			g.orientation.setFromUnitVectors(from, to);
			await frame();
		};

		/**
		 * Stand `radii` subject-radii off `bodyId`, at `sunAngleDeg` between the
		 * star and the camera as seen from the subject, and look at it.
		 *
		 * Sim space is star-centred (`sim.ts` §7.4), so the subject's direction to
		 * the star is simply the reverse of its own position. Zero degrees puts
		 * the camera on the star's side and the subject fully lit; 180 puts the
		 * star beyond the subject and the subject a silhouette.
		 *
		 * The perpendicular is built from whichever world axis is least parallel
		 * to the sun line, so the frame never degenerates — a fixed choice of
		 * axis collapses for any subject that happens to lie along it, and which
		 * subjects those are is a property of the seed.
		 */
		window.__sunOffset = async (bodyId, radii, sunAngleDeg) => {
			const body = window.__bodyById(bodyId);
			const sun = norm({ x: -body.pos.x, y: -body.pos.y, z: -body.pos.z });
			const axes = [
				{ x: 1, y: 0, z: 0 },
				{ x: 0, y: 1, z: 0 },
				{ x: 0, y: 0, z: 1 },
			];
			const up = axes.reduce((best, a) =>
				Math.abs(a.x * sun.x + a.y * sun.y + a.z * sun.z) <
				Math.abs(best.x * sun.x + best.y * sun.y + best.z * sun.z)
					? a
					: best,
			);
			const perp = norm({
				x: sun.y * up.z - sun.z * up.y,
				y: sun.z * up.x - sun.x * up.z,
				z: sun.x * up.y - sun.y * up.x,
			});
			const a = (sunAngleDeg * Math.PI) / 180;
			const dir = {
				x: sun.x * Math.cos(a) + perp.x * Math.sin(a),
				y: sun.y * Math.cos(a) + perp.y * Math.sin(a),
				z: sun.z * Math.cos(a) + perp.z * Math.sin(a),
			};
			const range = window.__radiusOf(bodyId) * radii;
			await window.__placeShipAt({
				x: body.pos.x + dir.x * range,
				y: body.pos.y + dir.y * range,
				z: body.pos.z + dir.z * range,
			});
			await window.__lookAt(body.pos);
		};

		/**
		 * The heading furthest from the star and every body, by search.
		 *
		 * Aiming at empty sky has no target to aim at, so it is found rather than
		 * computed: a Fibonacci sphere of candidate headings, scored by the
		 * closest thing in that direction, and the best kept. Cheap, and it does
		 * not care how many bodies the seed produced or where they went.
		 */
		window.__emptiestDirection = () => {
			const g = window.__seelite;
			const p = g.world.ship.pos;
			const subjects = [
				{ x: 0, y: 0, z: 0 },
				...g.world.system.bodies.map((b) => b.pos),
			];
			const dirs = subjects.map((s) =>
				norm({ x: s.x - p.x, y: s.y - p.y, z: s.z - p.z }),
			);
			const N = 512;
			const phi = Math.PI * (3 - Math.sqrt(5));
			let best = null;
			let bestScore = Number.POSITIVE_INFINITY;
			for (let i = 0; i < N; i++) {
				const y = 1 - (i / (N - 1)) * 2;
				const r = Math.sqrt(Math.max(0, 1 - y * y));
				const t = phi * i;
				const c = { x: Math.cos(t) * r, y, z: Math.sin(t) * r };
				let worst = -1;
				for (const d of dirs) {
					const dot = c.x * d.x + c.y * d.y + c.z * d.z;
					if (dot > worst) worst = dot;
				}
				if (worst < bestScore) {
					bestScore = worst;
					best = c;
				}
			}
			return best;
		};
	});
}
