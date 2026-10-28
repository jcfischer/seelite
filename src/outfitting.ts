/** The cockpit's view of the same atomic transactions that commit a purchase. */
import { HULL_SPECS } from "./hull";
import {
	type FittedModule,
	moduleFits,
	moduleRow,
	makeModule,
	equipmentNames,
	fittedCapacity,
	fittingSaleValue,
	LEGACY_MODULES,
} from "./loadout";
import { moduleStock, moduleKey, moduleLocked } from "./module-stock";
import { TOP_RUNGS } from "./ladder";
import { flightPerformance } from "./sim";
import { fittedDps, killCredit } from "./kill-credit";
import {
	type ConsoleInput,
	type CommanderState,
	type StationAction,
	transactAtStation,
	recoveredModule,
	recoveredLocked,
	commanderHold,
	flownMassT,
	commanderJumpRangeLy,
	commanderFuelCapacityLy,
} from "./station-commerce";
import type { ModuleKind } from "./module-catalog";
import { marketEpoch } from "./market";
import { fittedEcm } from "./missiles";

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
	"cargo-scoop": "Cargo scoop",
	"long-range-scanner": "Long-range scanner",
	"extra-energy-unit": "Extra energy unit",
	"cargo-rack": "Cargo rack",
	"armour-plating": "Armour plating",
	"fuel-tank": "Fuel tank",
	"power-plant": "Power plant",
};
export const moduleLabel = (m: FittedModule): string =>
	`${MODULE_LABELS[m.module]} · ${m.size}${m.grade}${m.variant ? ` · ${m.variant}` : ""}`;

/**
 * What the fitted ship does, as the Equipment tab compares it: one field per
 * effect a game system reads. A module whose figure no system reads has no
 * field, because a printed change would promise what
 * the game does not do (`tests/outfit-deltas.test.ts`). A docking computer
 * has none either: its grades differ in price and mass alone (#977).
 */
export function fitReadout(commander: CommanderState, entrustedT: number) {
	const ship = { hull: commander.hull, loadout: commander.loadout };
	const capacity = fittedCapacity(commander.hull, commander.loadout);
	const ecm = fittedEcm(commander.loadout);
	return {
		accel: flightPerformance(
			commander.hull,
			{},
			flownMassT(commander.hull, commander, entrustedT),
		).thrustKms2,
		integrity: capacity.integrity,
		shieldPool: capacity.shieldPool,
		bankE: capacity.bankE,
		regenPerS: capacity.regenPerS,
		dps: fittedDps(ship),
		missiles: capacity.missiles,
		ecmRadiusKm: ecm.radiusKm,
		ecmCooldownS: ecm.cooldownS,
		ecmDrawPerS: ecm.drawPerS,
		holdT: commanderHold(commander, entrustedT).capacityT,
		// Two readers: a fitted tank raises the tank, never the jump (#926).
		fuelCapacityLy: commanderFuelCapacityLy(commander),
		jump: commanderJumpRangeLy(commander),
		scoopLyPerS: capacity.scoopLyPerS,
		// The scanners and the pod (#977). 0 is "none fitted".
		scanRangeKm: capacity.scanRangeKm,
		scanChargeS: capacity.scanChargeS,
		signalRangeKm: capacity.signalRangeKm,
		scoopRadiusKm: capacity.scoopRadiusKm,
		scoopSpeedKms: capacity.scoopSpeedKms,
		podCargoPct: capacity.podCargoShare * 100,
		podCapsuleT: capacity.podCapsuleT,
		podCarriedModules: capacity.podCarriedModules,
		credit: killCredit(ship, "raider"),
	};
}
export type FitReadout = ReturnType<typeof fitReadout>;

/** The preview's rows, in print order. `always` rows show even unmoved:
 *  every module has mass, and the credit is the combat ladder's price.
 *  `noneAtZero` prints a 0 as `—`: no scanner has no charge time, and a
 *  0 → 5 s change would read as a slower scan. */
