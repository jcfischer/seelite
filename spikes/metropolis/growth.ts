import { BIT, solvePlan, type WfcSpec } from "../../src/wfc";

/** Versioned recipe: increasing count reveals a prefix of ONE solved master plan.
 * Count never enters WFC. A visit or expansion therefore cannot move an old module.
 * This prototype capacity is an authoring bound, not an economy threshold. */
export const GROWTH_VERSION = 2;
export const CAPACITY = 42;
export type ModuleKind = "habitat" | "exchange" | "terrace" | "utilities";
export interface GrowthModule {
	id: string;
	parentId: string;
	kind: ModuleKind;
	x: number;
	y: number;
	z: number;
	radius: number;
	height: number;
	tier: number;
	side: number;
	angle: number;
	terminal: boolean;
}
export interface GrowthPlan {
	version: number;
	seed: number;
	modules: GrowthModule[];
	fallback: boolean;
}
const kinds: ModuleKind[] = ["habitat", "exchange", "terrace", "utilities"];

export function createGrowthPlan(seed: number): GrowthPlan {
	if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff)
		throw Error("seed must be uint32");
	const allowed: WfcSpec["allowed"] = [
		new Uint32Array(5),
		new Uint32Array(5),
		new Uint32Array(5),
		new Uint32Array(5),
	];
	for (let d = 0; d < 4; d++)
		for (let a = 1; a <= 4; a++)
			for (let b = 1; b <= 4; b++) {
				// Terraces cannot crowd their neighbours; stacked utilities need a habitable separator.
				if (d < 2 && a === 3 && b === 3) continue;
				if (d >= 2 && a === 4 && b === 4) continue;
				allowed[d][a] |= BIT(b);
			}
	for (let d = 0; d < 4; d++)
		for (let m = 0; m < 5; m++) {
			allowed[d][m] |= BIT(0);
			allowed[d][0] |= BIT(m);
		}
	const top = [1, 3, 5, 6, 5, 3, 1],
		bottom = [1, 3, 3, 4, 3, 3, 1];
	const spec: WfcSpec = {
		nModules: 5,
		allowed,
		gw: 7,
		gd: 13,
		freeMask: (i) => {
			const row = Math.floor(i / 7) - 6;
			return Math.abs(row) > (row > 0 ? top : bottom)[i % 7] ? BIT(0) : 30;
		},
		plants: Array.from({ length: 7 }, (_, x) => ({ i: 42 + x, m: 1 })),
		weights: new Uint32Array([0, 4, 5, 3, 2]),
		isMass: (m) => m !== 0,
		orphanTo: 0,
		fallbackFill: 1,
	};
	const result = solvePlan(seed, spec);
	const modules: GrowthModule[] = [];
	// Each tier grows from the centre out before anything depends on the next tier.
	for (let tier = 0; tier < 6; tier++)
		for (const col of [0, -1, 1, -2, 2, -3, 3])
			for (const side of [1, -1]) {
				if (tier >= (side > 0 ? top : bottom)[col + 3]) continue;
				const m = result.plan[(6 + side * (tier + 1)) * 7 + 3 + col];
				// Alternate socket banks around the spine: four radial sectors leave the dock corridor open.
				const angle = col % 2 === 0 ? 0 : Math.PI / 2;
				const reach = side * (400 + tier * 240);
				modules.push({
					id: `district-${col}-${side}-${tier}`,
					parentId:
						tier === 0 ? "spine" : `district-${col}-${side}-${tier - 1}`,
					kind: kinds[m - 1],
					x: col * 365,
					y: Math.cos(angle) * reach,
					z: -170 + Math.sin(angle) * reach,
					radius:
						m === 3 ? 175 : 110 + (m === 2 ? 25 : 0) + (col === 0 ? 25 : 0),
					height: 240,
					tier,
					side,
					angle,
					terminal: tier === (side > 0 ? top : bottom)[col + 3] - 1,
				});
			}
	return { version: GROWTH_VERSION, seed, modules, fallback: result.fallback };
}
export function modulesAt(
	plan: GrowthPlan,
	moduleCount: number,
): GrowthModule[] {
	if (
		!Number.isInteger(moduleCount) ||
		moduleCount < 0 ||
		moduleCount > plan.modules.length
	)
		throw Error(`moduleCount must be 0..${plan.modules.length}`);
	return plan.modules.slice(0, moduleCount);
}
