/**
 * Node 446: the words on the control a pilot presses.
 *
 * The simulation was right and the cockpit was silent. `requests-view.ts`
 * labelled both families `Deliver ${tonnes} t ${goodName}` — byte-identical
 * for a courier consignment that is aboard and costs nothing, and for a
 * procurement job the pilot must buy — so the principal bought 8 t of Food
 * they already had. The details pane did say the cargo was entrusted; the
 * button said otherwise, and the button is what gets pressed.
 *
 * These rows are on the string builder rather than on the DOM, for the reason
 * `priceLabel` is tested that way: a probe that reads one rendered case is not
 * a check on the branch.
 */
import { describe, expect, test } from "bun:test";
import { generateGalaxy } from "../src/galaxy";
import { aboardFor, deliverAction } from "../src/requests-view";
import { nextAction } from "../src/requests";
import type { HoldSummary } from "../src/hold";
import { recordTrade } from "../src/deficits";
import {
	boardAt,
	firstOffer,
	postingStations,
	stationKeyOf,
} from "./helpers/job-board";

const SYSTEMS = generateGalaxy(0x5ee11e, 0).systems;
const COURIER = firstOffer(SYSTEMS, "courier").offer;

/**
 * A **real** procurement offer, bound the way `tests/jobs.test.ts` binds one.
 *
 * The first pass flipped the courier's `entrusted` flag and called a substring
 * scan of `jobs.ts` its control — a row that passes if both literals appear
 * anywhere in that file, including in a comment, and that cannot see which
 * family carries which. `bindProcurement` needs a live deficit at the posting
 * station, so this plants one, and the fixture is then the thing itself.
 */
const PROCUREMENT = (() => {
	for (const record of SYSTEMS) {
		for (const station of postingStations(record)) {
			const deficits = recordTrade({}, stationKeyOf(record, station), {
				goodName: "Food",
				units: 20,
				gameTimeMin: 120,
				holdT: 20,
			});
			const offer = boardAt(SYSTEMS, record, station, {
				deficits,
				gameTimeMin: 120,
			}).find((o) => o.family === "procurement");
			if (offer) return offer;
		}
	}
	throw new Error("no procurement offer could be bound");
})();

describe("the action says whose goods it moves", () => {
	test("an entrusted consignment is handed over, never supplied", () => {
		const action = deliverAction(COURIER, COURIER.tonnes);
		expect(action.label).toBe(
			`Hand over ${COURIER.tonnes} t ${COURIER.goodName}`,
		);
		// **Never the word that sent a pilot shopping.** The label may not read
		// as an instruction to supply anything.
		expect(action.label).not.toMatch(/deliver/i);
		expect(action.hint).toMatch(/aboard/);
		expect(action.hint).toMatch(/requester/);
		expect(action.enabled).toBe(true);
	});

	test("a procurement job says the goods come out of the pilot's hold", () => {
		const action = deliverAction(PROCUREMENT, PROCUREMENT.tonnes);
		expect(action.label).toBe(
			`Deliver ${PROCUREMENT.tonnes} t ${PROCUREMENT.goodName} from your hold`,
		);
		expect(action.enabled).toBe(true);
		expect(action.hint).toMatch(/yours/);
	});

	test("the two families' labels differ, which is the whole node", () => {
		// One offer, one flag, two labels — the same offer that used to render
		// the same string either way.
		expect(deliverAction(COURIER, COURIER.tonnes).label).not.toBe(
			deliverAction({ ...COURIER, entrusted: false }, COURIER.tonnes).label,
		);
	});

	test("both fixtures are bound offers, and they carry opposite flags", () => {
		// The control, on the objects rather than on the text of the module
		// that made them: these are what `bindCourier` and `bindProcurement`
		// actually produce.
		expect(COURIER.family).toBe("courier");
		expect(COURIER.entrusted).toBe(true);
		expect(PROCUREMENT.family).toBe("procurement");
		expect(PROCUREMENT.entrusted).toBe(false);
	});

	test("a short hold says how short, and the control is not live", () => {
		const short = deliverAction(PROCUREMENT, 3);
		expect(short.hint).toBe(`3 t of ${PROCUREMENT.tonnes} aboard`);
		expect(short.enabled).toBe(false);
	});

	test("a consignment that is not aboard is a journal fault, and it says so", () => {
		// Unreachable through the shipped verbs — `deliver` refuses a lot that
		// is short — but a control that read "Hand over 8 t" over an empty hold
		// would be the #446 confusion pointing the other way.
		const short = deliverAction(COURIER, 0);
		expect(short.enabled).toBe(false);
		expect(short.hint).toMatch(/not aboard/);
	});

	test("the builder is a pass-through, and escaping is the renderer's", () => {
		// The row this replaced asserted the label carried no `<` over
		// fixtures whose goods are `Food` and `Alloys` — true because of the
		// inputs, not because of anything this builder does. The contract is
		// the opposite one and it is worth pinning: the text arrives verbatim,
		// and `button()` escapes it on the way into markup.
		const odd = deliverAction({ ...COURIER, goodName: "Fo<o>d" }, 99);
		expect(odd.label).toContain("Fo<o>d");
	});

	test("a partial consignment says how much of it is aboard", () => {
		// "3 t of 8 aboard — the consignment is not aboard" contradicted
		// itself, which is the mixed signal this node exists to remove.
		const partial = deliverAction(COURIER, 3);
		expect(partial.hint).toBe(
			`only 3 t of the ${COURIER.tonnes} t consignment aboard`,
		);
		expect(partial.enabled).toBe(false);
	});
});

