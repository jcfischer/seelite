/**
 * https://github.com/jcfischer/seelite/issues/1325
 *
 * A sampled docking-waltz version loads its samples on approach and lets
 * them go on the way out. `?waltz=jazz-trio` (piano-grand-rich plus
 * bass-pizz) is the version; the probe stands the ship far from the
 * station, then inside the approach radius, and reads off the page when the
 * samples are all ready against the opening's length, then leaves the radius
 * and reads the held count back to zero.
 *
 * A default-layout probe (#381 D11): the F8 press is the trusted key that opens
 * the sound through the game's unlock listener.
 *
 * Where the browser offers no way to measure the sampler's memory, the
 * decoded recordings held are counted instead (`Music.heldSamples`).
 */
import { gameUrl } from "./lib/game-url.mjs";
import {
	bootedGame,
	guardedOrigin,
	installViewPlacement,
	launchChromium,
	tally,
} from "./probe-guard.mjs";

const SEED = 19;
const INTRO_S = 16.0;
const origin = await guardedOrigin(
	process.argv[2] ?? process.env.PROBE_ORIGIN ?? "http://127.0.0.1:5173",
);
const browser = await launchChromium();
const { check, watch, exit } = tally();

const page = await browser.newPage({ viewport: { width: 900, height: 620 } });
watch(page);
await installViewPlacement(page);
await page.goto(
	gameUrl(origin, { seed: SEED, raider: "off", waltz: "jazz-trio" }),
);
await bootedGame(page);
await page.keyboard.press("F8");

const run = await page.evaluate(async () => {
	const { VICINITY_KM } = await import("/src/docking.ts");
	const g = window.__seelite;
	const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
	for (let i = 0; i < 50 && !g.music.ready; i++) await sleep(100);
	await sleep(1500);
	const station = g.world.system.contents.stations.find(
		(s) => s.type !== "outpost",
	);
	const snap = g.dockingSnapshot(station.id);
	const stand = (km) =>
		window.__viewAlongAxis(station.id, km, { comoving: true });
	const held = () => ({
		count: g.music.heldSamples,
		sets: [...g.music.heldSampleSets].sort(),
	});
	const out = { ready: g.music.ready, vicinityKm: VICINITY_KM };

	await stand(VICINITY_KM * 4);
	await sleep(1500);
	out.far = held();

	const t0 = performance.now();
	await stand(snap.planeKm + 4.5);
	let started = null;
	for (let i = 0; i < 600 && started === null; i++) {
		if (g.music.heldSampleSets.length > 0) started = performance.now() - t0;
		else await sleep(50);
	}
	out.startedMs = started;
	await g.music.samplesReady();
	out.readyMs = performance.now() - t0;
	out.near = held();
	out.errors = g.music.errors.filter((e) => e.startsWith("sample set"));

	await stand(VICINITY_KM * 4);
	await sleep(1500);
	out.after = held();
	return out;
});

check("the worklet is ready", run.ready, JSON.stringify(run.far));
check(
	"far from the station nothing is held",
	run.far.count === 0 && run.far.sets.length === 0,
	JSON.stringify(run.far),
);
check(
	"inside the approach radius the version's two sample sets load",
	run.startedMs !== null &&
		run.near.sets.join() === "bass-pizz,piano-grand-rich" &&
		run.near.count > 0,
	JSON.stringify({ near: run.near, failed: run.errors.length }),
);
console.log(
	`samples all ready ${(run.readyMs / 1000).toFixed(2)} s after the approach began, ` +
		`against an opening of ${INTRO_S.toFixed(1)} s; ${run.near.count} decoded recordings held, ${run.errors.length} failed to load (a checkout holding Git LFS pointers cannot decode them: the parts then play their synth fallback)`,
);
check(
	"every failure is named and the run goes on",
	run.errors.every((e) => /did not load/.test(e)),
	JSON.stringify(run.errors.slice(0, 3)),
);
check(
	"leaving the radius without docking releases every sample",
	run.after.count === 0 && run.after.sets.length === 0,
	JSON.stringify(run.after),
);
await browser.close();
exit();
