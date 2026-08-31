/**
 * The canonical view set: what a visual node is judged on.
 *
 * [#98](https://github.com/jcfischer/seelite/issues/98) settled that a visual
 * node closes on two things and not one — a fixed-seed, fixed-camera contact
 * sheet, and the principal saying yes to it. #35 and #36 both closed green
 * against numeric probes and produced the look that is now being changed;
 * neither had any way to fail on *this looks flat*. This file is the first half
 * of the missing gate. `scripts/capture-views.mjs` is the second.
 *
 * ## Why the declarations live apart from the capture
 *
 * Everything here is pure, so `tests/view-set.test.ts` can hold it — the same
 * split, and for the same reason, as `scripts/lib/probe-args.mjs`. The capture
 * script opens a browser and cannot be tested at all, so anything decidable
 * without one is decided here: which views exist, which lever each is evidence
 * for, and whether a run's output is complete enough to build a sheet from.
 *
 * That last one is the failure worth the file. A probe that loses a check goes
 * red. **A contact sheet that loses a view looks exactly like one that did not**
 * — the reviewer scrolls past a gap and says yes — so a hole is thrown at the
 * point the sheet is built rather than left for a human to notice.
 */

/**
 * The fixture, pinned three ways. All three are decisions, not defaults.
 *
 * `SEED` is 47 because `probe-arrival.mjs` already chose it as the geometry
 * fixture: one station of each kind in a single system, a 7,046 km rocky world
 * and a 33,002 km gas giant. A sheet wants the same thing an arrival probe
 * wants — several subjects reachable without flying anywhere.
 *
 * `GAME_TIME_S` is pinned because **bodies move**: positions are
 * `f(systemSeed, gameTime)` (`src/sim.ts:23`), so an unpinned clock draws a
 * different frame each run and a before/after pair compares two worlds. Station
 * spin phase (`slotPhaseRad`) and strobe timing read it too.
 *
 * `VIEWPORT` is 1440x900 because that is the resolution #98's frame-cost table
 * was measured at. A sheet at one size and a cost at another would be two
 * claims about two builds.
 */
export const SEED = 47;
export const GAME_TIME_S = 0;
export const VIEWPORT = { width: 1440, height: 900 };

/**
 * The levers charted under #98, by node id — six then, seven since #147 put a
 * room behind every aperture.
 *
 * The set's job is to cover every surface these touch — that is what makes it
 * canonical rather than a convenient handful of screenshots. Adding a seventh
 * lever to the map without adding it here leaves it judged on somebody else's
 * frame, so `uncoveredLevers` is asserted rather than described.
 */
/** @type {Readonly<Record<number, string>>} */
export const LEVERS = Object.freeze({
	99: "the light rig",
	100: "the nebula backdrop",
	101: "the hull surface",
	102: "greebles and lit windows",
	103: "selective bloom",
	105: "the cockpit interior",
	147: "the station interior",
});

/**
 * How a shot places the ship and points the camera. Three kinds, deliberately.
 *
 * - `station-axis` — on a station's aperture axis at `radii` silhouette radii,
 *   looking back down it. The docking approach, and the one viewpoint defined
 *   for all three station types. `probe-station-visuals.mjs` established it.
 * - `body-offset` — `radii` body radii from a body, on a heading `sunAngleDeg`
 *   away from that body's direction to the star, looking at it. `sunAngleDeg`
 *   is the whole point: 0 puts the star behind the camera and the subject fully
 *   lit, 180 puts it beyond the subject and the subject a silhouette. #99's
 *   fill exists because the second case rendered the hull as a black cutout,
 *   and the sheet has to contain the case the fix was made for.
 * - `deep-sky` — at the arrival point, looking away from the star and every
 *   body. The only view where the backdrop is the subject rather than the
 *   thing behind one.
 * - `berth` — docked at a **named berth** of a named station, flown there by
 *   §7's docking computer, stopped at a named point of the traversal. #147's
 *   interior is only ever seen from inside, and the berth is named rather than
 *   allocated because §13.2 rotates equal fits by request time: an unnamed
 *   berth is a different room each run, and a before/after pair of two rooms
 *   compares nothing.
 * - `workbench-interior` — `?model-viewer=station`, framed from inside one
 *   role's bay. It exists for exactly one subject: no system generates an
 *   outpost (§12.7's joint 5), so the workbench is the only place its interior
 *   exists. It **navigates the page**, so it is last in the set.
 */
