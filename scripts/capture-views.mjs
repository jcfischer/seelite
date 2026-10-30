/**
 * Capture the canonical view set — the second half of #98's gate.
 *
 *   npm run dev                                  # in one shell
 *   npm run views                                # in another
 *   npm run views -- --label before              # name the run yourself
 *   npm run views -- --only hull-chase,hull-chase-miner,hull-chase-bollard --out view-set/node-909
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
import { installHaulerFixture } from "./lib/hauler-fixture.mjs";
// A default-layout probe (#381 D11): it presses keys by name, as the shipped
// layout binds them, and a moved default turns it red for that reason.
import { execFileSync } from "node:child_process";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
	GAME_TIME_S,
	MODEL_BOOT_PARAMS,
	SEED,
	SHOT_KINDS,
	VIEWPORT,
	selectViews,
	contactSheet,
} from "./lib/view-set.mjs";
import { requireChartSpot } from "./lib/chart-hover-spot.mjs";
import { assertPlayersRenderer } from "./lib/players-renderer.mjs";
import { installViewFraming } from "./lib/view-placement.mjs";
import { assertHorizonFacts } from "./lib/horizon-framing.mjs";
import { installCruiseLeg } from "./lib/cruise-page.mjs";
import { installChargeToNearest } from "./lib/witchspace-page.mjs";
import { holdCruiseTurnState, holdVentState } from "./lib/vent-state.mjs";
import { holdNpcVentState } from "./lib/npc-vent-state.mjs";
import {
	bootedGame,
	guardedTree,
	installViewPlacement,
	launchChromium,
} from "./probe-guard.mjs";
import { gameUrl, workbenchUrl } from "./lib/game-url.mjs";
import { holdProbeLockOrExit } from "./lib/probe-lock.mjs";
import { levelsFile, writeRunLevels } from "./lib/levels-report.mjs";

const ORIGIN = process.env.PROBE_ORIGIN ?? "http://localhost:5173";

/** `--out`, `--label`, `--quality` and `--only`, both `--k v` and `--k=v`. Small enough to read here;
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
// Scoped captures are separate from full runs and explicitly labelled on the sheet.
// Missing requested frames still refuse the sheet; unknown names refuse before boot.
const ONLY = arg("only", null);
const VIEWS = selectViews(ONLY);
const OUT = arg("out", ONLY === null ? "view-set" : "view-set/selected");
const QUALITY = arg("quality", null);
const COCKPIT_FOV = arg("cockpit-fov", null);
if (COCKPIT_FOV !== null && COCKPIT_FOV !== "normal" && COCKPIT_FOV !== "wide")
	throw new Error(`--cockpit-fov must be normal or wide, got ${COCKPIT_FOV}`);
if (QUALITY !== null && QUALITY !== "high" && QUALITY !== "low")
	throw new Error(`--quality must be high or low, got ${QUALITY}`);

/** Apply requested settings after each boot, including seed changes. */
async function applyCaptureSettings(page) {
	if (COCKPIT_FOV !== null)
		await page.evaluate((mode) => {
			window.__seelite.settings.set("cockpitFov", mode);
		}, COCKPIT_FOV);
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
 *
 * **A row may declare a `system` as well as a `seed`, and it is restored by the
 * same act** (#432). The reasoning is identical: one seed is not one place, and
 * a row that needs to stand at another star has to say so and have the boot
 * carry it there, rather than depend on the view above it having left the page
 * somewhere. What is *new* here is that the affordance can refuse — `?system=`
 * warns and boots the start system for an index it cannot use — so the restore
 * reads the booted index back and throws. A seed the page refused would have put
 * the whole run's frames in the wrong galaxy and announced itself everywhere at
 * once; a refused system puts one row's frame in the wrong star with a caption
 * naming the right one.
 *
 * It is called `ensureFixture` and not `ensureSeed` because it restores both
 * halves — and the name is a checked contract, since `tests/view-set.test.ts`
 * pins the call site as a string to prove the loop restores them together. A name
 * that says half of what the function guarantees is a name that misleads exactly
 * where a reader is deciding whether they can trust it.
 */
let currentSeed = null;
/**
 * The system the loaded page was asked to boot at, or `null` for the start
 * system — the other half of the fixture a row declares (#432).
 *
 * **Read back, not assumed.** `?system=` is polite about an index it cannot use:
 * it warns and boots the start system, which is right for a person at a URL and
 * wrong for a capture, because the row is captioned with the system it asked for.
 * So the booted index is compared here, on the page that booted, and a mismatch
 * throws the way a missing view throws — a sheet with a wrong picture in it reads
 * exactly like a whole one.
 */
let currentSystem = null;
let currentHull = "courier";
/**
 * Set by a placer that writes world state — the duel's kill (#324 part d) — so
 * the next view boots on a world with no save, as the first boot does.
 *
 * **A reload alone does not restore the world** (sage #330). The kill's
 * destroyed slot and its world-state clock live in the IndexedDB save, which
 * a reload keeps and `pagehide` flushes to. The first fix only reloaded, and
 * the next kill, on a clock `__startClockAt` had put back to the start, landed
 * before the saved clock and threw. So the saves are deleted from a workbench
 * route, which opens no save store, and only then is the game loaded.
 */
let worldWritten = false;
async function ensureFixture(page, seed, system = null, hull = "courier") {
	if (
		currentSeed === seed &&
		currentSystem === system &&
		currentHull === hull &&
		!worldWritten
	)
		return;
	// Hull changes need a fresh Commander: a saved hull takes precedence over ?hull=.
	if (currentHull !== hull) worldWritten = true;
	if (worldWritten) {
		await page.goto(workbenchUrl(SERVING, { "hud-gallery": true }), {
			waitUntil: "load",
		});
		await page.evaluate(async () => {
			for (const { name } of await indexedDB.databases())
				await new Promise((done, fail) => {
					const request = indexedDB.deleteDatabase(name);
					request.onsuccess = () => done();
					request.onerror = () => fail(request.error);
					request.onblocked = () =>
						fail(new Error(`capture: ${name} is still open`));
				});
		});
		worldWritten = false;
	}
	// `raider: "off"`: traversals cruise, and a leg-law raider would move the
	// frame. The duel placer forces its own raider, which this does not stop.
	// `system` is left off the URL when the row declares none, which is every
	// row written before #432 and every row that is not a frame of the rim.
	await page.goto(
		gameUrl(SERVING, {
			seed,
			hull,
			raider: "off",
			system,
			...MODEL_BOOT_PARAMS,
			"interiors-full": true,
		}),
		{
			waitUntil: "load",
		},
	);
	await bootedGame(page);
	// Node #909: a saved courier must not stand in for a requested tug/miner.
	// Compare the flown state and the drawn hull, including its authored install.
	const flown = await page.evaluate(() => {
		const g = window.__seelite;
		const ship = g.nearScene.getObjectByName("ship");
		return {
			hull: g.commander.hull,
			drawn: ship?.userData.hullId,
			authored: ship?.userData.authored,
		};
	});
	if (flown.hull !== hull || flown.drawn !== hull || !flown.authored)
		throw new Error(
			`capture: asked for authored ${hull}, got ${JSON.stringify(flown)}`,
		);
	if (system !== null) {
		const booted = await page.evaluate(
			() => window.__seelite.world.system.record.index,
		);
		if (booted !== system)
			throw new Error(
				`capture: ${seed ? `seed ${seed} ` : ""}system ${system} was asked for and system ${booted} booted — the page refuses an index it cannot use, quietly and for a person at a URL, so the capture is the one that has to refuse loudly`,
			);
	}
	await applyCaptureSettings(page);
	await page.evaluate(() => window.__rememberBootPosition());
	await page.evaluate((t) => window.__startClockAt(t), GAME_TIME_S);
	currentSeed = seed;
	currentSystem = system;
	currentHull = hull;
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

/**
 * The spot the chart row being captured aimed at — its index and the badge
 * count predicted there — for the readbacks either side of the shutter. Set by
 * the `chart` placer and cleared at the top of every view, so a row that did not
 * run the placer cannot be checked against another row's aim (sage round 1).
 */
let chartAimed = null;

/**
 * The chart's hover, read as state and as the drawn label, and refused unless
 * both describe the hover the row is captioned for.
 *
 * **Read three times: after the move, and on both sides of the screenshot.**
 * The first full capture of #540 passed the placer's readback and wrote two
 * frames with no label in them at all — the hover was dropped between the
 * placer and the screenshot, and nothing looked. The cause was not reproduced
 * across two further runs; a headed window takes real pointer events from
 * whoever is at the machine, and any of those clears it.
 *
 * One read before the screenshot leaves the gap after it (sage round 2), so
 * the loop reads again once the frame is written. What the pair proves rests
 * on the chart: a cleared hover does not come back until the pointer moves
 * again, because `clearHover` drops the remembered position with it. So a
 * label up on both sides was up during the frame — unless a pointer event
 * cleared it and re-set it in between, which the second read catches unless it
 * landed on the same system, and then the frame is still the one captioned.
 *
 * **The badge is checked against the prediction**, not only against the
 * label's own text (sage round 1): the chart's `contested` read against its own
 * label can only catch a label that disagrees with itself, so a build that
 * miscounts — a clipped system counted, say — would pass.
 *
 * `checkVisibility` rather than the element's `display`, because a hidden
 * ancestor leaves `display` reading `block` over a label nobody can see.
 */
async function assertChartHover(page, where, shot, aimed) {
	if (aimed === null)
		throw new Error(
			`chart placer (${where}): the ${shot.spot} row has no aim to check — the placer did not run for it`,
		);
	const got = await page.evaluate(() => {
		const el = document.querySelector("[data-map-hover]");
		return {
			hovered: window.__seeliteGalaxyMap?.hovered() ?? null,
			shown: el instanceof HTMLElement && el.checkVisibility(),
			text: el?.textContent ?? "",
			events: (window.__captureEvents ?? []).slice(-8),
		};
	});
	const { hovered } = got;
	const recent = ` — the last events the page saw: ${JSON.stringify(got.events)}`;
	if (hovered === null || hovered.index !== aimed.index || !got.shown)
		throw new Error(
			`chart placer (${where}): aimed at system ${aimed.index} for the ${shot.spot} row and the chart labelled ${hovered === null ? "nothing" : `system ${hovered.index}`}${got.shown ? "" : ", with no label drawn"}${recent}`,
		);
	const badged =
		hovered.contested === aimed.contested &&
		(aimed.contested > 0
			? got.text.includes(`(${aimed.contested} more)`)
			: !got.text.includes("more)"));
	if (!badged)
		throw new Error(
			`chart placer (${where}): the ${shot.spot} row predicted ${aimed.contested} more, the chart counts ${hovered.contested} and its label reads "${got.text}"${recent}`,
		);
	return hovered;
}

/** One placer per shot kind. Each returns the subject it framed, for the log. */
const PLACERS = {
	horizon: async (page, shot) => {
		assertHorizonFacts(
			await page.evaluate((s) => window.__horizonView(s), shot),
			shot,
		);
		return shot.station ?? shot.body;
	},
	derelict: async (page, shot) => {
		worldWritten = true;
		const { placeDerelict } = await import("./lib/derelict-state.mjs");
		const result = await placeDerelict(page, shot);
		return (
			result.hull +
			" · " +
			result.key +
			(result.tear ? " · " + result.tear : "")
		);
	},
	"npc-jump": async (page, shot) => {
		await page.evaluate(installHaulerFixture);
		// Seconds from the crossing instant. The default is the half-second-after
		// frame the set has always carried; the beat rows (#1006) name their own,
		// including negative ones — a ring opening before anything is in it is the
		// frame the set could not draw.
		const phaseS = shot.phaseS ?? 0.5;
		const sampled = await page.evaluate(
			({ event, phaseS, framing }) => {
				const f = window.__haulerFixture;
				f.sample(f.plan.actor.schedule.departureAtS + 1, false);
				f.sample(f.voyage.tOut - 3.1, false);
				f.sample(f.voyage.tOut + 0.5);
				if (event === "arrival") f.follow();
				return f.sample(f.voyage.tOut + phaseS, true, framing ?? "ring");
			},
			{ event: shot.event, phaseS, framing: shot.framing },
		);
		if (sampled.jump?.kind !== shot.event || sampled.rift <= 0)
			throw new Error(
				`NPC ${shot.event} fixture did not draw its ring: ${JSON.stringify(sampled)}`,
			);
		return `${sampled.name} · ${sampled.hull} · ${shot.event} · ${phaseS >= 0 ? "+" : ""}${phaseS.toFixed(2)} s from the crossing · ring ${(sampled.riftRadiusKm * 2).toFixed(3)} km across, strength ${sampled.rift.toFixed(2)}, flare ${sampled.flare.toFixed(2)}, ${
			sampled.hullThroughPlaneKm === null
				? shot.event === "arrival"
					? "no hull in this system yet"
					: "no hull in this system any more"
				: `hull origin ${sampled.hullThroughPlaneKm.toFixed(3)} km from ring plane along nose`
		} · camera ${sampled.cameraRangeKm.toFixed(3)} km`;
	},
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
		await page.goto(workbenchUrl(SERVING, { "model-viewer": "station" }), {
			waitUntil: "load",
		});
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
	"docking-notice": async (page, shot) => {
		// The crossing damages the ship and the let-go spends no grant, but both
		// leave a docking state and a notice the next row must not inherit.
		worldWritten = true;
		const id = "station-trade";
		await page.evaluate(
			async ([bodyId, radii]) =>
				window.__viewAlongAxis(bodyId, window.__radiusOf(bodyId) * radii, {
					comoving: true,
				}),
			[id, 3],
		);
		const text = await page.evaluate(
			async ([stationId, notice]) => {
				const { migrateEquipment, equipmentNames } = await import(
					"/src/loadout.ts"
				);

				const g = window.__seelite;
				const dt = g.units.MAX_DT;
				const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
				const scale = (a, k) => ({ x: a.x * k, y: a.y * k, z: a.z * k });
				g.targetId = stationId;
				g.dockingComputer.disengage();
				g.dockingStates.delete(stationId);
				if (notice === "bounce") {
					g.requestDockingClearance();
					const snap = g.dockingSnapshot(stationId);
					const body = g.world.system.byId.get(stationId);
					const vel = g.stationVelocity(stationId);
					const inward = scale(snap.axis, -0.05);
					// 90° off the slot's own up: check 4's failure and nothing else.
					const across = snap.basis.across;
					const place = (axialKm) => {
						g.world.ship.pos = add(body.pos, scale(snap.axis, axialKm));
						g.world.ship.vel = add(vel, inward);
					};
					g.setAttitude(scale(snap.axis, -1), across);
					place(snap.planeKm + 0.01);
					const before = g.dockingApproaches();
					place(snap.planeKm - 0.01);
					// A build before node #663 resolved the crossing inside
					// `stepDocking`; since, `stepWorld` finds it and this seam
					// finds it for a placed ship.
					g.stepDocking(
						typeof g.crossingFrom === "function"
							? g.crossingFrom(before)
							: before,
					);
				} else {
					if (!g.hasDockingComputer)
						g.commander = {
							...g.commander,
							loadout: migrateEquipment(g.commander.hull, [
								...equipmentNames(g.commander.loadout ?? {}),
								g.dockingComputerName,
							]).loadout,
						};
					g.toggleDockingComputer();
					g.step(dt);
				}
				g.render(dt);
				const snap = g.dockingSnapshot(stationId);
				// A build from before #597 has no notice to draw: the before arm,
				// captioned as such the way the witchspace rows caption a hard cut.
				if (!snap || !("notice" in snap)) return { absent: true };
				return { text: snap.notice?.text ?? null };
			},
			[id, shot.notice],
		);
		if (text.absent) return `${id} · this build draws no docking notice`;
		if (!text.text)
			throw new Error(`docking-notice placer: no notice for ${shot.notice}`);
		return `${id} · ${text.text}`;
	},
	duel: async (page, shot) => {
		// **The next view boots on a fresh world** (sage #330). A duel leaves the
		// page changed — an encounter, a kill with a destroyed slot, and for the
		// log a clock 601 s ahead — and `ensureFixture` reloaded only on a seed
		// change, so the same-seed berth views after it ran on that page, 697 to
		// 1036 s into the clock. Marked before placing, so a placer that throws
		// still leaves the page marked.
		worldWritten = true;
		// Cruise to the farthest body, force a raider ahead, fly the contest out on
		// fixed steps so it interdicts, then select it and aim at it. Close and
		// ahead, so the raider is near the centre of the frame; the probe forces
		// its own raider for its own checks.
		const name = await page.evaluate(
			async ({ headLook, aftermath }) => {
				const g = window.__seelite;
				const dt = g.units.MAX_DT;
				g.resetFlightToStart();
				const far = g.world.system.bodies
					.filter((b) => b.kind !== "star")
					.map((b) => ({
						b,
						d: Math.hypot(
							b.pos.x - g.world.ship.pos.x,
							b.pos.y - g.world.ship.pos.y,
							b.pos.z - g.world.ship.pos.z,
						),
					}))
					.sort((a, b) => b.d - a.d)[0].b;
				g.targetId = far.id;
				g.faceTarget?.();
				g.engageCruise();
				for (let i = 0; i < 100 && g.regime !== "cruise"; i++) g.step(dt);
				g.forceRaider("ahead", 0.5, 12);
				for (let i = 0; i < 600 && g.encounter?.phase !== "duel"; i++)
					g.step(dt);
				if (g.encounter?.phase !== "duel")
					throw new Error(
						`duel placer: the raider never interdicted (phase ${g.encounter?.phase ?? "none"})`,
					);
				// **Rendered, not only stepped.** The raider's contact takes its id in
				// `render`, so a placer that only steps selects whatever id the contact
				// held before — the first capture of this view had no target at all.
				for (let i = 0; i < 60; i++) {
					g.step(dt);
					g.render(dt);
				}
				const raider = g.encounter.raider;
				if (!raider) throw new Error("duel placer: no raider in the duel");
				g.targetId = g.raiderContact.id;
				g.render(dt);
				if (g.targetBody()?.id !== g.raiderContact.id)
					throw new Error(
						`duel placer: the raider is not the selected target (${g.targetId})`,
					);
				const p = g.world.ship.pos;
				const r = raider.flight.ship.pos;
				g.setAttitude({ x: r.x - p.x, y: r.y - p.y, z: r.z - p.z }, g.shipUp());
				const slotName = g.encounter.name;
				g.rightTab = "Flight";
				// #324 part d's aftermath views: the raider brought to its last point
				// of hull and shot down on fixed steps, then either its canisters
				// framed on the glass or the Communications log ten minutes on.
				if (aftermath) {
					// **Head forward first.** The gun follows the camera's sightline,
					// and the view captured before this one leaves the head turned to
					// a console, so every shot went sideways and the raider fled.
					g.setHeadLook("forward");
					// **Two kilometres ahead, at the ship's velocity.** At its last
					// point of hull the raider flees at once, and from the 12 km it
					// was forced at it leaves the laser's 12 km reach before a shot
					// lands. The capture lost its kill that way twice.
					const ahead = g.nose();
					const shipPos = g.world.ship.pos;
					g.encounter = {
						...g.encounter,
						raider: {
							...raider,
							flight: {
								...raider.flight,
								ship: {
									...raider.flight.ship,
									pos: {
										x: shipPos.x + ahead.x * 2,
										y: shipPos.y + ahead.y * 2,
										z: shipPos.z + ahead.z * 2,
									},
									vel: { ...g.world.ship.vel },
								},
							},
							condition: { ...raider.condition, fore: 0, aft: 0, hull: 0.01 },
						},
					};
					g.keys.add(" ");
					// **Aim, then step.** The step fires along the aim it starts with,
					// at the raider where the step starts. Aiming after the step shot
					// at where a fleeing raider had been, and it got away.
					for (let i = 0; i < 300 && g.encounter; i++) {
						const live = g.encounter?.raider;
						if (live) {
							const q = g.world.ship.pos;
							const t = live.flight.ship.pos;
							g.setAttitude(
								{ x: t.x - q.x, y: t.y - q.y, z: t.z - q.z },
								g.shipUp(),
							);
						}
						g.step(dt);
						g.render(dt);
					}
					g.keys.delete(" ");
					if (g.encounter || !g.lastExit.endsWith("destroyed"))
						throw new Error(
							`duel placer: the raider did not die for the aftermath (${g.lastExit}, head ${g.headLook})`,
						);
					if (aftermath === "canisters") {
						const c = g.canisters[0];
						if (!c)
							throw new Error("duel placer: the kill dropped no canister");
						const q = g.world.ship.pos;
						g.setAttitude(
							{ x: c.pos.x - q.x, y: c.pos.y - q.y, z: c.pos.z - q.z },
							g.shipUp(),
						);
					}
					if (aftermath === "log") {
						g.world.gameTime += 601;
						g.leftTab = "Communications";
					}
				}
				g.setHeadLook(headLook);
				g.render(dt);
				await new Promise((done) => requestAnimationFrame(() => done()));
				return slotName;
			},
			{ headLook: shot.headLook, aftermath: shot.aftermath ?? null },
		);
		return `duel · ${name} · ${shot.headLook}${shot.aftermath ? ` · ${shot.aftermath}` : ""}`;
	},
	"deep-sky": async (page) => {
		// Back to the arrival point first. Turning the camera alone left the ship
		// wherever the previous view had put it, which made one view of a
		// *canonical* set a function of the order of the array above it.
		//
		// One heading rule, `__emptiestDirection`. #432 added a second — aim along
		// the **Core bearing**, through `galaxy-frame.ts`'s transform rather than
		// arithmetic here, which is #430's reason for existing — and removed it in
		// the same PR: the row it was for cannot show its subject at this cluster's
		// population, and `measure-sky-density.ts`'s core mode is the reading that
		// said so. See the note beside `sky-only` in `lib/view-set.mjs`.
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
	controls: async (page, shot) => {
		// The arrival point and a forward head, then `?` through the keyboard —
		// the key the player presses rather than a field assignment, so the
		// frame is the tab the game opens. Every group is opened before the
		// declared ones are folded, because the fold is kept beside the tab and
		// would otherwise carry over from the view before.
		await page.evaluate(async () => {
			await window.__returnToBootPosition();
			window.__seelite.setHeadLook("forward");
		});
		await page.keyboard.press("Shift+Slash");
		// **A build without the tab is captured, not refused.** The `before` of
		// #372 is a build where `?` does nothing, and that frame — the forward
		// view, unchanged — is the honest before. The subject line says which
		// one the sheet is showing, so the absence cannot pass for a regression.
		const opened = await page
			.waitForFunction(
				() =>
					window.__seelite.headLook === "right" &&
					!!document.querySelector("[data-live-controls-body]"),
				undefined,
				{ timeout: 2000 },
			)
			.then(
				() => true,
				() => false,
			);
		if (!opened) return "? opened no Controls tab on this build";
		await page.evaluate((folded) => {
			// Queried again each pass: a fold redraws the tree, so a list taken
			// once holds detached headers after the first click (sage round 1).
			// Bounded, and it throws: a build whose click does not toggle would
			// otherwise spin here and hang the run with no message (sage round 3).
			const closed = '[data-live-controls-group][aria-expanded="false"]';
			for (let pass = 0; pass < 12; pass++) {
				const header = document.querySelector(closed);
				if (!header) break;
				header.click();
			}
			if (document.querySelector(closed))
				throw new Error("controls placer: a folded group would not open");
			for (const group of folded)
				document
					.querySelector(`[data-live-controls-group="${group}"]`)
					?.click();
		}, shot.folded ?? []);
		// **Read back, not assumed** (sage round 2): a misspelt group clicks
		// nothing, and a label naming a fold that did not happen reads exactly
		// like one that did.
		const unfolded = await page.evaluate(
			(folded) =>
				folded.filter(
					(group) =>
						document
							.querySelector(`[data-live-controls-group="${group}"]`)
							?.getAttribute("aria-expanded") !== "false",
				),
			shot.folded ?? [],
		);
		if (unfolded.length > 0)
			throw new Error(
				`controls placer: ${unfolded.join(", ")} did not fold — no such group, or the fold was lost`,
			);
		if (shot.rebind) {
			// **The row is clicked and the modal is read back**, on the placer's
			// own rule two paragraphs up: a selector that matched nothing would
			// produce the tab with no modal on it, and a sheet captioned
			// "rebinding" showing a tab reads exactly like a regression in the
			// modal. A build without one is captured and *said*, which is the
			// honest `before` of this node.
			const row = `[data-live-controls-row="${shot.rebind}"]`;
			const opened = await page.evaluate((sel) => {
				const el = document.querySelector(sel);
				if (!el) return false;
				el.click();
				return true;
			}, row);
			if (!opened) return `no ${shot.rebind} row on this build`;
			const up = await page
				.waitForFunction(
					() => !!document.querySelector("[data-capture-modal]"),
					undefined,
					{ timeout: 2000 },
				)
				.then(
					() => true,
					() => false,
				);
			if (!up) return `the ${shot.rebind} row opened no modal on this build`;
			// The key the modal is shown having caught. A press rather than a
			// field assignment, for the reason `?` is pressed above: the frame
			// is what the game does with a keystroke.
			if (shot.press) {
				await page.keyboard.press(shot.press);
				// **Wait on the confirm control, not on `.capture-caught`.**
				// The refused branch draws that class too — it shows what it
				// caught and then says why it cannot take it — so a build that
				// *refused* the key would satisfy the wait and the sheet would
				// be captioned `caught k` over a refusal (sage round 2 on
				// #497). Only a candidate the registry will store draws a
				// confirm.
				// **Reported, not thrown**, like the two waits above it: a throw
				// here aborts the whole capture run, and a build that refuses
				// the key is a thing this sheet exists to *show* (sage round 5
				// on #497).
				const offered = await page
					.waitForFunction(
						() => !!document.querySelector("[data-capture-confirm]"),
						undefined,
						{ timeout: 2000 },
					)
					.then(
						() => true,
						() => false,
					);
				if (!offered)
					return `${shot.rebind} · ${shot.press} was caught and refused`;
			}
			return `Rebinding ${shot.rebind}${shot.press ? ` · caught ${shot.press}` : ""}`;
		}
		return `Controls tab${shot.folded?.length ? ` · folded ${shot.folded.join(", ")}` : ""}`;
	},
	/**
	 * #177's hover label, with a player's pointer (D4). The spot comes from the
	 * chart's own projection at run time — `lib/chart-hover-spot.mjs` picks it,
	 * independently of the hover rule it is checking — and `page.mouse` moves
	 * there, the way `probe-navigation-console.mjs` does. An in-page
	 * `PointerEvent` was rejected: it is not a player's pointer (#370).
	 *
	 * **Read back by index, and the badge with it.** Names are not unique per
	 * galaxy, so the label's text cannot say which system it names. A `null`, a
	 * different index, or a badge the row's caption does not describe throws,
	 * so no sheet is built over a frame captioned for another hover.
	 */
	chart: async (page, shot) => {
		const frames = () =>
			page.evaluate(
				() =>
					new Promise((r) =>
						requestAnimationFrame(() => requestAnimationFrame(() => r())),
					),
			);
		// **The pointer starts off the canvas** — the capture loop parks it in the
		// corner before every view. Both rows share a page and the chart's hover
		// holds its last system within a release radius, so the second row would
		// otherwise begin with the first row's label held. The readback below
		// confirms nothing is labelled before the pointer moves.
		await page.evaluate(async () => {
			await window.__returnToBootPosition();
			window.__seelite.setHeadLook("left");
		});
		await page.waitForFunction(
			() =>
				document
					.querySelector("[data-live-cockpit]")
					?.getAttribute("data-live-head-look") === "left",
		);
		// The Galaxy Map tab of the Navigation console, clicked as the probe
		// clicks it. Not a field assignment: the tab mounts the chart.
		await page.evaluate(() => {
			const tab = document.querySelector('[data-live-left-tab="Galaxy Map"]');
			if (!(tab instanceof HTMLElement))
				throw new Error("chart placer: no Galaxy Map tab on this build");
			tab.click();
		});
		await page.waitForFunction(
			() =>
				document
					.querySelector("[data-live-cockpit]")
					?.getAttribute("data-live-left-view") === "Galaxy Map" &&
				!!window.__seeliteGalaxyMap,
		);
		// The documented default framing and no selection: a selection draws a
		// card, and a card beside the label is a different picture. The probe's
		// hover section starts from the same state.
		await page.evaluate(() => {
			const map = window.__seeliteGalaxyMap;
			map.select(null);
			map.resetView();
		});
		await frames();
		const layout = await page.evaluate(() => {
			const map = window.__seeliteGalaxyMap;
			const box = map.viewport();
			return {
				points: map.projected(),
				box,
				pickRadiusPx: map.pickRadiusPx,
				held: map.hovered(),
			};
		});
		if (layout.held !== null)
			throw new Error(
				`chart placer: ${JSON.stringify(layout.held)} was still labelled with the pointer off the chart`,
			);
		const spot = requireChartSpot(
			layout.points,
			{
				pickRadiusPx: layout.pickRadiusPx,
				width: layout.box.width,
				height: layout.box.height,
			},
			shot.spot,
		);
		// Declared first, so the filter above is on before the move arrives.
		const at = { x: layout.box.left + spot.x, y: layout.box.top + spot.y };
		await page.evaluate((own) => {
			window.__capturePointer = own;
		}, at);
		await page.mouse.move(at.x, at.y);
		await frames();
		const hovered = await assertChartHover(page, "placed", shot, spot);
		chartAimed = spot;
		return `Galaxy Map · ${shot.spot} · system ${hovered.index}${hovered.contested ? ` (${hovered.contested} more)` : ""}`;
	},
	/**
	 * #532's strip. The clock is held first — the capture loop lets it run,
	 * and a held phase before the cut with a running charge would fire the
	 * jump during the settle frames — and a phase from the cut on is taken
	 * after a real jump, driven a step at a time, so the rift and the new
	 * system are the ones a player gets.
	 *
	 * **Read back, not assumed**: a charge the game refused, or a jump that did
	 * not arrive, throws rather than capturing the start system under a
	 * caption that says otherwise.
	 */
	witchspace: async (page, shot) => {
		// Marked before placing, like the duel: a jump saves, and a placer that
		// throws still leaves the page marked.
		worldWritten = true;
		await page.evaluate(installChargeToNearest);
		const result = await page.evaluate((phase) => {
			const g = window.__seelite;
			g.clockHeld = true;
			const start = window.__chargeToNearest();
			if (!start.charged) return { error: `charge refused: ${start.notice}` };
			if (phase >= 0) {
				const dt = g.units.MAX_DT;
				for (
					let i = 0;
					i < 200 && g.world.system.record.index === start.from;
					i++
				)
					g.step(dt);
				if (g.world.system.record.index !== start.to)
					return { error: `the jump to ${start.toName} did not arrive` };
			}
			// A build before #532 has no handle: its frames are the hard cut, which
			// is that build's honest `before`, and the caption says so.
			const held = typeof g.holdWitchspace === "function";
			if (held) g.holdWitchspace(phase);
			return { from: start.fromName, to: start.toName, held };
		}, shot.phase);
		if (result.error) throw new Error(`witchspace placer: ${result.error}`);
		const cut = result.held
			? ""
			: " · no transition on this build: the hard cut";
		return `${shot.phase >= 0 ? "+" : ""}${shot.phase} s · ${result.from} → ${result.to}${cut}`;
	},
	/**
	 * #535's strip. A guided new game booted with `?cinematic=held`, which
	 * starts the opening held on its first frame, then held again at `at`
	 * shown seconds into `shot` through #530's phase handle. The hold steps
	 * the real flight there and stops, so every capture lands on the same step.
	 *
	 * **Read back, not assumed**: a hold that lands on another shot throws. A
	 * build before #535 has no opening, and a guided boot there is #408 D1's
	 * docked start, which is that build's honest `before` and is captioned so.
	 */
	opening: async (page, shot) => {
		// The dock saves; the next row boots clean.
		worldWritten = true;
		await page.goto(
			gameUrl(SERVING, {
				seed: SEED,
				raider: "off",
				guided: true,
				cinematic: "held",
				...MODEL_BOOT_PARAMS,
				"interiors-full": true,
			}),
			{ waitUntil: "load" },
		);
		await bootedGame(page);
		await applyCaptureSettings(page);
		const result = await page.evaluate(
			({ want, at }) => {
				const g = window.__seelite;
				if (typeof g.holdOpening !== "function" || !g.openingActive)
					return { held: false, phase: g.dockPhase };
				g.holdOpening(want, at);
				const r = g.openingReading();
				return { held: true, shot: r.shot, shown: r.shownBy[want] };
			},
			{ want: shot.shot, at: shot.at },
		);
		if (!result.held)
			return `no opening on this build: the docked start (${result.phase})`;
		if (result.shot !== shot.shot)
			throw new Error(
				`opening placer: asked for ${shot.shot} at ${shot.at} s and the hold landed on ${result.shot}`,
			);
		return `${shot.shot} +${result.shown.toFixed(2)} s`;
	},
	/** #583's Shipyard tab, docked at the fixture's shipyard, at a new game's
	 *  rungs or the top. */
	"shipyard-tab": async (page, shot) => {
		// The rungs and the purse are written, so the next row boots clean.
		worldWritten = true;
		const result = await page.evaluate(async (rungs) => {
			const g = window.__seelite;
			const id = g.world.system.bodies.find(
				(b) => b.kind === "station" && b.stationType === "shipyard",
			)?.id;
			if (!id) return { error: "no shipyard in the fixture's system" };
			// Head right through the dock: see the bake wait below.
			await window.__parkInBerth(id, g.berthIdsOfStation(id)[0], {
				headLook: "right",
			});
			if (rungs === "top") {
				const L = await import("/src/ladder.ts");
				g.ladders = {
					...g.ladders,
					banked: Object.fromEntries(
						L.LADDERS.map((l) => [l, L.threshold(l, L.TOP_RUNG)]),
					),
				};
				g.commander = {
					...g.commander,
					credits: 100_000,
					cargo: { Food: 20 },
				};
			}
			g.stationConsoleRevision += 1;
			return { id };
		}, shot.rungs);
		if (result.error) throw new Error(`shipyard-tab placer: ${result.error}`);
		// **The bakes finish with the head turned, then it faces the console.**
		// This row boots fresh, and the dock queues a planet bake that does not
		// advance while a docked head faces forward — measured on this build and
		// on main alike: `planet-4` stayed queued for 20 s forward and drained at
		// once turned right. Left queued, the capture's own bake wait times out.
		await page.waitForFunction(
			() => (window.__seelite?.bakeQueue?.length ?? 0) === 0,
			undefined,
			{ timeout: 60_000 },
		);
		await page.evaluate(() => {
			window.__seelite.setHeadLook("forward");
			window.__seelite.updateCockpit();
		});
		// **A build without the tab is captured, not refused**, on the
		// Controls row's precedent: the `before` of #583 is a shipyard whose
		// console has no Shipyard tab, and the subject line says so.
		const tabName = shot.tab ?? "Shipyard";
		const tab = page.locator(`[data-live-station-tab="${tabName}"]`);
		if ((await tab.count()) === 0)
			return `${result.id} · no Shipyard tab on this build`;
		await tab.click();
		if (tabName === "Equipment")
			await page.evaluate(() => {
				const g = window.__seelite;
				g.commander = { ...g.commander, cargo: {} };
				g.outfittingSlot = "h1";
				g.outfittingCandidate = "stock:pulse-laser/1/E";
				g.stationConsoleRevision++;
				g.updateCockpit();
			});
		return `${result.id} · ${tabName} tab at ${shot.rungs} rungs`;
	},
	/**
	 * #621's two cues, in one state the real sim was flown into: the assist
	 * on, the ship above the cap and spinning above its envelope, so the
	 * retro and attitude vents fire and both families saturate. The clock is
	 * held, so the plumes and the pulse are the same frame every run.
	 *
	 * **Read back, not assumed**: a build with the cue that fired nothing or
	 * flagged nothing throws rather than capturing a quiet frame under this
	 * caption. A build before #621 is its honest `before` and says so.
	 */
	vents: async (page, shot) => {
		// The ship is moved and spun; the next row boots clean.
		worldWritten = true;
		const state = await page.evaluate(holdVentState, {
			overCap: shot.overCap,
			spin: shot.spin,
			steps: shot.steps,
		});
		await page.evaluate((yaw) => {
			window.__seelite.chaseYaw = yaw;
		}, shot.orbit ?? 0);
		if (state.absent)
			return `${state.hull} · this build keeps no firing table: no plumes, no pulse`;
		if (state.lit.length === 0 || !state.cue?.linear || !state.cue?.angular)
			throw new Error(
				`vents placer: ${state.lit.length} vents fired, cue ${JSON.stringify(state.cue)}`,
			);
		const drawn = await page.evaluate(async () => {
			await new Promise((r) => requestAnimationFrame(() => r()));
			return window.__seelite.saturationRender;
		});
		const pulse = drawn
			? `markers at ${drawn.linear.toFixed(2)} (velocity) and ${drawn.angular.toFixed(2)} (nose) of their alpha`
			: "no glass this frame";
		return `${state.hull} at ${state.speedOverCap.toFixed(2)}× the cap, spinning · ${state.lit.length} vents firing · ${pulse}`;
	},
	/**
	 * #647's cruise turn: a real cruise leg, the hull spinning past its yaw
	 * envelope with the assist on, flown by the game's own `step` and held.
	 *
	 * **Read back, not assumed**: a leg that never reached cruise throws. A
	 * build before #647 records no firing in cruise; that is its honest
	 * `before`, and the caption says so rather than the run failing.
	 */
	"cruise-turn": async (page, shot) => {
		worldWritten = true;
		const state = await page.evaluate(holdCruiseTurnState, {
			spin: shot.spin,
			steps: shot.steps,
		});
		await page.evaluate((yaw) => {
			window.__seelite.chaseYaw = yaw;
		}, shot.orbit ?? 0);
		if (!state.engaged || !state.stillCruising)
			throw new Error(
				`cruise-turn placer: engaged ${state.engaged}, still cruising ${state.stillCruising}`,
			);
		await page.evaluate(
			() => new Promise((r) => requestAnimationFrame(() => r())),
		);
		if (state.lit.length === 0)
			return `${state.hull} in cruise, spinning · this build draws no vent for a cruise turn`;
		return `${state.hull} in cruise, spinning · ${state.lit.length} attitude vents firing (${state.lit.map((v) => v.slot).join(", ")}) · angular cue ${state.cue?.angular ? "latched" : "clear"}`;
	},
	/**
	 * Node #637's NPC plumes: the duel's raider flown by the game's own `step`,
	 * the clock held, the player placed off its stern.
	 *
	 * **Read back, not assumed**: a raider that fired nothing throws rather
	 * than capturing a quiet hull under this caption. A build before node #637
	 * keeps no table on the raider's contact; that is its honest `before`.
	 */
	"npc-vents": async (page, shot) => {
		worldWritten = true;
		const state = await page.evaluate(holdNpcVentState, {
			steps: shot.steps,
			behindKm: shot.behindKm,
		});
		await page.evaluate(
			() => new Promise((r) => requestAnimationFrame(() => r())),
		);
		if (state.absent)
			return `${state.name} (${state.hull}) · this build keeps no firing table for an NPC hull: no plumes`;
		if (state.lit.length === 0)
			throw new Error("npc-vents placer: the raider fired no vent");
		return `${state.name} (${state.hull}) off its stern · ${state.lit.length} vents firing (${state.lit.map((v) => v.slot).join(", ")})`;
	},
	/**
	 * #537's cruise light shift. A real leg to the farthest body, then the
	 * clock held and the look held at `intensity`.
	 *
	 * **Read back, not assumed**: a leg that never reached cruise throws rather
	 * than capturing normal flight under a cruise caption.
	 */
	cruise: async (page, shot) => {
		// Cruise moves the ship and spends charge; the next row boots clean.
		worldWritten = true;
		await page.evaluate(installCruiseLeg);
		const result = await page.evaluate((intensity) => {
			const g = window.__seelite;
			const leg = window.__cruiseLeg();
			if (leg.regime !== "cruise")
				return {
					error: `the leg to ${leg.to} is not in cruise (${leg.regime})`,
				};
			g.clockHeld = true;
			// A build before #537 has no handle: its frame is the streaks alone,
			// which is that build's honest `before`, and the caption says so.
			const held = typeof g.holdCruiseLight === "function";
			if (held) g.holdCruiseLight(intensity);
			return {
				to: leg.to,
				c: g.cruiseSpeedKms / g.units.C_KMS,
				held,
			};
		}, shot.intensity);
		if (result.error) throw new Error(`cruise placer: ${result.error}`);
		const look = result.held
			? `light shift held at ${shot.intensity}`
			: "no light shift on this build: the streaks alone";
		return `to ${result.to} at ${result.c.toFixed(1)} c · ${look}`;
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
	await writeFile(join(out, "index.html"), contactSheet(runs, VIEWS));
	return runs;
}

/**
 * The probe suite's lock, held for the whole capture (#84). The mid-traversal
 * views run on wall-clock time, so a capture beside a running suite puts the
 * ship somewhere else — the same failure a starved probe has, in a frame a
 * person then judges. Taken before the tree guard below, so the guard reads
 * the server as it is when the capture starts and not before a wait.
 */
await holdProbeLockOrExit(`capture-views --label ${LABEL}`);

/**
 * Which tree the server is serving — refused if it is not this one, and kept,
 * because the sheet prints it.
 *
 * **The value is the point here and not only the refusal.** A probe asserts
 * numbers a later reader can re-derive; a contact sheet is looked at by a
 * person with no way to tell which checkout the pixels came from. #123's
 * wrong-tree capture was caught by an arithmetic tell in a *probe*, not by
 * anyone looking at the sheet it produced. So the declaration goes into the
 * manifest and onto the sheet beside this process's own git ref.
 *
 * **It is a record of provenance, not a cross-check.** `view-set.mjs`'s
 * `servedBy` owns that argument; what matters here is the consequence for this
 * script. The guard throws unless the declared root is this tree, so a live run
 * cannot show the two disagreeing — which is only true while the *checked*
 * origin and the *navigated* one are the same. They were not for a round:
 * `guardedTree` resolves `PROBE_URL` and this took only the declaration from
 * it, so with that variable set the guard validated one server and the frames
 * came from another, with the validated server's root stamped on them. That is
 * #123's own failure rebuilt out of its fix. `SERVING` is the checked origin
 * and every navigation goes there.
 *
 * There is no file list any more — the guard used to fingerprint one, and a
 * module with no top-level numeric constants could not be pointed at, which for
 * this script meant the cockpit interior and the planet shaders. A declaration
 * is a property of the server, so that gap closed with it.
 */
const { origin: SERVING, served } = await guardedTree(ORIGIN);

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
/**
 * **While a chart row owns the pointer, the page sees only the capture's
 * pointer** — and it keeps a log of what it saw, for the chart rows' errors.
 *
 * A headed window also receives the physical cursor. During #540 a trusted
 * `pointerleave` reached the chart canvas at (733.2, 623.8), 62 ms after the
 * placer's move, at a coordinate no script used; every other pointer action in
 * this script is a coordinate-free DOM `click()`. It cleared the label in two
 * of six captures while the cursor wandered, and in three of three once it
 * rested over the window. So the chart rows' frame depended on where the person
 * running the capture had left their mouse.
 *
 * The chart placer declares where it put the pointer in
 * `window.__capturePointer`, and this capture-phase listener on `window`
 * stops any pointer or mouse event more than half a pixel from there before the
 * canvas sees it — non-bubbling `pointerleave` included, since the capture
 * phase runs through `window` for every event. The loop sets the declaration
 * at the top of every view — the park position for a chart row, `null` for
 * any other — so no other row is filtered. Dropped
 * events are logged with `dropped: true`, so a failure still shows them.
 */
await page.addInitScript(() => {
	const log = [];
	window.__captureEvents = log;
	window.__capturePointer = null;
	const pointerish = new Set([
		"pointermove",
		"pointerover",
		"pointerout",
		"pointerenter",
		"pointerleave",
		"mousemove",
		"mouseover",
		"mouseout",
		"mouseenter",
		"mouseleave",
	]);
	for (const type of [...pointerish, "blur", "focus", "visibilitychange"])
		window.addEventListener(
			type,
			(e) => {
				const own = window.__capturePointer;
				const dropped =
					own !== null &&
					pointerish.has(type) &&
					Math.hypot(e.clientX - own.x, e.clientY - own.y) > 0.5;
				if (dropped) e.stopImmediatePropagation();
				if (type.startsWith("mouse") && !dropped) return;
				const t = e.target;
				log.push({
					type,
					x: e.clientX,
					y: e.clientY,
					trusted: e.isTrusted,
					dropped,
					target:
						t instanceof Element
							? `${t.tagName.toLowerCase()}${t.id ? `#${t.id}` : ""}`
							: String(t),
					atMs: Math.round(performance.now()),
				});
				if (log.length > 16) log.shift();
			},
			{ capture: true },
		);
});
await installViewFraming(page);
await page.goto(
	gameUrl(SERVING, {
		seed: SEED,
		raider: "off",
		...MODEL_BOOT_PARAMS,
		"interiors-full": true,
	}),
	{
		waitUntil: "load",
	},
);
await bootedGame(page);
await applyCaptureSettings(page);
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
		await page.evaluate(() => window.__restoreHorizon?.());
		// **Any modal the previous view left up comes down first** (#381 S4).
		// The rebind modal is a full-screen overlay outside the canvas, and
		// nothing else in this loop resets the DOM — `ensureFixture` reloads
		// only when the seed changes and `setView` presses a key. So
		// `controls-rebind` left its modal standing and it was captured again
		// in `duel-glass`, the next view to frame the glass: 30.99% of that
		// frame moved against a same-build control of 0.00%, which reads
		// exactly like a regression in the duel HUD.
		//
		// Dismissed the way a player does, through the modal's own control,
		// rather than by removing the node: a `remove()` here would leave the
		// game still believing it is in the `capture` context, and the next
		// view would be flown with the sticks suspended.
		await page.evaluate(() => {
			document
				.querySelector("[data-capture-modal] [data-capture-cancel]")
				?.click();
		});
		// **And the pointer comes off whatever the previous view left it on.**
		// The chart rows are the only ones that move it (#540); every row after
		// them was framed with a pointer that never moved, and a cursor resting
		// over the cockpit's DOM puts a `:hover` into a frame that has nothing to
		// do with the chart. The chart placer relies on it to start unlabelled.
		// A chart row owns the pointer from the park on, so the filter never lapses
		// while the chart may be mounted: released first, the physical cursor got
		// in between the park and the placer and left another system labelled.
		// Every other row is released.
		await page.evaluate(
			(own) => {
				window.__capturePointer = own;
			},
			view.shot.kind === "chart" ? { x: 0, y: 0 } : null,
		);
		await page.mouse.move(0, 0);
		chartAimed = null;
		// **Not on the workbench**, which has no view cycle: `v` there is an
		// unbound key, so `setView` would press it eight times and then throw
		// about a view the game does not have — on a page that is not the game.
		if (view.shot.kind !== "workbench-interior") {
			// **The Shipyard rows dock and bank, which writes the world**, so they
			// need what the duel's next row gets: a boot with no save. Without it
			// the reload after the refinery's seed restores the seed-47 save an
			// earlier row flushed, its clock ahead of the one `__startClockAt`
			// puts back, and the dock's first write throws (#583).
			if (view.shot.kind === "shipyard-tab") worldWritten = true;
			// A follow jump saves its new system. Every NPC row needs a fresh home
			// boot, including the first one after the docked Shipyard fixtures.
			if (view.shot.kind === "npc-jump") worldWritten = true;
			// Before the view is set, because a page load resets the game to the
			// cockpit and would undo it.
			await ensureFixture(
				page,
				view.shot.seed ?? SEED,
				view.shot.system ?? null,
				view.shot.hull ?? "courier",
			);
			await setView(page, view.shot.view);
		} else {
			// The workbench is not the game and carries no seed. Its own
			// navigation leaves the page somewhere `ensureFixture` cannot reason
			// about, so the next view — there is none today — starts by navigating.
			currentSeed = null;
			currentSystem = null;
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
		// The chart's second readback, after the settle and the bake wait: the
		// label the placer confirmed has to still be drawn when the frame is.
		if (view.shot.kind === "chart")
			await assertChartHover(page, "before the shutter", view.shot, chartAimed);
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
		const fovDeg = await page.evaluate(
			() => window.__seelite?.nearCamera.fov ?? null,
		);
		const horizonFacts =
			view.shot.kind === "horizon"
				? assertHorizonFacts(
						await page.evaluate((s) => window.__measureHorizon(s), view.shot),
						view.shot,
					)
				: undefined;
		await page.screenshot({ path: join(OUT, file) });
		// And after it: a hover lost between the read above and the shutter would
		// otherwise ship an unlabelled frame under a green run (sage round 2). The
		// PNG is on disk by now; the throw stops the manifest and the sheet.
		if (view.shot.kind === "chart")
			await assertChartHover(page, "after the shutter", view.shot, chartAimed);
		captured.push({
			name: view.name,
			file,
			subject,
			gameTime,
			fovDeg,
			horizonFacts,
		});
		// A chart row says how many foreign pointer events the filter dropped, so
		// a green run shows whether the physical cursor was in play at all. The
		// log keeps the last sixteen, so the count is a floor.
		const foreign =
			view.shot.kind === "chart"
				? await page.evaluate(
						() =>
							(window.__captureEvents ?? []).filter((e) => e.dropped).length,
					)
				: null;
		console.log(
			`  ${view.name.padEnd(20)} ${view.shot.view.padEnd(8)} ${subject}${foreign ? ` · ${foreign} foreign pointer events dropped` : ""}`,
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
	cockpitFov: COCKPIT_FOV ?? "default",
	// The full-set tone report is deliberately absent from scoped captures.
	levelsFile: ONLY === null ? levelsFile(LABEL) : undefined,
	selectedViews: ONLY === null ? undefined : VIEWS.map((view) => view.name),
	views: captured,
};
// A failed tone reading must not leave an older complete-looking sheet.
await rm(join(OUT, "index.html"), { force: true });
if (ONLY === null) {
	const toneReport = await writeRunLevels(manifest, OUT);
	console.log(`\n${toneReport.table}`);
}
await writeFile(
	join(dir, "manifest.json"),
	`${JSON.stringify(manifest, null, "\t")}\n`,
);

const runs = await rebuildSheet(OUT);

console.log(
	`\n  ${captured.length} views → ${dir}\n  renderer: ${renderer}\n  sheet: ${join(OUT, "index.html")} (${runs.length} run${runs.length === 1 ? "" : "s"})`,
);
