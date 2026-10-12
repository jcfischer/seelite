/** The cockpit's view of the same atomic transactions that commit a purchase. */
import { HULL_SPECS } from "./hull";
import {
	type FittedModule,
	moduleFits,
	moduleRow,
	makeModule,
	equipmentNames,
	fittingSaleValue,
	LEGACY_MODULES,
} from "./loadout";
import { moduleStock, moduleKey, moduleLocked } from "./module-stock";
import { TOP_RUNGS } from "./ladder";
import { flightPerformance } from "./sim";
import { killCredit } from "./kill-credit";
import {
	type ConsoleInput,
	type CommanderState,
	type StationAction,
	transactAtStation,
	recoveredModule,
	recoveredLocked,
	flownMassT,
	commanderJumpRangeLy,
	commanderFuelCapacityLy,
} from "./station-commerce";
import type { ModuleKind } from "./module-catalog";
import { marketEpoch } from "./market";

export const MODULE_LABELS: Record<ModuleKind, string> = {
	"pulse-laser": "Pulse laser",
	"beam-laser": "Beam laser",
	"military-laser": "Military laser",
	"mining-laser": "Mining laser",
	"missile-rack": "Missile rack",
	ecm: "E.C.M.",
	"identity-scanner": "Identity scanner",
	"docking-computer": "Docking computer",
	"escape-pod": "Escape pod",
	"shield-booster": "Shield booster",
	"fuel-scoop": "Fuel scoop",
	"long-range-scanner": "Long-range scanner",
	"extra-energy-unit": "Extra energy unit",
	"cargo-rack": "Cargo rack",
	"armour-plating": "Armour plating",
	"fuel-tank": "Fuel tank",
	"power-plant": "Power plant",
};
export const moduleLabel = (m: FittedModule): string =>
	`${MODULE_LABELS[m.module]} · ${m.size}${m.grade}`;

export function fitReadout(commander: CommanderState, entrustedT: number) {
	return {
		accel: flightPerformance(
			commander.hull,
			{},
			flownMassT(commander.hull, commander, entrustedT),
		).thrustKms2,
		// Two readers: a fitted tank raises the tank, never the jump (#926).
		fuelCapacityLy: commanderFuelCapacityLy(commander),
		jump: commanderJumpRangeLy(commander),
		credit: killCredit(
			{ hull: commander.hull, loadout: commander.loadout },
			"raider",
		),
	};
}

export function outfittingScreen(
	input: ConsoleInput,
	requestedSlot = "h1",
	requestedCandidate = "",
) {
	const spec = HULL_SPECS[input.commander.hull];
	const slots = [
		{ key: "plant", kind: "core", size: spec.plantSize, accepts: "power" },
		...spec.slots,
	].map((s) => {
		const module = input.commander.loadout[s.key];
		const removal = module
			? transactAtStation({
					...input,
					action: { type: "remove-module", slot: s.key },
				})
			: null;
		return {
			...s,
			module,
			row: module ? moduleRow(module) : null,
			removeReason: removal?.reason ?? null,
		};
	});
	const slot = slots.some((s) => s.key === requestedSlot)
		? requestedSlot
		: "h1";
	const accepts = (m: FittedModule) =>
		slot === "plant"
			? m.module === "power-plant" && m.size <= spec.plantSize
			: moduleFits(m, spec.slots.find((s) => s.key === slot)!);
	const stock = moduleStock(input)
		.map((r) => ({ row: r, module: makeModule(r.kind, r.size, r.grade) }))
		.filter((c) => accepts(c.module))
		.map((c) => ({
			...c,
			id: `stock:${moduleKey(c.row)}`,
			locked: moduleLocked(c.module, input.rungs),
		}));
	const holdings = (input.commander.recoveredFittings ?? []).map(
		(item, index) => ({ item, index }),
	);
	const carried = holdings
		.filter(({ item }) => item.module || LEGACY_MODULES[item.id])
		.map(({ item, index }) => {
			const module = recoveredModule(item, input.commander.hull);
			return {
				id: `hold:${index}`,
				index,
				module,
				row: moduleRow(module),
				fits: accepts(module),
				locked: recoveredLocked(item, input.commander.hull, input.rungs),
				saleCr: fittingSaleValue(item),
			};
		});
	const candidate = [...stock, ...carried.filter((c) => c.fits)].find(
		(c) => c.id === requestedCandidate,
	);
	const action: StationAction | null = candidate
		? "index" in candidate && typeof candidate.index === "number"
			? { type: "fit-recovered", slot, index: candidate.index }
			: { type: "buy-module", slot, module: candidate.module }
		: null;
	const offer = action ? transactAtStation({ ...input, action }) : null;
	// A locked or unaffordable row can still explain its effect. It never gets
	// a buy button: only the unmodified real offer authorises a press.
	const hypothetical = action
		? transactAtStation({
				...input,
				rungs: TOP_RUNGS,
				commander: {
					...input.commander,
					credits: Math.max(input.commander.credits, candidate!.row.priceCr),
				},
				action,
			})
		: null;
	return {
		epoch: marketEpoch(input.station.phaseMin, input.gameTimeMin),
		slot,
		slots,
		stock,
		carried,
		retired: holdings
			.filter(({ item }) => !item.module && !LEGACY_MODULES[item.id])
			.map(({ item, index }) => ({
				...item,
				index,
				saleCr: fittingSaleValue(item),
			})),
		candidate: candidate ?? null,
		action,
		offer,
		before: fitReadout(input.commander, input.entrustedT),
		after: hypothetical?.accepted
			? fitReadout(hypothetical.commander, input.entrustedT)
			: null,
		moved:
			candidate && input.commander.loadout[slot]
				? moduleLabel(input.commander.loadout[slot])
				: null,
	};
}
export type OutfittingScreen = ReturnType<typeof outfittingScreen>;
