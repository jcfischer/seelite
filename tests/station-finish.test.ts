/**
 * #202 — the station finishes.
 *
 * The station half of `ship-finish.test.ts`, and the same three claims: that
 * `stock` is #36's surface as it shipped (the pins in `surface.test.ts` hold
 * the bytes; this holds the finish's figures), that every finish builds every
 * selected form inside its declared reach with the corridor clear and the
 * outline unchanged by the detail band, and that the finish reaches the
 * material.
 *
 * Every case restores the **default** on its way out, for the ship test's
 * reason: the finish is module state and the next file expects the game's.
 */

import { afterEach, describe, expect, test } from "bun:test";
import * as THREE from "three";
import {
	STATION_GEOMETRY,
	STATION_TYPES,
	type StationType,
} from "../src/station";
import { Pools, SHIP_SCALE, radiatorArray } from "../src/station-fixtures";
import {
	STATION_FORMS,
	STATION_PANEL_KM,
	type StationFormId,
	buildStationForm,
	setStationDetail,
} from "../src/station-mesh";
import {
	DEFAULT_STATION_FINISH,
	STATION_FINISHES,
	STATION_FINISH_IDS,
	STATION_VISUALS,
	type StationDetailLevel,
	type StationFinishId,
	platingTexels,
	setStationFinish,
	stationFinishId,
	stationMapSize,
} from "../src/station-visuals";
import { PLATE_TEXTURE_SIZE, plateTexels } from "../src/surface";
import { corridorIntrusions, corridorLine } from "./helpers/aperture-opening";
import { FORMS_IN_PLAY } from "./helpers/forms-in-play";
import { instanceBoxes } from "./helpers/instance-boxes";
import { reachKm } from "./helpers/station-reach";

const GREY = 0x9aa6b2;
const LEVELS: StationDetailLevel[] = ["full", "reduced", "outline"];

// The default, not stock, for `ship-finish.test.ts`'s reason.
afterEach(() => setStationFinish(DEFAULT_STATION_FINISH));

const formOf = (type: StationType, formId: StationFormId) =>
	STATION_FORMS[type].find(
		(form) => form.id === formId,
	) as (typeof STATION_FORMS)[StationType][number];

describe("stock is the station that shipped", () => {
	test("the default is worn — the principal's choice on the second sheet", () => {
		expect(DEFAULT_STATION_FINISH).toBe("worn");
		expect(STATION_FINISHES[DEFAULT_STATION_FINISH].fixtures).toBe(true);
	});

	test("the finish is the identity over the role profile, at the shipped scales", () => {
		setStationFinish("stock");
		for (const type of STATION_TYPES) {
			const role = STATION_VISUALS[type].plating;
			expect(STATION_FINISHES.stock.plating(role)).toBe(role);
			// And the wrapper hands the generator the role's own profile at the
			// shipped size, which is what the pins in `surface.test.ts` read.
			expect(platingTexels(type)).toEqual(plateTexels(role, type));
		}
		expect(STATION_FINISHES.stock.mapScale).toBe(1);
		expect(STATION_FINISHES.stock.tile).toBe(1);
		expect(stationMapSize()).toBe(PLATE_TEXTURE_SIZE);
	});

	test("every industrial finish keeps the plate the same nineteen metres, and nostromo halves it", () => {
		// Plate = tile / plates across. The industrial finishes double the tile
		// and the map together and halve the pitch, so the quotient is the
		// stock plate; `nostromo` doubles the map again at the same tile, so
		// its plate is half of it — the principal's ship-scale ruling, at
		// 9.4 m a sixth of a courier.
		const stock =
			STATION_PANEL_KM /
			Math.round(PLATE_TEXTURE_SIZE / STATION_VISUALS.trade.plating.pitchPx);
		for (const id of STATION_FINISH_IDS) {
			setStationFinish(id);
			const finish = STATION_FINISHES[id];
			const role = STATION_VISUALS.trade.plating;
			const profile = finish.plating(role);
			const plateKm =
				(STATION_PANEL_KM * finish.tile) /
				Math.round(stationMapSize() / profile.pitchPx);
			expect([id, plateKm]).toEqual([
				id,
				id === "nostromo" ? stock / 2 : stock,
			]);
		}
	});
});

