/** Slot identities are hull-owned. Catalogue rows own price, mass and capacity.
 * Legacy names remain as stable salvage aliases and in the old console adapter. */
import {
	HULL_SPECS,
	type HullId,
	type FittedCapacity,
	type HullSlot,
	type SlotSize,
	stockPlant,
} from "./hull";
import {
	deriveProposal,
	fits,
	identityScanChargeS,
	type Grade,
	type ModuleRow,
	type ModuleKind,
} from "./module-catalog";
import { EQUIPMENT } from "./market";
import { SKIM_BAND_R, SKIM_SHELL_R } from "./ship-condition";
import { variantRow } from "./module-variants";

export interface FittedModule {
	module: ModuleKind;
	size: SlotSize;
	grade: Grade;
	/** One per-kind tradeoff identity, interpreted by moduleRow. */
	variant?: string;
	ammo?: number;
	/** Cost basis for trade credit. Zero is salvage; absent is legacy/stock
	 * equipment, conservatively valued at list price rather than zero. */
	purchaseCostCr?: number;
}
export const sameModule = (a: FittedModule, b: FittedModule): boolean =>
	a.module === b.module &&
	a.size === b.size &&
	a.grade === b.grade &&
	a.variant === b.variant &&
	a.ammo === b.ammo;
export const stockModuleAt = (
	hull: HullId,
	slot: string,
	module: FittedModule,
): boolean => {
	const base = stockLoadout(hull)[slot];
	return !!base && sameModule(module, base);
};
export type Loadout = Readonly<Record<string, FittedModule>>;
export interface ModuleFitting extends FittedModule {
	id: string;
	tonnes: number;
}
export { LEGACY_MODULES } from "./module-identities";
import { LEGACY_MODULES } from "./module-identities";
let rows: ModuleRow[] | undefined;
export const moduleRows = (): readonly ModuleRow[] =>
	(rows ??= deriveProposal().rows);
let rowIndex: Map<string, ModuleRow> | undefined;
export function moduleRow(m: FittedModule): ModuleRow {
	rowIndex ??= new Map(
		moduleRows().map((r) => [`${r.kind}/${r.size}/${r.grade}`, r]),
	);
	// Keep parser identity strict: the string key must not admit size "1".
	const r =
		typeof m.module === "string" &&
		typeof m.size === "number" &&
		typeof m.grade === "string"
			? rowIndex.get(`${m.module}/${m.size}/${m.grade}`)
			: undefined;
	if (!r) throw new Error(`Unknown module ${m.module}/${m.size}/${m.grade}`);
	return variantRow(r, m.variant);
}
/** Hull and installed catalogue mass, before cargo and carried fittings. */
export const fittedMassT = (hull: HullId, loadout: Loadout): number =>
	HULL_SPECS[hull].massT +
	Object.values(loadout).reduce(
		(mass, module) => mass + moduleRow(module).massT,
		0,
	);

export const fitted = (loadout: Loadout, name: string): boolean =>
	Object.values(loadout).some(
		(m) => m.module === (LEGACY_MODULES[name] ?? name),
	);
/** The legacy console permits another weapon when a hardpoint can take it. */
export function repeatableEquipment(name: string): boolean {
	const kind = LEGACY_MODULES[name];
	return !!kind && moduleRow(makeModule(kind, 1)).slotKind === "hardpoint";
}
/** Compatibility projection for existing consoles and scanner APIs, never saved. */
export const equipmentNames = (loadout: Loadout): string[] =>
	Object.keys(LEGACY_MODULES).filter((name) => fitted(loadout, name));
export const withoutModule = (loadout: Loadout, name: string): Loadout =>
	Object.fromEntries(
		Object.entries(loadout).filter(
			([, m]) => m.module !== (LEGACY_MODULES[name] ?? name),
		),
	);
export const loadoutValue = (loadout: Loadout): number =>
	Object.values(loadout).reduce((n, m) => n + moduleRow(m).priceCr, 0);
