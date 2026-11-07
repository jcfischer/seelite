import { expect, test } from "bun:test";
import type { CapabilityService } from "../src/capability-slots";
import { refusalSentence, stationServiceStatus } from "../src/station-console";

test("each damaged service has a matching purchase refusal", () => {
	for (const service of ["market", "equipment", "exclusive"] as const)
		expect(
			refusalSentence(`${service}-damaged`, {
				freeT: 20,
				capacityT: 20,
				entrustedT: 0,
			}),
		).toContain(service);
});

test("live service status names independent damage beside an unrelated notice", () => {
	const cases: [
		Partial<Record<CapabilityService, boolean>> | undefined,
		string | null,
	][] = [
		[{ market: false, equipment: true }, "Damaged service: market."],
		[{ equipment: false }, "Damaged service: equipment."],
		[{ exclusive: false }, "Damaged service: exclusive."],
		[
			{ market: false, equipment: false, exclusive: false },
			"Damaged service: market, equipment, exclusive.",
		],
		[{ market: true, equipment: true, exclusive: true }, null],
		[{}, null],
		[undefined, null],
	];
	for (const [services, notice] of cases)
		expect(stationServiceStatus(services, "Cargo scoop fitted.")).toEqual({
			notice,
			message: "Cargo scoop fitted.",
		});
});

test("healing expires only the matching damage refusal while other damage remains", () => {
	const services = ["market", "equipment", "exclusive"] as const;
	for (const [index, service] of services.entries()) {
		const other = services[(index + 1) % services.length];
		const message = `The ${service} service is damaged.`;
		expect(stationServiceStatus({ [service]: false }, message)).toEqual({
			notice: `Damaged service: ${service}.`,
			message,
		});
		expect(
			stationServiceStatus({ [service]: true, [other]: false }, message),
		).toEqual({ notice: `Damaged service: ${other}.`, message: null });
		expect(stationServiceStatus({ [service]: true }, message)).toEqual({
			notice: null,
			message: null,
		});
		expect(stationServiceStatus(undefined, message)).toEqual({
			notice: null,
			message: null,
		});
	}
});
