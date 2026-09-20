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
 * The **identity of the tree**, declared by the server itself. The vite plugin
 * in `scripts/lib/tree-declaration.mjs` serves the absolute path of its own
 * project root at `/__seelite/tree`, and this compares that against the root
 * this module sits in. One fetch, one string comparison, and the refusal names
 * the offending checkout.
 *
 * It used to compare **top-level numeric constants** between the file on disk
 * and the module the server handed back, and that could not answer the
 * question. **The argument and its measurement are not restated here** —
 * `scripts/lib/tree-declaration.mjs` owns them beside the plugin, and #123 has
 * the original. What is worth knowing at this end is the shape: the fingerprint
 * was a subset of the file that two checkouts share by construction, so it
 * could not separate them, and it did not.
 *
 * Two consequences worth knowing. The `files` argument is gone, and with it the
 * refusal for a module declaring no top-level numeric constants — identity is a
 * property of the server, not of any file, so no module is unguardable any
 * more. And the check now rests on the server's cooperation: a plain `vite`
 * with the plugin removed declares nothing and is refused, which is the right
 * direction to fail in.
 *
 * What it does not catch: a server on the **right** tree serving a **stale**
 * module out of its own cache. That is a different question from identity and
 * is charted separately (#297) — but read it as ground this change **gives
 * up**, not as ground nobody held. The fingerprint fetched each named file and
 * refused a mismatch, so a stale `src/units.ts` whose top-level constant had
 * moved was refused by it. It said "still" here for a round, which scopes #297
 * as new work rather than as restoring a check this merge drops.
 */
import { existsSync, realpathSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { TREE_ENDPOINT } from "./lib/tree-declaration.mjs";

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
 * The tree this module is part of, resolved.
 *
 * From this file's own location rather than from `process.cwd()`: a probe is
 * run from wherever its operator happens to be standing, and the question is
 * which checkout the *code doing the asking* came out of. `realpathSync`
 * because the other side resolves too — a tree reached through a symlink is the
 * same tree, and on macOS `/tmp` is one.
 */
const OWN_ROOT = realpathSync(
	resolve(dirname(fileURLToPath(import.meta.url)), ".."),
);

/** Re-exported so a consumer of the guard has one import rather than two, and
 *  so nothing spells the path a second time. */
export { TREE_ENDPOINT };

/** The same "who owns that port" recipe both refusals end with. */
const whereToLook = (origin) =>
	`Most likely another 'npm run dev' owns that port. Find it with:\n` +
	`  lsof -a -p $(lsof -nP -iTCP:$(echo ${origin} | sed 's/.*://') ` +
	`-sTCP:LISTEN -t | head -1) -d cwd\n` +
	`Then stop it, or point the probe elsewhere with PROBE_ORIGIN.`;

/**
 * The server answered, but not with a declaration.
 *
 * **Two causes, and they get different advice.** A non-JSON body is almost
 * always a vite with no plugin — its fallback answers any unknown path with
 * `index.html` — so that branch names the wiring. A body that *is* JSON and
 * still has no usable `root` is a different server or a different version of
 * this one, and telling its operator to check `vite.config.ts` sends them to a
 * file that is fine. One message for both said the first thing in every case,
 * which is a confident wrong answer half the time (#296 review).
 */
const undeclared = (origin, url, type, body, why) =>
	`The dev server at ${origin} does not declare which tree it serves.\n` +
	`  - ${url} answered ${type}\n` +
	`  - it begins: ${JSON.stringify(body.slice(0, 120))}\n\n` +
	`${why}\n\n${whereToLook(origin)}`;

const NO_PLUGIN =
	`A vite server started without the tree-declaration plugin answers any\n` +
	`unknown path with index.html, which is what this looks like. Check that\n` +
	`vite.config.ts still lists treeDeclaration(), and that the server was\n` +
	`started with that config.\n\n` +
	`It also looks exactly like this from anywhere but the machine the server\n` +
	`is on: the endpoint answers a loopback socket asking for a local name,\n` +
	`and nothing else. If this origin is another host, that is the reason,\n` +
	`and the config there is fine.`;

const NO_ROOT =
	`That is JSON, so something is serving this path — but it carries no\n` +
	`string 'root', which is the one field the guard compares. Check what is\n` +
	`on that port before touching vite.config.ts.`;

const NOT_JSON =
	`That claims to be JSON and does not parse as any, so something on that\n` +
	`port is answering this path and getting it wrong. Check what is there\n` +
	`before touching vite.config.ts.`;

/**
 * Throws unless the server at `origin` declares this working tree.
 *
 * Returns the declaration on success — `{ root }`, plus `head`, `branch` and
 * `dirty` where the server could read git. `capture-views.mjs` stamps those on
 * the contact sheet, which is the tier where a wrong-checkout run is least
 * likely to be noticed by eye.
 *
 * **Shape and content type, never `res.ok`.** An absent endpoint is not a 404
 * here: vite answers an unknown path with `index.html` and a **200**, so a
 * status check reads the SPA fallback as a successful declaration. Measured on
 * this repo's own config while the check was being built.
 */
export async function assertServingThisTree(origin) {
	const url = `${origin}${TREE_ENDPOINT}`;
	let res;
	try {
		res = await fetch(url);
	} catch (e) {
		throw new Error(
			`Could not reach ${url} — ${e.message}\n\n${whereToLook(origin)}`,
		);
	}
	const type = res.headers.get("content-type") ?? "(none)";
	const body = await res.text();
	if (!type.includes("application/json"))
		throw new Error(undeclared(origin, url, type, body, NO_PLUGIN));
	let declared;
	try {
		declared = JSON.parse(body);
	} catch {
		throw new Error(undeclared(origin, url, type, body, NOT_JSON));
	}
	if (typeof declared?.root !== "string")
		throw new Error(undeclared(origin, url, type, body, NO_ROOT));

	// The declared root is resolved the way this module's own is, so two
	// spellings of one tree compare equal. A path that does not exist on this
	// machine cannot be resolved and is simply not this tree — it is named as
	// declared rather than swallowed, because "the server says it is serving a
	// directory I cannot see" is the useful half of that message.
	let servedRoot = declared.root;
	try {
		servedRoot = realpathSync(declared.root);
	} catch {}
	if (servedRoot !== OWN_ROOT)
		throw new Error(
			`The dev server at ${origin} is not serving this working tree.\n` +
				`  - it serves ${servedRoot}\n` +
				`  - this is   ${OWN_ROOT}\n\n${whereToLook(origin)}`,
		);
	return declared;
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
 * scheme-and-host is used. There is no second argument: which tree a server
 * serves is the server's to declare, so a probe has nothing to choose here.
 */
export async function guardedOrigin(origin) {
	return (await guardedTree(origin)).origin;
}

/**
 * The same preamble, handing back **both** halves: the resolved origin and the
 * declaration the server made.
 *
 * `guardedOrigin` above throws the declaration away, which is right for every
 * caller that only wants to be sure — and wrong for `capture-views.mjs`,
 * which stamps the declaration on the contact sheet. That script reached past
 * the preamble to `assertServingThisTree(ORIGIN)` for a round and silently lost
 * `originOf` and the `PROBE_URL` override with it: a `PROBE_ORIGIN` ending in a
 * slash then built the endpoint off a doubled one, fell through to the SPA
 * fallback, and refused a correct server while blaming its config (#296
 * review). One entry point rather than two spellings of the preamble.
 */
export async function guardedTree(origin) {
	const resolved = originOf(process.env.PROBE_URL ?? origin);
	return { origin: resolved, served: await assertServingThisTree(resolved) };
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
 * Wait until the settings screen exists, so a script can drive its key.
 *
 * **The first drawn frame is not that moment.** `main.ts` mounts the screen from
 * a deferred `import("./settings-panel")`, and that handle lands some time
 * *after* the frame `bootedGame` answers on. Measured here, six sequential boots
 * of one build against one dev server: 325 ms with a cold transform cache, and
 * 410-424 ms for the five warm ones after it — so the wait is not paying a
 * compile, and it does not shorten when the machine has seen the module before.
 * A gate that presses the settings key straight after `bootedGame` is pressing
 * it at a window listener that is not installed yet: the screen opens if the
 * chunk happens to land first and never opens if it does not. #418's row in
 * `probe-boot.mjs` failed three runs in three that way, and reported the game
 * refusing to open settings rather than the probe arriving early.
 *
 * The predicate is the handle the mount itself publishes (`Game.settingsPanel`),
 * assigned inside `mountSettingsPanel` after its key listener is on the window —
 * so the handle being present is the same fact as the key being live, not a
 * proxy for it.
 *
 * Answers whether it landed rather than throwing, so the caller can put the
 * answer in a named row: a gate that dies on a wait prints a timeout and never
 * reaches the row that would have named the surface it was waiting for.
 */
export async function waitForSettingsPanel(page, timeout = 20000) {
	return page
		.waitForFunction(
			() => window.__seelite && window.__seelite.settingsPanel !== null,
			null,
			{ timeout },
		)
		.then(() => true)
		.catch(() => false);
}

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
 * Install the two page-side placers that put the ship somewhere and look at it.
 *
 * `__placeShipAt` and `__viewAlongAxis` were written inside
 * `probe-station-visuals.mjs` and lived there alone until #104 needed the same
 * two. They are here rather than copied for the reason `installCamSim` is here:
 * a second copy is a second thing to retune, and the copy that does not get
 * retuned is the one that goes quietly wrong.
 *
 * The framing vocabulary #104 also needs — sun angles, subject radii, the search
 * for empty sky — is **not** here. It has one consumer, and putting it here made
 * the station probe inject a Fibonacci-sphere search it never calls into every
 * page it opens. It lives in `scripts/lib/view-placement.mjs`, which builds on
 * these.
 *
 * Call before `page.goto`; it re-runs on every navigation.
 */
export async function installViewPlacement(page) {
	await page.addInitScript(() => {
		const frame = () => new Promise((r) => requestAnimationFrame(() => r()));

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
		 *  defined for all three types. The axis comes from `poseOfStation`.
		 *
		 *  Returns what the placement actually achieved:
		 *  `{ askedKm, actualKm, offAxisDeg }`, all measured after the last frame
		 *  against the body re-read at that moment. A placement is a request and
		 *  the frame loop is free to carry the subject off it, so where a caller
		 *  framed from is a reading rather than a constant — see the framing check
		 *  in `probe-station-visuals.mjs`. */
		window.__viewAlongAxis = async (bodyId, rangeKm, opts) => {
			const g = window.__seelite;
			const body = g.world.system.bodies.find((b) => b.id === bodyId);
			const pose = g.poseOfStation(bodyId);
			// Co-moving is the default, and `comoving: false` is the opt-out for a
			// caller that genuinely wants a ship at rest in sim space. "Parked"
			// meaning "not moving with the thing you are looking at" is not a
			// framing beside a station: see `__placeShipAt`'s docstring for the
			// ~30 km/s and what it did to a shot in four frames. This was opt-in
			// until #271, defended by a comment about not moving the numbers of
			// the probes that had the helper first — every one of those had since
			// opted in, so the flag had outlived its own reason.
			const vel =
				opts?.comoving === false ? undefined : g.stationVelocity(bodyId);
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
			// Re-read both ends: the body has moved since the placement aimed at
			// it, which is the whole of what this reading is for. **Two numbers,
			// because a range on its own understates it** — a station carried
			// across the frame leaves most of the error off the axis rather than
			// along it, and a camera 12% short but 16° round the side is looking
			// at a different face of the subject.
			const now = g.world.system.bodies.find((b) => b.id === bodyId);
			const p = g.world.ship.pos;
			const d = {
				x: p.x - now.pos.x,
				y: p.y - now.pos.y,
				z: p.z - now.pos.z,
			};
			const actualKm = Math.hypot(d.x, d.y, d.z);
			const cos =
				(d.x * pose.axis.x + d.y * pose.axis.y + d.z * pose.axis.z) / actualKm;
			return {
				askedKm: rangeKm,
				actualKm,
				offAxisDeg: (Math.acos(Math.min(1, Math.max(-1, cos))) * 180) / Math.PI,
			};
		};
	});
}

/**
 * How far a placement may land from the framing it asked for: a fraction of the
 * range, and an angle off the aperture axis.
 *
 * **Here rather than in a probe, because two probes gate on it.** #271 wrote
 * these in `probe-station-visuals.mjs` as module-local consts and #290 needed
 * the same pair — copying them would have left a retune of the documented
 * figures silently not reaching the second gate, which is the drift a shared
 * owner exists to prevent. They live beside `installViewPlacement` because they
 * are the tolerance on what it lands.
 *
 * **Where they came from (#271).** Bounded from above by the falsifying build:
 * parked, one run on one machine, range trade −11.41% / −9.75%, refinery
 * +3.83% / +2.15%, shipyard −2.15% / −2.15%, and off-axis 14.24° / 11.96°,
 * 14.89° / 10.89°, 6.18° / 6.18° (desktop / narrow). So the tightest red arm is
 * 2.15% on the range and 6.18° on the angle, and a tolerance at or above either
 * would not be a check on that arm. Bounded from below by what co-moving lands:
 * ≤0.02% and ≤0.01°, printed in the detail of every check that uses them.
 *
 * The magnitude of the red side is **frame-cost dependent** — it is how far the
 * station travelled while the loop ran, not a constant of the geometry — so it
 * is a figure to re-measure rather than to quote. #290 re-measured it at a
 * different range and got a different red: at `RANGE_KM` 5 km the angle is
 * 4.69°–5.20°, and at 60 km it is 0.35°–0.44°, which is **inside** this
 * tolerance. A parked framing is not red everywhere.
 */
export const FRAMING_TOLERANCE = 0.01;
export const FRAMING_TOLERANCE_DEG = 0.5;

/**
 * Gate one placement on both tolerances and print the numbers either way.
 *
 * `check` is the caller's, from its own `tally()` — the helper cannot own the
 * counter without owning the exit code too. The detail string is printed on a
 * pass as well as a fail, because a receipt that says only `ok` cannot be read
 * against a later run.
 *
 * Both numbers, and #271's reason: a station carried across the frame leaves
 * most of the error off the axis rather than along it, so a camera 12% short
 * but 16° round the side is looking at a different face of the subject and a
 * range check alone passes it.
 */
export function checkFraming(check, label, framing) {
	const drift = (framing.actualKm - framing.askedKm) / framing.askedKm;
	check(
		`${label} is framed where it asked`,
		Math.abs(drift) <= FRAMING_TOLERANCE &&
			framing.offAxisDeg <= FRAMING_TOLERANCE_DEG,
		`asked ${framing.askedKm.toFixed(3)} km, landed ` +
			`${framing.actualKm.toFixed(3)} km (${(drift * 100).toFixed(2)}%), ` +
			`${framing.offAxisDeg.toFixed(2)}° off the axis`,
	);
}
