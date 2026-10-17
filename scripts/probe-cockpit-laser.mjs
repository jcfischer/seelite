/**
 * Node #806: in cockpit view a laser is hidden by every cabin fitting in
 * front of it.
 *
 * **What the player reported.** Flying the authored cockpit (#794), the
 * principal saw a fired laser drawn in front of the cabin's fittings. The
 * beam was never in the WebGL frame at all: `drawGunTracer` and
 * `drawEnemyBeam` (as they were then) stroked it on `#overlay`, the 2D canvas the page stacks
 * *over* the WebGL canvas, clipped only at `GLASS_BOTTOM_FRACTION` — the old
 * procedural cabin's glass line. #651's cabin pass, drawn after every world
 * layer over a cleared depth buffer, could not hide what was drawn on another
 * canvas, and the authored dash and canopy struts reach well above that line.
 *
 * **What this reads is what the player sees**: the WebGL canvas with the
 * overlay drawn on top of it, in the same task as `render(0)`
 * (`lib/composite-frame.mjs`) and with the loop stopped, so every arm is one
 * pose. Reading the WebGL canvas alone would
 * pass on the build with the defect, because that build's beam is not in it.
 *
 * **By difference, not by colour.** Each beam is drawn on one frame and not on
 * the next, and a pixel is the beam's if the two differ. A colour test would
 * move with the tone mapping, the bloom and the dither the beam now goes
 * through; the difference does not care what the beam looks like.
 *
 * **Where the cabin is** comes from a flat arm: every opaque cabin fitting in
 * flat green with every world layer drawing nothing, as `probe-cabin-pass`
 * does, eroded so a sampled edge cannot count. Inside it the beam must change
 * nothing. Outside it the beam must change something, or a build that drew no
 * beam at all would pass.
 *
 * **What it does not cover.** Transparent fittings — the canopy pane — are
 * left out of the footprint on purpose: a beam is outside the canopy and is
 * meant to be seen through it, so a pixel there counts as outside. It reads
 * one seed, one viewport and one raider pose (`forceRaider("ahead")`), so
 * "every fitting" means every opaque fitting in front of these two beams in
 * this frame; the cabin pass's own occlusion is what generalises it, and
 * `probe-cabin-pass` holds that.
 *
 * Two beams, two rows: the player's tracer, and the raider's beam while it
 * fires (`raiderFiring`), which is drawn toward the pilot below the glass and
 * so crosses the dash on its way.
 *
 * **Red on the build before node #806**: run against `fa3f6f8` (headed, M1 Pro,
 * 1280x800) the tracer changed 206 px and the raider's beam 250 px inside a
 * 48.6% footprint, the first of each at the dash top on the centre line,
 * against 0 for the same frame drawn twice.
 */
import {
	bootedGame,
	guardedOrigin,
	launchChromium,
	tally,
} from "./probe-guard.mjs";
import { installCompositeFrame } from "./lib/composite-frame.mjs";
import { gameUrl } from "./lib/game-url.mjs";
import { stopLoop } from "./lib/view-placement.mjs";

const ORIGIN =
	process.env.PROBE_ORIGIN ?? process.argv[2] ?? "http://localhost:5173";
/** Pixels trimmed off the footprint's edge before a row reads it. */
const ERODE_PX = 3;
/** A display code any channel must move by for a pixel to be the beam's. */
const MOVED = 24;
/** The fewest changed pixels outside the cabin a drawn beam must make. */
const SEEN_FLOOR_PX = 40;

const origin = await guardedOrigin(ORIGIN);
const browser = await launchChromium();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const { check, watch, exit } = tally();
watch(page);
await installCompositeFrame(page);
await page.goto(gameUrl(origin, { seed: 42, weaponsound: "crack" }));
await bootedGame(page);

// A live duel, flown to on fixed steps as `probe-gun-feedback` does, so a
// raider is listed and on screen ahead.
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
	return { phase: g.encounter?.phase ?? null, view: g.view };
});
check(
	"the probe reaches a live duel in the cockpit",
	setup.phase === "duel" && setup.view === "cockpit",
	JSON.stringify(setup),
);
await stopLoop(page);
// Record the fitted gun's actual muzzle through the firing path before
// freezing the scene and toggling its tracer for the pixel comparison.
const fired = await page.evaluate(() => {
	const g = window.__seelite;
	g.keys.add(" ");
	g.step(g.units.MAX_DT);
	g.keys.delete(" ");
	return g.gunFeedback.tracerLeftS > 0;
});
check("the player fires a fitted gun before measuring its tracer", fired);