export const SHOT_KINDS = Object.freeze([
	"station-axis",
	"body-offset",
	"deep-sky",
	"berth",
	"workbench-interior",
]);

/**
 * Fifteen views, one seed, one clock.
 *
 * #98 named four as a starting list and called it a proposal. Two things are
 * added here and both close a hole that list had. **`sky-only`**, because #100's
 * backdrop is otherwise only ever judged with a hull in front of it. And
 * **`cockpit-backlit`**, because #98's list named the cockpit as a *viewpoint* —
 * the same reading that let #35's title carry "cockpit" while nothing owned the
 * surface, which is the miss #105 records.
 *
 * Every view states the levers it is evidence for. That is not documentation:
 * `uncoveredLevers` reads it, and the test drops a view to prove the reading can
 * fail.
 *
 * **`radii` is apparent size, and nothing here checks it.** Each number was set
 * by opening the PNG at 1440x900 and looking; six to eight of a subject's own
 * radii put it at roughly a third of the frame. The first version of this set
 * had three views at twelve, thirty and sixty, where the station is a bloom dot
 * with no surface to judge at all — a sheet that is captured, green, complete
 * and shows nothing.
 *
 * That was caught by looking, and only by looking. **No check in this repo can
 * catch it**, which is not an omission to be closed later: it is #98's finding
 * restated one level down. A number that decides whether a frame is worth
 * looking at cannot be verified by anything that is not looking. So anything
 * retuning these has to reopen the PNGs, and a regression that shrinks a subject
 * back to a dot will reach the sheet — where the person the sheet exists for is
 * the one who notices.
 */
