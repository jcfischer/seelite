/**
 * The station proxy budget rows (collision.md §9.1.11).
 *
 * Two rows hold the proxy as a budget, the same way `stationSilhouetteKm`
 * holds `reachKm` (#28):
 *
 * 1. **No drawn vertex outside the proxy.** Every vertex of the built station
 *    lies inside the proxy, or within a stated tolerance of its boundary. The
 *    exemption is by **volume**, never by group: a vertex strictly inside the
 *    opening (§2.2) is not owed a primitive, and every other vertex is —
 *    including the berths and booms of a refinery or an outpost, which stand
 *    outside the corridor and are solid. The bay's walls lie on the opening's
 *    boundary and pass on the tolerance. On a station that spins, each vertex
 *    is held to the primitives of its own frame: a part drawn under the
 *    spinning member to `spinning`, the shipyard's keel to `static`.
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
 * For a seeded form every row runs over `ASSEMBLY_SEEDS`. The vertex row builds
 * each plan with the berth on both sides, because the mesh reads the berth
 * seed; the rows that read only the proxy stay on berth seed 0, because the
 * proxy reads none, and a row asserts that. The berth seed is also swept on its
 * own, because a dependency on it is never isolated when both seeds move
 * together.
 *
 * The thinnest-primitive figure is declared and asserted.
 *
 * A form in any pool with no proxy is red (node #717): the budget rows run
 * over `FORMS_IN_PLAY`, so a form added to a pool is measured by them. They
 * also run over the outposts built ahead of any pool (node #1032).
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import * as THREE from "three";
import {
	STATION_TYPES,
	type StationFormId,
	type StationType,
	formsInPlay,
} from "../src/station";
import {
	STATION_FORMS,
	buildStationForm,
	stationSilhouetteKm,
} from "../src/station-mesh";
import {
	PROXY_VERTEX_TOLERANCE_KM,
	type ProxyPrimitive,
	type StationProxy,
	proxyContains,
	proxyReachKm,
	stationProxy,
} from "../src/station-proxy";
import {
	FORMS_IN_PLAY,
	FORMS_MEASURED,
	OUTPOST_FORMS_AHEAD,
	formLabel,
} from "./helpers/forms-in-play";
import { HUB, modularPlacements } from "../src/station-modular";
import { ASSEMBLY_SEEDS, isSeededForm } from "./helpers/solved-forms";
import {
	BERTH_SIDES,
	openingOf,
	sampleCylinder,
	spinningOpeningPoints,
	verticesOutsideProxy,
} from "./helpers/station-proxy-measure";
import { codeOf } from "./lib/source-scan";
import {
	installShippedOutposts,
	uninstallOutposts,
} from "../scripts/lib/shipped-outposts";
import {
	installShippedRefineries,
	uninstallRefineries,
} from "../scripts/lib/shipped-refineries";
import {
	installShippedShipyards,
	uninstallShipyards,
} from "../scripts/lib/shipped-shipyards";

const TYPES: StationType[] = STATION_TYPES;
const GREY = 0x9aa6b2;

/** `PROXY_VERTEX_TOLERANCE_KM`: budget slack, not float rounding — the
 *  declaration in `station-proxy.ts` says what it lets through. */
const VERTEX_TOLERANCE_KM = PROXY_VERTEX_TOLERANCE_KM;

/**
 * The rows that build a mesh per plan or sample the whole opening run for
 * seconds, so bun's 5 s default would fail them on a slower machine for
 * load rather than for a defect.
 */
const HEAVY_ROW_MS = 30_000;

/** Berth seeds swept on their own, at assembly seed zero. */
const BERTH_SEEDS = [0, 1, 2, 7];

// The vertex row pairs every plan with `BERTH_SIDES`, one berth seed of each
// parity. The rows that read only the proxy pair each plan with berth seed 0:
// the proxy does not read the berth seed, and a row below says so.

