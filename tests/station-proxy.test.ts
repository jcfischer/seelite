/**
 * The station proxy budget rows (collision.md §9.1.11).
 *
 * Two rows hold the proxy as a budget, the same way `STATION_SILHOUETTE_KM`
 * holds `reachKm` (#28):
 *
 * 1. **No drawn vertex outside the proxy.** Every vertex of the built station
 *    lies inside the proxy, or within a stated tolerance of its boundary. The
 *    exemption is by **volume**, never by group: a vertex strictly inside the
 *    opening (§2.2) is not owed a primitive, and every other vertex is —
 *    including the berths and booms of a refinery or an outpost, which stand
 *    outside the corridor and are solid. The bay's walls lie on the opening's
 *    boundary and pass on the tolerance.
 *
 * 2. **No proxy outside the reach.** Every primitive lies inside `reachKm`.
 *
 * And the row that makes the first two more than a container check:
 *
 * 3. **The opening is clear.** No primitive contains a point of the opening.
 *    On a trade station or a shipyard that is the bay over
 *    `interiorAxialSpanKm` and the prism the aperture rectangle sweeps outward
 *    from the plane; on a refinery or an outpost it is the corridor cylinder at
 *    `corridorRadiusKm`. A static primitive (the shipyard's keel) does not turn
 *    with the rectangle, so it must clear what the rectangle sweeps: the
 *    corridor cylinder, and the bay's own swept cylinder. Without this row a
 *    sphere over the whole reach passes rows 1 and 2.
 *
 * For a solved form every row runs over `ASSEMBLY_SEEDS`, and the berth seed
 * is swept on its own, because a dependency on it is never isolated when both
 * seeds move together.
 *
 * The thinnest-primitive figure is declared and asserted.
 *
 * A selected form with no proxy is red.
 */

import { describe, expect, test } from "bun:test";
import * as THREE from "three";
import {
	STATION_GEOMETRY,
	STATION_TYPES,
	type StationType,
} from "../src/station";
import {
	corridorRadiusKm,
	interiorAxialSpanKm,
	stationInterior,
} from "../src/station-interior";
import {
	SELECTED_FORM,
	STATION_FORMS,
	STATION_SILHOUETTE_KM,
	buildStationForm,
} from "../src/station-mesh";
import {
	type ProxyPrimitive,
	type StationProxy,
	proxyContains,
	proxyReachKm,
	stationProxy,
} from "../src/station-proxy";
import { ASSEMBLY_SEEDS, isSolvedForm } from "./helpers/solved-forms";
import { codeOf } from "./lib/source-scan";

const TYPES: StationType[] = STATION_TYPES;
const GREY = 0x9aa6b2;

/**
 * Tolerance for the vertex-inside-proxy check, in kilometres.
 *
 * This is slack in the budget, not float rounding — float32 at a kilometre is
 * about a tenth of a metre. It is what lets a lamp, a greeble or a bay wall sit
 * on or just past a primitive's face without a primitive of its own, and it is
 * the figure a reader should hold a drawn part to: anything standing more than
 * this far outside the proxy is red. The proxy is a budget, not a shrinkwrap,
 * and §11 joint 5 says what the headless rows cannot see — only flying it shows
 * an invisible wall.
 */
const VERTEX_TOLERANCE_KM = 0.06;

/** Berth seeds swept on their own, at assembly seed zero. */
const BERTH_SEEDS = [0, 1, 2, 7];

/** `[berthSeed, assemblySeed]` pairs a form is measured at. */
function seedPairs(
	type: StationType,
	form: (typeof SELECTED_FORM)[StationType],
): [number, number][] {
	const assembly = isSolvedForm(type, form) ? ASSEMBLY_SEEDS : [0];
	return [
		...assembly.map((seed): [number, number] => [0, seed]),
		...BERTH_SEEDS.filter((seed) => seed !== 0).map(
			(seed): [number, number] => [seed, 0],
		),
	];
}

// ---------------------------------------------------------------------------
// The opening, read from the interior catalogue — never from the proxy
// ---------------------------------------------------------------------------

interface AxialBox {
	hx: number;
	hy: number;
	z0: number;
	z1: number;
}

interface AxialCylinder {
	radiusKm: number;
	z0: number;
	z1: number;
}

/**
 * What §2.2 leaves open for one role. A bay role has the bay and the prism in
 * the spinning frame; every role has the corridor and (bay roles) the bay's
 * swept cylinder in the static frame.
 */
interface Opening {
	/** Open in the spinning frame. */
	boxes: AxialBox[];
	cylinders: AxialCylinder[];
	/** Open in the static frame: what the spinning openings sweep. */
	sweptCylinders: AxialCylinder[];
}