describe("every finish builds every form in play", () => {
	for (const id of STATION_FINISH_IDS) {
		test(`${id}: inside its declared reach, the corridor clear, the outline the same at every level`, () => {
			setStationFinish(id);
			for (const [type, formId] of FORMS_IN_PLAY) {
				const form = formOf(type, formId);
				const built = buildStationForm(type, form.id, GREY, 0, 0);
				const measured = LEVELS.map((level) => {
					setStationDetail(built, level);
					return reachKm(built.root, type);
				});
				expect([id, type, measured[0] <= form.reachKm * (1 + 1e-6)]).toEqual([
					id,
					type,
					true,
				]);
				// A fixture that carried the outline would read here as a reach
				// that shrinks when the band hides it.
				expect([id, type, measured[1]]).toEqual([id, type, measured[0]]);
				expect([id, type, measured[2]]).toEqual([id, type, measured[0]]);
				setStationDetail(built, "full");
				const blocked = corridorLine(corridorIntrusions(built.root, type));
				expect([id, type, blocked]).toEqual([id, type, ""]);
			}
		});
	}

	test("the fixtures are there under an industrial finish and not under stock", () => {
		const count = (
			id: StationFinishId,
			type: StationType,
			formId: StationFormId,
		) => {
			setStationFinish(id);
			const built = buildStationForm(type, formId, GREY, 0, 0);
			const group = built.root.getObjectByName("macro-fixtures");
			let instanced = 0;
			group?.traverse((object) => {
				if ((object as THREE.InstancedMesh).isInstancedMesh) instanced += 1;
			});
			const beacons = built.fixtures.filter((fixture) =>
				fixture.kind.startsWith("strobe"),
			).length;
			return { group: Boolean(group), instanced, beacons };
		};
		for (const [type, formId] of FORMS_IN_PLAY) {
			const stock = count("stock", type, formId);
			const industrial = count("industrial", type, formId);
			expect([type, stock.group]).toEqual([type, false]);
			expect([type, industrial.group]).toEqual([type, true]);
			expect([type, industrial.instanced > 0]).toEqual([type, true]);
			// Beacons only where the role strobes: a refinery marks no rotation.
			const strobes = STATION_VISUALS[type].activity.strobePeriodS > 0;
			expect([type, industrial.beacons > stock.beacons]).toEqual([
				type,
				strobes,
			]);
		}
	});

	test("the fixtures are mounted: every member is supported, through others, by structure", () => {
		/*
		 * The mounting rule is what stops a truss floating beside a rock. The
		 * first version cast from each member toward the station's centre and
		 * asked for structure on the way — and read a mast's top frame as
		 * floating, because a ray from the top of a mast toward the centre
		 * passes over the keel it stands on. A member is supported if its box
		 * touches structure **or a supported member**, so a mast is grounded
		 * through its own lattice. Boxes rather than rays, and axis-aligned
		 * ones: the tolerance is a few metres, which is well under any fixture's
		 * own thickness and well over float error.
		 */
		setStationFinish("industrial");
		for (const [type, formId] of FORMS_IN_PLAY) {
			const built = buildStationForm(type, formId, GREY, 0, 0);
			const km = built.root.getObjectByName("km") as THREE.Group;
			km.updateMatrixWorld(true);
			const group = km.getObjectByName("macro-fixtures") as THREE.Group;
			const tolerance = STATION_GEOMETRY[type].coreRadiusKm * 0.01;
			const structure: THREE.Box3[] = [];
			km.traverse((object) => {
				const mesh = object as THREE.Mesh;
				if (!mesh.geometry) return;
				let inside: THREE.Object3D | null = object;
				while (inside && inside !== group) inside = inside.parent;
				if (inside === group) return;
				structure.push(
					new THREE.Box3().setFromObject(object).expandByScalar(tolerance),
				);
			});
			const members: THREE.Box3[] = [];
			group.traverse((object) => {
				const instanced = object as THREE.InstancedMesh;
				if (instanced.isInstancedMesh) {
					for (const box of instanceBoxes(instanced))
						members.push(box.expandByScalar(tolerance));
				} else if ((object as THREE.Mesh).geometry)
					members.push(
						new THREE.Box3().setFromObject(object).expandByScalar(tolerance),
					);
			});
			const supported = members.map((box) =>
				structure.some((s) => s.intersectsBox(box)),
			);
			let grew = true;
			while (grew) {
				grew = false;
				for (let i = 0; i < members.length; i++) {
					if (supported[i]) continue;
					if (
						members.some(
							(other, j) => supported[j] && other.intersectsBox(members[i]),
						)
					) {
						supported[i] = true;
						grew = true;
					}
				}
			}
			const floating = supported.filter((s) => !s).length;
			expect(members.length).toBeGreaterThan(20);
			expect([type, floating]).toEqual([type, 0]);
		}
	});
});

describe("the finish reaches the material", () => {
	test("an industrial finish cuts the seams into a normal map; stock paints them", () => {
		const normalOf = (id: StationFinishId) => {
			setStationFinish(id);
			const core = buildStationForm(
				"trade",
				"a",
				GREY,
				0,
				0,
			).root.getObjectByName("core") as THREE.Mesh;
			return (core.material as THREE.MeshStandardMaterial).normalMap;
		};
		expect(normalOf("stock")).toBeNull();
		expect(normalOf("plated")).toBeTruthy();
	});
});

