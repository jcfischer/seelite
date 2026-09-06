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
 * Every case restores `stock` on its way out, for the ship test's reason: the
 * finish is module state and the next file was written for the stock one.
 */

import { afterEach, describe, expect, test } from "bun:test";
import * as THREE from "three";
import {
	STATION_GEOMETRY,
	STATION_TYPES,
	type StationType,
} from "../src/station";
import {
	SELECTED_FORM,
	STATION_FORMS,
	STATION_PANEL_KM,
	buildStationForm,
	setStationDetail,
} from "../src/station-mesh";
import {
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

const GREY = 0x9aa6b2;
const LEVELS: StationDetailLevel[] = ["full", "reduced", "outline"];

afterEach(() => setStationFinish("stock"));

/** The reach `station-visuals.test.ts` measures: every drawn vertex, instanced
 *  copies included, hidden parts excluded, back in kilometres. */
function reachKm(root: THREE.Object3D, type: StationType): number {
	root.updateMatrixWorld(true);
	let maxSq = 0;
	const v = new THREE.Vector3();
	const instance = new THREE.Matrix4();
	const stack: THREE.Object3D[] = [root];
	while (stack.length) {
		const object = stack.pop() as THREE.Object3D;
		if (!object.visible) continue;
		for (const child of object.children) stack.push(child);
		const mesh = object as THREE.Mesh;
		const position = mesh.geometry?.getAttribute?.("position");
		if (!position) continue;
		const instanced = object as THREE.InstancedMesh;
		const count = instanced.isInstancedMesh ? instanced.count : 1;
		for (let n = 0; n < count; n++) {
			if (instanced.isInstancedMesh) instanced.getMatrixAt(n, instance);
			else instance.identity();
			for (let i = 0; i < position.count; i++) {
				v.fromBufferAttribute(position as THREE.BufferAttribute, i);
				v.applyMatrix4(instance);
				mesh.localToWorld(v);
				maxSq = Math.max(maxSq, v.lengthSq());
			}
		}
	}
	return Math.sqrt(maxSq) * STATION_GEOMETRY[type].coreRadiusKm;
}

const formOf = (type: StationType) =>
	STATION_FORMS[type].find(
		(form) => form.id === SELECTED_FORM[type],
	) as (typeof STATION_FORMS)[StationType][number];

describe("stock is the station that shipped", () => {
	test("the finish is the identity over the role profile, at the shipped scales", () => {
		expect(stationFinishId()).toBe("stock");
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

	test("every industrial finish keeps the plate the same nineteen metres", () => {
		for (const id of STATION_FINISH_IDS) {
			setStationFinish(id);
			const finish = STATION_FINISHES[id];
			// Plate = tile / plates across; the tile and the map scale together
			// and the pitch halves, so the quotient is the stock plate.
			const role = STATION_VISUALS.trade.plating;
			const profile = finish.plating(role);
			const plateKm =
				(STATION_PANEL_KM * finish.tile) /
				Math.round(stationMapSize() / profile.pitchPx);
			expect([id, plateKm]).toEqual([
				id,
				STATION_PANEL_KM / Math.round(PLATE_TEXTURE_SIZE / role.pitchPx),
			]);
		}
	});
});

describe("every finish builds every selected form", () => {
	for (const id of STATION_FINISH_IDS) {
		test(`${id}: inside its declared reach, the corridor clear, the outline the same at every level`, () => {
			setStationFinish(id);
			for (const type of STATION_TYPES) {
				const form = formOf(type);
				const built = buildStationForm(type, form.id, GREY, 0);
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
		const count = (id: StationFinishId, type: StationType) => {
			setStationFinish(id);
			const built = buildStationForm(type, SELECTED_FORM[type], GREY, 0);
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
		for (const type of STATION_TYPES) {
			const stock = count("stock", type);
			const industrial = count("industrial", type);
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
		const unit = new THREE.Box3(
			new THREE.Vector3(-0.5, -0.5, -0.5),
			new THREE.Vector3(0.5, 0.5, 0.5),
		);
		for (const type of STATION_TYPES) {
			const built = buildStationForm(type, SELECTED_FORM[type], GREY, 0);
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
			const matrix = new THREE.Matrix4();
			group.traverse((object) => {
				const instanced = object as THREE.InstancedMesh;
				if (instanced.isInstancedMesh) {
					for (let i = 0; i < instanced.count; i++) {
						instanced.getMatrixAt(i, matrix);
						members.push(
							unit
								.clone()
								.applyMatrix4(matrix)
								.applyMatrix4(instanced.matrixWorld)
								.expandByScalar(tolerance),
						);
					}
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
			const core = buildStationForm("trade", "a", GREY, 0).root.getObjectByName(
				"core",
			) as THREE.Mesh;
			return (core.material as THREE.MeshStandardMaterial).normalMap;
		};
		expect(normalOf("stock")).toBeNull();
		expect(normalOf("plated")).toBeTruthy();
	});
});
