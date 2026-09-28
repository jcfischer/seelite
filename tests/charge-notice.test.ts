import { describe, expect, test } from "bun:test";
import {
	CHARGE_NOTICE_S,
	CHARGE_READ_S,
	chargeExit,
	chargeLogText,
	chargeNotice,
	nextChargeNotice,
} from "../src/charge-notice";

/** A callsign carrying a digit, so "no figure" is a claim about the template
 *  and not about the one name this file happened to pick — and **mixed case**,
 *  so the glass line's uppercasing and the log's raw spelling are two different
 *  strings. With an already-shouted fixture the two arms below are one
 *  assertion written twice (sage round 2). */
const CALLSIGN = "Sirius 9";

describe("the charge's own words", () => {
	test("names the act and the carrier it was done to", () => {
		const said = chargeNotice({ callsign: CALLSIGN });
		// Shouted, like the scoop's line, so the carrier is named in the glass's
		// own case rather than the roster's.
		expect(said).toContain(CALLSIGN.toUpperCase());
		expect(said.toLowerCase()).toContain("sustained fire");
	});

	test("carries no figure — the pilot is told what they did, not what it cost", () => {
		// The callsign is the one place a digit may reach the line, so it is
		// taken out before the template is read. #429's heat figures are held
		// inside `10 ... 15` by `tests/legal.test.ts`; none of them is a thing a
		// pilot is shown.
		// Each line is read with **its own** spelling of the callsign taken out:
		// the glass shouts it and the log does not, so one substitution cannot
		// serve both without silently passing on the arm it does not fit.
		expect(
			chargeNotice({ callsign: CALLSIGN })
				.split(CALLSIGN.toUpperCase())
				.join(""),
		).not.toMatch(/\d/);
		expect(
			chargeLogText({ callsign: CALLSIGN }).split(CALLSIGN).join(""),
		).not.toMatch(/\d/);
	});

	test("the log says the same thing as the glass, in the log's sentence shape", () => {
		const log = chargeLogText({ callsign: CALLSIGN });
		expect(log).toContain(CALLSIGN);
		expect(log.toLowerCase()).toContain("sustained fire");
		// The log is the record, so it may be longer; it may not be a second
		// claim, and it is not shouted the way the glass line is.
		expect(log).not.toBe(log.toUpperCase());
	});

	test("the exit line keeps both arms, and only the charged one is an offence", () => {
		// `scripts/probe-witnesses.mjs` reads this string; it is evidence a line
		// was authored, and #447 ruled it is not evidence a pilot was told.
		expect(chargeExit({ callsign: CALLSIGN }, true)).toContain(
			"sustained fire",
		);
		expect(chargeExit({ callsign: CALLSIGN }, true)).toContain("offence");
		expect(chargeExit({ callsign: CALLSIGN }, false)).toContain(
			"sustained fire",
		);
		expect(chargeExit({ callsign: CALLSIGN }, false)).not.toContain("offence");
	});
});

describe("the notice's window and its re-arm rule", () => {
	const none = { text: "", left: 0 };

	test("a charge arms the notice for its whole life", () => {
		const armed = nextChargeNotice(none, { callsign: CALLSIGN });
		expect(armed.left).toBe(CHARGE_NOTICE_S);
		expect(armed.text).toBe(chargeNotice({ callsign: CALLSIGN }));
	});

	test("a second charge does not take a line the pilot has not finished reading", () => {
		const first = nextChargeNotice(none, { callsign: CALLSIGN });
		const barelyRead = { ...first, left: CHARGE_NOTICE_S - CHARGE_READ_S / 2 };
		const next = nextChargeNotice(barelyRead, { callsign: "LETHARGY ONE" });
		expect(next).toBe(barelyRead);
	});

	test("and it does take the glass once that line has been read", () => {
		const read = {
			text: chargeNotice({ callsign: CALLSIGN }),
			left: CHARGE_NOTICE_S - CHARGE_READ_S * 2,
		};
		const next = nextChargeNotice(read, { callsign: "LETHARGY ONE" });
		expect(next.text).toContain("LETHARGY ONE");
		expect(next.left).toBe(CHARGE_NOTICE_S);
	});

	test("an expired notice is replaced however briefly it stood", () => {
		const expired = { text: chargeNotice({ callsign: CALLSIGN }), left: 0 };
		const next = nextChargeNotice(expired, { callsign: "LETHARGY ONE" });
		expect(next.text).toContain("LETHARGY ONE");
	});

	test("the read guard is shorter than the notice, or nothing is ever replaced", () => {
		expect(CHARGE_READ_S).toBeLessThan(CHARGE_NOTICE_S);
	});
});

describe("the notice a second charge meets (#546)", () => {
	// `main.ts` sounds the `bad` tone only when this returns a new notice,
	// so the identity is the contract: a charge inside the first's reading
	// time keeps the first on the glass and plays nothing.
	test("inside the reading time, the standing notice is returned as is", () => {
		const first = nextChargeNotice(
			{ text: "", left: 0 },
			{ callsign: CALLSIGN },
		);
		expect(nextChargeNotice(first, { callsign: "Other 2" })).toBe(first);
	});

	test("after it, a second charge is a new notice", () => {
		const first = nextChargeNotice(
			{ text: "", left: 0 },
			{ callsign: CALLSIGN },
		);
		// A little past the reading time: subtracting it back out of the notice's
		// length lands one ulp short of it, which is still inside.
		const read = { ...first, left: CHARGE_NOTICE_S - CHARGE_READ_S - 0.01 };
		expect(nextChargeNotice(read, { callsign: "Other 2" })).not.toBe(read);
	});
});
