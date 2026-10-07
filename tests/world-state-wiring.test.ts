/**
 * The `Game`'s writes to its `WorldState` go through the module's writers.
 *
 * `world-state.ts`'s `withEnvelope` carries three things a hand-rolled write
 * does not: the galaxy bound, the `at < gameTime` refusal, and `materializeDue`
 * before the edit. Its own comment says a fifth writer "should not have to
 * rediscover the sequence" — and the fifth writer was in `main.ts`, which
 * spread a replacement envelope in by hand and set
 * `gameTime: this.world.gameTime / 60`.
 *
 * **That division is the defect, not a style point.** `World.gameTime` is
 * seconds (`sim.ts`); a `DeficitRow.updatedAt` is game minutes
 * (`deficits.ts`). A caller holding both must convert one of them at exactly
 * one boundary, and the hand-rolled write converted the world clock instead of
 * the row's stamp — so the first save taken after a trade would carry a clock
 * sixty times too small, and every `completesAt` in the snapshot would then sit
 * in the future for an hour of play.
 *
 * `Game` is not constructible headless — it builds a renderer — so this reads
 * the source. A source assertion is what `tests/output-stage.test.ts` and
 * `tests/headless.test.ts` already do for the same reason, and the alternative
 * is the wire being checked by nothing at all until a browser probe notices.
 */

import { describe, expect, test } from "bun:test";

const MAIN = await Bun.file(new URL("../src/main.ts", import.meta.url)).text();

/** Every writer `world-state.ts` exports that returns a new `WorldState`. */
const WRITERS = [
	"advanceTo",
	"withDeathWreck",
	"materializeDerelict",
	"scoopDerelict",
	"observeDerelict",
	"applyTransition",
	"materializeDue",
	"observe",
	"observeDocking",
	"observeScan",
	"observeSystemRelay",
	"setDeficits",
	"setLegalHeat",
	// `legal.ts`'s lazy clear of the witnesses and the assault marks (H6),
	// through `setLegalWitnesses` and `setLegalAssaulted`. A writer by
	// composition, not a new one.
	"settleIncident",
	// **`withOffence` and `markAssaultCharged` are not here since #633**, and
	// that is a tightening: they are `legal.ts`'s own steps inside
	// `chargeOffence` and no longer exported, so `Game` has no business naming
	// them. The offence reaches `Game` as `chargeOffence`'s `world`, which is
	// held by the `adoptWorld` row below.
	"visit",
];