describe("what is aboard comes off the hold projection, not a second scan", () => {
	const summary = (lines: HoldSummary["lines"]): HoldSummary => ({
		usedT: 0,
		capacityT: 20,
		freeT: 20,
		entrustedT: 0,
		lines,
	});

	test("a procurement job reads the pilot's own tonnage of the good", () => {
		expect(
			aboardFor(
				{
					hold: summary([
						{
							goodName: PROCUREMENT.goodName,
							amount: 3,
							unit: "t",
							owner: "pilot",
						},
					]),
				},
				PROCUREMENT,
			),
		).toBe(3);
	});

	test("a requester's line of the same good is not the pilot's", () => {
		// The defect this catches is a one-word slip: `owner === "requester"`
		// on the procurement arm would count someone else's cargo as the
		// pilot's and enable a control the till then refuses.
		expect(
			aboardFor(
				{
					hold: summary([
						{
							goodName: PROCUREMENT.goodName,
							amount: 8,
							unit: "t",
							owner: "requester",
							offerId: "some-other-job",
						},
					]),
				},
				PROCUREMENT,
			),
		).toBe(0);
	});

	test("a consignment reads its own lot and no other job's", () => {
		const lines: HoldSummary["lines"] = [
			{
				goodName: COURIER.goodName,
				amount: COURIER.tonnes,
				unit: "t",
				owner: "requester",
				offerId: COURIER.id,
			},
			{
				goodName: COURIER.goodName,
				amount: 4,
				unit: "t",
				owner: "requester",
				offerId: "another-job",
			},
			{ goodName: COURIER.goodName, amount: 2, unit: "t", owner: "pilot" },
		];
		expect(aboardFor({ hold: summary(lines) }, COURIER)).toBe(COURIER.tonnes);
	});

	test("no hold reads as nothing aboard, which disables rather than enables", () => {
		expect(aboardFor({ hold: null }, COURIER)).toBe(0);
		expect(
			deliverAction(COURIER, aboardFor({ hold: null }, COURIER)).enabled,
		).toBe(false);
	});
});

describe("the in-flight cue carries the same distinction", () => {
	const accepted = (offer: typeof COURIER) => ({
		offerId: offer.id,
		terms: offer,
		acceptedAt: 0,
		lastAcceptedAt: 0,
		acceptanceOrdinal: 1,
		status: "accepted" as const,
		stageId: offer.stages[0],
		evidence: [],
		settledAt: null,
		outcomeReason: null,
	});

	test("a consignment is carried and says it is already aboard", () => {
		const cue = nextAction(accepted(COURIER));
		expect(cue).toMatch(/aboard/);
		expect(cue).toContain(COURIER.reportName);
	});

	test("a procurement job is sourced and says the pilot supplies it", () => {
		const cue = nextAction(accepted(PROCUREMENT));
		expect(cue).toMatch(/[Ss]ource/);
		expect(cue).not.toMatch(/aboard/);
	});
});