describe("a fixture's frame", () => {
	/**
	 * Sage read the radiator basis off the matrix: `side = axis × up` is a
	 * reflection, and `setFromRotationMatrix` on a reflection answered the
	 * identity for the shipyard's keel, so every panel lay along the spine and
	 * the bank drew as one slab. The frame is right-handed now, and this reads
	 * every panel's thin axis back against the spine it stands on — for the
	 * pair that failed and for the three other orientations the forms use.
	 */
	test("a radiator panel stands across its spine, whichever way the spine runs", () => {
		const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
		const cases: [string, THREE.Vector3, THREE.Vector3][] = [
			["shipyard keel", V(1, 0, 0), V(0, 1, 0)],
			["trade +Y face", V(0, 0, 1), V(0, 1, 0)],
			["outpost flank", V(0, 0, 1), V(-1, 0, 0)],
			["assembly cell", V(-1, 0, 0), V(0, 0, -1)],
		];
		const matrix = new THREE.Matrix4();
		const position = new THREE.Vector3();
		const rotation = new THREE.Quaternion();
		const scale = new THREE.Vector3();
		for (const [label, along, up] of cases) {
			const pools = new Pools();
			radiatorArray(pools, {
				origin: V(1, 2, 3),
				along,
				up,
				count: 4,
				panelWidthKm: 0.1,
				panelHeightKm: 0.08,
			});
			const group = new THREE.Group();
			pools.emit(group, "fx");
			const panels = group.getObjectByName(
				"fx-radiator",
			) as THREE.InstancedMesh;
			expect([label, panels.count]).toEqual([label, 4]);
			for (let i = 0; i < panels.count; i++) {
				panels.getMatrixAt(i, matrix);
				// A rotation, not a reflection.
				expect([label, i, matrix.determinant() > 0]).toEqual([label, i, true]);
				matrix.decompose(position, rotation, scale);
				const thin = V(0, 0, 1).applyQuaternion(rotation);
				const rise = V(0, 1, 0).applyQuaternion(rotation);
				// The panel's thin dimension runs along the spine — it stands
				// across it — and its height runs up off the surface.
				expect(Math.abs(thin.dot(along))).toBeCloseTo(1, 6);
				expect(rise.dot(up)).toBeCloseTo(1, 6);
				expect(scale.z).toBeLessThan(scale.x * 0.1);
			}
		}
	});
});

describe("the station maps are the plating's, not the finish's", () => {
	test("plated and industrial share one set of maps; stock and worn have their own", () => {
		const mapOf = (id: StationFinishId) => {
			setStationFinish(id);
			const core = buildStationForm(
				"trade",
				"a",
				GREY,
				0,
				0,
			).root.getObjectByName("core") as THREE.Mesh;
			return (core.material as THREE.MeshStandardMaterial).map;
		};
		const plated = mapOf("plated");
		expect(plated).not.toBeNull();
		expect(mapOf("industrial")).toBe(plated);
		expect(mapOf("stock")).not.toBe(plated);
		expect(mapOf("worn")).not.toBe(plated);
	});
});

describe("the fixtures are at ship scale", () => {
	/**
	 * The principal's ruling on the first sheet: a station's details are
	 * sized to a ship, or nothing in the frame says how big the station is.
	 * `SHIP_SCALE.caps` names the largest member each pool may hold, and this
	 * reads every instance's scale back against it on every selected form and
	 * on the assembly — the first trusses were 47 m wide, and a figure over
	 * its cap is a fixture back at station scale.
	 */
	test("no pooled member on any form exceeds its material's cap", () => {
		setStationFinish("nostromo");
		const matrix = new THREE.Matrix4();
		const position = new THREE.Vector3();
		const rotation = new THREE.Quaternion();
		const scale = new THREE.Vector3();
		const builds: (readonly [StationType, StationFormId])[] = [
			...FORMS_IN_PLAY,
			["trade", "d"],
			["refinery", "d"],
			["outpost", "d"],
		];
		let members = 0;
		for (const [type, form] of builds) {
			const km = buildStationForm(type, form, GREY, 0, 0).root.getObjectByName(
				"km",
			) as THREE.Group;
			km.traverse((object) => {
				const instanced = object as THREE.InstancedMesh;
				if (!instanced.isInstancedMesh) return;
				const material = object.name.split("-").pop() as string;
				if (!(material in SHIP_SCALE.caps)) return;
				const cap = SHIP_SCALE.caps[material as keyof typeof SHIP_SCALE.caps];
				for (let i = 0; i < instanced.count; i++) {
					instanced.getMatrixAt(i, matrix);
					matrix.decompose(position, rotation, scale);
					const sorted = [scale.x, scale.y, scale.z].sort((a, b) => a - b);
					// A member's and a tank's measure is its section; a panel's is
					// its longest side.
					const measure = material === "radiator" ? sorted[2] : sorted[1];
					expect([type, form, object.name, i, measure <= cap]).toEqual([
						type,
						form,
						object.name,
						i,
						true,
					]);
					members += 1;
				}
			});
		}
		expect(members).toBeGreaterThan(2000);
	});
});
