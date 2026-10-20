import { expect, test } from "bun:test";

// Execute the production placer's callbacks with a fixture that records the
// requested framing. Importing the capture entry point would launch Chromium.
test("NPC captures preserve the requested framing, with ring as the default", async () => {
	const source = await Bun.file(
		new URL("../scripts/capture-views.mjs", import.meta.url),
	).text();
	const start = source.indexOf("const PLACERS = {");
	const end = source.indexOf("\n};", start);
	expect(start).toBeGreaterThan(0);
	expect(end).toBeGreaterThan(start);
	const expression = source.slice(start + "const PLACERS = ".length, end + 2);
	for (const event of ["arrival", "departure"]) {
		for (const framing of ["player-lane-point", undefined]) {
			const samples: unknown[][] = [];
			const fixture = {
				plan: { actor: { schedule: { departureAtS: 10 } } },
				voyage: { tOut: 20 },
				follow() {},
				sample(...args: unknown[]) {
					samples.push(args);
					return {
						jump: { kind: event },
						rift: 1,
						riftRadiusKm: 0.1,
						flare: 0,
						hullThroughPlaneKm: 0,
						cameraRangeKm: 0.24,
					};
				},
			};
			const placers = new Function(
				"window",
				"installHaulerFixture",
				`return (${expression});`,
			)({ __haulerFixture: fixture }, () => {});
			await placers["npc-jump"](
				{ evaluate: (fn: (arg: unknown) => unknown, arg: unknown) => fn(arg) },
				{ event, phaseS: 0.25, framing },
			);
			expect(samples.at(-1)).toEqual([20.25, true, framing ?? "ring"]);
		}
	}
});