export const VIEWS = Object.freeze([
	{
		name: "cockpit-arrival",
		covers: [105, 103, 99],
		what: "The interior and the HUD, station ahead at arrival range. ~40% of this frame is cockpit.",
		shot: {
			kind: "station-axis",
			station: "trade",
			radii: 5,
			view: "cockpit",
		},
	},
	{
		name: "cockpit-backlit",
		// 102 added by #129, and it is the strongest frame in the set for it:
		// the station is a **silhouette**, so the only thing making its flank
		// legible is that the flank emits. That is #102's whole thesis — raising
		// the sun brightens the lit half and leaves the dark half exactly as
		// dark — and this is the one view where nothing else can be doing the
		// work. Measured across #129's before/after, against a same-build
		// control: this frame moves 0.41% of its pixels by more than 24/255
		// where two captures of one build move 0.14%. The table below the next
		// view is the whole set; the figures live there rather than being
		// restated here, which is how this comment came to carry a superseded
		// pair through a round of review.
		covers: [105, 103, 102, 99],
		what: "The same interior with the star beyond the station: the case the camera-side fill was added for, and the dark side that only reads because it emits.",
		shot: {
			kind: "body-offset",
			body: "station-trade",
			radii: 8,
			sunAngleDeg: 175,
			view: "cockpit",
		},
	},
	{
		name: "station-approach",
		covers: [101, 103, 99],
		what: "On the aperture axis at three silhouette radii — the docking face, its plating and the lit aperture.",
		shot: { kind: "station-axis", station: "trade", radii: 3, view: "chase" },
	},
	{
		name: "station-flank",
		covers: [102, 101, 99],
		what: "A trade station's lit flank at four radii: the window grid and the plant beside it, which the axis view cannot show.",
		/**
		 * **Added by #129, and the reason is a frame rather than an argument.**
		 *
		 * #102 §7 recorded that the two station views already claimed lever 102,
		 * so the station child needed no view-set change and only the ship child
		 * did. The before/after sheet falsified that. `station-approach` is on
		 * the *aperture axis*, and the aperture face is the one face a station's
		 * clutter and ports are deliberately kept off — nothing may stand in the
		 * corridor a ship flies down.
		 *
		 * **Measured rather than eyeballed**, because the first version of this
		 * comment said "pixel-identical" on the strength of looking at two PNGs.
		 * `npm run views:diff` (`scripts/diff-view-set.mjs`) is the instrument,
		 * so these are re-runnable rather than quoted. The fraction of pixels
		 * moving by more than 24/255 — **three captures of the branch against
		 * one `before`, and the three same-build pairings among them**, because
		 * the clock runs during capture and a spinning station is framed at a
		 * different phase each time:
		 *
		 * | view | before → after ×3 | same build, 3 pairings |
		 * |---|---|---|
		 * | `station-flank` | 1.27–1.52% | 0.00–0.09% |
		 * | `cockpit-backlit` | 0.37% | 0.00% |
		 * | `station-approach` | 0.03–0.10% | 0.00–0.06% |
		 * | `station-outline` | 0.01% | 0.00% |
		 * | `cockpit-arrival` | 0.00–0.01% | 0.00% |
		 * | `hull-chase` | 0.00–0.03% | 0.00–0.03% |
		 * | `planet-terminator`, `sky-only` | 0.00% | 0.00% |
		 *
		 * The two views that keep 102 move by fifteen to twenty times their own
		 * noise; the two that lost it move inside it.
		 *
		 * **Ranges and not single readings.** One pair is not a measurement
		 * here: in an earlier, noisier session the same `before → after`
		 * comparison read 0.55% on `station-approach` — with a same-build
		 * control that also read 0.55%. The conclusion held, and it held for a
		 * reason a single number could not have carried.
		 *
		 * The equatorial faces *are* on screen in the axis view — but at that
		 * obliquity, tripling the ports and adding the plant moves the frame by
		 * as much as a view with no station surface in it at all. `covers`
		 * records where a lever can be **judged**, not where its geometry is
		 * technically within the frustum.
		 *
		 * So 102 moved off `station-approach` and off `station-outline`, onto
		 * this and onto `cockpit-backlit`. The two that keep it are the lit case
		 * and the dark one, which is the pair #102 is actually about; the two
		 * that lost it are an axis view and a range view that show neither.
		 *
		 * A `body-offset` and not a `station-axis`, because the axis kind points
		 * at exactly the face this has to avoid. 35° puts the star off the
		 * camera's shoulder, so the flank is lit and still has a shaded side for
		 * the plant to cast onto — a fully frontal light flattens a greeble into
		 * its own footprint, which is the failure the first build was rejected
		 * for.
		 */
		shot: {
			kind: "body-offset",
			body: "station-trade",
			radii: 4,
			sunAngleDeg: 35,
			view: "chase",
		},
	},
	{
		name: "station-outline",
		covers: [100, 103],
		/**
		 * **102 came off here too, and for the same reason it came off
		 * `station-approach`** (#129). A shipyard's ports are on the keel's top
		 * and the slab's back face; at 140° this frame sees the shipyard from
		 * neither: across #129's before/after this frame moved 0.05% of its
		 * pixels by more than 24/255, which is **exactly** what a third run of
		 * the same build moves. What the frame does show is the
		 * backdrop behind a hard outline and what bloom does to one, which is
		 * what it is kept for.
		 *
		 * The residue is stated rather than papered over: **no view in this set
		 * judges lit-window density at range.** `station-flank` judges it at
		 * four radii and `cockpit-backlit` at eight, both on a trade station.
		 * Whether the sheet needs a ninth view for a shipyard's own ports, or for
		 * the far case, is a decision, and #129 is not the node that takes it.
		 */
		what: "The shipyard's whole frame against the sky: the backdrop behind a hard outline, and what bloom does to one.",
		shot: {
			kind: "body-offset",
			body: "station-shipyard",
			radii: 8,
			sunAngleDeg: 140,
			view: "cockpit",
		},
	},
	{
		name: "hull-chase",
		covers: [101, 99],
		what: "The player's own hull, mostly backlit, against a gas giant. Flat plate shows here first.",
		shot: {
			kind: "body-offset",
			body: "largest-planet",
			radii: 6,
			sunAngleDeg: 150,
			view: "chase",
		},
	},
	{
		name: "planet-terminator",
		covers: [99],
		what: "The gas giant at a crescent. The far layer takes no fill on purpose, and this is why.",
		shot: {
			kind: "body-offset",
			body: "largest-planet",
			radii: 4,
			sunAngleDeg: 70,
			view: "cockpit",
		},
	},
	{
		name: "sky-only",
		covers: [100],
		what: "Away from the star and every body. The backdrop with nothing in front of it.",
		shot: { kind: "deep-sky", view: "cockpit" },
	},
	/**
	 * §13.6's seven-frame acceptance set, as declared views.
	 *
	 * The receipt fixes them and they are transcribed rather than reinterpreted:
	 * the first four prove the whole transition at one station, and the last
	 * three prove that role, family and location produce distinct interiors.
	 * They are here rather than in a script of their own because #98's gate is
	 * *one* sheet — a second contact sheet is a second thing to remember to
	 * look at.
	 *
	 * **They come after the eight above and before nothing.** Each docks the
	 * ship, which leaves the session somewhere the earlier views do not expect;
	 * and the last one navigates the page away from the game entirely.
	 */
	{
		name: "berth-arrival",
		covers: [147, 105, 99],
		what: "§13.6.1 — a trade station's bay mid-transfer to a deep overhead berth, in the cockpit. The scripted traversal, at the leg that leaves the lane.",
		shot: {
			kind: "berth",
			station: "trade",
			berth: "overhead-deep",
			at: 0.75,
			view: "cockpit",
		},
	},
	{
		name: "berth-docked-forward",
		covers: [147, 105],
		what: "§13.6.2 — the same station docked, looking forward: the station console over the bay, which is what a parked pilot actually sees.",
		shot: {
			kind: "berth",
			station: "trade",
			berth: "overhead-deep",
			view: "cockpit",
		},
	},
	{
		name: "berth-free-look",
		covers: [147, 102, 99],
		/**
		 * **Chase, not a cockpit head-turn, and the frame decided it.** §13.6.3
		 * asks for a free look showing bay depth and the other berths; a docked
		 * cockpit has a console on every wall (#143), so `Alt+→` shows the Flight
		 * console filling the canopy and no bay at all. The chase camera is the
		 * only view in the game from which a parked ship's surroundings are
		 * visible.
		 */
		what: "§13.6.3 — the same berth from the chase camera: bay depth, the other berths, and the ship in its own berth.",
		shot: {
			kind: "berth",
			station: "trade",
			berth: "overhead-deep",
			view: "chase",
		},
	},
	{
		name: "berth-launch-chase",
		covers: [147, 101, 103],
		what: "§13.6.4 — the same station launching, in chase view: the hull leaving its berth down the lane it arrived by.",
		shot: {
			kind: "berth",
			station: "trade",
			berth: "overhead-deep",
			launch: true,
			view: "chase",
		},
	},
	{
		name: "shipyard-wall-berth",
		covers: [147, 99],
		what: "§13.6.5 — a shipyard's bay from a wall berth, chase: coarse structure, cold work light, gantries.",
		shot: {
			kind: "berth",
			station: "shipyard",
			berth: "starboard-near",
			view: "chase",
		},
	},
	{
		name: "refinery-cradle-berth",
		covers: [147, 99],
		/**
		 * **The one view that names its own seed, and the fixture is why.**
		 * **Seed 47 has no refinery** — it generates a trade station and a
		 * shipyard and nothing else. The docstring on `SEED` above said the
		 * fixture had "one station of each kind"; that was written for
		 * `probe-arrival.mjs`'s purposes and is false of the station roster,
		 * which is a finding this node ran into rather than a choice it made.
		 *
		 * Re-pinning `SEED` was the alternative and was declined: the eight views
		 * above are framed against it and #129's before/after figures were
		 * measured on it, so moving it would reframe every one of them to fix
		 * one. Seed 2 is the lowest seed whose start system carries all three
		 * generated types.
		 */
		what: "§13.6.6 — a refinery's bay from a service cradle, chase. Seed 2, because seed 47 generates no refinery.",
		shot: {
			kind: "berth",
			station: "refinery",
			berth: "port-deep",
			seed: 2,
			view: "chase",
		},
	},
	{
		name: "outpost-interior-workbench",
		covers: [147],
		/**
		 * **A workbench frame, and the receipt says why**: no system generates an
		 * outpost, so this is the only place its interior exists at all. It is
		 * last because it navigates the page — every view above it needs the
		 * game, and this one needs the game not to be there.
		 *
		 * **Through the aperture, not from a berth, and the stage is why.** The
		 * workbench's camera always looks at the origin: on the axis and inside
		 * the bay it sees the end bulkhead square on and flat, because the bay is
		 * wider than it is deep, and off-axis at the same radius it is outside
		 * the bay among the Derrick's own structure. Both were captured and
		 * rejected. What the stage can do is stand off and look *in* — the view
		 * axis passes through the opening — which is the outpost's bay as the
		 * only place one exists.
		 *
		 * `radii` is the orbit radius the stage frames from the form's **reach**,
		 * so it is a fraction of the whole silhouette rather than of the core.
		 */
		what: "§13.6.7 — an outpost's bay from inside, on the station workbench. Sparse panels, exposed utilities, one neutral lamp.",
		shot: {
			kind: "workbench-interior",
			asset: "outpost",
			radii: 0.75,
			azimuth: 0.28,
			elevation: 0.18,
			view: "cockpit",
		},
	},
]);