export function fittingValue(f: {
	id: string;
	tonnes: number;
	module?: string;
	size?: SlotSize;
	grade?: Grade;
	variant?: string;
}): number {
	return f.module
		? moduleRow(f as FittedModule).priceCr * f.tonnes
		: (EQUIPMENT.find((e) => e.name === f.id)?.priceCr ?? 0);
}
export const fittingSaleValue = (
	item: Parameters<typeof fittingValue>[0],
): number => fittingValue(item) * 0.9;
export const fittingCost = (
	item: Parameters<typeof fittingValue>[0] & { purchaseCostCr?: number },
): number => item.purchaseCostCr ?? (item.module ? fittingValue(item) : 0);
export const freeSlot = (
	loadout: Loadout,
	hull: HullId,
	module: FittedModule,
): HullSlot | undefined =>
	HULL_SPECS[hull].slots.find(
		(slot) => !loadout[slot.key] && moduleFits(module, slot),
	);
export const carriedModule = (m: FittedModule): ModuleFitting => ({
	...m,
	id:
		Object.keys(LEGACY_MODULES).find((n) => LEGACY_MODULES[n] === m.module) ??
		m.module,
	tonnes: 1,
});
export function makeModule(
	kind: ModuleKind,
	size: SlotSize,
	grade: Grade = "E",
): FittedModule {
	const m: FittedModule = { module: kind, size, grade };
	const r = moduleRow(m);
	return r.kind === "missile-rack" ? { ...m, ammo: r.output.missiles } : m;
}
export function stockLoadout(hull: HullId): Loadout {
	const spec = HULL_SPECS[hull],
		hp = spec.slots.find((s) => s.key === "h1")!,
		scoopSlot = spec.slots.find(
			(s) =>
				s.kind === "internal" &&
				s.accepts !== "any" &&
				s.accepts.includes("cargo"),
		);
	return {
		plant: makeModule("power-plant", spec.plantSize),
		h1: makeModule("pulse-laser", hp.size),
		...(scoopSlot && { [scoopSlot.key]: makeModule("cargo-scoop", 1) }),
	};
}
/**
 * What a fitted ship holds, read off its loadout: the one home for capacity
 * (#873). The bank is the plant's plus every Extra Energy Unit's `bankE`; regen
 * is the plant's alone (#925). A loadout with no plant flies the stock one.
 * The tank is the hull's `tankLy` plus every fitted tank's `fuelLy` (#926).
 * Integrity is the hull's plus every plate's; each pool is the hull's
 * `shieldPool` plus every booster's `pointsPerPool`, and the boosters' draws
 * add (#927). The scoops' rate and draw (#932) and the racks' missiles add.
 * Scanners and the pod do not add: the best fitted one is read (#977), and so
 * is the cargo scoop, whose window is the widest fitted one's (node #1096).
 * The hold is the hull's `holdT` plus every rack's `cargoT` (#928); NPCs
 * pass the same instance-owned fit their combat and manifest read (#875).
 */
