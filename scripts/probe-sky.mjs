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
 * #432's four rows arrive with the row that aims at the cluster's core, and read
 * the two things no headless row can: that `?system=` moved the *page* to the
 * system the row names, and that the frame it aims at holds the cone. The
 * fixture — seed and system alike — is read out of `view-set.mjs` rather than
 * restated here, because a probe holding its own copy of the thing it exists to
 * photograph keeps passing after the photograph has moved.
 *
 * The probe drives the shipped game through `window.__seelite` and reads
 * constants off the page (`units.BACKDROP_RADIUS`) rather than restating them.
 */
import { gameUrl } from "./lib/game-url.mjs";
import { SEED as VIEW_SEED, VIEWS } from "./lib/view-set.mjs";
import { installViewFraming } from "./lib/view-placement.mjs";
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

/**
 * The canonical row #432 added, read out of the view set rather than restated.
 *
 * The rim system's index is that file's to own — `tests/view-set.test.ts` holds
 * the rule that picked it — and a probe with its own copy of the fixture is a
 * probe that keeps passing after the row it exists to test has moved. The row
 * missing at all is refused here, before a browser is launched, because the four
 * rows below would otherwise report a share of `NaN`.
 */
const coreRow = VIEWS.find((v) => v.shot?.aim === "core");
if (!coreRow)
	throw new Error(
		"probe-sky: the view set declares no `deep-sky` row aimed at the cluster's core — #432's rows have nothing to aim at",
	);

const origin = await guardedOrigin(ORIGIN);
const browser = await launchChromium();
const { check, watch, exit } = tally();

const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
watch(page);
// #432's rows aim the shipped game with the same vocabulary the canonical
// capture aims it with — `__lookAt`, `__coreBearingHere`,
// `__emptiestDirection` — rather than with a second copy of the framing that
// would then be the thing measured instead of the thing shipped.
await installViewFraming(page);
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
// #432: standing at a named system, and what the frame there holds.
//
// The headless tier holds the arithmetic and the fixture rule. What it cannot
// hold is either half of what this node is actually for: that the affordance
// moves a *running game* to the system a row names — `planBoot` and
// `makeWorldAtSystem` have to agree through a browser boot for that — and that
// the heading the row aims along is where the cone of cluster light is, which is
// only measurable against the bearings a live renderer is holding.
//
// **Nothing below quotes a figure of its own.** A share of one seeded sky at one
// instant is a property of that world, and #1's constraint is that such a number
// earns its place as a ratio or a bound: the Core bearing is judged against the
// crowdest heading a search can find, the old rule's heading against the new
// one's, the rim's frame against the centre's frame on the same seed. The one
// absolute printed is a frame's share of a uniform sphere — a reference for
// reading the percentages, not a threshold, and labelled where it appears.
//
// What this still does not do is read a pixel. Every number below comes off the
// mounted `BufferAttribute` and the camera's own matrix, so — as above — a frame
// that never drew would pass, and the look of the cone is the sheet's to judge.
// ---------------------------------------------------------------------------

/**
 * Aim the shipped game from where it stands, and read what its frame holds.
 *
 * The frame is read as a box in angle off the camera that draws the sky — the
 * same `tan θ / tan(fov/2)` form `main.ts` uses for its own projection — because
 * the question is what is *inside the frame*, and an angular radius is not a
 * frustum test. The aiming is `__aimAlong`, the same call the capture makes, so
 * what is measured here is the framing that ships.
 *
 * **And a heading is scored against a search, not against the anti-aim.** The
 * first cut of the cone row compared the Core bearing with
 * `__emptiestDirection` — a search whose whole purpose is finding the minimum —
 * which any heading at all beats, cone or no cone. So the page now scores 512
 * candidate headings itself and the row asks whether the shipped transform's
 * bearing is at the crowdest place there is.
 */
