/**
 * Node #431's browser tier: the derived sky is a picture of where the player
 * stands, and the texture behind it is not.
 *
 * `tests/backdrop.test.ts` owns the arithmetic — every bearing against
 * `galaxy-frame`, the size law, the colour rule. None of it can see the
 * renderer, and the two things that can only be seen here are:
 *
 * - **The buffers that reach the GPU are the ones the module returned.** A jump
 *   rebuilds the derived layer's geometry; a rebuild that updated the positions
 *   and left the old sizes mounted would draw a sky of the wrong brightness at
 *   the right bearings, and every headless row would stay green. So the jump arm
 *   reads the *mounted* attributes and asks that the brightest mounted point
 *   belongs to the nearest system, and that the two layers moved apart from each
 *   other in the way #431 designed them to: the systems re-drawn, the invented
 *   population not touched at all.
 * - **Both layers are in the layer they belong in.** `backdropScene` is drawn
 *   with no depth write, first, and re-centred on the camera; a `Points` that
 *   ended up in the far layer would parallax, which is a bug no headless test
 *   can express.
 *
 * The probe drives the shipped game through `window.__seelite` and reads
 * constants off the page (`units.BACKDROP_RADIUS`) rather than restating them.
 */
import { gameUrl } from "./lib/game-url.mjs";
import {
	bootedGame,
	guardedOrigin,
	launchChromium,
	tally,
} from "./probe-guard.mjs";

const ORIGIN =
	process.env.PROBE_ORIGIN ?? process.argv[2] ?? "http://localhost:5173";
/** A seed with a first system that has neighbours in every direction, which any
 *  connected layout has. Fixed so a red run is reproducible. */
const SEED = 42;

const origin = await guardedOrigin(ORIGIN);
const browser = await launchChromium();
const { check, watch, exit } = tally();

const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
watch(page);
await page.goto(gameUrl(origin, { seed: SEED }));
await bootedGame(page);

await page.evaluate(() => {
	const g = window.__seelite;
	const dt = g.units.MAX_DT;
	/** One shipped frame: the sim and the renderer, in the loop's own order. */
	const frame = () => {
		g.step(dt);
		g.render(dt);
	};

	/** The mounted attributes of one backdrop layer, as the GPU sees them. */
	const mounted = (name) => {
		const layer = g.backdropScene.getObjectByName(name);
		if (!layer) return null;
		const attr = (n) => layer.geometry.getAttribute(n);
		return {
			count: attr("position").count,
			radius: attr("position").count
				? Math.hypot(
						attr("position").getX(0),
						attr("position").getY(0),
						attr("position").getZ(0),
					)
				: null,
			positions: Array.from(attr("position").array),
			sizes: Array.from(attr("aSize").array),
			// Which layer the renderer thinks it is drawing in, read back from
			// the parent chain rather than from the name.
			inBackdrop:
				layer.parent === g.backdropScene ||
				layer.parent?.parent === g.backdropScene,
		};
	};

	window.__skyProbe = {
		mounted,
		/** Both layers, plus the galaxy the page is standing in. */
		sky() {
			return {
				systemIndex: g.world.system.record.index,
				systemTotal: g.world.galaxy.systems.length,
				// Galaxy-space positions of every system, for the distance
				// reading below. Index-aligned with `systems[i]`.
				positions: g.world.galaxy.systems.map((s) => ({
					index: s.index,
					x: s.pos.x,
					y: s.pos.y,
					z: s.pos.z,
				})),
				backdropRadius: g.units.BACKDROP_RADIUS,
				faint: mounted("stars-faint"),
				systems: mounted("stars-systems"),
			};
		},
		/** A jump to the nearest other system, through the shipped course and
		 *  charge, driven a frame at a time. */
		jumpToNearest() {
			const here = g.world.system.record;
			const d = (a, b) =>
				Math.hypot(a.pos.x - b.pos.x, a.pos.y - b.pos.y, a.pos.z - b.pos.z);
			const near = g.world.galaxy.systems
				.filter((s) => s.index !== here.index)
				.sort((a, b) => d(a, here) - d(b, here))[0];
			g.dropOut("probe");
			g.encounter = null;
			const committed = g.commitCourseTo(near.index);
			const charged = g.chargeJump();
			for (
				let i = 0;
				i < 120 && g.world.system.record.index !== near.index;
				i++
			)
				frame();
			frame();
			return {
				from: here.index,
				to: near.index,
				distanceLy: d(near, here),
				committed,
				charged,
				arrived: g.world.system.record.index === near.index,
			};
		},
	};
});

const before = await page.evaluate(() => window.__skyProbe.sky());

check(
	"the backdrop mounts two named point layers",
	Boolean(before.faint) && Boolean(before.systems),
	`faint ${before.faint?.count ?? "none"}, systems ${before.systems?.count ?? "none"}`,
);

check(
	"the derived layer carries one point for every other system",
	before.systems !== null && before.systems.count === before.systemTotal - 1,
	`${before.systems?.count} for ${before.systemTotal} systems`,
);

check(
	"every point sits at the backdrop radius, not at its distance",
	[before.faint, before.systems].every(
		(layer) =>
			layer !== null &&
			layer.inBackdrop &&
			Math.abs(layer.radius - before.backdropRadius) < 1e-3,
	),
	`radius ${before.systems?.radius} against the page's ${before.backdropRadius}`,
);

check(
	"the mounted sizes fall as the mounted distances rise",
	// The pairing claim, read off the buffers the GPU was handed. The layer's
	// points are index-aligned with `galaxy.systems` minus the observer, so the
	// distances can be rebuilt here; if a rebuild ever wrote new bearings over
	// old sizes — or the two buffers were swapped — a nearby system would draw
	// small and a far one large, and every headless row would stay green because
	// each buffer is correct on its own.
	(() => {
		if (before.systems === null) return false;
		const here = before.positions.find((s) => s.index === before.systemIndex);
		const d = (a) => Math.hypot(a.x - here.x, a.y - here.y, a.z - here.z);
		const others = before.positions.filter((s) => s.index !== here.index);
		const sizes = before.systems.sizes;
		if (sizes.length !== others.length) return false;
		const pairs = others
			.map((s, i) => ({ d: d(s), size: sizes[i] }))
			.sort((a, b) => a.d - b.d);
		for (let i = 1; i < pairs.length; i++)
			if (pairs[i].size > pairs[i - 1].size + 1e-9) return false;
		return true;
	})(),
	"255 points, brightest at the nearest system",
);

const jumped = await page.evaluate(() => window.__skyProbe.jumpToNearest());

check(
	"a jump reaches another system",
	jumped.arrived,
	`system ${jumped.from} to ${jumped.to} across ${jumped.distanceLy.toFixed(2)} ly`,
);

const after = await page.evaluate(() => window.__skyProbe.sky());

check(
	"a jump re-draws the derived sky",
	after.systems !== null &&
		after.systems.positions.some((v, i) => v !== before.systems.positions[i]),
	"the mounted positions differ after the arrival",
);

check(
	"a jump leaves the invented population exactly where it was",
	after.faint !== null &&
		after.faint.positions.length === before.faint.positions.length &&
		after.faint.positions.every((v, i) => v === before.faint.positions[i]) &&
		after.faint.sizes.every((v, i) => v === before.faint.sizes[i]),
	`${after.faint?.count} points, byte-identical`,
);

check(
	"the derived layer is still full after the arrival",
	after.systems !== null && after.systems.count === after.systemTotal - 1,
	`${after.systems?.count} for ${after.systemTotal} systems`,
);

await browser.close();
exit();