export function fittedCapacity(hull: HullId, loadout: Loadout): FittedCapacity {
	const spec = HULL_SPECS[hull];
	const plant = loadout.plant
		? moduleRow(loadout.plant).output
		: stockPlant(hull);
	let bankE = plant.bankE;
	let holdT = spec.holdT;
	let fuelCapacityLy = spec.tankLy;
	let integrity = spec.integrity;
	let shieldPool = spec.shieldPool;
	let boosterDrawPerS = 0;
	let scoopLyPerS = 0;
	let scoopDrawPerS = 0;
	let missiles = 0;
	let scanRangeKm = 0;
	let scanChargeS = 0;
	let signalRangeKm = 0;
	let scoopRadiusKm = 0;
	let scoopSpeedKms = 0;
	let pod = { cargoShare: 0, capsuleT: 0, carriedModules: 0 };
	for (const m of Object.values(loadout)) {
		if (m.module === "identity-scanner") {
			const rangeKm = moduleRow(m).output.rangeKm;
			if (rangeKm > scanRangeKm) {
				scanRangeKm = rangeKm;
				scanChargeS = identityScanChargeS(m.grade);
			}
		}
		if (m.module === "cargo-scoop") {
			const o = moduleRow(m).output;
			if (
				o.scoopRadiusKm > scoopRadiusKm ||
				(o.scoopRadiusKm === scoopRadiusKm && o.scoopSpeedKms > scoopSpeedKms)
			) {
				scoopRadiusKm = o.scoopRadiusKm;
				scoopSpeedKms = o.scoopSpeedKms;
			}
		}
		if (m.module === "long-range-scanner")
			signalRangeKm = Math.max(
				signalRangeKm,
				moduleRow(m).output.signalRangeKm,
			);
		if (m.module === "escape-pod") {
			const o = moduleRow(m).output;
			if (
				o.cargoShare > pod.cargoShare ||
				(o.cargoShare === pod.cargoShare && o.capsuleT > pod.capsuleT)
			)
				pod = {
					cargoShare: o.cargoShare,
					capsuleT: o.capsuleT,
					carriedModules: o.carriedModules,
				};
		}
		if (m.module === "extra-energy-unit") bankE += moduleRow(m).output.bankE;
		if (m.module === "fuel-tank") fuelCapacityLy += moduleRow(m).output.fuelLy;
		if (m.module === "armour-plating")
			integrity += moduleRow(m).output.integrity;
		if (m.module === "shield-booster") {
			const row = moduleRow(m);
			shieldPool += row.output.pointsPerPool;
			boosterDrawPerS += row.drawPerS;
		}
		if (m.module === "fuel-scoop") {
			const row = moduleRow(m);
			scoopLyPerS += row.output.fuelLyPerS;
			scoopDrawPerS += row.drawPerS;
		}
		if (m.module === "missile-rack") missiles += moduleRow(m).output.missiles;
		if (m.module === "cargo-rack") holdT += moduleRow(m).output.cargoT;
	}
	return {
		bankE,
		regenPerS: plant.regenPerS,
		holdT,
		fuelCapacityLy,
		integrity,
		shieldPool,
		boosterDrawPerS,
		scoopLyPerS,
		scoopDrawPerS,
		missiles,
		scanRangeKm,
		scanChargeS,
		signalRangeKm,
		scoopRadiusKm,
		scoopSpeedKms,
		podCargoShare: pod.cargoShare,
		podCapsuleT: pod.cargoShare > 0 ? pod.capsuleT : 0,
		podCarriedModules: pod.carriedModules,
	};
}
/**
 * The fuel scoop's fill shape at `rOverR`, the distance from the star's centre
 * in its radii: linear, 1 at cruise's drop-out shell and 0 at the skim band's
 * edge (#930's approved table). A fill rate is the row's `fuelLyPerS` times it.
 */
export function scoopShape(rOverR: number): number {
	const s = (SKIM_BAND_R - rOverR) / (SKIM_BAND_R - SKIM_SHELL_R);
	return Math.min(1, Math.max(0, s));
}
/** What one scoop step reads: the star distance in R, the regime, the fit,
 *  the tank in LY and the energy bank. */
export interface ScoopInput {
	rOverR: number;
	cruising: boolean;
	hull: HullId;
	loadout: Loadout;
	fuelLy: number;
	energy: number;
	dt: number;
}
/** The tank and bank after the step, and whether the scoop filled on it: the
 *  glass's `SCOOPING` line reads that flag. */
export interface ScoopStep {
	fuelLy: number;
	energy: number;
	filling: boolean;
}
/**
 * One step of the fuel scoop (#932). In cruise inside the band, every fitted
 * scoop fills the hyperspace tank at its row's `fuelLyPerS` times
 * `scoopShape`, and the bank pays its row's `drawPerS` (#871 D1, D2). The
 * tank stops at the fitted capacity (#926), never at the jump range, and a
 * full tank draws nothing. A bank short of the step's draw fills nothing on
 * that step. Normal flight never fills: the skim is a cruise pass.
 *
 * The shape is held over the step at the distance passed in, as the hull's
 * temperature is (`stepHullTemperature`).
 */