const frameReading = (which) =>
	page.evaluate(async (rule) => {
		const g = window.__seelite;
		const record = g.world.system.record;
		const ship = g.world.ship.pos;
		const d = await window.__aimAlong(rule);

		const cam = g.backdropCamera;
		cam.updateMatrixWorld(true);
		const tanV = Math.tan((cam.fov * Math.PI) / 360);
		const tanH = tanV * cam.aspect;
		const e = cam.matrixWorld.elements;
		const right = [e[0], e[1], e[2]];
		const up = [e[4], e[5], e[6]];
		// three's camera looks down its own -Z.
		const fwd = [-e[8], -e[9], -e[10]];
		const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
		// Homogeneous in the vector's length, so the sky's radius and a body's
		// distance both pass straight through it unnormalised.
		const inFrame = (v, padTan = 0) => {
			const z = dot3(v, fwd);
			if (z <= 0) return false;
			return (
				Math.abs(dot3(v, right) / z) <= tanH + padTan &&
				Math.abs(dot3(v, up) / z) <= tanV + padTan
			);
		};
		// What a heading of this frame's own solid angle would hold if the sky were
		// uniform: the rectangular pyramid's solid angle over the sphere's 4π.
		// Printed as a reference, never as a threshold — the derived sky is not
		// uniform, which is the entire subject.
		const isoShare =
			(4 * Math.asin(Math.sin(Math.atan(tanH)) * Math.sin(Math.atan(tanV)))) /
			(4 * Math.PI);

		const sky = g.backdropScene
			.getObjectByName("stars-systems")
			.geometry.getAttribute("position");
		const unit = (v) => {
			const l = Math.hypot(v[0], v[1], v[2]);
			return [v[0] / l, v[1] / l, v[2] / l];
		};
		// The heading the ship was just turned along, as the triples this file's
		// arithmetic runs on. `__aimAlong` hands back a `Vec3`.
		const bearing = unit([d.x, d.y, d.z]);
		const bearings = [];
		let lit = 0;
		for (let i = 0; i < sky.count; i++) {
			const v = [sky.getX(i), sky.getY(i), sky.getZ(i)];
			bearings.push(unit(v));
			if (inFrame(v)) lit++;
		}

		// A cone rather than the box for the search: a candidate heading has no
		// roll to be measured against, and the question is *where the crowd is*.
		// Its half-angle is the frame's own vertical one, read off the same camera.
		const coneCos = Math.cos(Math.atan(tanV));
		const inCone = (c) => {
			let n = 0;
			for (const b of bearings) if (dot3(c, b) >= coneCos) n++;
			return n;
		};
		const N = 512;
		const golden = Math.PI * (3 - Math.sqrt(5));
		let best = { held: -1, at: null };
		for (let i = 0; i < N; i++) {
			const y = 1 - (i / (N - 1)) * 2;
			const r = Math.sqrt(Math.max(0, 1 - y * y));
			const t = golden * i;
			const c = [Math.cos(t) * r, y, Math.sin(t) * r];
			const held = inCone(c);
			if (held > best.held) best = { held, at: c };
		}
		const atBearing = inCone(bearing);
		const offDeg =
			(Math.acos(Math.min(1, dot3(bearing, best.at))) * 180) / Math.PI;

		// What could be the frame's subject instead of the sky. A disc counts by
		// the frame growing by the disc's own tangent, which is the conservative
		// direction: a sliver of a planet over the edge is reported as in frame.
		const subjects = [];
		for (const b of g.world.system.bodies) {
			const to = [b.pos.x - ship.x, b.pos.y - ship.y, b.pos.z - ship.z];
			const dist = Math.hypot(to[0], to[1], to[2]);
			if (dist <= b.radiusKm || inFrame(to, b.radiusKm / dist))
				subjects.push(b.id);
		}
		return {
			index: record.index,
			name: record.name,
			t: record.t,
			lit,
			total: sky.count,
			subjects,
			isoShare,
			coneDeg: (Math.atan(tanV) * 180) / Math.PI,
			atBearing,
			bestHeld: best.held,
			offDeg,
		};
	}, which);

await page.goto(
	gameUrl(origin, {
		seed: VIEW_SEED,
		raider: "off",
		system: coreRow.shot.system,
	}),
);
await bootedGame(page);

const atCore = await frameReading("core");
const atEmptiest = await frameReading("emptiest");

check(
	"`?system=` boots the running page at the system the row names",
	atCore.index === coreRow.shot.system,
	`system ${atCore.index} ${atCore.name} at t=${atCore.t.toFixed(
		3,
	)}, asked for ${coreRow.shot.system}`,
);

/**
 * The row the node was really for, and the reason this probe scores headings at
 * all. `≥ 90%` of the searched maximum rather than equal to it, because the
 * densest place in a lumpy sky need not be exactly the centre of the cluster —
 * the claim is that the transform's bearing is *at* the crowd, not that it is its
 * arithmetic centre. A wrong transform lands far off the maximum and goes red.
 */
check(
	"the Core bearing the page reports is at the crowd the search finds",
	atCore.atBearing >= 0.9 * atCore.bestHeld,
	`a cone of ${atCore.coneDeg.toFixed(1)}° on the Core bearing holds ${
		atCore.atBearing
	} of ${atCore.total} derived points; the crowdest of 512 searched headings holds ${
		atCore.bestHeld
	}, ${atCore.offDeg.toFixed(1)}° off the Core bearing`,
);

check(
	"the frame the row aims holds no sun and no planet",
	atCore.subjects.length === 0,
	atCore.subjects.length === 0
		? "nothing of the system's own light is inside the frame"
		: `in frame: ${atCore.subjects.join(", ")}`,
);

/**
 * What the *old* rule does with this sky, which is the other half of why the row
 * exists. Honest about its own weakness: `__emptiestDirection` searches for the
 * least, so a small number is what it is built to return — the reading is kept
 * because the sheet needs the size of the difference between the two rules, not
 * because it locates the cone. The row above is what locates it.
 */
check(
	"the emptiest heading rule finds far less of the same sky than the Core bearing does",
	atEmptiest.lit * 4 <= atCore.lit,
	`${atEmptiest.lit} of ${atEmptiest.total} derived points inside the frame aimed at emptiness against ${atCore.lit} aimed along the Core bearing — the same sky, the same camera`,
);

// The other half of the node: the row could not be taken where the game boots,
// because `startSystem` is the most central system there is and a directional
// arm has nothing to point along from the centre. Same seed, same aim, no
// `?system=`. §12 of `galaxy-generation.md` owns the cone figures this restates
// structurally, and `measure-sky-density.ts core` reprints them.
await page.goto(gameUrl(origin, { seed: VIEW_SEED, raider: "off" }));
await bootedGame(page);
const atStart = await frameReading("core");

const rimShare = atCore.lit / atCore.total;
const centreShare = atStart.lit / atStart.total;

check(
	"the same aim at the system the game boots at is the inverted frame #432 was opened to escape",
	atStart.index !== atCore.index && rimShare >= 2 * centreShare,
	`${(rimShare * 100).toFixed(1)}% of the derived sky in frame at system ${
		atCore.index
	} (t=${atCore.t.toFixed(3)}) against ${(centreShare * 100).toFixed(
		1,
	)}% at the start system ${atStart.index} (t=${atStart.t.toFixed(3)}); this frame's share of a uniform sphere is ${(
		atCore.isoShare * 100
	).toFixed(1)}%, so the centre's is a heading you could have picked blind`,
);

await browser.close();
exit();
