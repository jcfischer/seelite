import {
	HUB,
	NODE,
	TUBE_X,
	TUBE_Y,
	TRUSS_Y,
	modularPlacements,
} from "../../../src/station-modular";
import { CELL_KM } from "./blocks";

export function jointForSeed(seed: number) {
	const fixture = new Map<number, readonly [number, number, string]>([
		[0, [NODE, TUBE_X, "NODE–TUBE_X"]],
		[1, [HUB, TUBE_X, "HUB–TUBE_X"]],
		[47, [NODE, TRUSS_Y, "NODE–TRUSS_Y"]],
		[1234, [NODE, TUBE_Y, "NODE–TUBE_Y"]],
	] as const).get(seed);
	if (!fixture) throw Error(`No joint fixture for seed ${seed}`);
	const { placements } = modularPlacements(seed);
	const [first, second, kind] = fixture;
	const a = placements.find(
		(p) => p.module === first && p.beside.includes(second),
	);
	if (!a) throw Error(`Seed ${seed} lacks ${kind}`);
	const direction = a.beside.indexOf(second);
	const [dx, dy] = [
		[-1, 0],
		[1, 0],
		[0, -1],
		[0, 1],
	][direction];
	const b = placements.find((p) => p.dx === a.dx + dx && p.dy === a.dy + dy)!;
	const distance = first === HUB ? 0.21 : CELL_KM / 2;
	return {
		kind,
		a,
		b,
		direction,
		target: [a.dx * CELL_KM + dx * distance, a.dy * CELL_KM + dy * distance, 0],
	};
}