export function stepFuelScoop(input: ScoopInput): ScoopStep {
	const idle = { fuelLy: input.fuelLy, energy: input.energy, filling: false };
	if (!input.cruising || !(input.dt > 0)) return idle;
	const shape = scoopShape(input.rOverR);
	if (!(shape > 0)) return idle;
	const {
		fuelCapacityLy: capacityLy,
		scoopLyPerS: fuelLyPerS,
		scoopDrawPerS,
	} = fittedCapacity(input.hull, input.loadout);
	if (!(input.fuelLy < capacityLy)) return idle;
	if (!(fuelLyPerS > 0)) return idle;
	const draw = scoopDrawPerS * input.dt;
	if (input.energy < draw) return idle;
	return {
		fuelLy: Math.min(capacityLy, input.fuelLy + fuelLyPerS * shape * input.dt),
		energy: input.energy - draw,
		filling: true,
	};
}
export function moduleFits(m: FittedModule, slot: HullSlot): boolean {
	return fits(moduleRow(m), slot);
}
export function parseModule(raw: unknown): FittedModule {
	if (!raw || typeof raw !== "object" || Array.isArray(raw))
		throw Error("module is not an object");
	const o = raw as Record<string, unknown>;
	if (
		Object.keys(o).some(
			(k) =>
				![
					"module",
					"size",
					"grade",
					"variant",
					"ammo",
					"purchaseCostCr",
				].includes(k),
		)
	)
		throw Error("unknown module field");
	const m = { module: o.module, size: o.size, grade: o.grade } as FittedModule;
	const row = moduleRow(m);
	if (o.purchaseCostCr !== undefined) {
		if (
			typeof o.purchaseCostCr !== "number" ||
			!Number.isFinite(o.purchaseCostCr) ||
			o.purchaseCostCr < 0
		)
			throw Error("invalid module purchase cost");
		m.purchaseCostCr = o.purchaseCostCr;
	}
	if (o.variant !== undefined) {
		if (typeof o.variant !== "string" || !o.variant.trim())
			throw Error("invalid variant");
		m.variant = o.variant;
	}
	const effective = moduleRow(m);
	if (row.kind === "missile-rack") {
		if (
			!Number.isInteger(o.ammo) ||
			Number(o.ammo) < 0 ||
			Number(o.ammo) > effective.output.missiles
		)
			throw Error("invalid missile ammunition");
		m.ammo = Number(o.ammo);
	} else if (o.ammo !== undefined) throw Error("ammunition on a non-rack");
	return m;
}
export function parseLoadout(raw: unknown, hull: HullId): Loadout {
	if (!raw || typeof raw !== "object" || Array.isArray(raw))
		throw Error("loadout is not an object");
	const result: Record<string, FittedModule> = {};
	for (const [key, v] of Object.entries(raw).sort(([a], [b]) =>
		a.localeCompare(b),
	)) {
		const m = parseModule(v);
		if (key === "plant") {
			if (m.module !== "power-plant" || m.size > HULL_SPECS[hull].plantSize)
				throw Error("invalid core plant");
		} else {
			const slot = HULL_SPECS[hull].slots.find((s) => s.key === key);
			if (!slot || !moduleFits(m, slot))
				throw Error(`module does not fit ${key}`);
		}
		result[key] = m;
	}
	if (!result.plant) throw Error("missing core plant");
	return result;
}
/** Legacy cargo expansion chooses the nearest capacity to +15 t, then price,
 * among rows that the hull can fit; all other legacy fittings use E grade. */