/**
 * Levers no view claims, in map order.
 *
 * **What this cannot check**, said here because the assertion reads stronger
 * than it is: both sides are hand-kept in this file, so a seventh lever added to
 * the map and never added to `LEVERS` passes green. And `covers` records an
 * intention — that a number was typed — not that the view shows that surface.
 * The second half is a person's job by construction: it is the same judgement
 * #98 made the gate, and there is no check that stands in for it.
 *
 * Returns ids rather than names so a caller can print either, and so the test
 * asserting the empty case can also assert the populated one exactly.
 *
 * @param {ReadonlyArray<{covers: number[]}>} views
 * @returns {number[]}
 */
export function uncoveredLevers(views) {
	const covered = new Set(views.flatMap((v) => v.covers));
	return Object.keys(LEVERS)
		.map(Number)
		.filter((id) => !covered.has(id));
}

/** What each shot kind needs beyond `kind` and `view`, and how to check it. */
const finite = (n) => typeof n === "number" && Number.isFinite(n);
const SHOT_REQUIREMENTS = {
	"station-axis": (s) => typeof s.station === "string" && finite(s.radii),
	"body-offset": (s) =>
		typeof s.body === "string" && finite(s.radii) && finite(s.sunAngleDeg),
	"deep-sky": () => true,
	// The berth is named for the reason `SHOT_KINDS` gives: an unnamed one is a
	// different room each run. `at`, `headLook` and `launch` are optional and a
	// missing one is a docked, forward, cockpit frame.
	berth: (s) => typeof s.station === "string" && typeof s.berth === "string",
	"workbench-interior": (s) => typeof s.asset === "string" && finite(s.radii),
};

