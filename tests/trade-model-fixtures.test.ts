import { expect, test } from "bun:test";
import {
	MODEL_QUEUE_HOME,
	TRADE_MODEL_FIXTURES,
} from "../scripts/lib/trade-model-fixtures.mjs";
import { restoreWorld } from "../src/sim";
import { bootModelIds } from "../src/system-models";
import { HULL_SPECS } from "../src/hull";

test("held-response fixtures boot the permitted exterior and jump within the courier's tank", () => {
	const home = restoreWorld(
		MODEL_QUEUE_HOME.seed,
		0,
		MODEL_QUEUE_HOME.system,
		0,
	);
	expect(bootModelIds(home.system, null)).toEqual(["cockpit", "coriolis"]);
	for (const fixture of TRADE_MODEL_FIXTURES) {
		const start = restoreWorld(MODEL_QUEUE_HOME.seed, 0, fixture.from, 0);
		const arrival = restoreWorld(MODEL_QUEUE_HOME.seed, 0, fixture.system, 0);
		const trade = arrival.system.contents.stations.find(
			(s) => s.type === "trade",
		)!;
		expect(trade.formId).toBe(fixture.form);
		expect(bootModelIds(start.system, null)).not.toContain(
			`trade/${fixture.form}`,
		);
		expect(bootModelIds(arrival.system, null)).toContain(
			`trade/${fixture.form}`,
		);
		const a = start.system.record.pos,
			b = arrival.system.record.pos;
		expect(Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)).toBeLessThanOrEqual(
			HULL_SPECS.courier.tankLy,
		);
	}
});
