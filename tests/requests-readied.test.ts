/**
 * `readiedBy`: whether a step made some request ready to report (#546). The
 * console sounds a `good` message then, and not on every change a kill makes:
 * a kill can move a request to its next stage without readying it.
 */
import { expect, test } from "bun:test";
import { type RequestsState, readiedBy } from "../src/requests";

const state = (statuses: Record<string, string>): RequestsState =>
	({
		byId: Object.fromEntries(
			Object.entries(statuses).map(([id, status]) => [
				id,
				{ offerId: id, status },
			]),
		),
	}) as unknown as RequestsState;

test("a request that becomes ready to report readies", () => {
	expect(
		readiedBy(state({ a: "accepted" }), state({ a: "ready-to-report" })),
	).toBe(true);
});

test("a kill that only advances a stage does not", () => {
	expect(readiedBy(state({ a: "accepted" }), state({ a: "accepted" }))).toBe(
		false,
	);
});

test("a request already ready does not ready again", () => {
	expect(
		readiedBy(
			state({ a: "ready-to-report", b: "accepted" }),
			state({ a: "ready-to-report", b: "accepted" }),
		),
	).toBe(false);
});
