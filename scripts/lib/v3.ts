import type { V3 } from "../../src/rock-heightfields";

export const sub = (a: V3, b: V3): V3 => [
	a[0] - b[0],
	a[1] - b[1],
	a[2] - b[2],
];
export const dot = (a: V3, b: V3): number =>
	a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: V3, b: V3): V3 => [
	a[1] * b[2] - a[2] * b[1],
	a[2] * b[0] - a[0] * b[2],
	a[0] * b[1] - a[1] * b[0],
];
