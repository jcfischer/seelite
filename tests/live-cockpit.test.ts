import { expect, test } from "bun:test";
import { LAUNCH_HOLD_NOTICE } from "../src/live-cockpit";

test("every held-launch notice reads as a hold (#314)", () => {
	// The record's type already demands a notice per refusal; what it cannot
	// demand is that each one says what happened.
	const notices = Object.values(LAUNCH_HOLD_NOTICE);
	expect(notices.length).toBeGreaterThan(0);
	for (const notice of notices) expect(notice).toMatch(/^LAUNCH HELD — /);
});
