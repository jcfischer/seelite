/**
 * The pulse laser, fired the way a player fires it (#324).
 *
 * **Why this probe exists.** `probe-interdiction.mjs` fires with
 * `g.keys.add(" ")` and reads the ship's heat, and that stayed green while the
 * principal's first flight found Space and the mouse dead. They were not dead:
 * a real key press moved heat from 0 to 1.3 in 0.8 s. The screen showed nothing,
 * and no sound played. So every check here drives a **real** input — the
 * keyboard, the mouse, or the fake pad the gamepad probes use — and reads what
 * the player gets: tracer pixels on the overlay and the shot sound.
 *
 * The controller's other bindings (L2/R2 throttle, L1/R1 target, Square not
 * trimming) are `probe-gamepad.mjs`'s, so one remap edits one probe (sage #328).
 */
// A default-layout probe (#381 D11): it presses keys by name, as the shipped
// layout binds them, and a moved default turns it red for that reason.
import { installFakePad, STANDARD_INDEX } from "./lib/fake-pad.mjs";
import {
	bootedGame,
	guardedOrigin,
	launchChromium,
	tally,
} from "./probe-guard.mjs";
import { gameUrl } from "./lib/game-url.mjs";

const ORIGIN =
	process.env.PROBE_ORIGIN ?? process.argv[2] ?? "http://localhost:5173";
const origin = await guardedOrigin(ORIGIN);
const browser = await launchChromium();
const { check, watch, exit } = tally();

const W = 900;
const H = 620;
const page = await browser.newPage({ viewport: { width: W, height: H } });
watch(page);
await page.addInitScript(installFakePad);
// This file used to carry `HTMLElement.prototype.requestPointerLock = () =>
// Promise.resolve()` here, on the stated ground that headless Chromium refuses
// the lock and the refusal reached the run as a page error. That was true, and it
// was the game's error rather than the environment's: the click handler dropped
// the promise, so every refused lock was an unhandled rejection. #371 reads the
// refusal, so the stub is gone — and this probe clicking a real canvas with a
// real pointer-lock request still standing, with `watch` reporting nothing, is
// where that is checked. `probe-pointer-lock.mjs` counts the refusals directly.
// On the `crack` arm: the default laser since the principal's ruling on #545
// is a sustained beam, a loop with no shot cue to count, and
// `probe-weapon-sound.mjs` holds that loop. The shot's pacing, which these
// rows count, is the crack's.
await page.goto(gameUrl(origin, { seed: 42, weaponsound: "crack" }));
await bootedGame(page);

// A live duel, flown to on fixed steps, then left to the game's own loop so the
// real inputs below are read the way a player's are.
const setup = await page.evaluate(() => {
	const g = window.__seelite;
	const dt = g.units.MAX_DT;
	g.resetFlightToStart();
	let far = null;
	let farKm = 0;
	for (const b of g.world.system.bodies) {
		const d = Math.hypot(
			b.pos.x - g.world.ship.pos.x,
			b.pos.y - g.world.ship.pos.y,
			b.pos.z - g.world.ship.pos.z,
		);
		if (b.kind !== "star" && d > farKm) {
			far = b;
			farKm = d;
		}
	}
	g.targetId = far.id;
	g.faceTarget?.();
	g.engageCruise();
	for (let i = 0; i < 100 && g.regime !== "cruise"; i++) g.step(dt);
	g.forceRaider("ahead", 0.5, 12);
	for (let i = 0; i < 900 && g.encounter?.phase !== "duel"; i++) {
		g.step(dt);
		g.render(dt);
	}
	// Laser cues into the engine's one entry point (#552), counted on the way
	// through; the shipped `play` still plays them.
	window.__shots = 0;
	const play = g.audio.play.bind(g.audio);
	g.audio.play = (cue) => {
		if (cue.kind === "laser") window.__shots += 1;
		play(cue);
	};
	// Frames the game actually ran, so the pacing check knows how many sounds
	// an unpaced gun would have made.
	window.__frameCount = 0;
	const count = () => {
		window.__frameCount += 1;
		requestAnimationFrame(count);
	};
	requestAnimationFrame(count);
	return { phase: g.encounter?.phase ?? null, view: g.view };
});
check(
	"the probe reaches a live duel in the cockpit",
	setup.phase === "duel" && setup.view === "cockpit",
	JSON.stringify(setup),
);

/**
 * Tracer pixels, sampled on the tracer's own line three quarters of the way
 * from the left port to the sightline — both read off the page's `gunTracer`,
 * not restated — and the state that drew them.
 *
 * **Off the composited frame, not the overlay** (node #806). The cockpit's
 * tracer is drawn into the WebGL frame behind the cabin now, and chase's stays
 * on the overlay, so the sample is the WebGL canvas with the overlay over it,
 * rendered and read in one task. Three quarters along rather than halfway,
 * because the port is behind the dash and the half nearest it is hidden by
 * design. The cyan band admits the frame's tone-mapped beam as well as the
 * overlay's: ACES desaturates the red channel up to about 170.
 */
