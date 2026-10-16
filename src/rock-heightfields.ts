/**
 * Node #966: collision data independent of the model installer. Binary v1:
 * 0..3 "RHF1"; LE uint16 version/res/count/faces at 4/6/8/10;
 * 12..15 reserved zero; 16..47 source GLB SHA-256 bytes; then
 * archetype/face/row/column uint16 LE radii, divided by 65535 × rock bound.
 * Faces are +X,-X,+Y,-Y,+Z,-Z. No filesystem, renderer or fetching here.
 */
export const ROCK_HEIGHTFIELD_RES = 64;
export const ROCK_ARCHETYPE_COUNT = 16;
export const ROCK_HEIGHTFIELD_HEADER_BYTES = 48;
export type V3 = [number, number, number];
export interface RockHeightfield {
	res: number;
	/** Six faces of normalized radii, decoded from uint16 fractions. */
	r: Float32Array;
}
export interface RockHeightfields {
	sourceSha256: string;
	fields: RockHeightfield[];
}

export function decodeRockHeightfields(bytes: Uint8Array): RockHeightfields {
	const samples = 6 * ROCK_HEIGHTFIELD_RES ** 2;
	if (
		bytes.byteLength !==
		ROCK_HEIGHTFIELD_HEADER_BYTES + ROCK_ARCHETYPE_COUNT * samples * 2
	)
		throw new Error(`Invalid rock heightfield length: ${bytes.byteLength}`);
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	if (
		String.fromCharCode(...bytes.subarray(0, 4)) !== "RHF1" ||
		view.getUint16(4, true) !== 1 ||
		view.getUint16(6, true) !== ROCK_HEIGHTFIELD_RES ||
		view.getUint16(8, true) !== ROCK_ARCHETYPE_COUNT ||
		view.getUint16(10, true) !== 6 ||
		view.getUint32(12, true) !== 0
	)
		throw new Error("Invalid rock heightfield header");
	const sourceSha256 = Array.from(bytes.subarray(16, 48), (b) =>
		b.toString(16).padStart(2, "0"),
	).join("");
	const fields: RockHeightfield[] = [];
	let offset = ROCK_HEIGHTFIELD_HEADER_BYTES;
	for (let rock = 0; rock < ROCK_ARCHETYPE_COUNT; rock++) {
		const r = new Float32Array(samples);
		for (let i = 0; i < samples; i++, offset += 2) {
			const value = view.getUint16(offset, true);
			if (!value)
				throw new Error(`Zero rock radius at archetype ${rock}, sample ${i}`);
			r[i] = value / 65535;
		}
		fields.push({ res: ROCK_HEIGHTFIELD_RES, r });
	}
	return { sourceSha256, fields };
}

/** Caller hashes the received GLB bytes, before parsing or canonicalization. */
export function assertRockSource(data: RockHeightfields, actual: string): void {
	if (data.sourceSha256 !== actual)
		throw new Error(
			`Rock heightfield source mismatch: recorded ${data.sourceSha256}, actual ${actual}`,
		);
}

/** Cube major-axis mapping and bilinear sampling retained from node #949. */
export function faceUV(d: V3): [number, number, number] {
	const ax = Math.abs(d[0]),
		ay = Math.abs(d[1]),
		az = Math.abs(d[2]);
	if (ax >= ay && ax >= az)
		return d[0] > 0 ? [0, -d[2] / ax, d[1] / ax] : [1, d[2] / ax, d[1] / ax];
	if (ay >= az)
		return d[1] > 0 ? [2, d[0] / ay, -d[2] / ay] : [3, d[0] / ay, d[2] / ay];
	return d[2] > 0 ? [4, d[0] / az, d[1] / az] : [5, -d[0] / az, d[1] / az];
}
export function dirOf(face: number, u: number, v: number): V3 {
	const p: V3 = [
		[1, v, -u],
		[-1, v, u],
		[u, 1, -v],
		[u, -1, v],
		[u, v, 1],
		[-u, v, -1],
	][face] as V3;
	const length = Math.hypot(...p);
	return [p[0] / length, p[1] / length, p[2] / length];
}
export function radiusAt(h: RockHeightfield, d: V3): number {
	const [face, u, v] = faceUV(d);
	const x = Math.min(h.res - 1, Math.max(0, ((u + 1) * h.res) / 2 - 0.5));
	const y = Math.min(h.res - 1, Math.max(0, ((v + 1) * h.res) / 2 - 0.5));
	const i = Math.floor(x),
		j = Math.floor(y),
		fx = x - i,
		fy = y - j;
	const r = (a: number, b: number) => h.r[(face * h.res + b) * h.res + a];
	const ii = Math.min(h.res - 1, i + 1),
		jj = Math.min(h.res - 1, j + 1);
	return (
		(r(i, j) * (1 - fx) + r(ii, j) * fx) * (1 - fy) +
		(r(i, jj) * (1 - fx) + r(ii, jj) * fx) * fy
	);
}
