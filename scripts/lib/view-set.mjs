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
	199: "the exposure budget",
	206: "the planet surface at the apparent size that costs a frame",
	200: "the composed frame's edges, its dither, and the cockpit vignette",
	201: "the sun's shadow and the ambient occlusion on the near layer",
	207: "the relief program picked by how big the planet looks",
	202: "the station finish: a second plating octave, a cut seam, macro fixtures",
	203: "the hull finish: a second plating octave, muted paint, a rim, collars, open bells",
	208: "the baked cube a planet is drawn from below two radii",
	211: "the half-resolution planet surface beneath a full-resolution limb",
	257: "the refinery and outpost forms solved by wave function collapse, and selected",
	210: "the planet's shadow across its ring, and the ring's back across the planet",
	209: "the gas giant's band tones, its storm's interior, and its limb",
	300: "every §5 fixture on the surface its own aperture axis looks at",
	324: "the duel HUD, the canister markers after a kill, and the Communications console's raider log",
	372: "the Controls tab: every control as a folding tree of task groups",
	381: "the rebind modal, and the tab's Settings and Commanders doors beside it",
	431: "the derived sky: real neighbouring systems at true bearings, over the invented field behind them",
	532: "the witchspace transition: the entry streak, the tunnel over the cut, its collapse and the arrival rift",
	535: "the opening cinematic: the rift forming, the arrival, the fly-past, the planet fly-by, the station approach and the dock, filmed from outside",
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
 * - `deep-sky` — at the arrival point, with the backdrop as the subject rather
 *   than the thing behind one, aimed by `__emptiestDirection`. What that rule is
 *   worth knowing before its heading is trusted: it takes the **maximum of the
 *   minimum** angle over 512 candidate directions, so it returns the emptiest
 *   heading *available* and not an empty one, and the angle it lands on
 *   is a measured quantity rather than something the rule guarantees. #487 measured
 *   it, and `probe-sky.mjs` holds the reading at this file's own seed. **What the
 *   sweep found is the sweep's to print** — neither its seed count nor its verdict is
 *   reprinted here, because this file has carried a stale figure before and a
 *   caption's strongest word should be held by a row rather than by a comment.
 *   #432 grew an `aim: "core"` arm here, aimed along the **Core bearing**, and it
 *   is gone again: see the note beside `sky-only` for why a row aimed at the
 *   cluster's centre cannot show it, and `scripts/measure-sky-density.ts`'s field
 *   arm for the reading that decided it.
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
 * - `duel` — in normal flight against a forced raider, aimed at it and with it
 *   selected, looking `headLook` (`forward`, `right` for the Flight console,
 *   or `left` for Communications). With `aftermath` it shoots the raider down
 *   first and frames its `canisters`, or the raider `log` ten minutes on.
 *   #324's HUD exists only in a fight, so no other kind reaches it. **It is not
 *   a repeatable frame**: the fight runs on the live clock through the settle
 *   frames, so the raider and both conditions move between runs. Judge the
 *   instruments' presence, tone and legibility, not a pixel difference.
 * - `controls` — at the arrival point, `?` pressed through the keyboard, so the
 *   head is turned to the right console on its Controls tab (#372). `folded`
 *   names the task groups closed first. The frame is the tab's layout and is
 *   judged as one: #370's §1 risk — a wall of text — is what no probe fails on.
 * - `witchspace` — #532's transition held at `phase` seconds from the cut
 *   (#195 D4) with the clock held. Before the cut, a charge to the nearest
 *   system from the start system; from the cut on, after that jump. The
 *   placer writes world state (a jump saves), so the next row boots clean.
 * - `opening` — #535's opening held at `at` shown seconds into `shot`
 *   (#530's phase handle), on a guided new game booted with `?cinematic`.
 *   The hold steps the real flight there and stops it; the dock saves, so the
 *   next row boots clean.
 */
export const SHOT_KINDS = Object.freeze([
	"station-axis",
	"body-offset",
	"deep-sky",
	"berth",
	"workbench-interior",
	"duel",
	"controls",
	"witchspace",
	"opening",
]);

/**
 * One clock, and — with two declared exceptions — one seed.
 *
 * **The exceptions are `refinery-cradle-berth` and `ringed-giant`, and each
 * names its own.** `SEED` 47 generates no refinery and no gas giant, so those
 * two carry `seed: 2` and `seed: 5` and their captures navigate. Saying "one
 * seed" of this set would be the class of claim this file's own capture code
 * refuses: a caption asserting a fixture property the frames do not have.
 *
 * **One seed is not one place, and one place is not the whole cluster.** Every
 * row is framed in the system the game boots at, which is `startSystem` — the most
 * *central* well-stocked and orderly one — and a row may name a `system` to stand at
 * instead (#432). One does: `sky-at-the-rim` (#480). Why the set needed it, the rule
 * that picked its star, and what its line on the sheet may claim are all told once,
 * in the note beside that row, and not here. What belongs here is the mechanism.
 * `capture-views.mjs` restores the system with the seed before each view and reads
 * the booted index back: a row that got a different system than it asked for has to
 * be a red run rather than a wrong picture wearing the right caption. The half of
 * that plumbing worth keeping was never the argument to `gameUrl` but the readback —
 * the one place a wrong-star caption can be caught is the boot that made it — which
 * is why it stayed when #432's row was removed, carried by no row for a round and
 * named out loud as the cost of keeping it.
 *
 * **A declared seed used to be an ordering hazard and is not any more.** The
 * navigation lived inside the `berth` placer, so every view *below* a
 * seed-declaring one was captured on that view's world; it was harmless only
 * because the one exception sat second to last. `capture-views.mjs` restores
 * the seed a view declares — `SEED` when it declares none — before each view
 * rather than after, so position in this list carries no meaning it did not
 * before.
 *
 * The count of views is deliberately not stated here. It said eighteen while
 * two were being added, which is the drift `LEVERS` above already warns about
 * one paragraph up.
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
		covers: [105, 103, 99, 200, 201],
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
		covers: [199, 105, 103, 102, 99, 201, 203],
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
		covers: [199, 162, 101, 103, 99, 202, 203, 300, 102],
		/**
		 * **102 is back here, which reverses #129** (#300). It came off because
		 * the aperture face was the one face a station's clutter and ports were
		 * deliberately kept off, so tripling the ports moved this frame by as
		 * much as a frame with no station surface in it: 0.03–0.10% of pixels
		 * against a same-build control of 0.00–0.06%. That premise is now false.
		 * The trade station carries a forward window run on the +Z diamond and
		 * both its strobes at opposite corners of it, and those are the only
		 * lights on this role a docking approach can see at all — the
		 * equatorial grid reads exactly 0 px from here and always did.
		 *
		 * So this is the frame lever 102 is judged on for the *axis* case, and
		 * `station-flank` keeps the flank case. Both are still needed: neither
		 * shows the other's surface.
		 */
		what: "On the aperture axis at three silhouette radii — the docking face, its plating, the lit aperture, and the forward window run and strobes round the slot.",
		shot: { kind: "station-axis", station: "trade", radii: 3, view: "chase" },
	},
	{
		name: "station-shipyard-axis",
		covers: [300, 102, 101, 99, 202],
		/**
		 * **The shipyard from its own aperture axis, which nothing in the set
		 * had ever framed** (#300). Every station-axis view was the trade
		 * station's, and #300 moves this form's strobe pair onto the drum that
		 * turns and its bay floods and weld arc onto the two booms — all four
		 * of which read 0 px, 0 px and 3 px from here before it. A lever with
		 * no view is judged on somebody else's frame, and `uncoveredLevers`
		 * asserts that rather than describing it.
		 *
		 * Three radii, which is the probe's `CLOSE_RADII` and this set's other
		 * axis view: the comparison worth having is against the frame the
		 * figures were measured at. The subject is sparse and 1.66 km of
		 * declared reach is mostly boom, so it fills less of the frame than the
		 * trade station does at the same rung — that is the form, not the
		 * framing, and #146 halves it again on the sheet.
		 */
		what: "A shipyard on its own aperture axis at three radii: the strobes on the drum that turns, and the floods and weld arc between the two booms.",
		shot: {
			kind: "station-axis",
			station: "shipyard",
			radii: 3,
			view: "chase",
		},
	},
	{
		name: "station-refinery-axis",
		covers: [300, 102, 101, 99, 202, 165],
		/**
		 * **The refinery from its own aperture axis, on seed 2** (#300). `SEED`
		 * 47 generates no refinery, so this declares its own the way
		 * `refinery-cradle-berth` does and for the same reason — and that view
		 * is a *berth* frame, looking at the deck from a cradle on it, so it
		 * cannot show what an arriving pilot sees.
		 *
		 * What it is evidence for: the lit ports moved off the head house's
		 * edge-on walls onto the pad deck, in the sectors between the berths and
		 * the floods, and the flare stack's vent bank sized to this form rather
		 * than to a ship. The ports read 0 px from here and the throats 0 px at
		 * 2.9 px wide.
		 */
		what: "A refinery on its own aperture axis at three radii, seed 2: the lit ports round the pad, the heat ring, and the flare stack's throats.",
		shot: {
			kind: "station-axis",
			station: "refinery",
			radii: 3,
			view: "chase",
			seed: 2,
		},
	},
	{
		name: "station-flank",
		covers: [208, 102, 101, 99, 201, 207, 202],
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
		covers: [199, 102, 101, 99, 202, 203],
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
		covers: [208, 102, 101, 99, 201, 202],
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
		covers: [208, 199, 102, 101, 99, 200, 201, 207, 203],
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
		covers: [208, 211, 99, 206, 200, 207],
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
		covers: [208, 211, 206, 207],
		what: "A rocky planet spanning the frame at two radii, limb on the top and bottom edges. Surface detail at the largest apparent size it still resolves at, and the frame the planet-cost table prices.",
		shot: {
			kind: "body-offset",
			body: "planet-5",
			radii: 2,
			sunAngleDeg: 60,
			view: "chase",
		},
	},
	/**
	 * **The only ringed body the sheet can show, and it names its own seed.**
	 *
	 * `SEED` 47 generates no gas giant at all — `FIXTURE.planets` is two rocky
	 * worlds — and only a `jovian` or an `iceGiant` can carry rings
	 * (`planet-appearance.ts`). So there is no framing of the fixture that puts
	 * a ring in shot, and re-pinning `SEED` to get one would reframe every view
	 * above against a different world. `refinery-cradle-berth` already
	 * established the alternative.
	 *
	 * **The seed and the angle are measured, and #210 needs *two* conditions of
	 * them rather than one.** Both shadows are the same geometry read from
	 * opposite ends, and each has its own way of not being in the picture:
	 *
	 * - The **ring's shadow on the planet** exists at all only while the sun is
	 *   low enough over the ring plane for the annulus to project onto the
	 *   sphere. Measured over every ringed body in the first four hundred
	 *   seeds: seed 6's ice giant — the body #210's own evidence was read off —
	 *   stands at 63.6°, where it misses the disc entirely. Seeds 4, 10 and 29
	 *   sit near 5°, where it collapses to a line. Seed 5's jovian is at 27.8°,
	 *   which lays a band across the disc.
	 * - And it falls on the hemisphere **away** from the sun, so it is only
	 *   visible from a camera on that side of the ring plane. This is what the
	 *   first version of this view got wrong: seed 34 at 33.6° satisfies the
	 *   elevation, and at every `sunAngleDeg` under 150 the camera stands on the
	 *   *sun's* side. The captured frame showed the eclipse on the ring
	 *   perfectly and a disc with nothing on it, which reads exactly like a
	 *   shadow that was never drawn. Seed 5 is on the shadow side at every
	 *   angle.
	 *
	 * `sunAngleDeg` 90 is where the two stop competing. Below it the disc is
	 * fully lit and the planet's own shadow falls behind the ring where nothing
	 * can see it; above about 120 the ring opens to 0.96 of full and the planet
	 * is a crescent, so the band has almost no lit disc to cross. At 90 the
	 * terminator runs down the middle, the ring is 0.83 open, and the eclipse
	 * reaches out sideways across it.
	 *
	 * `radii` 6 rather than `planet-fill`'s 2: the ring runs out to 2.3 body
	 * radii, so the frame has to hold more than four times the subject that view
	 * does. Set by the same method as every other number here — opening the PNG
	 * and looking — and nothing checks it.
	 */
	{
		name: "ringed-giant",
		covers: [210, 206, 207, 99],
		what: "A ringed gas giant, seed 5, sun 27.8° above the ring plane and 90° off the camera. The planet's shadow reaching across the ring and the ring's band across the disc — the pair #210 draws.",
		shot: {
			kind: "body-offset",
			body: "planet-6",
			seed: 5,
			radii: 6,
			sunAngleDeg: 90,
			view: "chase",
		},
	},
	/**
	 * **A gas giant close enough to read, which nothing in the set was** (#209).
	 *
	 * The node was written naming `planet-fill` and `station-shipyard-flank` as
	 * its views, and neither can judge it: `tests/view-set.test.ts` asserts that
	 * every planet of the canonical `SEED` is rocky — `planet-fill` frames one
	 * of them — and the other is a station. `ringed-giant` is the only gas giant
	 * in the set and it stands at 6 radii to hold a ring that runs out to 2.3,
	 * where a band edge and a storm's eye are a few pixels each.
	 *
	 * So this is the one case the map's rule allows a new view for: no existing
	 * frame shows the surface. It borrows `ringed-giant`'s seed and body rather
	 * than finding its own — seed 5's `planet-6` is the jovian that view already
	 * established and navigates to, and a second declared seed would be a second
	 * world to keep track of for no gain. What differs is the range and the
	 * light: 2 radii, the same as `planet-fill`, which is where #206's own table
	 * says the surface is at the largest apparent size it still resolves at.
	 *
	 * `sunAngleDeg` 35 rather than `planet-fill`'s 60. The bands and the storm
	 * are albedo, so they want light; the limb is the other half of what this
	 * node changed and needs a slice of terminator on the disc to be seen
	 * against. 35 keeps most of the face lit with the terminator still inside
	 * the frame. `chase` for `planet-fill`'s reason — the canopy frame would eat
	 * a third of the one thing the view exists to show.
	 */
	{
		name: "giant-fill",
		covers: [209, 206, 207, 99],
		what: "A gas giant spanning the frame at two radii, seed 5, lit from 35°. Band tones and edges, the storm's eye and rim, and the limb where the shell meets the disc.",
		shot: {
			kind: "body-offset",
			body: "planet-6",
			seed: 5,
			radii: 2,
			sunAngleDeg: 35,
			view: "chase",
		},
	},
	{
		name: "sky-only",
		covers: [100, 200],
		what: "Away from the star and every body. The backdrop with nothing in front of it.",
		shot: { kind: "deep-sky", view: "cockpit" },
	},
	/**
	 * The gap between these two rows is #432's answer, and it is a measurement
	 * rather than a missing row. A row standing at the cluster's rim and aimed
	 * along the **Core bearing** was built, captured on the GPU lane and judged by
	 * the principal, whose reading was *"few dots, neither wall of dots or cone of
	 * lights"*. That is what the arithmetic predicts:
	 * `scripts/measure-sky-density.ts`'s core mode prints the crowded heading's
	 * points-per-square-degree against the density the invented population already
	 * lays down in *every* direction, and the cone loses. No framing at a
	 * 256-system cluster makes #100's lever visible, because — as `CONTEXT.md`
	 * says of the Core bearing — it carries information rather than light. What
	 * #432 shipped is the way to stand at a named system (`?system=`) and the
	 * measurement that standing there is not enough.
	 *
	 * The row below is what came back after that, in the role a rim frame can
	 * actually fill, on the principal's ruling and not on this file's: the cone is
	 * #478's to decide, and the sky is already the picture he asked for.
	 *
	 * **What its caption may claim is measured rather than tasted, and this is the
	 * one place that account lives.** Two claims are open to it and no more. Where
	 * it stands — the farthest system of the cluster, recomputed by
	 * `tests/view-set.test.ts` — and which rule pointed the camera. Nothing else.
	 *
	 * In particular it says nothing about what is *in* the frame, and two drafts of
	 * it did. The first read *"seen from where they are thinnest"*:
	 * `__emptiestDirection` takes the star and the bodies of *this system* as its
	 * subjects and knows nothing about the derived field, so the heading is as free
	 * to point coreward, where the neighbours are densest, as outboard. The second
	 * read *"with nothing in front of it"*, which is the subtler of the two and just
	 * as unheld: the rule maximises the *minimum* angle over a 512-point sampling of
	 * the sphere, which makes it the emptiest heading available rather than an empty
	 * one, and nothing here bounds the angle it achieves against the cockpit's field
	 * of view at system 115. Bounding it is clearance arithmetic, and clearance
	 * arithmetic is what #432's `aim` axis existed to do and this row deliberately did
	 * not revive. So the line names the *rule* — what the camera did, which is true
	 * and readable off the placer — instead of what the frame contains, which is
	 * neither. (`sky-only`'s line has said *"with nothing in front of it"* since
	 * #104 on just the basis this paragraph calls unheld, and it was a fair
	 * question why a new row had to be careful about a sentence an old one had been
	 * spending for twenty nodes. #487 measured it and the sentence stands —
	 * `scripts/measure-sky-clearance.mjs` prints what it found and `probe-sky.mjs`
	 * holds this file's own seed, and neither the sweep's count nor its verdict is
	 * reprinted here. Which does not make this row's draft right: it claimed a
	 * *crowding* property, which is a different question from a clearance and is not
	 * rescued by measuring one.)
	 *
	 * System 115 is the farthest of the 256 from the cluster centre on the sheet's
	 * own seed, on the generator's own radial coordinate (`SystemRecord.t`) rather
	 * than a ruler held here, which is what the row's `what` means by *"the
	 * outermost system on the cluster's rim"*. How far out that is is deliberately
	 * not written down: what answers to a re-cut cluster is the rule — no other
	 * system outranks it — and the floor — it stands in the rim third — and both are
	 * in `tests/view-set.test.ts`, while a figure in a comment answers to neither.
	 * The index is written down because a shot has to name one and the capture is a
	 * browser tool that cannot recompute anything, and it is *recomputed* rather
	 * than remembered in `tests/view-set.test.ts`: the same fold over
	 * `makeWorld(SEED).galaxy.systems` runs there every run, so a re-cut cluster
	 * moves the row or goes red rather than leaving it standing at a star that is
	 * no longer the edge. The browser-side half is `ensureFixture`: it restores seed
	 * and system together, reads the index back off the world the page is running, and
	 * throws on a mismatch. Both halves are worth stating precisely rather than
	 * praising. The boot has run — this row's capture put the page at system 115 and
	 * the readback agreed — which is the first time that path has been walked for a row
	 * rather than for a test fixture. The refusal has never fired, in a capture or
	 * anywhere else: it is a throw in a browser tool that no headless test can reach,
	 * and the nearest thing to coverage of the subject is `probe-sky.mjs` proving that
	 * the *page* refuses an unusable index politely, which is the other half of a
	 * different guard. Said out loud because this is the first row leaning on a net
	 * that has never once caught anything. Nor is it assumed that the number in the
	 * literal means what `?system=` reads: that question is settled where it could be
	 * got wrong, by `probe-sky.mjs` asking the URL for an index it computed off the
	 * running page and asking the page which system it came up as.
	 */
	{
		name: "sky-at-the-rim",
		covers: [431],
		what: "Aimed by the emptiest-heading rule `sky-only` uses, at the outermost system on the cluster's rim. The derived sky, framed from the rim rather than the centre.",
		shot: { kind: "deep-sky", view: "cockpit", system: 115 },
	},
	/**
	 * #372's two frames: the tree as `?` first opens it, and with four groups
	 * folded, so the sheet shows both what a fold does and the lower groups an
	 * open tree pushes below the panel.
	 */
	{
		name: "controls-open",
		covers: [372],
		what: "`?` pressed in flight: the head on the right console's Controls tab, every group open. The owner line, the chord, and FLY, FIGHT and DOCK from the top.",
		shot: { kind: "controls", view: "cockpit" },
	},
	{
		name: "controls-folded",
		covers: [372],
		what: "The same tab with FLY, FIGHT, DOCK and TRADE folded: four closed headers, then VIEW and SYSTEM open below them.",
		shot: {
			kind: "controls",
			view: "cockpit",
			folded: ["fly", "fight", "dock", "trade"],
		},
	},
	/**
	 * #381 S4's frame, and the reason it is here at all: the capture modal is a
	 * **fourth modal surface**, which #369 D9 names as the cost of hosting the
	 * rebind on this tab, and a drawn surface with no frame in the set is what
	 * #177 is open about for the galaxy chart. It is captured mid-session
	 * rather than empty — a modal listening and a modal holding something are
	 * different pictures, and the second is the one a player spends time
	 * reading.
	 *
	 * The tab behind it is part of the subject: the frame shows the door, and
	 * it shows a held row printing `hold` beside a pressed one, which is D3's
	 * split finally visible on the screen #370 owns.
	 */
	{
		name: "controls-rebind",
		covers: [381],
		what: "The rebind modal open on Pitch: nose up with `k` caught, over the Controls tab. The Settings and Commanders doors top right; `hold s` and `hold k` where the tab used to print bare characters.",
		shot: {
			kind: "controls",
			view: "cockpit",
			rebind: "fly.pitchUp",
			press: "k",
		},
	},
	/**
	 * #324 part (c)'s two frames: the glass and the console, because the
	 * principal put the duel gauges in both places. They come before the views
	 * that dock the ship; the placer resets the flight, so what came before them
	 * does not matter.
	 */
	{
		name: "duel-glass",
		covers: [324],
		what: "A duel in cockpit view, the raider selected and in the sights. The SHD and HEAT row above the course band, the raider's ring in the duel tone with its on-target mark.",
		shot: { kind: "duel", headLook: "forward", view: "cockpit" },
	},
	{
		name: "duel-console",
		covers: [324],
		what: "The same duel, head turned to the right console on its Flight tab. FORE, AFT, HULL, ENERGY BANK and HEAT beside ASSIST and CHARGE.",
		shot: { kind: "duel", headLook: "right", view: "cockpit" },
	},
	{
		name: "raider-canisters",
		covers: [324],
		what: "Just after a kill, facing the wreck's cargo: a canister marked on the glass with its good and range (#324 part d).",
		shot: {
			kind: "duel",
			headLook: "forward",
			aftermath: "canisters",
			view: "cockpit",
		},
	},
	{
		name: "raider-log",
		covers: [324],
		what: "Ten minutes after a kill, head turned to the Communications console: the raider log's destroyed and under-repair lines (#324 part d).",
		shot: { kind: "duel", headLook: "left", aftermath: "log", view: "cockpit" },
	},
	/**
	 * #532's fixed-phase strip (#195 D4). The wind-up runs on wall-clock time,
	 * so an ordinary capture cannot land on the same frame twice; each row holds
	 * the transition at a phase through `holdWitchspace` and holds the clock, so
	 * the charge cannot fire while the frame settles.
	 *
	 * Six cockpit rows across the straddle, and two from outside, because
	 * #195 D2's rift is judged from outside the ship and a cockpit strip shows
	 * none of it. The phases before the cut are drawn in the start system; the
	 * ones from the cut on are drawn after a real jump to the nearest
	 * system, so the new system and the rift are the ones a player gets.
	 *
	 * **The `before` arm is the hard cut.** A build without `holdWitchspace` is
	 * captured through the same placer and captioned as having no transition, the
	 * way the controls placer captions a build with no Controls tab. Capture it
	 * with this branch's scripts over the base build's `src/`.
	 */
	{
		name: "witchspace-windup",
		covers: [532],
		what: "Cockpit, 2.4 s before the cut: the sky starting to crowd forward as the drive takes the ship toward light speed.",
		shot: { kind: "witchspace", phase: -2.4, view: "cockpit" },
	},
	{
		name: "witchspace-entry",
		covers: [532],
		what: "Cockpit, 1.5 s before the cut: the starbow — the sky squeezed round the nose, blue ahead and red at the rim, the streaks straight out from the nose and the stars bent round it.",
		shot: { kind: "witchspace", phase: -1.5, view: "cockpit" },
	},
	{
		name: "witchspace-entry-late",
		covers: [532],
		what: "Cockpit, 0.4 s before the cut: escaping the light — the dark has closed to one blazing point ahead.",
		shot: { kind: "witchspace", phase: -0.4, view: "cockpit" },
	},
	{
		name: "witchspace-cut",
		covers: [532],
		what: "Cockpit, on the cut, in the new system: the flash in the dark the world is replaced in.",
		shot: { kind: "witchspace", phase: 0, view: "cockpit" },
	},
	{
		name: "witchspace-exit",
		covers: [532],
		what: "Cockpit, 1.5 s after the cut: riding the tunnel, behind the cabin — mist, plasma strands, rings rushing past.",
		shot: { kind: "witchspace", phase: 1.5, view: "cockpit" },
	},
	{
		name: "witchspace-exit-late",
		covers: [532],
		what: "Cockpit, 3.3 s after the cut: the new system's light catching up — the sky unfolding out of the point, red-shifted, the hands still held.",
		shot: { kind: "witchspace", phase: 3.3, view: "cockpit" },
	},
	{
		name: "witchspace-rift-chase",
		covers: [532],
		what: "Chase, 4.3 s after the cut: the sky back and the arrival rift open around the ship, from outside.",
		shot: { kind: "witchspace", phase: 4.3, view: "chase" },
	},
	{
		name: "witchspace-rift-closing",
		covers: [532],
		what: "Chase, 6.5 s after the cut: the rift closing behind a ship already in the new system.",
		shot: { kind: "witchspace", phase: 6.5, view: "chase" },
	},
	/**
	 * #535's strip: the opening a guided new game watches (#530), held through
	 * its phase handle at a shot and a shown time. Two frames a shot, early and
	 * late, because each shot moves: the rift opens and closes, the ship passes
	 * the camera and goes to cruise, the planet slides past, the aperture grows.
	 *
	 * **The `before` arm is the docked start.** A build before #535 has no
	 * opening, so a `?cinematic` boot there is #408 D1's placement, and the
	 * placer captions it so rather than pretending to a shot.
	 */
	{
		name: "opening-forming",
		covers: [535],
		what: "The prologue, 2 s in: empty space at the arrival point, no ship yet, the witchspace rift forming out of nothing before the cut to the arrival.",
		shot: { kind: "opening", shot: "forming", at: 2, view: "chase" },
	},
	{
		name: "opening-arrival",
		covers: [535],
		what: "The opening, 1.5 s in: the ship in the witchspace tunnel, seen from ahead and off the nose — the rift is sized for a chase camera on that axis, and this is the frame that checks it from off it.",
		shot: { kind: "opening", shot: "arrival", at: 1.5, view: "chase" },
	},
	{
		name: "opening-arrival-rift",
		covers: [535],
		what: "The opening, 4.5 s in: the sky back and the arrival rift open behind the resting ship, the system named under it.",
		shot: { kind: "opening", shot: "arrival", at: 4.5, view: "chase" },
	},
	{
		name: "opening-flypast",
		covers: [535],
		what: "The fly-past, 1.5 s in: the same take as the arrival, no cut — the orbit has stopped and the ship burns past that camera toward the trade station, the rift closing behind it.",
		shot: { kind: "opening", shot: "flypast", at: 1.5, view: "chase" },
	},
	{
		name: "opening-flypast-away",
		covers: [535],
		what: "The fly-past, 3.5 s in: the ship past the camera and going away, the spool about to hand it to cruise.",
		shot: { kind: "opening", shot: "flypast", at: 3.5, view: "chase" },
	},
	{
		name: "opening-cruise",
		covers: [535],
		what: "The planet fly-by, 1 s in: the ship under cruise past the start station's planet — between ship and planet, or the reverse angle with the planet behind the ship.",
		shot: { kind: "opening", shot: "cruise", at: 1, view: "chase" },
	},
	{
		name: "opening-cruise-late",
		covers: [535],
		what: "The planet fly-by, 7 s in: the leg's end, the camera swung round the ship with the planet still in frame.",
		shot: { kind: "opening", shot: "cruise", at: 7, view: "chase" },
	},
	{
		name: "opening-approach",
		covers: [535],
		what: "The station approach, 1 s in: the scene after the drop-out, behind the ship on the line from the station, ship and station in one frame.",
		shot: { kind: "opening", shot: "approach", at: 1, view: "chase" },
	},
	{
		name: "opening-approach-late",
		covers: [535],
		what: "The station approach, 5 s in: the ship closed to a few kilometres, the station recognisable before the cut to the dock.",
		shot: { kind: "opening", shot: "approach", at: 5, view: "chase" },
	},
	{
		name: "opening-dock",
		covers: [535],
		what: "The dock, 1 s in: station control bringing the ship in on the aperture axis, the station behind it and the line saying who flies.",
		shot: { kind: "opening", shot: "dock", at: 1, view: "chase" },
	},
	{
		name: "opening-dock-late",
		covers: [535],
		what: "The dock, 7 s in: the ship at the mouth of the slot, a moment before the berth.",
		shot: { kind: "opening", shot: "dock", at: 7, view: "chase" },
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
		covers: [147, 105, 99, 201],
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
		covers: [199, 147, 102, 99, 201, 203],
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
		covers: [199, 147, 99],
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
		covers: [199, 165, 147, 99, 257],
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
		covers: [165, 147, 257],
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
			// **Named, not defaulted** (#257). The workbench opens on the first
			// variant in the list; the outpost's selected form is D since the
			// principal's yes on this node's sheet, and a frame that kept
			// showing A would be a view of a form the role no longer carries.
			variant: "d",
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
/**
 * The opening's shots, as `src/opening.ts` names them in `OPENING_SHOTS.guided`.
 * This file runs under node and cannot import that module, so the list is
 * copied — and `tests/view-set.test.ts` holds the copy equal to the source.
 */
export const OPENING_SHOT_NAMES = Object.freeze([
	"forming",
	"arrival",
	"flypast",
	"cruise",
	"approach",
	"dock",
]);

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
	controls: (s) =>
		s.folded === undefined ||
		(Array.isArray(s.folded) && s.folded.every((g) => typeof g === "string")),
	// A phase in seconds from the cut (#195 D4): negative in the wind-up.
	witchspace: (s) => finite(s.phase),
	// A shot of the guided opening and shown seconds into it (#530's handle).
	opening: (s) =>
		OPENING_SHOT_NAMES.includes(s.shot) && finite(s.at) && s.at >= 0,
	duel: (s) =>
		["forward", "right", "left"].includes(s.headLook) &&
		(s.aftermath === undefined ||
			s.aftermath === "canisters" ||
			s.aftermath === "log"),
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
			// `system` is checked over every kind rather than inside one's, because
			// it is a boot parameter and not a framing: a row may name where it
			// stands as well as which world it stands in (#432). A fractional,
			// stringy or negative one would reach `?system=` as an index the page
			// refuses — and the page refuses *politely*, booting the start system,
			// so a bad value here is the wrong picture wearing the right caption.
			//
			// The upper bound is deliberately absent: the galaxy's length is not
			// this file's to own, and `capture-views.mjs` reads the booted index back
			// and throws, so an index too big for the galaxy is caught where the
			// page that refused it is still open. A negative is caught here because
			// no bound is needed to know it is wrong.
			if (
				v.shot.system !== undefined &&
				(!Number.isInteger(v.shot.system) || v.shot.system < 0)
			)
				return true;
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
 * @param {Array<{label: string, gitRef: string, capturedAt: string, renderer: string, seed: number, served?: import("./tree-declaration.mjs").TreeDeclaration, views: Array<{name: string, file: string, gameTime?: number}>}>} runs
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
	/**
	 * Which tree the frames were actually taken of.
	 *
	 * `gitRef` above is the ref of the checkout the capture *script* ran in, and
	 * for #123's failure those are the two different things: a dev server left
	 * running in a sibling worktree served a whole other branch's hulls into a
	 * sheet labelled with this one's ref, and nobody looking at it could have
	 * known. The server's own declaration is what is printed here.
	 *
	 * **It is provenance, not a cross-check** — `capture-views.mjs` carries
	 * the argument, and this file claimed the detection for a round. What
	 * closes #123 is the *refusal*: the guard throws unless the declared root
	 * is the capture's own tree, so a live run cannot reach the disagreement
	 * this line would show. What the line buys is that a sheet on disk names
	 * the checkout its pixels came from, which is what #123's sheet could not.
	 *
	 * **The root is always shown, and the branch is the extra.** It was the
	 * other way round for a round — `branch@head` where git could be read, with
	 * the root only in a hover title — and that renders two worktrees of the
	 * same branch at the same commit as an identical string, which is precisely
	 * the pair #296 demonstrated the guard on. A path is what tells two
	 * checkouts apart; a ref is what tells two builds apart, and the sheet needs
	 * both.
	 *
	 * **Absent is a state, not an error.** A `before` half captured at a base
	 * commit was written by a `capture-views` that did not record this, and a
	 * sheet that refused such a run could never show a before/after for the
	 * change that introduced it. It says so rather than leaving a blank that
	 * reads as agreement.
	 */
	const servedBy = (run) => {
		const s = run.served;
		if (!s) return "served: not recorded";
		// Both fields gated together, because they are read together and the
		// declaration emits all of git or none of it. Keying on `branch` alone
		// while reading `head` prints `main@undefine` the day that stops being
		// true, which the JSDoc type above already allows.
		const ref =
			s.branch && s.head
				? ` (${s.branch}@${String(s.head).slice(0, 7)}${s.dirty ? "-dirty" : ""})`
				: "";
		return `served: ${s.root}${ref}`;
	};
	const head = runs
		.map(
			(r) =>
				`<th><b>${esc(r.label)}</b><span>${esc(r.gitRef)} · ${esc(r.renderer)}${esc(clockSpan(r))}</span>` +
				`<span>${esc(servedBy(r))}</span></th>`,
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