const FIT_DELTA_ROWS: readonly {
	key: keyof FitReadout;
	label: string;
	unit: string;
	digits: number;
	always?: true;
	noneAtZero?: true;
}[] = [
	{ key: "accel", label: "ACCEL", unit: "km/s²", digits: 3, always: true },
	{ key: "integrity", label: "HULL", unit: "pts", digits: 1 },
	{ key: "shieldPool", label: "SHIELD", unit: "pts / pool", digits: 1 },
	{ key: "bankE", label: "BANK", unit: "E", digits: 1 },
	{ key: "regenPerS", label: "REGEN", unit: "E/s", digits: 1 },
	{ key: "dps", label: "DPS", unit: "/s", digits: 1 },
	{ key: "missiles", label: "MISSILES", unit: "", digits: 0 },
	{ key: "ecmRadiusKm", label: "ECM RADIUS", unit: "km", digits: 2 },
	{ key: "ecmCooldownS", label: "ECM COOLDOWN", unit: "s", digits: 2 },
	{ key: "ecmDrawPerS", label: "ECM DRAW", unit: "E/s", digits: 1 },
	{ key: "holdT", label: "HOLD", unit: "t", digits: 0 },
	{ key: "fuelCapacityLy", label: "TANK", unit: "LY", digits: 1 },
	{ key: "jump", label: "JUMP", unit: "LY", digits: 1 },
	{ key: "scoopLyPerS", label: "SCOOP", unit: "LY/s", digits: 2 },
	{ key: "scanRangeKm", label: "SCAN RANGE", unit: "km", digits: 0 },
	{
		key: "scanChargeS",
		label: "SCAN CHARGE",
		unit: "s",
		digits: 2,
		noneAtZero: true,
	},
	{ key: "signalRangeKm", label: "SIGNAL RANGE", unit: "km", digits: 0 },
	{ key: "scoopRadiusKm", label: "PICKUP RADIUS", unit: "km", digits: 3 },
	{ key: "scoopSpeedKms", label: "PICKUP SPEED", unit: "km/s", digits: 3 },
	{ key: "podCargoPct", label: "POD CARGO", unit: "%", digits: 0 },
	{ key: "podCapsuleT", label: "POD CAPSULE", unit: "t", digits: 0 },
	{ key: "podCarriedModules", label: "POD MODULES", unit: "", digits: 0 },
	{
		key: "credit",
		label: "CREDIT / RAIDER",
		unit: "",
		digits: 2,
		always: true,
	},
];

export interface FitDelta {
	label: string;
	before: string;
	after: string;
	/** Signed, at the row's precision: `+25.0`, `−6.0`, `±0.00`. */
	delta: string;
	unit: string;
}

/**
 * Each effect a candidate moves, as printed: before, after and the signed
 * change (principal, 2026-10-14, on #927). A row whose printed value does not
 * move is left out, bar the `always` rows.
 */
export function fitDeltas(before: FitReadout, after: FitReadout): FitDelta[] {
	return FIT_DELTA_ROWS.flatMap(
		({ key, label, unit, digits, always, noneAtZero }) => {
			const b = before[key].toFixed(digits);
			const a = after[key].toFixed(digits);
			if (a === b && !always) return [];
			if (noneAtZero && (before[key] === 0 || after[key] === 0))
				return [
					{
						label,
						before: before[key] === 0 ? "—" : b,
						after: after[key] === 0 ? "—" : a,
						delta: "—",
						unit,
					},
				];
			// The change of the printed figures, so the three always agree.
			const d = (Number(a) - Number(b)).toFixed(digits);
			const zero = Number(d) === 0;
			const delta = zero
				? `±${(0).toFixed(digits)}`
				: d.startsWith("-")
					? `−${d.slice(1)}`
					: `+${d}`;
			return [{ label, before: b, after: a, delta, unit }];
		},
	);
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
