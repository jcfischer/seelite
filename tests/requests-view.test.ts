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
import { deliverAction, settlementMessage } from "../src/requests-view";
import { nextAction } from "../src/requests";
import { readFileSync } from "node:fs";
import { firstOffer } from "./helpers/job-board";

const SYSTEMS = generateGalaxy(0x5ee11e, 0).systems;
const COURIER = firstOffer(SYSTEMS, "courier").offer;

/**
 * A procurement offer, from the courier with its family flipped.
 *
 * **Not a shortcut around the binder.** A real procurement offer needs a live
 * deficit at the posting station — `tests/jobs.test.ts` binds one that way and
 * is where the *binder* is checked. What this file checks is a string builder
 * whose only inputs are `entrusted`, `tonnes` and `goodName`, and the row
 * below pins that the two families really do differ on the first of those, so
 * a flipped flag is the same input a bound offer would supply. Reaching for
 * the binder here would be checking `bindProcurement` twice and these words
 * once.
 */
const PROCUREMENT = {
	...COURIER,
	entrusted: false,
	goodName: "Textiles",
	tonnes: 5,
};

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

	test("the catalogue really does flip that flag between the families", () => {
		// The control for the fixture above: `jobs.ts` declares `entrusted:
		// true` on the courier row and `false` on the procurement one, so a
		// flipped flag is the input a bound offer supplies.
		expect(COURIER.entrusted).toBe(true);
		const source = readFileSync(
			new URL("../src/jobs.ts", import.meta.url),
			"utf8",
		);
		expect(source).toContain("entrusted: true");
		expect(source).toContain("entrusted: false");
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

	test("nothing in the label or the hint is markup", () => {
		// `requestsBody` escapes what it renders; this builder hands it text.
		for (const offer of [COURIER, PROCUREMENT])
			for (const aboard of [0, 3, offer.tonnes]) {
				const action = deliverAction(offer, aboard);
				expect(action.label).not.toMatch(/[<>]/);
				expect(action.hint).not.toMatch(/[<>]/);
			}
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

describe("the settlement says what moved", () => {
	test("a hand-over names the tonnes, the pay and what is left of the pilot's", () => {
		expect(
			settlementMessage({
				tonnes: 8,
				goodName: "Food",
				entrusted: true,
				rewardCr: 180,
				remainingT: 8,
			}),
		).toBe(
			"Reported · 8 t Food handed over, 180 Cr paid · 8 t Food still aboard, yours.",
		);
	});

	test("a procurement settlement says the goods were the pilot's", () => {
		expect(
			settlementMessage({
				tonnes: 5,
				goodName: "Textiles",
				entrusted: false,
				rewardCr: 90,
				remainingT: 0,
			}),
		).toBe(
			"Reported · 5 t Textiles delivered from your hold, 90 Cr paid · no Textiles left aboard.",
		);
	});

	test("an empty remainder is a sentence rather than a zero", () => {
		// `0 t Food still aboard, yours` is a line about cargo that is not
		// there, which is the same reading-as-a-bug problem #443 met with a
		// zeroed entrusted clause.
		expect(
			settlementMessage({
				tonnes: 8,
				goodName: "Food",
				entrusted: true,
				rewardCr: 180,
				remainingT: 0,
			}),
		).toContain("no Food left aboard");
	});
});