function openingOf(type: StationType): Opening {
	const g = STATION_GEOMETRY[type];
	const plane = g.aperturePlaneKm;
	const reach = STATION_SILHOUETTE_KM[type];
	const interior = stationInterior(type, plane, 0);
	const corridor: AxialCylinder = {
		radiusKm: corridorRadiusKm(g.aperture),
		z0: plane,
		z1: reach,
	};
	if (interior.presentation !== "bay") {
		return { boxes: [], cylinders: [corridor], sweptCylinders: [corridor] };
	}
	const [z0, z1] = interiorAxialSpanKm(interior);
	const bay: AxialBox = {
		hx: interior.halfAcrossKm,
		hy: interior.halfUpKm,
		z0,
		z1,
	};
	const prism: AxialBox = {
		hx: interior.laneHalfAcrossKm,
		hy: interior.laneHalfUpKm,
		z0: plane,
		z1: reach,
	};
	return {
		boxes: [bay, prism],
		cylinders: [],
		sweptCylinders: [
			corridor,
			{ radiusKm: Math.hypot(bay.hx, bay.hy), z0: bay.z0, z1: bay.z1 },
		],
	};
}

const insideBox = (b: AxialBox, v: THREE.Vector3) =>
	Math.abs(v.x) < b.hx && Math.abs(v.y) < b.hy && v.z > b.z0 && v.z < b.z1;

const insideCylinder = (c: AxialCylinder, v: THREE.Vector3) =>
	Math.hypot(v.x, v.y) < c.radiusKm && v.z > c.z0 && v.z < c.z1;

/** Is this vertex strictly inside the spinning frame's opening? */
function inOpening(opening: Opening, v: THREE.Vector3): boolean {
	return (
		opening.boxes.some((b) => insideBox(b, v)) ||
		opening.cylinders.some((c) => insideCylinder(c, v))
	);
}

/** A grid of points strictly inside an axial box, about 5 m apart. */
function sampleBox(b: AxialBox): THREE.Vector3[] {
	const out: THREE.Vector3[] = [];
	const step = 0.005;
	const nx = Math.max(2, Math.ceil((2 * b.hx) / step));
	const ny = Math.max(2, Math.ceil((2 * b.hy) / step));
	const nz = Math.max(2, Math.ceil((b.z1 - b.z0) / step));
	for (let i = 0; i < nx; i++)
		for (let j = 0; j < ny; j++)
			for (let k = 0; k < nz; k++)
				out.push(
					new THREE.Vector3(
						-b.hx + ((i + 0.5) * 2 * b.hx) / nx,
						-b.hy + ((j + 0.5) * 2 * b.hy) / ny,
						b.z0 + ((k + 0.5) * (b.z1 - b.z0)) / nz,
					),
				);
	return out;
}

/** Points strictly inside an axial cylinder, about 5 m apart. */
function sampleCylinder(c: AxialCylinder): THREE.Vector3[] {
	const out: THREE.Vector3[] = [];
	const step = 0.005;
	const nr = Math.max(2, Math.ceil(c.radiusKm / step));
	const nz = Math.max(2, Math.ceil((c.z1 - c.z0) / step));
	for (let k = 0; k < nz; k++) {
		const z = c.z0 + ((k + 0.5) * (c.z1 - c.z0)) / nz;
		out.push(new THREE.Vector3(0, 0, z));
		for (let i = 1; i <= nr; i++) {
			const r = ((i - 0.5) * c.radiusKm) / nr;
			const na = Math.max(8, Math.ceil((2 * Math.PI * r) / step));
			for (let a = 0; a < na; a++) {
				const t = (a / na) * 2 * Math.PI;
				out.push(new THREE.Vector3(r * Math.cos(t), r * Math.sin(t), z));
			}
		}
	}
	return out;
}

/** How many sample points a primitive list holds strictly inside it. */
function intrusions(
	primitives: readonly ProxyPrimitive[],
	points: readonly THREE.Vector3[],
): THREE.Vector3[] {
	return points.filter((p) => proxyContains(primitives, p.x, p.y, p.z, -1e-9));
}

// ---------------------------------------------------------------------------
// The built mesh's vertices, in kilometres
// ---------------------------------------------------------------------------

interface NamedVertex {
	v: THREE.Vector3;
	name: string;
}

