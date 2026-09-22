/**
 * Node #431's browser tier: the derived sky is a picture of where the player
 * stands, and the texture behind it is not.
 *
 * `tests/backdrop.test.ts` owns the arithmetic — every bearing against
 * `galaxy-frame`, the size law, the colour rule. None of it can see the
 * renderer, and the three things that can only be seen here are:
 *
 * - **The buffers mounted on the scene graph are the ones the module returned.**
 *   A jump rebuilds the derived layer's geometry; a rebuild that wrote new
 *   bearings and left the old sizes mounted would draw a sky of the wrong
 *   brightness at the right bearings, and every headless row would stay green
 *   because each buffer is correct on its own. So the jump arm reads the
 *   *mounted* attributes and asks that the mounted sizes fall as the mounted
 *   distances rise.
 *
 * **What this probe reads, exactly, and what it cannot see.** Every attribute
 * reading here is `geometry.getAttribute(...)` — the CPU-side `BufferAttribute`
 * the module handed to the geometry the scene graph is drawing with — plus the
 * geometry's own identity and the layer's parent chain. Nothing here renders or
 * reads a pixel back, so **a draw call that never happened, or an upload that the
 * driver dropped, passes every check in this file**; the claim that the sky is
 * actually on
 * screen belongs to `probe-output-stage.mjs`, which counts lit pixels of the
 * composited frame (`the backdrop is still there when the frame is multisampled`).
 * That row is a floor on **the backdrop as a whole**, and it predates this PR: it
 * would go red on a backdrop that stopped drawing, and it is not shown to
 * distinguish a missing 255-point derived layer from the 4,000 invented points
 * still drawing behind it. Nobody has read the derived layer's pixels on their own,
 * and the look of the thing is #433's sheet in any case. Naming that boundary is the
 * honest version of a docstring that used to say "reaches the GPU": the checks
 * below are the ones only a browser can do, because they read the objects a live
 * renderer is holding rather than ones a test built, and that is a different claim
 * from saying anything about what the GPU painted.
 * - **Which layer was actually rebuilt.** Contents alone cannot answer that: a
 *   faint population rebuilt to identical bytes would pass a content check, and
 *   the design claim is that it is not rebuilt at all. So each read tags the
 *   `BufferGeometry` object it found, by its `uuid`. After a jump the invented
 *   layer must still be on the **same** object and the derived layer on a
 *   **different** one — which is what
 *   `backdrop.ts` claims when it says the texture costs nothing ever again.
 * - **Both layers are in the layer they belong in.** `backdropScene` is drawn
 *   with no depth write, first, and re-centred on the camera; a `Points` that
 *   ended up in the far layer would parallax, which is a bug no headless test
 *   can express — the parallax itself is read on the sheet, but the parentage
 *   that causes it is read here.
 *
 * #432's two rows read the one thing no headless row can: that `?system=` moved a
 * *running* game to a system the generator did not pick. The row it was built for
 * — a `deep-sky` frame aimed along the Core bearing — was measured, judged on the
 * sheet, and removed; `scripts/measure-sky-density.ts`'s field arm is the reading
 * that decided it, and the note beside `sky-only` in `lib/view-set.mjs` is the
 * account. What the affordance outlived the row for, and what these two rows
 * hold, is the way to stand anywhere at all.
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
		// The geometry's own `uuid`, read rather than written: it identifies the
		// *object*, so a swapped-in geometry shows up even when its bytes come back
		// identical, and this probe no longer leaves bookkeeping on a live
		// `BufferGeometry` the renderer owns. (It did, as a counter of sky reads —
		// instrumentation state leaking into runtime objects, for an identity
		// question three.js already answers.)
		// A 4,000-point layer serialised whole is 16,000 floats through CDP per
		// read, for a claim — "nothing was written here" — that a checksum answers
		// as well. The head slice stays so a red row prints something readable, and
		// the derived layer keeps its full arrays because the pairing check below
		// needs every size and distance.
		// Folded over the buffer's **bytes**, not over the values. Hashing the
		// values and truncating with `|0` at each step is the mistake this
		// replaces: every `aSize` lies between 0.0048 and 0.055, so each one
		// truncates to zero and the size checksum is identically 0 for every
		// sky ever drawn — a check that cannot fail, which is the one thing
		// this node has now been told about three times.
		const checksum = (attr) => {
			const a = attr.array;
			const words = new Uint32Array(a.buffer, a.byteOffset, a.length);
			let h = 2166136261;
			// `Math.imul`, not `*`. The multiply reaches 2^55, which is past what a
			// double's mantissa carries exactly, so the low bits that `| 0` keeps
			// are already rounded away before the truncation — an FNV-1a that
			// quietly discards the part of each step it exists to mix. This digest
			// *is* the byte-identity claim, so its collision resistance is the
			// check rather than an implementation detail of it.
			for (let i = 0; i < words.length; i++)
				h = Math.imul(h ^ words[i], 16777619);
			return h;
		};
		const whole = position.count <= 512;
		return {
			count: position.count,
			minRadius: min,
			maxRadius: max,
			// No `positions` array: every check that needed the bearings does it
			// through `minRadius`/`maxRadius`/`positionChecksum`, and shipping a
			// 12,000-float slice that no row prints is the payload this file's
			// checksum was added to replace. `sizes` stays because
			// `mountedSizesFall` pairs them against the galaxy's distances.
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
			// Three's stable per-object identity, truncated only for the detail
			// string; compared whole.
			uuid: geometry.uuid,
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
	// Both sides read through `?.`, because a layer that never mounted must cost
	// this row and the ones after it a **red check**, not a TypeError that ends the
	// run with four rows unreported. `undefined !== undefined` is false, so a
	// missing layer on either side fails the row it belongs to and the probe keeps
	// printing. The `!== null` guards stay for the same reason: they name which
	// side is missing in the failing detail below.
	after.systems !== null &&
		before.systems !== null &&
		before.systems.uuid !== after.systems.uuid &&
		after.systems.positionChecksum !== before.systems.positionChecksum,
	`the mounted bytes differ, and the mounted geometry is ${after.systems?.uuid?.slice(0, 8)} against the boot ${before.systems?.uuid?.slice(0, 8)}`,
);

check(
	"a jump leaves the invented population on the geometry it booted with",
	after.faint !== null &&
		before.faint !== null &&
		after.faint.uuid === before.faint.uuid &&
		after.faint.count === before.faint.count &&
		after.faint.positionChecksum === before.faint.positionChecksum &&
		after.faint.sizeChecksum === before.faint.sizeChecksum,
	`${after.faint?.count} points on the boot geometry ${after.faint?.uuid?.slice(0, 8)}, same position and aSize checksums`,
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

// ---------------------------------------------------------------------------
// #432: `?system=` reaches a system the game would not have booted at.
//
// The headless tier holds the parse (`boot-system.test.ts`), the boot plan
// (`commander-flow.test.ts`) and the world built at a named index
// (`world-restore.test.ts`). What it cannot hold is that the three agree through a
// *running* page: `querySystem`, `planBoot` and `makeWorldAtSystem` are wired
// inside `main.ts`, which builds a renderer at module scope and so cannot be
// imported under bun. Two rows close that gap, and neither of them names a
// system.
//
// **The index is read off the page it is asked of.** The start system and the
// length of the galaxy both come from the booted world, and the probe asks for
// one seven along, wrapped inside that galaxy — so it is asking for a system the
// generator did not pick and one that exists, without either figure being copied
// here. A probe holding its own copy of a fixture is a probe that keeps passing
// after the thing it exists to test has moved.
//
// The second row asks for one index past the end and expects the page's own
// politeness — say it, and boot the start system — because `capture-views.mjs`
// refuses that case loudly, and the two halves of one affordance disagreeing is
// not something a contact sheet should be the one to find out.
// ---------------------------------------------------------------------------

const booted = await page.evaluate(() => {
	const g = window.__seelite;
	return {
		start: g.world.system.record.index,
		count: g.world.galaxy.systems.length,
	};
});

/** Seven along from where the game put the ship, wrapped inside this galaxy. */
const asked = (booted.start + 7) % booted.count;

await page.goto(gameUrl(origin, { seed: SEED, system: asked }));
await bootedGame(page);
const elsewhere = await page.evaluate(
	() => window.__seelite.world.system.record.index,
);

check(
	"`?system=` boots the running game at the system it was asked for",
	elsewhere === asked && asked !== booted.start,
	`asked for ${asked}, standing in system ${elsewhere}; the game boots at ${booted.start} on its own, so arriving elsewhere is the whole of the affordance`,
);

const said = [];
page.on("console", (message) => {
	if (message.type() === "warning" || message.type() === "error")
		said.push(message.text());
});
await page.goto(gameUrl(origin, { seed: SEED, system: booted.count }));
await bootedGame(page);
const refused = await page.evaluate(
	() => window.__seelite.world.system.record.index,
);

check(
	"an index the galaxy does not have is said, and the start system boots instead",
	refused === booted.start &&
		said.some((w) => w.includes(`?system=${booted.count}`)),
	`${refused === booted.start ? `system ${refused} booted, the start system, not clamped to the last index` : `system ${refused} booted for an index the galaxy does not have`}${said.some((w) => w.includes(`?system=${booted.count}`)) ? ", and the refusal was said in the console" : ", and nothing was said about it"}`,
);

await browser.close();
exit();