/** `[berthSeed, assemblySeed]` pairs a form is measured at. */
/** The roles drawn from approved models once they install (nodes #818,
 *  #819, #1031): their mesh and their proxy read no assembly seed, so one
 *  plan is every plan. The Works' and the Salvage's procedural stand-ins are
 *  seeded; the authored models that replace them, and the proxies the sim
 *  collides with, are not. */
const AUTHORED_TYPES: ReadonlySet<StationType> = new Set([
	"shipyard",
	"refinery",
	"outpost",
]);

const assemblySeedsOf = (type: StationType, form: StationFormId) =>
	isSeededForm(type, form) && !AUTHORED_TYPES.has(type) ? ASSEMBLY_SEEDS : [0];

function seedPairs(
	type: StationType,
	form: StationFormId,
	sides: readonly number[] = [0],
): [number, number][] {
	const assembly = assemblySeedsOf(type, form);
	return [
		...assembly.flatMap((seed) =>
			sides.map((side): [number, number] => [side, seed]),
		),
		...BERTH_SEEDS.filter((seed) => !sides.includes(seed)).map(
			(seed): [number, number] => [seed, 0],
		),
	];
}

/** How many sample points a primitive list holds strictly inside it. */
function intrusions(
	primitives: readonly ProxyPrimitive[],
	points: readonly THREE.Vector3[],
): THREE.Vector3[] {
	return points.filter((p) => proxyContains(primitives, p.x, p.y, p.z, -1e-9));
}

const fmt = (v: THREE.Vector3) =>
	`(${v.x.toFixed(3)}, ${v.y.toFixed(3)}, ${v.z.toFixed(3)})`;

// The shipyards', refineries' and outpost's proxies are the authored models'
// (nodes #818, #819, #1031), which the sim collides with whatever is drawn, so
// the rows here measure the meshes the game draws once their models install.
// Removed after, because bun runs every test file in one process and the next
// file may measure the stand-ins.
beforeAll(async () => {
	await installShippedShipyards();
	await installShippedRefineries();
	await installShippedOutposts();
});
afterAll(() => {
	uninstallShipyards();
	uninstallRefineries();
	uninstallOutposts();
});

