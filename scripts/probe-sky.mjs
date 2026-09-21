/**
 * Node #431's browser tier: the derived sky is a picture of where the player
 * stands, and the texture behind it is not.
 *
 * `tests/backdrop.test.ts` owns the arithmetic — every bearing against
 * `galaxy-frame`, the size law, the colour rule. None of it can see the
 * renderer, and the three things that can only be seen here are:
 *
 * - **The buffers that reach the GPU are the ones the module returned.** A jump
 *   rebuilds the derived layer's geometry; a rebuild that wrote new bearings and
 *   left the old sizes mounted would draw a sky of the wrong brightness at the
 *   right bearings, and every headless row would stay green because each buffer
 *   is correct on its own. So the jump arm reads the *mounted* attributes and
 *   asks that the mounted sizes fall as the mounted distances rise.
 * - **Which layer was actually rebuilt.** Contents alone cannot answer that: a
 *   faint population rebuilt to identical bytes would pass a content check, and
 *   the design claim is that it is not rebuilt at all. So each read tags the
 *   `BufferGeometry` object it found and reports how many reads that same object
 *   has seen. After a jump the invented layer must still be on its **first**
 *   object and the derived layer must be on a **different** one — which is what
 *   `backdrop.ts` claims when it says the texture costs nothing ever again.
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
/** A seed whose first system has other systems in every direction, which every
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

	/** The mounted state of one backdrop layer, as the GPU sees it. */
	const mounted = (name) => {
		const layer = g.backdropScene.getObjectByName(name);
		if (!layer) return null;
		const geometry = layer.geometry;
		const position = geometry.getAttribute("position");
		const size = geometry.getAttribute("aSize");
		// The radius of *every* point rather than of the first one: a rebuild
		// that wrote unnormalised bearings past the head would otherwise pass.
		let min = Infinity;
		let max = 0;
		for (let i = 0; i < position.count; i++) {
			const r = Math.hypot(
				position.getX(i),
				position.getY(i),
				position.getZ(i),
			);
			if (r < min) min = r;
			if (r > max) max = r;
		}
		// A tag on the geometry *object*, so a swapped-in geometry shows up even
		// when its bytes come back identical. One read of the sky per page read,
		// so the count is the number of sky reads that object has survived.
		if (geometry.__skyProbeReads === undefined) geometry.__skyProbeReads = 0;
		geometry.__skyProbeReads += 1;
		// A 4,000-point layer serialised whole is 16,000 floats through CDP per
		// read, for a claim — "nothing was written here" — that a checksum answers
		// as well. The head slice stays so a red row prints something readable, and
		// the derived layer keeps its full arrays because the pairing check below
		// needs every size and distance.
		const checksum = (attr) => {
			const a = attr.array;
			let h = 0;
			for (let i = 0; i < a.length; i++) h = (h * 31 + a[i]) | 0;
			return h;
		};
		const whole = position.count <= 512;
		return {
			count: position.count,
			minRadius: min,
			maxRadius: max,
			positions: whole
				? Array.from(position.array)
				: Array.from(position.array.slice(0, 24)),
			sizes: whole
				? Array.from(size.array)
				: Array.from(size.array.slice(0, 24)),
			positionChecksum: checksum(position),
			sizeChecksum: checksum(size),
			// Which layer the renderer thinks it is drawing in, read back from
			// the parent chain rather than from the name.
			inBackdrop:
				layer.parent === g.backdropScene ||
				layer.parent?.parent === g.backdropScene,
			reads: geometry.__skyProbeReads,
		};
	};

	window.__skyProbe = {
		/** Both layers, plus the galaxy the page is standing in. */
		sky() {
			return {
				systemIndex: g.world.system.record.index,
				systemTotal: g.world.galaxy.systems.length,
				// Galaxy-space positions of every system. `systemField` emits its
				// points in `galaxy.systems` order with the observer skipped, so
				// dropping the observer here re-aligns the two.
				positions: g.world.galaxy.systems
					.filter((s) => s.index !== g.world.system.record.index)
					.map((s) => ({ x: s.pos.x, y: s.pos.y, z: s.pos.z })),
				observer: {
					x: g.world.system.record.pos.x,
					y: g.world.system.record.pos.y,
					z: g.world.system.record.pos.z,
				},
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

/** The mounted sizes fall as the mounted distances rise.
 *
 * The pairing claim, read off the buffers the GPU was handed. The layer's points
 * are index-aligned with the galaxy's other systems, so the distances can be
 * rebuilt here; if a rebuild ever wrote new bearings over old sizes — or the two
 * buffers were swapped — a nearby system would draw small and a far one large,
 * and every headless row would stay green because each buffer is correct alone. */
function mountedSizesFall(reading) {
	const layer = reading.systems;
	if (layer === null) return { ok: false, why: "no derived layer is mounted" };
	if (layer.sizes.length !== reading.positions.length)
		return {
			ok: false,
			why: `${layer.sizes.length} sizes for ${reading.positions.length} systems`,
		};
	const d = (a) =>
		Math.hypot(
			a.x - reading.observer.x,
			a.y - reading.observer.y,
			a.z - reading.observer.z,
		);
	const pairs = reading.positions
		.map((s, i) => ({ d: d(s), size: layer.sizes[i] }))
		.sort((a, b) => a.d - b.d);
	for (let i = 1; i < pairs.length; i++)
		if (pairs[i].size > pairs[i - 1].size + 1e-9)
			return {
				ok: false,
				why: `the system at ${pairs[i].d.toFixed(2)} ly draws ${pairs[
					i
				].size.toFixed(5)} against ${pairs[i - 1].size.toFixed(
					5,
				)} for the one at ${pairs[i - 1].d.toFixed(2)} ly`,
			};
	return {
		ok: true,
		why: `${pairs.length} mounted points, brightest at the closest`,
	};
}

const before = await page.evaluate(() => window.__skyProbe.sky());
const monotoneBefore = mountedSizesFall(before);

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
	"every point of both layers sits at the backdrop radius, not at its distance",
	[before.faint, before.systems].every(
		(layer) =>
			layer !== null &&
			layer.inBackdrop &&
			Math.abs(layer.minRadius - before.backdropRadius) < 1e-3 &&
			Math.abs(layer.maxRadius - before.backdropRadius) < 1e-3,
	),
	`the derived layer spans ${before.systems?.minRadius} to ${before.systems?.maxRadius} against the page's ${before.backdropRadius}`,
);

check(
	"at boot the mounted sizes fall as the mounted distances rise",
	monotoneBefore.ok,
	monotoneBefore.why,
);

const jumped = await page.evaluate(() => window.__skyProbe.jumpToNearest());

check(
	"a jump commits a course, charges the drive, and reaches another system",
	jumped.committed && jumped.charged && jumped.arrived,
	`system ${jumped.from} to ${jumped.to} across ${jumped.distanceLy.toFixed(
		2,
	)} ly — committed ${jumped.committed}, charged ${jumped.charged}`,
);

const after = await page.evaluate(() => window.__skyProbe.sky());

check(
	"a jump re-draws the derived sky onto a geometry that is not the one before",
	after.systems !== null &&
		after.systems.reads === 1 &&
		after.systems.positionChecksum !== before.systems.positionChecksum,
	`the mounted positions differ, and the mounted geometry has survived ${after.systems?.reads} read — the boot one was a different object`,
);

check(
	"a jump leaves the invented population on the geometry it booted with",
	after.faint !== null &&
		after.faint.reads === before.faint.reads + 1 &&
		after.faint.count === before.faint.count &&
		after.faint.positionChecksum === before.faint.positionChecksum &&
		after.faint.sizeChecksum === before.faint.sizeChecksum,
	`${after.faint?.count} points, same BufferGeometry after ${after.faint?.reads} reads, same position and aSize checksums`,
);

check(
	"the derived layer is still full after the arrival",
	after.systems !== null && after.systems.count === after.systemTotal - 1,
	`${after.systems?.count} for ${after.systemTotal} systems`,
);

// The row the probe was written for. A rebuild that wrote new bearings and kept
// the old sizes — or wrote both from a stale galaxy — draws the right sky at the
// wrong brightness, and only the *rebuilt* buffer can show it: the boot buffer
// pairs correctly by construction, because nothing has had the chance to go
// stale yet.
const monotoneAfter = mountedSizesFall(after);

check(
	"on the rebuilt buffer too, the mounted sizes fall as the distances rise",
	monotoneAfter.ok,
	monotoneAfter.why,
);

await browser.close();
exit();
