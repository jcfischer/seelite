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
 * `SEED` is 47 because **every captured frame was taken on it**, and that is
 * now the whole of the reason. It was borrowed from `probe-arrival.mjs`, which
 * chose 47 as its geometry fixture and then re-picked to 481 in #118 when the
 * galaxy reshape moved every system (`e2844d2`, PR #124) — so the reason this
 * docstring gave has been false since, along with the pair of radii it quoted
 * from the world 47 had stopped being (#174). What pins the seed is the sheet:
 * #98's gate is a before/after comparison by eye, and a re-pick re-frames every
 * view against a different world, which invalidates every comparison anyone has
 * already made. It is a baseline rather than a choice, and it does not move.
 *
 * What it generates is `FIXTURE` below, where a test can reach it rather than a
 * reader having to take a comment's word. Two things it is **not**, both of
 * which this docstring asserted:
 *
 * - **Not one station of each kind.** #147 found that when it tried to frame a
 *   refinery here, and rescued the phrase by reading "kind" as the aperture's —
 *   slot and pad, "and both of those are present". That reading is false too,
 *   and was when it was written: seed 47 generates a trade station and a
 *   shipyard, and `STATION_GEOMETRY` gives both of them a **slot**
 *   (`station.ts`). The pad kind is not new either — the refinery has carried
 *   one since #28 and the outpost since #58, both before #147. There is no pad
 *   in this fixture at all, which is exactly why `refinery-cradle-berth` names
 *   seed 2 and the outpost frame is a workbench shot.
 *
 *   "Slot" and "pad" here are `aperture.kind` values, not the berth aliases
 *   `CONTEXT.md` asks to be avoided — that entry's own scope note names
 *   `aperture.kind === "slot"` as the case where the alias rule fires on an
 *   English word.
 * - **No gas giant.** The largest planet is a 5,473 km rocky world, so the two
 *   `largest-planet` views below no longer caption their subject as one.
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
 * What `SEED` generates, as data rather than as prose.
 *
 * The radii were a sentence in the docstring above and nothing read them, which
 * is how they went on describing a world the fixture had stopped being. They are
 * a constant because #118's own rule says so: a figure a file states as measured
 * owes a mode that reprints it, and a comment is not one.
 * `tests/view-set.test.ts` measures this against `makeWorld(SEED)`, so a
 * generator change that re-shapes the start system goes red there instead of
 * silently re-framing the sheet.
 *
 * `radiusKm` is rounded to the kilometre. The *order* is an input to a framing —
 * `largest-planet` resolves to the head of this list, so two views are framed on
 * whichever planet sorts first — but the figure itself is not: every frame is
 * placed in radii of its own subject, so it is the fixture's identity and
 * nothing more.
 */
export const FIXTURE = Object.freeze({
	/** The start system's name. A re-pick of the seed cannot be quiet. */
	system: "ANLEONOR",
	/** Every planet, largest first — the order `largest-planet` resolves in. */
	planets: Object.freeze([
		Object.freeze({ id: "planet-5", radiusKm: 5473, gasGiant: false }),
		Object.freeze({ id: "planet-4", radiusKm: 4487, gasGiant: false }),
	]),
	/**
	 * Station roles in generation order, each with the `aperture.kind`
	 * `STATION_GEOMETRY` gives it. The kind is data rather than a word in this
	 * comment because it is half the claim: there is no pad in this fixture, and
	 * a seed that later grew one should be an edit here and not a rewritten test.
	 */
	stations: Object.freeze([
		Object.freeze({ role: "trade", aperture: "slot" }),
		Object.freeze({ role: "shipyard", aperture: "slot" }),
	]),
});

/**
 * The levers charted under #98, by node id — six then, seven since #147 put a
 * room behind every aperture, eight since #162 cut the aperture into the hull,
 * nine since #165 replaced two roles' rooms with landing pads.
 *
 * The set's job is to cover every surface these touch — that is what makes it
 * canonical rather than a convenient handful of screenshots. Adding a lever to
 * the map without adding it here leaves it judged on somebody else's frame, so
 * `uncoveredLevers` is asserted rather than described. The count above is a
 * running total and goes stale silently; the assertion is what holds.
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
	162: "the aperture cut into the hull",
	165: "the landing pad, and the shipyard keel aft of its hub",
	206: "the planet surface at the apparent size that costs a frame",
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
 * - `workbench-interior` — `?model-viewer=station`, framed on one role's
 *   interior. It exists for exactly one subject: no system generates an
 *   outpost (§12.7's joint 5), so the workbench is the only place its interior
 *   exists. It **navigates the page**, so it is last in the set. Since #165 the
 *   outpost's interior is a landing pad rather than a bay, so the frame looks
 *   down at a deck rather than in through an opening; the kind's name is the
 *   mechanism — the workbench stage — and not a claim about the subject.
 */
export const SHOT_KINDS = Object.freeze([
	"station-axis",
	"body-offset",
	"deep-sky",
	"berth",
	"workbench-interior",
]);

/**
 * Eighteen views, one clock, and — with one declared exception — one seed.
 *
 * **The exception is `refinery-cradle-berth`, and it names its own.** `SEED` 47
 * generates no refinery, so that view carries `seed: 2` and its capture
 * navigates. Saying "one seed" of this set would be the class of claim this
 * file's own capture code refuses: a caption asserting a fixture property the
 * frames do not have.
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
 * **`station-range` stands at twenty and is not that mistake**, which is a
 * distinction #134's receipt had to measure rather than assert: those three
 * views were set by guessing, and its ladder put the floor at 31–40 px of
 * station width,
 * with twenty radii of a trade station at ~70. Far is a pixel quantity, and the
 * radii that reach it differ per form — the same shipyard is past its own floor
 * by 32.
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
		/**
		 * **Lever 162 is here rather than in a new view** (#155). The defect it
		 * fixes — a lit frame on an uncut surface, which a ship flew through —
		 * is only visible on the way *in*, and this is the one view on the
		 * aperture axis. Its partner `berth-arrival` is the control rather than
		 * the evidence: a hull is `FrontSide`, so from inside the bay the uncut
		 * face was culled and every frame taken from a berth read correctly
		 * throughout.
		 */
		covers: [162, 101, 103, 99],
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
		 * The residue #129 stated rather than papered over — **no view in this set
		 * judges lit-window density at range, and none a shipyard's ports at all**
		 * — was a decision it declined to take. #134 took it and #144 built it:
		 * `station-range` and `station-shipyard-flank` below are the two frames,
		 * and this one keeps the backdrop and the outline it was kept for.
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
		name: "station-range",
		covers: [102, 101, 99],
		/**
		 * **The far case, and #134's receipt measured where it ends before it was
		 * framed.** The figures below are that receipt's, not the node body's: the
		 * body carries the question and the resolution comment carries the ladder.
		 *
		 * #129 left the residue named in the view above: nothing in the set
		 * judged lit-window density at range, which is the half of #102's claim
		 * that a station reads as inhabited from far enough out that the ports
		 * are the only thing carrying it. #134's receipt answered it on a headed
		 * 1:1 ladder — eight ranges per subject, each captured again with the panes'
		 * instance count forced to zero and again with nothing changed for a
		 * per-rung noise floor — and put the legibility floor at **31–40 px of
		 * station width**: the principal read a shipyard's ports at 40 px and not
		 * at 31, and a trade station's still at 36.
		 *
		 * **Twenty radii is ~70 px, roughly twice that floor, and the margin is
		 * the decision.** A view parked at the vanishing point reads as barely
		 * anything in *both* halves of a before/after, so a change that dims the
		 * ports yields two frames that look equally empty. The floor says where
		 * the lever ends; it is not where to stand to judge it.
		 *
		 * **180° because the azimuth is the lever, not the lighting.** The sweep in
		 * #134's receipt, at a fixed range, swung a shipyard's ports 40× between angles and
		 * a trade station's 5×, and both forms read strongest backlit — a frame
		 * chosen for its light alone measures a blind face, which is the defect
		 * #129 found in `station-approach` arrived at from the other side. At
		 * 180 the camera is exactly on the star–subject line, so the hull is a
		 * cutout and the grid is the only thing emitting.
		 *
		 * **Judged by clicking the frame through, until #146 is fixed.** The
		 * sheet renders every capture at about half size, so this row is ~35 px
		 * across on it — on the floor rather than twice it.
		 */
		what: "A trade station backlit at twenty radii, ~70 px across on #134's ladder: lit-window density at range, where the grid is the only thing carrying the hull.",
		shot: {
			kind: "body-offset",
			body: "station-trade",
			radii: 20,
			sunAngleDeg: 180,
			view: "chase",
		},
	},
	{
		name: "station-shipyard-flank",
		covers: [102, 101, 99],
		/**
		 * **A shipyard's ports, which nothing in the set had ever seen** (#134).
		 * `station-outline` is the only other shipyard frame and it is at 140°,
		 * where the ports are on neither visible face; every view that kept 102
		 * after #129 is a trade station. Three of the four roles had their
		 * clutter judged by nothing, and this closes the one role that can be
		 * framed today — seed 47 generates no refinery and `system.ts` places no
		 * outpost, and #134 declined to buy a view for a form nobody has ranked.
		 *
		 * **150°, which is the angle #134's ladder found rather than one that
		 * looked right.** Sweeping the camera azimuth at a fixed range, its receipt
		 * reports this form's ports swinging 40× — 10 px at 240° against 395 at 150 — so an unchosen
		 * angle is not a weaker frame but a frame of a blind face. Four radii and
		 * not the trade station's twenty: a shipyard is a sparse frame rather
		 * than a compact drum, so it puts far fewer pixels on screen per radius
		 * and loses its ports between 26 and 32 of them.
		 */
		what: "A shipyard's ported faces at four radii, backlit at 150°: the one role whose ports and clutter no other view sees.",
		shot: {
			kind: "body-offset",
			body: "station-shipyard",
			radii: 4,
			sunAngleDeg: 150,
			view: "chase",
		},
	},
	{
		name: "hull-chase",
		covers: [101, 99],
		what: "The player's own hull, mostly backlit, against the system's largest planet. Flat plate shows here first.",
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
		covers: [99, 206],
		what: "The largest planet at a crescent. The far layer takes no fill on purpose, and this is why.",
		shot: {
			kind: "body-offset",
			body: "largest-planet",
			radii: 4,
			sunAngleDeg: 70,
			view: "cockpit",
		},
	},
	/**
	 * **The frame the planet-cost table is a price for** (#206).
	 *
	 * Every other framing in this set stands well off its subject; this one is
	 * as close as a planet can be framed and still be a planet. Two radii is
	 * where `asin(1 / 2)` = 30° meets the camera's 30° half-fov (`main.ts`'s
	 * `fov` 60), so the body spans the frame's height exactly and the limb sits
	 * on the top and bottom edges — full of surface, with the silhouette still
	 * in shot.
	 *
	 * **1.2 was flown first, and rejected by eye.** #206 prescribed it and the
	 * arithmetic was right — at 1.2 the body subtends 56.4° and the surface
	 * reaches every edge — but the capture is a featureless orange wash. The
	 * surface noise has a fixed frequency, so under about 1.6 radii it
	 * magnifies into blobs and there is nothing left to judge: no crater, no
	 * terminator, no limb. A ladder at 1.2, 1.6, 2, 2.5 and 3 put the collapse
	 * between 1.6 and 1.2, and the principal picked 2. That the detail runs
	 * out at all is a finding for a later node; what it settles here is that a
	 * frame prescribed for *fill* was not a frame anything could be judged on,
	 * which is `green-is-not-legible` one more time — the view captured, the
	 * suite stayed green, and the picture was useless.
	 *
	 * The pair with `planet-terminator` is what makes a surface judgeable at
	 * both ends: four radii out at a crescent for the silhouette and the
	 * atmosphere edge, two radii for the surface itself.
	 *
	 * It is also the one frame in the set that #206's sweep prices directly —
	 * 2 is a column in `RADII` for that reason, and 1.2 stays a column too
	 * because the expensive readings are there even though the picture is not.
	 * Framed on `planet-5` by id rather than through `largest-planet` so the
	 * table and the picture cannot drift apart; `tests/view-set.test.ts` pins
	 * the two together against `FIXTURE`.
	 *
	 * `sunAngleDeg` 60 rather than the terminator view's 70: what is wanted is
	 * a lit surface with the terminator still crossing it, not a crescent that
	 * would leave most of the frame black. `chase` rather than `cockpit`
	 * because the canopy frame would eat a third of the one thing this view
	 * exists to show.
	 */
	{
		name: "planet-fill",
		covers: [206],
		what: "A rocky planet spanning the frame at two radii, limb on the top and bottom edges. Surface detail at the largest apparent size it still resolves at, and the frame the planet-cost table prices.",
		shot: {
			kind: "body-offset",
			body: "planet-5",
			radii: 2,
			sunAngleDeg: 60,
			view: "chase",
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
		 *
		 * **The near berth, not the deep one the two frames above use**, and that
		 * is a finding rather than a preference: the chase camera sits behind the
		 * ship along its nose, the parked nose points *out*, so from a deep berth
		 * the camera lands behind the bay's own back wall and the frame comes
		 * back empty — captured twice to be sure. From a near berth it is inside
		 * the bay looking down it, which is also the better frame for what §13.6.3
		 * asks: depth, and the other berths.
		 */
		what: "§13.6.3 — a near berth from the chase camera: bay depth, the other berths, and the ship in its own berth. Deep berths put the chase camera outside the bay.",
		shot: {
			kind: "berth",
			station: "trade",
			berth: "overhead-near",
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
		covers: [165, 147, 99],
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
		 *
		 * **`port-near`, because a pad has one band** (#165). The refinery lost
		 * its enclosed bay to the principal's ruling; its cradles stand on a
		 * deck now, one to a side of the landing lane, and there is no `deep`
		 * address to name. This is the frame that reversal closes on.
		 */
		what: "§13.6.6 — a refinery's landing pad from a service cradle, chase: the deck, the lane, and the notch around it. Seed 2, because seed 47 generates no refinery.",
		shot: {
			kind: "berth",
			station: "refinery",
			berth: "port-near",
			seed: 2,
			view: "chase",
		},
	},
	{
		name: "outpost-interior-workbench",
		covers: [165, 147],
		/**
		 * **A workbench frame, and the receipt says why**: no system generates an
		 * outpost, so this is the only place its interior exists at all. It is
		 * last because it navigates the page — every view above it needs the
		 * game, and this one needs the game not to be there.
		 *
		 * **Standing off and looking down at the deck, and #165 is why.** It was
		 * framed to look *in* through the aperture at a bay behind it; the
		 * principal's ruling took the bay away, so there is nothing to look into
		 * and the subject is the deck itself — the kerb, the corner lamps, the
		 * lit square round the landing lane, and the two pads standing on it.
		 * The elevation is raised for that: the stage always looks at the origin,
		 * so what changes the view is where it stands, and a pad seen edge-on is
		 * a line.
		 *
		 * `radii` is the orbit radius the stage frames from the form's **reach**,
		 * so it is a fraction of the whole silhouette rather than of the core.
		 */
		what: "§13.6.7 — an outpost's landing pad from above, on the station workbench. Sparse plating, a kerb, corner lamps, and the lit lane.",
		shot: {
			kind: "workbench-interior",
			asset: "outpost",
			radii: 1.25,
			azimuth: 0.28,
			elevation: 0.45,
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