describe("station proxy budget (collision.md §9.1.11)", () => {
	test("the Wheel turns both rims and its spokes, leaving the gaps between them open", () => {
		const proxy = stationProxy("trade", "e", 0, 0)!;
		expect(proxy).not.toBeNull();
		expect(proxy.static).toEqual([]);
		for (const z of [-0.16, 0.16]) {
			for (let i = 0; i < 4; i++) {
				const theta = (i * Math.PI) / 2;
				for (const r of [0.5, 0.9])
					expect(
						proxyContains(
							proxy.spinning,
							r * Math.cos(theta),
							r * Math.sin(theta),
							z,
							0,
						),
					).toBe(true);
			}
			// Between spokes and well inside the rims: an envelope over the
			// whole disc would pass vertex containment but falsely close this.
			expect(proxyContains(proxy.spinning, 0.4, 0.4, z, 0)).toBe(false);
		}
		expect(proxyContains(proxy.spinning, 0.9, 0, 0, 0)).toBe(false);
	});

	test("the trade Assembly's proxy reads the assembly seed, cell by cell", () => {
		const shapes = new Set<string>();
		for (const seed of ASSEMBLY_SEEDS) {
			const proxy = stationProxy("trade", "d", 0, seed)!;
			const cells = modularPlacements(seed).placements.filter(
				(p) => p.module !== HUB,
			);
			for (let x = -4; x <= 4; x++)
				for (let y = -4; y <= 4; y++)
					expect([
						seed,
						x,
						y,
						proxyContains(proxy.static, x * 0.2, y * 0.2, -0.04, 0),
					]).toEqual([seed, x, y, cells.some((p) => p.dx === x && p.dy === y)]);
			shapes.add(JSON.stringify(proxy.static));
			expect(proxy.spinning).toEqual(
				stationProxy("trade", "d", 0, 0)!.spinning,
			);
		}
		expect(shapes.size).toBeGreaterThan(1);
	});

	test("every form in every pool has a proxy, and so has each outpost built ahead", () => {
		// Node #717: a system picks each station's form from its role's pool,
		// so every member can be drawn and every member is solid. Growing a
		// pool without building the form's proxy is red here by name.
		for (const [type, formId] of [...FORMS_IN_PLAY, ...OUTPOST_FORMS_AHEAD])
			expect([
				formLabel(type, formId),
				stationProxy(type, formId, 0, 0) !== null,
			]).toEqual([formLabel(type, formId), true]);
	});

	test("the outposts built ahead are the outpost forms no pool holds", () => {
		expect(OUTPOST_FORMS_AHEAD.map(([, form]) => form)).toEqual(
			STATION_FORMS.outpost
				.map((f) => f.id)
				.filter((id) => !formsInPlay("outpost").includes(id)),
		);
	});

	test("only a form in a pool, or an outpost built ahead, has a proxy", () => {
		// An alternate's proxy would be a claim no row measures: every row below
		// runs over the forms in play. Pooling an alternate (node #717) makes the
		// first row red, which is the refusal §2.2 asks for.
		for (const type of TYPES) {
			const inPlay = formsInPlay(type);
			for (const { id } of STATION_FORMS[type]) {
				if (inPlay.includes(id)) continue;
				// Authored outposts are solid ahead of any pool (node #1032).
				if (OUTPOST_FORMS_AHEAD.some(([t, f]) => t === type && f === id))
					continue;
				expect([formLabel(type, id), stationProxy(type, id, 0, 0)]).toEqual([
					formLabel(type, id),
					null,
				]);
			}
		}
	});

	// One row per form: the authored shipyards draw ~200,000 vertices each,
	// and the whole set in one row ran within a second of its limit (#818).
	for (const [type, form] of FORMS_MEASURED)
		test(
			`no drawn vertex outside the proxy, within tolerance: ${formLabel(type, form)}`,
			() => {
				const opening = openingOf(type, form);
				for (const [berthSeed, assemblySeed] of seedPairs(
					type,
					form,
					BERTH_SIDES,
				)) {
					const proxy = stationProxy(type, form, berthSeed, assemblySeed);
					expect(proxy).not.toBeNull();
					const mesh = buildStationForm(
						type,
						form,
						GREY,
						berthSeed,
						assemblySeed,
					);
					const offenders = verticesOutsideProxy(
						mesh,
						type,
						proxy!,
						opening,
						VERTEX_TOLERANCE_KM,
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
			},
			HEAVY_ROW_MS,
		);

	test("no primitive outside reachKm", () => {
		for (const [type, form] of FORMS_MEASURED) {
			for (const [berthSeed, assemblySeed] of seedPairs(type, form)) {
				const proxy = stationProxy(type, form, berthSeed, assemblySeed);
				expect(proxy).not.toBeNull();
				const reach = proxyReachKm(proxy!);
				const budget = stationSilhouetteKm(type, form);
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

	// One row per form, as the vertex rows: the authored shipyards' openings
	// are sampled against thousands of boxes, and the whole set in one row ran
	// past its limit on CI (#818). A proxy that does not read the seeds (a
	// shipyard's, one object per form) is the same object at every pair, so
	// it is measured once.
	for (const [type, form] of FORMS_MEASURED)
		test(
			`the opening is clear: no primitive holds a point of it: ${formLabel(type, form)}`,
			() => {
				const measured = new Set<object>();
				const opening = openingOf(type, form);
				const spinningPoints = spinningOpeningPoints(opening);
				const staticPoints = opening.sweptCylinders.flatMap(sampleCylinder);
				for (const [berthSeed, assemblySeed] of seedPairs(type, form)) {
					const proxy = stationProxy(type, form, berthSeed, assemblySeed)!;
					if (measured.has(proxy)) continue;
					measured.add(proxy);
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
			},
			HEAVY_ROW_MS,
		);

	test("the opening row goes red on a proxy that closes the opening", () => {
		// The row above must be able to fail: a sphere over the whole reach is
		// what this module shipped first, and it passed rows 1 and 2.
		for (const [type, form] of FORMS_MEASURED) {
			const points = spinningOpeningPoints(openingOf(type, form));
			const closed: ProxyPrimitive[] = [
				{
					kind: "sphere",
					cx: 0,
					cy: 0,
					cz: 0,
					radiusKm: stationSilhouetteKm(type, form),
				},
			];
			expect(intrusions(closed, points).length).toBeGreaterThan(0);
		}
	});

	test("the thinnest primitive is the declared figure, at every seed pair", () => {
		// §4.1's sub-step bound reads `thinnestKm`, so a rework that cuts a
		// 1 m sliver off a box changes how finely every tick is swept. Each
		// figure is pinned, and it is the thinnest full extent in the set:
		// - trade: the 32 m box in front of the +Z face that carries the collar;
		// - shipyard: a fitted plate of the authored model, 0.7 m: its 0.5 m
		//   minimum thickness and the packing's slack, the same on all three
		//   (node #818; the procedural drum's lip was 28 m);
		// - refinery: a fitted plate of the authored model, 0.8 m, the same on
		//   all four (node #819; the procedural forms' figures were 17-46 m);
		// - outpost: a fitted plate of the authored Salvage, 0.8 m, as the
		//   refineries' (node #1031; the procedural core section was 90 m), and
		//   the same on the four built ahead of any pool (node #1032).
		//
		// Keyed by form, not by role (node #717): two forms of one role are two
		// solids, and a pooled form with no figure here is red below.
		// These are measured extents, not minimum safe sizes: collision.ts
		// uses conservative advancement on each primitive's separation. The containment,
		// opening and no-tunnelling rows carry the separate safety obligations.
		const DECLARED: Partial<Record<string, number>> = {
			"trade/a": 0.032,
			"trade/b": 0.016,
			"trade/c": 0.016,
			"trade/d": 0.016,
			"trade/e": 0.016,
			"shipyard/a": 0.0007,
			"shipyard/b": 0.0007,
			"shipyard/c": 0.0007,
			"refinery/a": 0.0008,
			"refinery/b": 0.0008,
			"refinery/c": 0.0008,
			"refinery/d": 0.0008,
			"outpost/a": 0.0008,
			"outpost/b": 0.0008,
			"outpost/c": 0.0008,
			"outpost/d": 0.0008,
			"outpost/e": 0.0008,
		};
		for (const [type, form] of FORMS_MEASURED) {
			for (const [berthSeed, assemblySeed] of seedPairs(type, form)) {
				const proxy = stationProxy(type, form, berthSeed, assemblySeed)!;
				let min = Infinity;
				for (const p of [...proxy.spinning, ...proxy.static]) {
					switch (p.kind) {
						case "box":
							min = Math.min(min, p.hx * 2, p.hy * 2, p.hz * 2);
							break;
						case "sphere":
						case "capsule":
							min = Math.min(min, p.radiusKm * 2);
							break;
					}
				}
				expect(proxy.thinnestKm).toBeCloseTo(min, 9);
				const declared = DECLARED[formLabel(type, form)];
				expect([formLabel(type, form), declared !== undefined]).toEqual([
					formLabel(type, form),
					true,
				]);
				expect(proxy.thinnestKm).toBeCloseTo(declared ?? Number.NaN, 6);
			}
		}
	});

	test("the proxy does not read the berth seed", () => {
		// §2.2 names `berthSeed` in the signature; no selected form's proxy
		// reads it, because a berth seed moves only which side an outpost's
		// seeded berth stands on, and both sides are inside the same primitives.
		// If a form starts reading it, this row says so.
		for (const [type, form] of FORMS_MEASURED) {
			for (const assemblySeed of assemblySeedsOf(type, form)) {
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
});