function extractVertices(
	root: THREE.Object3D,
	type: StationType,
): NamedVertex[] {
	root.updateMatrixWorld(true);
	const out: NamedVertex[] = [];
	const v = new THREE.Vector3();
	const instance = new THREE.Matrix4();
	const core = STATION_GEOMETRY[type].coreRadiusKm;

	root.traverse((object) => {
		const mesh = object as THREE.Mesh;
		const position = mesh.geometry?.getAttribute?.("position");
		if (!position) return;
		const instanced = object as THREE.InstancedMesh;
		const count = instanced.isInstancedMesh ? instanced.count : 1;
		for (let n = 0; n < count; n++) {
			if (instanced.isInstancedMesh) instanced.getMatrixAt(n, instance);
			else instance.identity();
			for (let i = 0; i < position.count; i++) {
				v.fromBufferAttribute(position as THREE.BufferAttribute, i);
				v.applyMatrix4(instance);
				mesh.localToWorld(v);
				// The root is normalised to core radii — convert back to km
				out.push({
					v: v.clone().multiplyScalar(core),
					name: object.name || object.type,
				});
			}
		}
	});
	return out;
}

/**
 * Check whether a vertex is inside any primitive of the proxy. The mesh is
 * built at phase 0, where the spinning frame is the static frame, so the
 * vertex is tested against both lists at once.
 */
function vertexInsideProxy(
	proxy: StationProxy,
	v: THREE.Vector3,
	tolerance: number,
): boolean {
	return proxyContains(
		[...proxy.spinning, ...proxy.static],
		v.x,
		v.y,
		v.z,
		tolerance,
	);
}

const fmt = (v: THREE.Vector3) =>
	`(${v.x.toFixed(3)}, ${v.y.toFixed(3)}, ${v.z.toFixed(3)})`;