describe("the Game's world writes", () => {
	test("every assignment to the persistent world calls a world-state writer", () => {
		// The right-hand side of each `this.commerceWorld = …`, up to the end of
		// that line. A call is `name(` on the line; an object literal is `{`.
		const assignments = [...MAIN.matchAll(/this\.commerceWorld = (.*)$/gm)].map(
			(m) => m[1].trim(),
		);
		// The constructor's `newPersistentWorld` plus the writers. If this hits
		// zero the regex has drifted and every case below is vacuously true.
		expect(assignments.length).toBeGreaterThanOrEqual(5);
		const byHand = assignments.filter(
			(rhs) =>
				!rhs.startsWith("newPersistentWorld(") &&
				// The load arm. A snapshot that came out of `parseSave` is the
				// one right-hand side that is neither a construction nor a
				// write: it is the world being *adopted*, already validated, and
				// requiring it to go through a writer would mean replaying the
				// save through `applyTransition` to arrive at what it already
				// says. Spelled as the exact expression rather than as a
				// pattern, so a hand-built object literal cannot hide behind it.
				rhs !== "save.world;" &&
				// The adopt point (#631), which takes a hold event's outcome
				// and a world write made outside Holdings. What `holdings.ts`
				// puts there is held by the row below that scans that module,
				// and what `adoptWorld` is handed by the row that scans its
				// callers; the exact expression, for `save.world`'s reason.
				rhs !== "next.world;" &&
				!WRITERS.some((w) => rhs.startsWith(`${w}(`)),
		);
		expect(byHand).toEqual([]);
	});

	test("the carrier-condition hook exists and writes through the module", () => {
		// **Named for what it can check.** It was called "the path is reachable
		// from a running game", and `toContain("applyCarrierTransition(")` is
		// satisfied by the method's own declaration — so the row stayed green on
		// a build where nothing ever called it, which is the state its comment
		// claimed #90 had fixed. **#324 part d is its first in-flight producer**:
		// a raider kill applies the slot's destruction through it. What this
		// holds is that the hook goes through the module's writer rather than
		// editing the envelope, so no caller can reach a state a real writer
		// could not, and that the kill is what calls it. A source check, for the
		// same reason as the rows above — `Game` builds a renderer and is not
		// constructible headless.
		//
		// Split on the **declaration**, not the first occurrence: the kill's call
		// comes earlier in the file than the method, and the first version of this
		// row read the call site as the body.
		//
		// **#627: the module is `holdings.ts` now**, which applies the
		// transition through `world-state.ts`'s writer and pays a player's kill
		// in the same event. That the event does both is `holdings.test.ts`'s;
		// this row is that the hook reaches it and applies no law itself.
		const declaration = "applyCarrierTransition(\n\t\tkey: CarrierKey,";
		expect(MAIN).toContain(declaration);
		expect(MAIN).toContain("carrierCondition(");
		const body = (MAIN.split(declaration)[1] ?? "").split("\n\t/**")[0];
		expect(body).toContain("hull: HullId | null");
		expect(body).toContain("applyHoldEvent(");
		expect(body).toContain('kind: "carrier"');
		for (const law of ["applyTransition(", "recordKill(", "pendingKill("])
			expect(body).not.toContain(law);
		// The raider's end is one method for the duel's kill and a
		// collision's (node #664), `endEncounter`.
		const kill = MAIN.split('ended.end === "destroyed"')[1] ?? "";
		expect(kill.slice(0, 600)).toContain("this.applyCarrierTransition(");
		expect(kill.slice(0, 600)).toContain("raiderDestruction(");
	});

	/**
	 * #627 D3: every kill site makes one call, and the call names the struck
	 * hull. `creditKill` — the ladder half, called by hand at four sites that
	 * nothing checked — is gone, so no site can pay one half of a kill.
	 */
	test.each([
		// The anchor names the site; the call follows it (the traffic, raider
		// and tender sites open on their anchor) or encloses it (the relay site
		// names its transition inside the call).
		["traffic", "private destroyTrafficCarrier(", "after", "actor.hullId"],
		["raider", 'ended.end === "destroyed"', "after", "RAIDER_HULL_ID"],
		["relay", "relayDestruction(record.index, now", "before", "null"],
		["tender", "tenderKill(record.index, now", "after", "RELAY_TENDER_HULL_ID"],
	])(
		"the %s kill pays through the one carrier event",
		(_, head, side, hull) => {
			/** A kill site is one method's span; a call farther than this from its
			 *  anchor belongs to some other site. */
			const SITE_CHARS = 1600;
			const start = MAIN.indexOf(head);
			expect(start).toBeGreaterThan(-1);
			const at =
				side === "after"
					? MAIN.indexOf("this.applyCarrierTransition(", start)
					: MAIN.lastIndexOf("this.applyCarrierTransition(", start);
			expect(at).toBeGreaterThan(-1);
			expect(Math.abs(at - start)).toBeLessThan(SITE_CHARS);
			const call = MAIN.slice(at, MAIN.indexOf(");", at));
			// The hull is the call's last argument.
			expect(call.trimEnd().replace(/,$/, "").trimEnd().endsWith(hull)).toBe(
				true,
			);
		},
	);

	test("creditKill is gone, so no site can pay one half of a kill", () => {
		expect(MAIN).not.toContain("creditKill");
	});

	test("#366 and #396: an offence names every station that heard it, and every berth asks the law", () => {
		// `Game` builds a renderer, so this is a source check — the same reason
		// the rows above are. What it is guarding is the two ways this node could
		// ship green and do nothing: an offence that charges heat and never names
		// a witness (H5 unwritten), and a `refusedByLaw` computed by a helper
		// nobody calls (H5 and H7 unread).
		//
		// **#633 moved the charge into `legal.ts`'s `chargeOffence`**, so what
		// this row holds of `Game` is the facts it hands over and the one door
		// the result comes back through. The law itself — the earshot, the
		// incident, the mark — is `tests/legal.test.ts`'s, at the event.
		//
		// **#396 amended which end the reach is measured from**, and these two
		// assertions are that amendment rather than the frame body's rule it
		// replaced: the candidates are this system's stations, and the position
		// the distance is taken from is the victim's — a required fact, so no
		// call site can quietly measure from the player again.
		const earshot = MAIN.split("private earshotStations()")[1] ?? "";
		expect(earshot.slice(0, 400)).toContain('body.kind === "station"');
		// The key comes from the one derivation of it, not a spelling of it.
		expect(earshot.slice(0, 400)).toContain("this.stationKey(");
		expect(MAIN).toContain("private stationKey(station: Station): CarrierKey");
		// Every charge names where the **carrier** stood. The fight is passed
		// rather than a position plucked out at each call site, so the rule this
		// assertion holds is where the earshot is measured *from*: the victim's
		// own row. Facts that read the player's position instead — through
		// `world.ship` or a parameter default — are #396's amendment quietly
		// undone, and they would still compile.
		const facts = methodBody("private offenceFacts(");
		expect(facts).toContain("victim: engagement.flight.ship.pos,");
		expect(facts).toContain("stations: this.earshotStations(),");
		expect(facts).not.toContain("world.ship.pos");
		// The instance and the strike's clock come off one row, the one each
		// site read before its transition.
		expect(facts).toContain("instanceOrdinal: before.instanceOrdinal,");
		expect(facts).toContain("struckAt: strikeClock(before),");

		// **Three sites, one call each, one door** (#633 D1, D3). Each reads the
		// carrier's row, applies its own transition through Holdings if it has
		// one, then charges against the row it read — the order H9 needs, since
		// a row read after the divert already describes the strike. And no site
		// saves by hand: the result goes through `adoptWorld`, which saves on a
		// change in reference (#631), so an assault is one write and not two.
		expect(MAIN.match(/\bchargeOffence\(/g) ?? []).toHaveLength(3);
		for (const [head, offence, transition] of [
			["private assaultTrafficCarrier(", "assault", null],
			[
				"private divertTrafficCarrier(",
				"struck",
				"this.applyCarrierTransition(",
			],
			[
				"private destroyTrafficCarrier(",
				"destroyed",
				"this.applyCarrierTransition(",
			],
		] as const) {
			const body = methodBody(head);
			const read = body.indexOf("const carrier = this.carrierCondition(");
			const call = body.indexOf("const charge = chargeOffence(");
			expect(read).toBeGreaterThan(-1);
			expect(call).toBeGreaterThan(read);
			expect(body.match(/\bchargeOffence\(/g) ?? []).toHaveLength(1);
			expect(body.slice(call, call + 200)).toContain(
				`this.offenceFacts(actor, carrier, "${offence}", engagement)`,
			);
			expect(body.slice(call)).toContain("this.adoptWorld(charge.world);");
			expect(body).not.toContain("saveDirty(");
			if (transition !== null) {
				const at = body.indexOf(transition);
				expect(at).toBeGreaterThan(read);
				expect(at).toBeLessThan(call);
			}
		}
		// **And `Game` composes none of it.** The four functions the charge used
		// to be assembled from are `legal.ts`'s own now (#633 D5); a name
		// reappearing here — even in a comment, which is where a stale claim
		// about who reads what would live — is the composition coming back.
		for (const name of [
			"chargedOffence",
			"marginalOffenceHeat",
			"withOffence",
			"markAssaultCharged",
		])
			expect(MAIN).not.toMatch(new RegExp(`\\b${name}\\b`));

		// Three consumers, each named by the call it has to feed. A count over the
		// file was the first version and it is the wrong shape: it moves when a
		// fourth *reader* is added — the probe readout is exactly that fourth —
		// while saying nothing about whether the protocol's three doors are open.
		const feeds = (call: string) =>
			(MAIN.split(call)[1] ?? "")
				.slice(0, 900)
				// The value is named, not just the key. Sage's round one caught
				// the difference: a call site passing `refusedByLaw: false`
				// satisfies a key-only check exactly as the real one does, and
				// that is precisely the regression — H5 and H7 computed by a
				// helper nobody feeds — this row exists to refuse.
				.includes("refusedByLaw: this.refusedByLaw(");
		expect(feeds("const next = requestClearance(")).toBe(true);
		expect(feeds("const outcome = attemptEntry({")).toBe(true);
		expect(feeds("const director = dockingDirector({")).toBe(true);
		expect(MAIN).toContain("dockingRefusedByLaw(");
		// And the helper they feed is the one that asks the law, not a field.
		expect(MAIN).toContain("private refusedByLaw(");
		// H6's clear has to run, not exist. One call, on the flight step. It is
		// named for what it settles — the incident, which since #396 is two lists
		// — and this assertion follows it, so a rename that leaves the call site
		// behind is red here rather than a clear nobody runs.
		expect(MAIN.match(/this\.settleIncidentLists\(\);/g) ?? []).toHaveLength(1);
	});

	test("a cruise save is not handed its cruise velocity back", () => {
		// **The one thing that must not be restored under any arm.** A cruise
		// velocity is the cruise law's, up to about 10⁶× combat speed, and
		// handing it to normal flight is a ship that cannot be flown. The
		// browser arm in `scripts/probe-save.mjs` reads the restored ship back;
		// this reads the source, because the two answer different questions and
		// `Game` builds a renderer.
		const arm = MAIN.split('if (f.regime === "cruise")')[1] ?? "";
		expect(arm.slice(0, 300)).toContain("this.world.ship.vel = v3();");
		expect(arm.slice(0, 300)).toContain('this.regime = "normal";');
	});

	test("a failed write reaches the player through the store's held faults (#89 D9, §11.5)", () => {
		// The store took an `onWriteFailed` and the boot did not pass it for a
		// round, so the shipped game still told nobody while a test proved the
		// mechanism worked. It is the log line now; the badge reads the store.
		expect(MAIN).toContain("onWriteFailed:");
		const reader = MAIN.split("saveFaultText(): string | null {")[1] ?? "";
		expect(reader.slice(0, 120)).toContain(
			"return heldSaveFault(this.saveStore, this.saveFault);",
		);
		// **Not one message field written by every failure.** After a failed dock
		// flush, a debounced write that failed once and then landed replaced the
		// dock's words, and the overlay named a write that had landed (#311).
		// Sliced to each arm and matched on `saveFault =` alone, whatever follows
		// it: a guard on one spelling passed on the spelling `main` had (round 2).
		const onWriteFailed =
			MAIN.split("onWriteFailed: (error, consecutive) => {")[1] ?? "";
		const writeArm = onWriteFailed.slice(0, onWriteFailed.indexOf("},"));
		expect(writeArm).toContain("console.error(");
		expect(writeArm).not.toContain("saveFault =");
		const flush = MAIN.split("saveFlush(reason: FlushReason): void {")[1] ?? "";
		const flushBody = flush.slice(0, flush.indexOf("\n\t}\n"));
		expect(flushBody).toContain(".flush(reason)");
		expect(flushBody).not.toContain("saveFault =");
	});

	test("the badge and the overlay it opens read the one rule, every frame in both views", () => {
		// In `animate` and not in `updateCockpit`, which returns early in chase.
		const loop = MAIN.split("private animate = () => {")[1] ?? "";
		const end = loop.indexOf("\n\t};");
		expect(loop.slice(0, end)).toContain(
			"this.saveBadge?.update(\n\t\t\tthis.saveFaultShown() && !this.commanderOverlay?.isOpen(),\n\t\t);",
		);
		const shown = MAIN.split("saveFaultShown(): boolean {")[1] ?? "";
		expect(shown.slice(0, 120)).toContain(
			"return hasHeldSaveFault(this.saveStore, this.saveFault);",
		);
		expect(MAIN).toContain("fault: () => game.saveFaultText(),");
	});

	test("the jump flush runs after the arrival finishes", () => {
		// It ran beside `visit`, above `clearFlightSession` and `faceTheStar`,
		// so the record carried the departure system's regime, throttle and
		// attitude beside the new arrival position — and clearing the dirty flag
		// meant nothing below re-armed a write.
		const jump = MAIN.indexOf('this.saveFlush("jump")');
		expect(jump).toBeGreaterThan(0);
		expect(
			MAIN.lastIndexOf("this.clearFlightSession();", jump),
		).toBeGreaterThan(
			// The arrival's visit is a hold event since #627, so it is read by
			// its kind: `visit(this.commerceWorld` now finds only the boot's.
			MAIN.lastIndexOf('kind: "arrival"', jump),
		);
		expect(MAIN.lastIndexOf('kind: "arrival"', jump)).toBeGreaterThan(
			MAIN.lastIndexOf("private performJump(", jump),
		);
	});

	test("a refused save is never given a store aimed at it (#89 D9)", () => {
		// D9's one promise is that the bad record is never overwritten — it is
		// the only copy of whatever is left and the only thing the player can
		// still export. A store attached to that slot would write over it on the
		// first dirty event: the next dock, the next trade, the relay observe on
		// the next jump. The guard is on the construction, not on the write.
		//
		// **`plan.writesNothing` since #432, and the guard got wider rather than
		// moving.** It used to read `!noSave`, one cause read off the URL at the
		// call site; a pinned `?system=` is a second cause, and a shell that
		// re-derived the permission from either one of them instead of reading the
		// plan's answer would attach a store where the plan says to write nothing.
		// Why the second cause has to be said at all is §11.6 of
		// `persistent-world-state.md`, which owns the rule.
		expect(MAIN).toContain("!plan.writesNothing && plan.fault === null");
		// **And on the one-shot path**, which attaches with no such guard: a
		// record that parses and will not restore turns the plan into an overlay
		// boot there. `withRestoreFault` is tested headless; this pins that the
		// boot calls it. Textual, so it proves the call is present and nothing
		// about what surrounds it.
		expect(MAIN).toContain("plan = withRestoreFault(plan, error);");
		// **And the retry is the save's, not every construction's.** Since #432 the
		// same `catch` can be reached by a world that would not build at a *named
		// system*, where `plan.loaded` is already null; retrying there hands the
		// build the argument that just threw and labels the cause "the loaded save".
		// So the guard comes first, and its order relative to the retry is the whole
		// of what this row holds.
		const guarded = MAIN.indexOf("if (plan.loaded === null) {");
		const retried = MAIN.indexOf("plan = withRestoreFault(plan, error);");
		expect(guarded).toBeGreaterThan(-1);
		expect(guarded).toBeLessThan(retried);
	});

	test("permadeath is chosen at new game and cannot be flipped later", () => {
		const body = MAIN.split("choosePermadeath(): void")[1] ?? "";
		// The refusal, not just the assignment: a flag that can be turned on
		// after the fact is a setting, and D7 promises it was written at
		// creation.
		expect(body.slice(0, 300)).toContain("gameTime > 0");
		expect(MAIN).toContain(
			'permadeathAtAttach(plan, slot, query.has("permadeath"))',
		);
	});

	/** A method's span: from its head to the next member's doc comment. The
	 *  one copy of that rule, for `methodBody` and the revision scan. */
	const methodSpan = (start: number): [number, number] => [
		start,
		MAIN.indexOf("\n\t/**", start),
	];

	/** A method's body, found by its head. */
	const methodBody = (head: string): string => {
		const [start, end] = methodSpan(MAIN.indexOf(head));
		expect(start).toBeGreaterThan(-1);
		expect(end).toBeGreaterThan(start);
		return MAIN.slice(start, end);
	};

	/** What a site used to pair by hand after its hold event (#631). */
	const HAND_PAIRS = [
		"saveDirty(",
		"Revision += 1",
		"updateCockpit(",
		"consoleNotify(",
		"receiveHull(",
		"requestMessage =",
	];

	/**
	 * #626 and #627: the six sites that apply a hold event hand the act to
	 * `holdings.ts` and apply none of its law themselves. What the law does is
	 * `tests/holdings.test.ts`'s; this row is that each site reaches it,
	 * because `Game` is not constructible headless.
	 *
	 * #631: and each hands the outcome to the one adopt point, which derives
	 * the save, the revisions and the repaint. **After the event nothing is
	 * paired by hand.** What a site does *before* its event is its own: the
	 * till's refusal and the board's `details` press are not hold events, and
	 * they repaint themselves. The jump's and the dock's `saveDirty(); saveFlush`
	 * are #89's flush cadence and not an adopt pair: the jump's is in the body
	 * and is cut out by its exact text, and the dock's is in the dock method,
	 * which calls `bankLadders`.
	 */
	test.each([
		["actOnRequest", "private actOnRequest(", 'kind: "settlement"'],
		["the till", "private transactStation(", 'kind: "market"'],
		["the scoop", "private stepCargoCanisters(", 'kind: "scoop"'],
		["the jump", "private performJump(", 'kind: "arrival"'],
		["the dock", "private bankLadders(", 'kind: "dock"'],
		[
			"the carrier hook",
			"applyCarrierTransition(\n\t\tkey: CarrierKey,",
			'kind: "carrier"',
		],
	])(
		"%s applies its hold event through the Holdings module and adopts it at the one point",
		(_, head, kind) => {
			const body = methodBody(head);
			expect(body).toContain("applyHoldEvent(");
			expect(body).toContain(kind);
			expect(body).toContain("this.adoptHoldings(");
			for (const law of [
				"ladderAfter",
				"withCapstone(",
				"basisAfterScoop(",
				"setDeficits(",
				"recordTrade(",
				"scoopCargo(",
				"requestAction(",
				"applyTransition(",
				"recordKill(",
				"pendingKill(",
				"pendingArrival(",
				"bankOnDock(",
			])
				expect(body).not.toContain(law);
			const flush = 'this.saveDirty();\n\t\tthis.saveFlush("jump");';
			const after = body
				.slice(body.indexOf("applyHoldEvent("))
				.replace(flush, "");
			for (const pair of HAND_PAIRS) expect(after).not.toContain(pair);
		},
	);

	test("the jump keeps its flush and the dock its flush, after the adopt", () => {
		// Removing the adopt pairs must not take #89's cadence with them.
		expect(methodBody("private performJump(")).toContain(
			'this.saveDirty();\n\t\tthis.saveFlush("jump");',
		);
		const dock = MAIN.indexOf("this.bankLadders(this.stationKey(");
		expect(dock).toBeGreaterThan(-1);
		const flush = MAIN.indexOf('this.saveFlush("dock");', dock);
		expect(flush).toBeGreaterThan(dock);
		expect(MAIN.slice(dock, flush)).toContain("this.saveDirty();");
	});

	test("the adopt point derives every effect it applies", () => {
		const body = methodBody("private adopt(");
		expect(body).toContain("adoptEffects(");
		for (const applied of [
			"if (effects.save) this.saveDirty();",
			"if (effects.consoleRevision) this.stationConsoleRevision += 1;",
			"if (effects.requestRevision) this.requestRevision += 1;",
			"if (effects.redraw) this.updateCockpit();",
		])
			expect(body).toContain(applied);
		// The closed set of signals is applied here too, so no site can forget
		// one: the press's sentence, the delivered hull, a readied request.
		expect(body).toContain("this.requestMessage = ");
		expect(body).toContain("this.receiveHull(");
		expect(body).toContain('this.consoleNotify("good")');
	});

	test("every revision bump is the adopt point's, or a repaint that is not an adoption", () => {
		// Where a bump may stand, and why it is not an adopt pair: the clock's
		// market tick (#321), the till's refusal (#443) and the board's own
		// `details` press (#626 D5). Each of the last two is read before its
		// method's hold event, so a bump after the event is still refused.
		const allowed: [head: string, beforeEvent: boolean][] = [
			["private adopt(", false],
			["private stationConsoleState(", false],
			["private transactStation(", true],
			["private actOnRequest(", true],
		];
		const bumps = [
			...MAIN.matchAll(/(stationConsoleRevision|requestRevision) \+= 1/g),
		];
		expect(bumps.length).toBeGreaterThanOrEqual(4);
		const stray = bumps.filter((bump) => {
			const at = bump.index ?? -1;
			return !allowed.some(([head, beforeEvent]) => {
				const [start, end] = methodSpan(MAIN.lastIndexOf(head, at));
				if (start < 0) return false;
				if (at > end) return false;
				if (!beforeEvent) return true;
				const event = MAIN.indexOf("applyHoldEvent(", start);
				return event > at && event < end;
			});
		});
		expect(stray.map((b) => b[0])).toEqual([]);
	});

	test("every world adopted outside Holdings is a world-state writer's", () => {
		// The `this.commerceWorld =` row above cannot see these: the assignment
		// is the adopt point's. So their writer guarantee is read here, at the
		// argument (#631; #633 routes the offence charge through the same door).
		const calls = [...MAIN.matchAll(/this\.adoptWorld\(\s*([^\s(]*)/g)];
		// The three offences and the lazy clear. If this drops, the regex has
		// drifted.
		expect(calls.length).toBeGreaterThanOrEqual(4);
		const stray = calls.filter((m) => {
			if (WRITERS.includes(m[1])) return false;
			// **The one extension, made on purpose (#633).** `chargeOffence`
			// returns the world beside the heat, so its site adopts
			// `<name>.world` — accepted only when `<name>` is bound to a
			// `chargeOffence(` call earlier in the **same method**. Any other
			// `.world` — a hand-built object, an outcome from somewhere else —
			// is still stray.
			const field = /^(\w+)\.world\)/.exec(m[1]);
			if (field === null) return true;
			const at = m.index ?? -1;
			const [start] = methodSpan(MAIN.lastIndexOf("\n\t/**", at));
			const bound = MAIN.indexOf(`const ${field[1]} = chargeOffence(`, start);
			return !(bound > start && bound < at);
		});
		expect(stray.map((m) => m[0])).toEqual([]);
	});

	test("the Holdings fields are written at the adopt point and nowhere that should save", () => {
		// A new event that wrote a field by hand would have to remember its own
		// save, which is what #631 removes. Every other right-hand side is named
		// with the reason it is not an adoption.
		const rhs = [
			...MAIN.matchAll(
				/this\.(commander|requests|ladders|ladderPending) = (.*)$/gm,
			),
		].map((m) => `${m[1]} = ${m[2].trim()}`);
		const allowed = [
			// The adopt point.
			"commander = next.holdings.commander;",
			"requests = next.holdings.requests;",
			"ladders = next.holdings.ladders;",
			"ladderPending = next.holdings.ladderPending;",
			// The load arm: a parsed save is adopted whole and already saved.
			"commander = save.commander.state;",
			"requests = save.commander.requests;",
			"ladders = save.commander.ladders;",
			"ladderPending = emptyPending();",
			// A new game's seed, before any store is attached.
			"ladders = seededLadderRecord(",
			// #562 D2's play log: every running frame, and never a save — a dirty
			// mark per frame would reschedule the debounce for ever.
			"ladders = ladderAfterPlay(this.ladders, dt);",
			// The probe handle's tank, which has never saved.
			"commander = { ...this.commander, fuelLy: ly };",
		];
		expect(rhs.length).toBeGreaterThanOrEqual(allowed.length);
		expect(rhs.filter((line) => !allowed.includes(line))).toEqual([]);
		// And nothing edits one of them in place, which moves a value under every
		// reference an outcome compared against (#631's first precondition).
		expect(
			MAIN.match(
				/this\.(commander|requests|ladders|ladderPending)\.\w+\s*[-+*/]?=(?!=)/g,
			) ?? [],
		).toEqual([]);
	});

	test("a save read writes nothing", () => {
		// #631's second precondition: the store calls this on every write, so a
		// world it adopted would mark the save dirty on every save. The advance
		// is the snapshot's; the live world keeps its last event's clock, and
		// `advanceTo`'s idempotence makes the bytes the same either way.
		const body = methodBody("saveEnvelope(): SaveEnvelope {");
		expect(body).toContain(
			"advanceTo(this.commerceWorld, this.world.gameTime)",
		);
		expect(body).not.toMatch(/this\.\w+ = /);
		expect(body).not.toContain("adopt");
		expect(body).not.toContain("saveDirty(");
	});

	test("every world holdings.ts hands back is the one it was given or a writer's", async () => {
		// The other half of the `next.world;` exemption above: `Game`
		// adopts whatever world the module returns, so the module is where a
		// hand-built world would come from. Each `world:` property and the
		// world argument of each `unchanged(…)` call is either the world passed
		// in or a call to a world-state writer.
		const HOLDINGS = await Bun.file(
			new URL("../src/holdings.ts", import.meta.url),
		).text();
		const values = [...HOLDINGS.matchAll(/^\s+world:\s*(.*)$/gm)].map((m) =>
			m[1].trim(),
		);
		// A local bound to a writer's result is that writer's world (#627: a
		// carrier transition is applied once and returned on both arms).
		const bound = [...HOLDINGS.matchAll(/\bconst (\w+) = (\w+)\(/g)].flatMap(
			(m) => (WRITERS.includes(m[2]) ? [m[1]] : []),
		);
		// A wreck finding outcome carries only observeDerelict's world beside
		// the identified keys. Accept that field only on a bound invocation.
		const finding = [
			...HOLDINGS.matchAll(/\bconst (\w+) = identifyDerelicts\(/g),
		].map((m) => `${m[1]}.world,`);
		expect(bound.length).toBeGreaterThanOrEqual(1);
		// Settlement's mark and the till's deficits: the two writes it makes.
		// If this drops the regex has drifted and the check below is vacuous.
		expect(values.filter((v) => v.startsWith("setDeficits(")).length).toBe(2);
		const byHand = values.filter(
			(v) =>
				v !== "world," &&
				!bound.some((b) => v === `${b},`) &&
				!finding.includes(v) &&
				// A parameter or field's type, not a value.
				v !== "WorldState," &&
				v !== "WorldState;" &&
				!WRITERS.some((w) => v.startsWith(`${w}(`)),
		);
		expect(byHand).toEqual([]);
		// A refusal's world is `unchanged`'s second argument, which no
		// `world:` property shows. Both of today's refusals pass `world`.
		const refused = [
			...HOLDINGS.matchAll(/\bunchanged\(\s*\w+,\s*([^,)]+)/g),
		].map((m) => m[1].trim());
		expect(refused.length).toBeGreaterThanOrEqual(2);
		expect(refused.filter((w) => w !== "world" && !bound.includes(w))).toEqual(
			[],
		);
		// Shorthand `{ holdings: next, world, signals }` is the world passed in.
		expect(HOLDINGS).not.toMatch(/world:\s*\{/);
	});

	test("the renderer never converts the world clock into minutes", () => {
		// `this.world.gameTime / 60` is game minutes, which is the right unit for
		// `stationMarketScreen`, `readDeficit` and `recordTrade` and the wrong
		// one for anything named `gameTime`. The two live one line apart in
		// `transactStation`, which is how they were transposed.
		const minutes = [...MAIN.matchAll(/gameTime:\s*[^,\n]*\/\s*60/g)];
		expect(minutes.map((m) => m[0])).toEqual([]);
	});
});
