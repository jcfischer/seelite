import { describe, expect, test } from "bun:test";
import { requestLock } from "../src/pointer";

describe("pointer-lock requests", () => {
	test("asks for nothing when the method is absent", async () => {
		expect(requestLock({})).toBe(false);
		expect(requestLock({ requestPointerLock: undefined })).toBe(false);
		await Bun.sleep(0);
	});

	for (const form of ["rejected promise", "undefined", "resolved promise"]) {
		test(`calls the ${form} method once with its receiver`, async () => {
			let calls = 0;
			let receiver: unknown;
			const el = {
				requestPointerLock() {
					calls++;
					receiver = this;
					if (form === "rejected promise")
						return Promise.reject(new Error("Lock refused"));
					if (form === "resolved promise") return Promise.resolve();
					return undefined;
				},
			};

			expect(requestLock(el)).toBe(true);
			// Let an unhandled rejection surface in the test runner if the helper
			// dropped the returned promise instead of consuming its refusal.
			await Bun.sleep(0);
			expect(calls).toBe(1);
			expect(receiver).toBe(el);
		});
	}
});