/**
 * Views whose shot is missing what its kind needs, by name.
 *
 * The kind alone is not enough, and the gap had teeth: a `body-offset` view
 * without `sunAngleDeg` reaches `__sunOffset`, multiplies `undefined` through
 * the placement arithmetic and puts the ship at NaN — the exact failure
 * `__radiusOf` throws to avoid one argument earlier. A NaN placement is not an
 * error, it is a garbage frame, and a garbage frame in a contact sheet is
 * something the reviewer squints at rather than something that names the field
 * that is missing.
 *
 * Takes its subject as a parameter for the reason `uncoveredLevers` does: the
 * test can then hand it a set that is actually broken, rather than asserting
 * over the real one and proving only that today's literal is well formed.
 *
 * @param {ReadonlyArray<{name: string, shot: Record<string, unknown> & {kind: string}}>} views
 * @returns {string[]}
 */
export function malformedShots(views) {
	return views
		.filter((v) => {
			const needs = SHOT_REQUIREMENTS[v.shot.kind];
			return !needs || !needs(v.shot);
		})
		.map((v) => v.name);
}

/** HTML-escape, for the captions and the ref strings the sheet interpolates. */
const esc = (s) =>
	String(s)
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");

/**
 * Every declared view of every run, side by side, or an error.
 *
 * A run is one capture — one label, one git ref, one renderer. Two runs make the
 * before/after pair #98's gate is applied with; one run is the sheet you look at
 * to see where the build stands.
 *
 * **It throws on any mismatch between a run and the declaration**, in both
 * directions. A missing view is the failure the module exists for. An *extra*
 * view is refused for the same reason from the other side: a shot nobody
 * declared has no lever behind it and no reason to be judged, and admitting one
 * quietly makes the set whatever the last capture happened to emit.
 *
 * `views` is a parameter for the reason `uncoveredLevers` takes one: the
 * completeness rule is the whole point of this function, and a rule that can
 * only ever be exercised against the one real set is a rule nothing has watched
 * fail. It defaults to `VIEWS`, so every caller but a test passes one argument.
 *
 * @param {Array<{label: string, gitRef: string, capturedAt: string, renderer: string, seed: number, views: Array<{name: string, file: string, gameTime?: number}>}>} runs
 * @param {ReadonlyArray<{name: string, what: string, covers: number[]}>} [views]
 * @returns {string} a standalone HTML page
 */