const sample = () =>
	page.evaluate(
		([w, h]) => {
			const g = window.__seelite;
			const [port] = g.gunTracer.ports;
			const aim = g.gunTracer.aim;
			g.render(0);
			const canvas = g.renderer.domElement;
			const scratch = document.createElement("canvas");
			scratch.width = w;
			scratch.height = h;
			const ctx = scratch.getContext("2d", { willReadFrequently: true });
			ctx.drawImage(canvas, 0, 0, w, h);
			ctx.drawImage(document.getElementById("overlay"), 0, 0, w, h);
			const x = Math.round(w * (port.x + (aim.x - port.x) * 0.75));
			const y = Math.round(h * (port.y + (aim.y - port.y) * 0.75));
			const data = ctx.getImageData(x - 6, y - 6, 12, 12).data;
			let cyan = 0;
			for (let i = 0; i < data.length; i += 4)
				if (
					data[i + 1] > 200 &&
					data[i + 2] > 215 &&
					data[i] < data[i + 1] - 40
				)
					cyan++;
			return {
				cyan,
				tracerLeftS: g.gunFeedback.tracerLeftS,
				heat: g.condition.heat,
				shots: window.__shots,
				gameTime: g.world.gameTime,
				frames: window.__frameCount,
				view: g.view,
			};
		},
		[W, H],
	);
const settle = (ms) => page.waitForTimeout(ms);

/** Press, hold for `holdMs`, sample; release, let the tracer lapse, sample. */
const heldAndReleased = async (press, release, holdMs = 350) => {
	const before = await sample();
	await press();
	await settle(holdMs);
	const held = await sample();
	await release();
	await settle(600);
	return { before, held, released: await sample() };
};

// ---------------------------------------------------------------------------
// The keyboard, held long enough to tell a paced sound from one per frame.
// ---------------------------------------------------------------------------
await settle(400);
const space = await heldAndReleased(
	() => page.keyboard.down("Space"),
	() => page.keyboard.up("Space"),
	900,
);
check(
	"no tracer is drawn before the trigger is pulled",
	space.before.cyan === 0 && space.before.tracerLeftS === 0,
	JSON.stringify(space.before),
);
check(
	"a real Space press draws the tracer on the glass",
	space.held.cyan > 0 && space.held.heat > space.before.heat,
	JSON.stringify(space.held),
);
{
	const gap = await page.evaluate(() => window.__seelite.gunTracer.soundGapS);
	const heldS = space.held.gameTime - space.before.gameTime;
	const sounds = space.held.shots - space.before.shots;
	const frames = space.held.frames - space.before.frames;
	// One at once and one per full gap, with one of slack at each sample edge.
	const pacedBound = Math.floor(heldS / gap) + 2;
	check(
		"the shot sound plays, paced rather than once per frame",
		// The frames must outnumber the bound, or an unpaced gun would pass too.
		frames > pacedBound && sounds >= 1 && sounds <= pacedBound,
		`${sounds} sounds over ${heldS.toFixed(2)} s and ${frames} frames; paced bound ${pacedBound}`,
	);
}
check(
	"releasing Space clears the tracer",
	space.released.cyan === 0 && space.released.tracerLeftS === 0,
	JSON.stringify(space.released),
);

// ---------------------------------------------------------------------------
// The mouse.
// ---------------------------------------------------------------------------
await page.mouse.move(W / 2, H * 0.3);
const click = await heldAndReleased(
	() => page.mouse.down(),
	() => page.mouse.up(),
);
check(
	"a real left click held on the canvas draws the tracer and sounds",
	click.held.cyan > 0 && click.held.shots > click.before.shots,
	JSON.stringify(click.held),
);
check(
	"releasing the mouse clears it",
	click.released.cyan === 0,
	JSON.stringify(click.released),
);

// ---------------------------------------------------------------------------
// The controller's trigger.
// ---------------------------------------------------------------------------
const pad = await heldAndReleased(
	() => page.evaluate((i) => window.__pad.hold(i, 1), STANDARD_INDEX.x),
	() => page.evaluate((i) => window.__pad.release(i), STANDARD_INDEX.x),
);
check(
	"Square held fires the pulse laser, with the tracer and the sound",
	pad.held.cyan > 0 && pad.held.shots > pad.before.shots,
	JSON.stringify(pad.held),
);
check(
	"releasing Square clears the tracer",
	pad.released.cyan === 0,
	JSON.stringify(pad.released),
);

// ---------------------------------------------------------------------------
// Chase view: no glass, and the shot must still show (sage #328).
// ---------------------------------------------------------------------------
await page.keyboard.press("v");
await settle(300);
const chase = await heldAndReleased(
	() => page.keyboard.down("Space"),
	() => page.keyboard.up("Space"),
);
check(
	"in chase view a held trigger still draws the tracer",
	chase.held.view === "chase" && chase.held.cyan > 0,
	JSON.stringify(chase.held),
);

await browser.close();
exit();