export function legacyModule(hull: HullId, name: string): FittedModule {
	const kind = LEGACY_MODULES[name];
	if (!kind) throw Error(`Unknown legacy equipment ${name}`);
	const spec = HULL_SPECS[hull];
	if (kind === "cargo-rack") {
		const r = [...moduleRows()]
			.filter((r) => r.kind === kind && spec.slots.some((s) => fits(r, s)))
			.sort(
				(a, b) =>
					Math.abs(a.output.cargoT - 15) - Math.abs(b.output.cargoT - 15) ||
					a.priceCr - b.priceCr ||
					a.size - b.size,
			)[0];
		return makeModule(kind, r.size, r.grade);
	}
	const r = moduleRows().find(
		(r) =>
			r.kind === kind && r.grade === "E" && spec.slots.some((s) => fits(r, s)),
	);
	return makeModule(kind, r?.size ?? 1);
}
export function migrateEquipment(hull: HullId, names: readonly string[]) {
	const stock = stockLoadout(hull);
	const loadout: Record<string, FittedModule> = { plant: stock.plant };
	const recoveredFittings: ModuleFitting[] = [];
	let refundCr = 0;
	const pending = [...names];
	for (const id of pending)
		if (!EQUIPMENT.some((e) => e.name === id))
			throw Error(`Unknown legacy equipment ${id}`);
	const best = ["Military Laser", "Extra Beam Laser", "Extra Pulse Laser"].find(
		(n) => pending.includes(n),
	);
	if (best) {
		const i = pending.indexOf(best);
		pending.splice(i, 1);
		loadout.h1 = makeModule(
			LEGACY_MODULES[best],
			HULL_SPECS[hull].slots.find((s) => s.key === "h1")!.size,
		);
		refundCr += Math.max(
			0,
			EQUIPMENT.find((e) => e.name === best)!.priceCr -
				moduleRow(loadout.h1).priceCr,
		);
	} else loadout.h1 = stock.h1;
	for (const name of pending.sort()) {
		const price = EQUIPMENT.find((e) => e.name === name)!.priceCr;
		if (name === "Energy Bomb" || name === "Galactic Hyperdrive") {
			refundCr += price;
			continue;
		}
		const m = legacyModule(hull, name);
		const slot = HULL_SPECS[hull].slots.find(
			(s) => !loadout[s.key] && moduleFits(m, s),
		);
		if (slot) loadout[slot.key] = m;
		else recoveredFittings.push(carriedModule(m));
		refundCr += Math.max(0, price - moduleRow(m).priceCr);
	}
	return { loadout, recoveredFittings, refundCr };
}
export function grantLegacyScoop(
	hull: HullId,
	loadout: Loadout,
): { loadout: Loadout; granted: boolean; owed: boolean } {
	if (Object.values(loadout).some((m) => m.module === "cargo-scoop"))
		return { loadout, granted: false, owed: false };
	const scoop = makeModule("cargo-scoop", 1);
	const slot = HULL_SPECS[hull].slots
		.filter(
			(s) =>
				s.kind === "internal" &&
				s.accepts !== "any" &&
				s.accepts.includes("cargo") &&
				!loadout[s.key] &&
				moduleFits(scoop, s),
		)
		.sort((a, b) => a.key.localeCompare(b.key))[0];
	return slot
		? { loadout: { ...loadout, [slot.key]: scoop }, granted: true, owed: false }
		: { loadout, granted: false, owed: true };
}
/** Move the same modules, without resizing, repricing or rerolling them. */
export function transferLoadout(loadout: Loadout, hull: HullId) {
	const target: Record<string, FittedModule> = {},
		overflow: ModuleFitting[] = [];
	for (const [key, m] of Object.entries(loadout).sort(([a], [b]) =>
		a.localeCompare(b),
	)) {
		if (key === "plant") {
			if (m.size <= HULL_SPECS[hull].plantSize) target.plant = m;
			else overflow.push(carriedModule(m));
			continue;
		}
		const slot = HULL_SPECS[hull].slots.find(
			(s) => !target[s.key] && moduleFits(m, s),
		);
		if (slot) target[slot.key] = m;
		else overflow.push(carriedModule(m));
	}
	target.plant ??= stockLoadout(hull).plant;
	return { loadout: target, overflow };
}
