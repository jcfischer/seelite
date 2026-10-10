/** Slot identities are hull-owned. Catalogue rows own price, mass and capacity.
 * Legacy names remain as stable salvage aliases and in the old console adapter. */
import { HULL_SPECS, type HullId, type SlotSize, type HullSlot } from "./hull";
import {
	deriveProposal,
	fits,
	type Grade,
	type ModuleRow,
	type ModuleKind,
} from "./module-catalog";
import { EQUIPMENT } from "./market";

export interface FittedModule {
	module: ModuleKind;
	size: SlotSize;
	grade: Grade;
	/** Reserved identity; rolling and interpreting traits belongs to node #875. */
	variant?: string;
	ammo?: number;
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
export const LEGACY_MODULES: Readonly<Record<string, ModuleKind>> = {
	Missile: "missile-rack",
	"Large Cargo Bay": "cargo-rack",
	"Extra Pulse Laser": "pulse-laser",
	"Extra Beam Laser": "beam-laser",
	"Military Laser": "military-laser",
	"Mining Laser": "mining-laser",
	"E.C.M. System": "ecm",
	"Docking Computer": "docking-computer",
	"Identity Scanner": "identity-scanner",
	"Long-Range Scanner": "long-range-scanner",
	"Fuel Scoops": "fuel-scoop",
	"Escape Pod": "escape-pod",
	"Extra Energy Unit": "extra-energy-unit",
};
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
	return r;
}
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
}): number {
	return f.module
		? moduleRow(f as FittedModule).priceCr * f.tonnes
		: (EQUIPMENT.find((e) => e.name === f.id)?.priceCr ?? 0);
}
export const fittingSaleValue = (
	item: Parameters<typeof fittingValue>[0],
): number => fittingValue(item) * 0.9;
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
		hp = spec.slots.find((s) => s.key === "h1")!;
	return {
		plant: makeModule("power-plant", spec.plantSize),
		h1: makeModule("pulse-laser", hp.size),
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
			(k) => !["module", "size", "grade", "variant", "ammo"].includes(k),
		)
	)
		throw Error("unknown module field");
	const m = { module: o.module, size: o.size, grade: o.grade } as FittedModule;
	const row = moduleRow(m);
	if (o.variant !== undefined) {
		if (typeof o.variant !== "string" || !o.variant.trim())
			throw Error("invalid variant");
		m.variant = o.variant;
	}
	if (row.kind === "missile-rack") {
		if (
			!Number.isInteger(o.ammo) ||
			Number(o.ammo) < 0 ||
			Number(o.ammo) > row.output.missiles
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
