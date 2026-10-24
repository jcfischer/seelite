import {
	DISH,
	HUB,
	isHost,
	isLeaf,
	NODE,
	type Placement,
	RADIATOR,
	TANKS,
	TRUSS_X,
	TRUSS_Y,
	TUBE_X,
	TUBE_Y,
} from "./station-modular";

export const ASSEMBLY_CELL_KM = 0.2;
export const ASSEMBLY_BLOCKS = [
	"HUB",
	"HUB_STATIC",
	"NODE",
	"TUBE",
	"TRUSS",
	"RADIATOR",
	"TANKS",
	"DISH",
	"LINK",
] as const;
export type AssemblyBlock = (typeof ASSEMBLY_BLOCKS)[number];
export interface AssemblyInstance {
	block: AssemblyBlock;
	module: number;
	dx: number;
	dy: number;
	turn: number;
}
const names: Readonly<Record<number, AssemblyBlock>> = {
	[HUB]: "HUB",
	[NODE]: "NODE",
	[TUBE_X]: "TUBE",
	[TUBE_Y]: "TUBE",
	[TRUSS_X]: "TRUSS",
	[TRUSS_Y]: "TRUSS",
	[RADIATOR]: "RADIATOR",
	[TANKS]: "TANKS",
	[DISH]: "DISH",
};
export function assemblyInstances(
	placements: readonly Placement[],
): AssemblyInstance[] {
	return placements.flatMap((p) => {
		const block = names[p.module];
		if (!block) throw Error(`Unknown Assembly module ${p.module}`);
		const turn = p.module === TUBE_Y || p.module === TRUSS_Y ? Math.PI / 2 : 0;
		const instances: AssemblyInstance[] = [
			{ block, module: p.module, dx: p.dx, dy: p.dy, turn },
		];
		if (p.module === HUB)
			instances.push({ ...instances[0], block: "HUB_STATIC" });
		if (isLeaf(p.module)) {
			for (const [direction, neighbour] of p.beside.entries())
				if (isHost(neighbour))
					instances.push({
						...instances[0],
						block: "LINK",
						turn: [Math.PI, 0, -Math.PI / 2, Math.PI / 2][direction],
					});
		}
		return instances;
	});
}