const r = await page.evaluate(
	([erode, moved]) => {
		const g = window.__seelite;
		const Basic =
			g.cockpit.mesh.getObjectByName("scanner").material.constructor;
		if (Basic.name !== "MeshBasicMaterial")
			throw new Error(`scanner face is a ${Basic.name}`);
		const canvas = g.renderer.domElement;
		const W = canvas.width;
		const H = canvas.height;
		/** Render and read in one task: the WebGL canvas, then the overlay over
		 *  it, as the page stacks them. */
		const frame = () => window.__compositeFrame(W, H).data;

		// ---- the footprint: opaque cabin fittings green, the world drawing
		// nothing ----
		const cabin = new Set();
		g.cockpit.mesh.traverse((o) => cabin.add(o));
		const near = [];
		g.nearScene.traverse((o) => {
			if (!cabin.has(o)) near.push(o);
		});
		const materialOf = (o) =>
			Array.isArray(o.material) ? o.material[0] : o.material;
		const GREEN = new Basic({ color: 0x00ff00, toneMapped: false });
		const NOTHING = new Basic({ colorWrite: false, depthWrite: false });
		const swapped = [];
		const hidden = [];
		for (const o of cabin) {
			if (o === g.cockpit.mesh) continue;
			if (o.isMesh && !materialOf(o)?.transparent) {
				swapped.push([o, o.material]);
				o.material = GREEN;
			} else if (o.isMesh || o.isLine || o.isPoints || o.isSprite) {
				hidden.push([o, o.visible]);
				o.visible = false;
			}
		}
		for (const o of near)
			if (o.isMesh) {
				swapped.push([o, o.material]);
				o.material = NOTHING;
			} else if (o.isLine || o.isPoints || o.isSprite) {
				hidden.push([o, o.visible]);
				o.visible = false;
			}
		const layers = [g.backdropScene, g.farScene, g.approachScene];
		const layerWas = layers.map((s) => s.visible);
		for (const s of layers) s.visible = false;
		const firingWas = g.raiderFiring;
		const gunWas = g.gunFeedback;
		g.raiderFiring = false;
		g.gunFeedback = { ...gunWas, tracerLeftS: 0 };
		const flat = frame();
		for (const [o, m] of swapped) o.material = m;
		for (const [o, v] of hidden) o.visible = v;
		layers.forEach((s, i) => {
			s.visible = layerWas[i];
		});
		GREEN.dispose();
		NOTHING.dispose();

		const green = (d, i) => d[i + 1] > d[i] + 40 && d[i + 1] > d[i + 2] + 40;
		const inside = new Uint8Array(W * H);
		for (let p = 0; p < W * H; p++) inside[p] = green(flat, p * 4) ? 1 : 0;
		const core = new Uint8Array(W * H);
		let footprint = 0;
		for (let p = 0; p < W * H; p++) {
			if (inside[p] !== 1) continue;
			const x = p % W;
			const y = (p - x) / W;
			let ok = true;
			for (let dy = -erode; ok && dy <= erode; dy++)
				for (let dx = -erode; ok && dx <= erode; dx++) {
					const yy = y + dy;
					const xx = x + dx;
					if (yy < 0 || yy >= H || xx < 0 || xx >= W) ok = false;
					else if (inside[yy * W + xx] !== 1) ok = false;
				}
			if (ok) {
				core[p] = 1;
				footprint++;
			}
		}
		/** Changed pixels in and out of the footprint between two frames. */
		const diff = (a, b) => {
			let inCabin = 0;
			let outside = 0;
			let first = null;
			for (let p = 0; p < W * H; p++) {
				const i = p * 4;
				const d = Math.max(
					Math.abs(a[i] - b[i]),
					Math.abs(a[i + 1] - b[i + 1]),
					Math.abs(a[i + 2] - b[i + 2]),
				);
				if (d < moved) continue;
				if (core[p]) {
					inCabin++;
					if (!first) first = [p % W, Math.floor(p / W)];
				} else if (!inside[p]) outside++;
			}
			return { inCabin, outside, first };
		};

		// ---- the player's tracer ----
		g.gunFeedback = { ...gunWas, tracerLeftS: 0 };
		const quiet = frame();
		g.gunFeedback = { ...gunWas, tracerLeftS: 1 };
		const tracer = frame();
		const tracerVertices = g.beamLayer.vertexCount;
		g.gunFeedback = { ...gunWas, tracerLeftS: 0 };
		const quietAgain = frame();
		// ---- the raider's beam ----
		g.raiderFiring = true;
		const raider = frame();
		// Drawn means the frame pass drew it — the tracer is off in this arm, so
		// any vertex is the raider's — and the overlay recorded where. Either
		// alone can read true on a build that drew nothing: a record is not a
		// pixel (#69), and `undefined !== null`.
		const raiderDrawn =
			g.beamLayer.vertexCount > 0 &&
			g.hostileFireRender != null &&
			g.hostileFireRender.beam != null;
		g.raiderFiring = firingWas;
		g.gunFeedback = gunWas;
		g.render(0);
		return {
			W,
			H,
			footprintShare: footprint / (W * H),
			control: diff(quiet, quietAgain),
			tracer: diff(quiet, tracer),
			raider: diff(quietAgain, raider),
			raiderDrawn,
			tracerVertices,
		};
	},
	[ERODE_PX, MOVED],
);

const fmt = (d) =>
	`${d.inCabin} px changed inside the cabin, ${d.outside} outside` +
	(d.first ? `; first inside at ${JSON.stringify(d.first)}` : "");
check(
	"the cabin's footprint is a real share of the frame",
	r.footprintShare > 0.2,
	`${(r.footprintShare * 100).toFixed(1)}% of ${r.W}x${r.H}`,
);
check(
	"the same frame twice changes nothing (the control)",
	r.control.inCabin === 0 && r.control.outside === 0,
	fmt(r.control),
);
check(
	"a fired laser is hidden by every cabin fitting in front of it",
	r.tracerVertices > 0 &&
		r.tracer.inCabin === 0 &&
		r.tracer.outside >= SEEN_FLOOR_PX,
	`${r.tracerVertices} vertices drawn; ${fmt(r.tracer)}`,
);
check(
	"the raider's beam is hidden by the cabin on its way to the pilot",
	r.raiderDrawn && r.raider.inCabin === 0 && r.raider.outside >= SEEN_FLOOR_PX,
	`${r.raiderDrawn ? "drawn" : "not drawn"}; ${fmt(r.raider)}`,
);

await browser.close();
exit();