describe("station proxy budget (collision.md §9.1.11)", () => {
	test("every selected form has a proxy", () => {
		for (const type of TYPES) {
			const form = SELECTED_FORM[type];
			const proxy = stationProxy(type, form, 0, 0);
			expect(proxy).not.toBeNull();
		}
	});

	test("only a selected form has a proxy", () => {
		// An alternate's proxy would be a claim no row measures: every row below
		// runs over the selected forms. Selecting an alternate (#260, #491) makes
		// the first row red, which is the refusal §2.2 asks for.
		for (const type of TYPES) {
			for (const { id } of STATION_FORMS[type]) {
				if (id === SELECTED_FORM[type]) continue;
				expect(stationProxy(type, id, 0, 0)).toBeNull();
			}
		}
	});

	test("no drawn vertex outside the proxy, within tolerance", () => {
		for (const type of TYPES) {
			const form = SELECTED_FORM[type];
			const opening = openingOf(type);
			for (const [berthSeed, assemblySeed] of seedPairs(type, form)) {
				const proxy = stationProxy(type, form, berthSeed, assemblySeed);
				expect(proxy).not.toBeNull();
				const mesh = buildStationForm(
					type,
					form,
					GREY,
					berthSeed,
					assemblySeed,
				);
				const offenders = extractVertices(mesh.root, type).filter(
					({ v }) =>
						!inOpening(opening, v) &&
						!vertexInsideProxy(proxy!, v, VERTEX_TOLERANCE_KM),
				);
				if (offenders.length > 0) {
					const sample = offenders
						.slice(0, 6)
						.map(({ v, name }) => `${name} ${fmt(v)}`)
						.join("; ");
					console.log(
						`${type} form ${form} berth ${berthSeed} assembly ${assemblySeed}: ` +
							`${offenders.length} vertices outside the proxy — ${sample}`,
					);
				}
				expect(offenders.length).toBe(0);
			}
		}
	});

	test("no primitive outside reachKm", () => {
		for (const type of TYPES) {
			const form = SELECTED_FORM[type];
			for (const [berthSeed, assemblySeed] of seedPairs(type, form)) {
				const proxy = stationProxy(type, form, berthSeed, assemblySeed);
				expect(proxy).not.toBeNull();
				const reach = proxyReachKm(proxy!);
				const budget = STATION_SILHOUETTE_KM[type];
				if (reach > budget * (1 + 1e-6)) {
					console.log(
						`${type} form ${form} assembly ${assemblySeed}: proxy reaches ` +
							`${reach.toFixed(3)} km, budget ${budget} km`,
					);
				}
				expect(reach).toBeLessThanOrEqual(budget * (1 + 1e-6));
			}
		}
	});

	test("the opening is clear: no primitive holds a point of it", () => {
		for (const type of TYPES) {
			const form = SELECTED_FORM[type];
			const opening = openingOf(type);
			const spinningPoints = [
				...opening.boxes.flatMap(sampleBox),
				...opening.cylinders.flatMap(sampleCylinder),
			];
			const staticPoints = opening.sweptCylinders.flatMap(sampleCylinder);
			for (const [berthSeed, assemblySeed] of seedPairs(type, form)) {
				const proxy = stationProxy(type, form, berthSeed, assemblySeed)!;
				const spun = intrusions(proxy.spinning, spinningPoints);
				const fixed = intrusions(proxy.static, staticPoints);
				if (spun.length + fixed.length > 0) {
					console.log(
						`${type} form ${form} assembly ${assemblySeed}: ` +
							`${spun.length} spinning and ${fixed.length} static intrusions — ` +
							[...spun, ...fixed].slice(0, 4).map(fmt).join("; "),
					);
				}
				expect(spun.length).toBe(0);
				expect(fixed.length).toBe(0);
			}
		}
	});

	test("the opening row goes red on a proxy that closes the opening", () => {
		// The row above must be able to fail: a sphere over the whole reach is
		// what this module shipped first, and it passed rows 1 and 2.
		for (const type of TYPES) {
			const opening = openingOf(type);
			const points = [
				...opening.boxes.flatMap(sampleBox),
				...opening.cylinders.flatMap(sampleCylinder),
			];
			const closed: ProxyPrimitive[] = [
				{
					kind: "sphere",
					cx: 0,
					cy: 0,
					cz: 0,
					radiusKm: STATION_SILHOUETTE_KM[type],
				},
			];
			expect(intrusions(closed, points).length).toBeGreaterThan(0);
		}
	});

	test("thinnest primitive figure matches the declared value", () => {
		for (const type of TYPES) {
			const form = SELECTED_FORM[type];
			const proxy = stationProxy(type, form, 0, 0);
			expect(proxy).not.toBeNull();
			// Recompute the thinnest from the primitives
			const allPrims = [...proxy!.spinning, ...proxy!.static];
			let min = Infinity;
			for (const p of allPrims) {
				switch (p.kind) {
					case "box":
						min = Math.min(min, p.hx * 2, p.hy * 2, p.hz * 2);
						break;
					case "sphere":
						min = Math.min(min, p.radiusKm * 2);
						break;
					case "capsule":
						min = Math.min(min, p.radiusKm * 2);
						break;
				}
			}
			expect(proxy!.thinnestKm).toBeCloseTo(min, 6);
			expect(proxy!.thinnestKm).toBeGreaterThan(0);
		}
	});

	test("the proxy does not read the berth seed", () => {
		// §2.2 names `berthSeed` in the signature; no selected form's proxy
		// reads it, because a berth seed moves only which side an outpost's
		// seeded berth stands on, and both sides are inside the same primitives.
		// If a form starts reading it, this row says so.
		for (const type of TYPES) {
			const form = SELECTED_FORM[type];
			const assembly = isSolvedForm(type, form) ? ASSEMBLY_SEEDS : [0];
			for (const assemblySeed of assembly) {
				const base = JSON.stringify(stationProxy(type, form, 0, assemblySeed));
				for (const berthSeed of BERTH_SEEDS) {
					expect(
						JSON.stringify(stationProxy(type, form, berthSeed, assemblySeed)),
					).toBe(base);
				}
			}
		}
	});

	test("the proxy's value imports never reach three", () => {
		// §2.2: the proxy is Three-free, so the sim can read it without dragging
		// a renderer in. Walk every local module it value-imports, transitively.
		const seen = new Set<string>();
		const reachesThree: string[] = [];
		const walk = (rel: string) => {
			if (seen.has(rel)) return;
			seen.add(rel);
			const code = codeOf(rel);
			const valueImports = code.matchAll(
				/^\s*import\s+(?!type\b)[^;]*?from\s*["']([^"']+)["']/gm,
			);
			for (const [, spec] of valueImports) {
				if (spec === "three" || spec.startsWith("three/"))
					reachesThree.push(rel);
				else if (spec.startsWith("./")) walk(`src/${spec.slice(2)}.ts`);
			}
		};
		walk("src/station-proxy.ts");
		expect(seen.size).toBeGreaterThan(1);
		expect(reachesThree).toEqual([]);
	});

	test("the refinery's proxy reads the assembly seed, cell by cell", () => {
		// The Works is the selected form whose proxy derives from the placement
		// solve. Two plans must give two proxies, or a regression where the
		// seed is ignored stays green. The Salvage bounds every plan of its
		// welded debris with one set of primitives and is seed-independent by
		// design.
		const p0 = stationProxy("refinery", SELECTED_FORM.refinery, 0, 0);
		const p1 = stationProxy("refinery", SELECTED_FORM.refinery, 0, 42);
		expect(JSON.stringify(p0!.spinning)).not.toEqual(
			JSON.stringify(p1!.spinning),
		);
	});
});