export function contactSheet(runs, views = VIEWS) {
	if (!runs.length)
		throw new Error("contactSheet: no runs — there is nothing to look at");

	const declared = new Set(views.map((v) => v.name));
	for (const run of runs) {
		const present = new Set(run.views.map((v) => v.name));
		const missing = [...declared].filter((n) => !present.has(n));
		if (missing.length)
			throw new Error(
				`contactSheet: run "${run.label}" is missing ${missing.join(", ")} — ` +
					`a sheet with a hole in it reads as a complete one, so it is not built`,
			);
		const extra = [...present].filter((n) => !declared.has(n));
		if (extra.length)
			throw new Error(
				`contactSheet: run "${run.label}" carries ${extra.join(", ")}, ` +
					`which the view set does not declare — add it to VIEWS or drop it`,
			);
	}

	const fileIn = (run, name) => run.views.find((v) => v.name === name).file;
	/**
	 * The world clock the run's frames were actually taken at.
	 *
	 * Printed because the caption used to say "clock pinned at 0s" and that was
	 * false: `__startClockAt` normalises the start and then lets the clock run, so
	 * the seven frames are at seven different times. The sheet is what the
	 * principal's yes is given against, and a fixture property asserted to them
	 * has to be one the frames above it actually have.
	 */
	const clockSpan = (run) => {
		const times = run.views.map((v) => v.gameTime).filter((t) => t != null);
		if (!times.length) return "";
		return ` · clock ${Math.min(...times).toFixed(1)}–${Math.max(...times).toFixed(1)}s`;
	};
	const head = runs
		.map(
			(r) =>
				`<th><b>${esc(r.label)}</b><span>${esc(r.gitRef)} · ${esc(r.renderer)}${esc(clockSpan(r))}</span></th>`,
		)
		.join("");
	const rows = views
		.map(
			(view) => `<tr>
  <th scope="row">
    <b>${esc(view.name)}</b>
    <span>${esc(view.what)}</span>
    <em>${view.covers.map((id) => `#${id} ${esc(LEVERS[id])}`).join(" · ")}</em>
  </th>
${runs
	.map(
		(r) =>
			`  <td><a href="${esc(fileIn(r, view.name))}"><img src="${esc(
				fileIn(r, view.name),
			)}" alt="${esc(view.name)} — ${esc(r.label)}" loading="lazy"></a></td>`,
	)
	.join("\n")}
</tr>`,
		)
		.join("\n");

	return `<!doctype html>
<meta charset="utf-8">
<title>seelite canonical view set — seed ${SEED}</title>
<style>
  :root { color-scheme: dark; }
  body { background:#0b0d12; color:#c8d0dc; font:14px/1.5 ui-sans-serif,system-ui,sans-serif; margin:0; padding:24px; }
  h1 { font-size:18px; font-weight:600; margin:0 0 4px; }
  p.sub { margin:0 0 24px; color:#7f8b9c; }
  table { border-collapse:collapse; width:100%; }
  th, td { vertical-align:top; padding:8px; border-top:1px solid #1c2230; }
  th[scope="row"] { text-align:left; width:22ch; }
  th b { display:block; color:#e6ecf5; font-size:14px; }
  th span { display:block; color:#8d99ab; font-weight:400; margin-top:4px; }
  th em { display:block; color:#5f6b7d; font-style:normal; margin-top:6px; font-size:12px; }
  img { display:block; width:100%; height:auto; background:#000; border:1px solid #1c2230; }
</style>
<h1>Canonical view set</h1>
<p class="sub">Seed ${SEED}, ${VIEWPORT.width}×${VIEWPORT.height}, clock started at ${GAME_TIME_S}s and left running. Captured headed — every frame here is the renderer the player gets. Each camera is placed co-moving with its subject, which is what holds a framing; the clock is not stopped.</p>
<table>
<thead><tr><th scope="row"></th>${head}</tr></thead>
<tbody>
${rows}
</tbody>
</table>
`;
}
