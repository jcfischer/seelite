import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import * as THREE from "three";
import { decodeShippedGlb } from "../scripts/lib/shipped-glb";

import { DETAIL_RADII, type DetailLevel } from "../src/detail-level";
import {
	HULL_IDS,
	HULL_SPECS,
	type HullEnvelope,
	type HullId,
} from "../src/hull";
import { HABITAT_ROTOR_NAME, isLevelStandIn } from "../src/ship-detail";
import {
	HULL_REACH_KM,
	advanceAuthoredHabitat,
	authoredHullBuilder,
	buildShipMesh,
	installAuthoredHull,
	isDriveBell,
	rebuildAuthoredStandIn,
	updateShipVisuals,
} from "../src/ship-mesh";
import { slotPhaseRad } from "../src/station";
import { berthFits, stationInterior } from "../src/station-interior";
import { STATION_GEOMETRY, STATION_TYPES } from "../src/station";
import { ventThroats } from "../src/vent-plumes";
import {
	SEVEN_SHIP_STUDIES,
	type SevenShipRole,
	sevenShipFrameName,
	sevenShipLevelNames,
} from "../src/seven-ships-hulls";
import { installShippedSevenShip } from "../scripts/lib/shipped-seven-ships";
import { useShippedSevenShips } from "./setup/seven-ships-hull";
import { withProceduralHulls } from "./helpers/procedural-hulls";

await useShippedSevenShips();

const SHIPPED: Partial<
	Record<HullId, { file: string; bytes: number; sha256: string }>
> = {
	patrol: {
		file: "src/models/warden-patrol.glb",
		bytes: 15_139_996,
		sha256: "19a88c432afba5f672cae5d03866bed503dae973630af062befdc3c86b41ed2d",
	},
	raider: {
		file: "src/models/shiv-raider.glb",
		bytes: 15_721_260,
		sha256: "7787a3ce045d0e67f4311db9cfd86b430c2b211bb9ecdd0642691dd46b65b70c",
	},
	carrier: {
		file: "src/models/bastion-carrier.glb",
		bytes: 21_950_512,
		sha256: "ca747b400f84bf0e3f040c6d136ffd20373d13e41931faae7407ccd573056a0a",
	},
	prospector: {
		file: "src/models/sluice-prospector.glb",
		bytes: 8_252_584,
		sha256: "b28283533018020548974f4975bcc75918dbc359060d10b13b7746d16a522fdb",
	},
	dreadnought: {
		file: "src/models/rampart-dreadnought.glb",
		bytes: 20_167_256,
		sha256: "8dc04e9da656e17d1d3e8c406764fead88453bd3d8c387dcf42591285fcced57",
	},
};
const HULLS = Object.keys(SHIPPED) as SevenShipRole[];

const STUDY_METRES: Record<string, [number, number, number]> = {
	patrol: [33.82, 12.108, 55.308],
	raider: [33.82, 11.678, 56.308],
	carrier: [189.492, 189.492, 406.76],
	prospector: [20.008, 15, 66.4],
	dreadnought: [189.492, 189.492, 432],
};

const HABITATS: Partial<Record<HullId, { floorM: number; rpm: number }>> = {
	carrier: { floorM: 90, rpm: 2.5 },
	dreadnought: { floorM: 90, rpm: 2.5 },
};

const fileOf = (id: HullId) => (SHIPPED[id] as { file: string }).file;

const hullOf = (id: HullId) => {
	const root = buildShipMesh(id, HULL_SPECS[id].variant).root;
	root.updateMatrixWorld(true);
	return root;
};

const levelsOf = (root: THREE.Object3D, id: HullId) => {
	const frame = root.getObjectByName(sevenShipFrameName(id as never)) as
		| THREE.Object3D
		| undefined;
	const names = sevenShipLevelNames(id as never);
	const named = (name: string) =>
		frame?.children.find((child) => child.name === name) as THREE.Object3D;
	return {
		frame,
		full: named(names.full),
		reduced: named(names.reduced),
		outline: named(names.outline),
	};
};

const drawn = (root: THREE.Object3D, id: HullId) =>
	Object.entries(levelsOf(root, id))
		.filter(([name, object]) => name !== "frame" && object?.visible)
		.map(([name]) => name);

const boxOf = (object: THREE.Object3D) =>
	new THREE.Box3().setFromObject(object);

describe("the shipped assets (node #1035)", () => {
	test.each(HULLS)("%s ships the file its receipt records", (id) => {
		const row = SHIPPED[id] as { file: string; bytes: number; sha256: string };
		expect(statSync(row.file).size).toBe(row.bytes);
		expect(
			createHash("sha256").update(readFileSync(row.file)).digest("hex"),
		).toBe(row.sha256);
	});

	test("every shipped file is under the node's 25,000,000 bytes", () => {
		for (const id of HULLS) {
			const row = SHIPPED[id] as { bytes: number };
			expect([id, row.bytes < 25_000_000]).toEqual([id, true]);
		}
	});

	test("the wear map is one shared file, named by hash, except the Bastion's and the Rampart's", () => {
		const shared = readFileSync("src/models/steel-wear.webp");
		const sha = createHash("sha256").update(shared).digest("hex");
		for (const id of HULLS) {
			const file = readFileSync(fileOf(id));
			const json = JSON.parse(
				file.subarray(20, 20 + file.readUInt32LE(12)).toString(),
			);
			if (id === "dreadnought" || id === "carrier") {
				expect(json.extensionsUsed).toContain("KHR_texture_transform");
				expect(json.images).toHaveLength(1);
				expect(json.images[0].mimeType).toBe("image/webp");
				continue;
			}
			expect(json.images).toBeUndefined();
			expect(json.textures[0].extensions.SEELITE_shared_image.sha256).toBe(sha);
		}
	});

	test("each decoded model is the study's box, in metres, and fits its envelope", async () => {
		for (const id of HULLS) {
			const scene = await decodeShippedGlb(fileOf(id));
			scene.updateMatrixWorld(true);
			const size = boxOf(scene).getSize(new THREE.Vector3());
			const study = STUDY_METRES[id as keyof typeof STUDY_METRES];
			expect(Math.abs(size.x - study[0])).toBeLessThan(0.01);
			expect(Math.abs(size.y - study[1])).toBeLessThan(0.01);
			expect(Math.abs(size.z - study[2])).toBeLessThan(0.01);
		}
	}, 120_000);

	test("each hull's declared envelope holds its model, on its own centre", () => {
		for (const id of HULLS) {
			const root = hullOf(id);
			const spec = HULL_SPECS[id];
			const box = boxOf(root);
			const size = box.getSize(new THREE.Vector3());
			expect([id, size.z <= spec.env.lengthKm + 1e-9]).toEqual([id, true]);
			expect([id, size.x <= spec.env.beamKm + 1e-9]).toEqual([id, true]);
			expect([id, size.y <= spec.env.heightKm + 1e-9]).toEqual([id, true]);
			const centre = box.getCenter(new THREE.Vector3());
			expect(centre.x).toBeCloseTo(spec.envCentre.rightKm, 6);
			expect(centre.y).toBeCloseTo(spec.envCentre.upKm, 6);
			expect(centre.z).toBeCloseTo(-spec.envCentre.foreKm, 6);
		}
	}, 120_000);

	test("the envelope is the model's box rounded up to 0.1 m, and nothing more", () => {
		const ceil = (km: number) => Math.ceil(km * 10_000 - 1e-9) / 10_000;
		for (const id of HULLS) {
			const spec = HULL_SPECS[id];
			const study = STUDY_METRES[id as keyof typeof STUDY_METRES];
			expect({
				id,
				env: {
					lengthKm: Math.round(spec.env.lengthKm * 10_000) / 10_000,
					beamKm: Math.round(spec.env.beamKm * 10_000) / 10_000,
					heightKm: Math.round(spec.env.heightKm * 10_000) / 10_000,
				},
			}).toEqual({
				id,
				env: {
					lengthKm: ceil(study[2] / 1000),
					beamKm: ceil(study[0] / 1000),
					heightKm: ceil(study[1] / 1000),
				},
			});
		}
	});

	test("every berth answers the model's box as it answers the declared one", () => {
		let admitted = 0;
		for (const id of HULLS) {
			const box = boxOf(hullOf(id));
			const size = box.getSize(new THREE.Vector3());
			const model: HullEnvelope = {
				lengthKm: size.z,
				beamKm: size.x,
				heightKm: size.y,
			};
			for (const type of STATION_TYPES) {
				const { berths } = stationInterior(
					type,
					STATION_GEOMETRY[type].aperturePlaneKm,
					1,
				);
				for (const berth of berths) {
					if (berthFits(berth, HULL_SPECS[id].env)) admitted++;
					expect([id, type, berth.id, berthFits(berth, model)]).toEqual([
						id,
						type,
						berth.id,
						berthFits(berth, HULL_SPECS[id].env),
					]);
				}
			}
		}

		expect(admitted).toBeGreaterThan(0);
	}, 120_000);

	test("the capitals keep the approved rings' dimensions", () => {
		for (const id of ["carrier", "dreadnought"] as const) {
			const size = boxOf(hullOf(id)).getSize(new THREE.Vector3());
			expect([id, Math.abs(size.x * 1000 - 189.492) < 0.01]).toEqual([
				id,
				true,
			]);
			expect([id, Math.abs(size.y * 1000 - 189.492) < 0.01]).toEqual([
				id,
				true,
			]);
		}
	});

	test("the display reach covers the model and the stand-in, rounded up to 0.1 m", () => {
		const farthest = (root: THREE.Object3D) => {
			root.updateMatrixWorld(true);
			const v = new THREE.Vector3();
			let out = 0;
			root.traverse((object) => {
				if (
					!(object instanceof THREE.Mesh) ||
					(object as THREE.InstancedMesh).isInstancedMesh ||
					isLevelStandIn(object) ||
					object.name.startsWith("ship-")
				)
					return;
				const position = object.geometry.getAttribute("position");
				for (let i = 0; i < position.count; i++)
					out = Math.max(
						out,
						v
							.fromBufferAttribute(position, i)
							.applyMatrix4(object.matrixWorld)
							.length(),
					);
			});
			return out;
		};
		for (const id of HULLS) {
			const model = farthest(hullOf(id));
			const loft = withProceduralHulls(() =>
				farthest(buildShipMesh(id, HULL_SPECS[id].variant).root),
			);
			const ceil = Math.ceil(Math.max(model, loft) * 10_000 - 1e-9) / 10_000;
			expect({ id, reach: HULL_REACH_KM[id] }).toEqual({ id, reach: ceil });
		}
	}, 120_000);
});

describe("the authored exteriors are what the game draws", () => {
	test.each(HULLS)("%s installs through the game's builder", (id) => {
		expect(authoredHullBuilder(id)).toBeDefined();
		const root = hullOf(id);
		expect(root.userData.authored).toBe(true);
		const { frame } = levelsOf(root, id);
		expect(frame).toBeDefined();
		expect(frame?.scale.toArray()).toEqual([0.001, 0.001, 0.001]);
		expect(frame?.rotation.y).toBe(Math.PI);
	});

	test.each(HULLS)(
		"%s draws one level at a time, with hysteresis both ways",
		(id) => {
			const root = hullOf(id);
			const reach = HULL_REACH_KM[id];
			expect(drawn(root, id)).toEqual(["full"]);
			const at = (radii: number) => {
				updateShipVisuals(root, radii * reach, "high");
				return drawn(root, id);
			};
			expect(at(DETAIL_RADII.full * 1.02)).toEqual(["full"]);
			expect(at(DETAIL_RADII.full * 1.1)).toEqual(["reduced"]);
			expect(at(DETAIL_RADII.full * 1.02)).toEqual(["reduced"]);
			expect(at(DETAIL_RADII.reduced * 1.1)).toEqual(["outline"]);
			expect(at(DETAIL_RADII.reduced * 0.9)).toEqual(["reduced"]);
			expect(at(DETAIL_RADII.full * 0.9)).toEqual(["full"]);
		},
	);

	test.each(HULLS)(
		"%s drives its main plumes from the model's own mouths",
		(id) => {
			const root = hullOf(id);
			const bells = (levelsOf(root, id).full as THREE.Object3D).parent
				? (() => {
						const out: THREE.Mesh[] = [];
						root.traverse((object) => {
							if (object instanceof THREE.Mesh && isDriveBell(object))
								out.push(object);
						});
						return out;
					})()
				: [];
			const study = SEVEN_SHIP_STUDIES[id as keyof typeof SEVEN_SHIP_STUDIES];
			const mounts = "mounts" in study.nozzles ? study.nozzles.mounts : null;
			expect(bells.length).toBe(mounts ? mounts.length : 2);
			expect(bells.map((bell) => bell.name).sort()).toEqual(
				(mounts
					? mounts.map((mount) => `${id}-${mount.side}-exhaust`)
					: [`${id}-port-exhaust`, `${id}-starboard-exhaust`]
				).sort(),
			);
			const box = boxOf(root);
			const middle = box.getCenter(new THREE.Vector3());
			for (const bell of bells) {
				const at = boxOf(bell).getCenter(new THREE.Vector3());
				expect([id, at.z > middle.z]).toEqual([id, true]);
				expect([id, box.expandByScalar(1e-9).containsPoint(at)]).toEqual([
					id,
					true,
				]);
			}
			const mains = ventThroats(root, id).filter((t) => t.family === "main");
			expect(mains.length).toBe(bells.length);
			for (const main of mains) expect(main.placed).toBe("bell");
		},
		120_000,
	);

	test.each(HULLS)(
		"%s shares one set of geometry and disposes nothing on teardown",
		(id) => {
			const a = hullOf(id);
			const b = hullOf(id);
			const geometries = (root: THREE.Object3D) => {
				const out: THREE.BufferGeometry[] = [];
				root.traverse((object) => {
					if (object instanceof THREE.Mesh && !isDriveBell(object))
						out.push(object.geometry);
				});
				return out;
			};
			const mine = geometries(a);
			const theirs = geometries(b);
			expect(theirs.length).toBe(mine.length);
			for (let i = 0; i < mine.length; i++) expect(theirs[i]).toBe(mine[i]);
			const freed: unknown[] = [];
			for (const geometry of mine)
				geometry.addEventListener("dispose", () => freed.push(geometry));
			a.clear();
			expect(freed).toEqual([]);
		},
		120_000,
	);

	test.each(HULLS)(
		"%s keeps the loft as its stand-in until the model installs",
		(id) => {
			const builder = authoredHullBuilder(id);
			installAuthoredHull(id, undefined);
			const root = buildShipMesh(id, HULL_SPECS[id].variant).root;
			expect(root.userData.authored).not.toBe(true);
			expect(rebuildAuthoredStandIn(root)).toBe(false);
			installAuthoredHull(id, builder);
			expect(rebuildAuthoredStandIn(root)).toBe(true);
			expect(root.userData.authored).toBe(true);
			expect(
				root.getObjectByName(sevenShipFrameName(id as never)),
			).toBeDefined();
		},
		120_000,
	);
});

describe("the habitats turn on the game clock (node #1035)", () => {
	test("only the two accepted rings turn, at their accepted rate", () => {
		for (const id of HULLS) {
			const root = hullOf(id);
			const { full } = levelsOf(root, id);
			const rotor = full.getObjectByName(HABITAT_ROTOR_NAME);
			const habitat = HABITATS[id];
			if (!habitat) {
				expect([id, rotor]).toEqual([id, undefined]);
				continue;
			}
			expect(rotor).toBeDefined();
			expect([id, rotor?.userData.rotationRPM]).toEqual([id, habitat.rpm]);
			expect([id, rotor?.userData.floorRadiusMetres]).toEqual([
				id,
				habitat.floorM,
			]);
		}
	});

	test.each(["carrier", "dreadnought"] as const)(
		"%s's ring turns at the accepted rate, and a level switch cannot reset it",
		(id) => {
			const root = hullOf(id);
			const rpm = (HABITATS[id] as { rpm: number }).rpm;
			const phase = (level: DetailLevel) => {
				const rotor = levelsOf(root, id)[level].getObjectByName(
					HABITAT_ROTOR_NAME,
				) as THREE.Object3D;
				return rotor.rotation.z;
			};
			for (const seconds of [0, 7, 61, 3_600]) {
				advanceAuthoredHabitat(root, seconds);
				const expected = slotPhaseRad(rpm, seconds);
				for (const level of ["full", "reduced", "outline"] as const)
					expect([seconds, level, phase(level)]).toEqual([
						seconds,
						level,
						expected,
					]);
			}

			updateShipVisuals(
				root,
				DETAIL_RADII.full * 1.1 * HULL_REACH_KM[id],
				"high",
			);
			expect(drawn(root, id)).toEqual(["reduced"]);
			for (const level of ["full", "reduced", "outline"] as const)
				expect([level, phase(level)]).toEqual([
					level,
					slotPhaseRad(rpm, 3_600),
				]);

			advanceAuthoredHabitat(root, 3_660);
			expect(phase("full")).toBeCloseTo(slotPhaseRad(rpm, 3_660), 12);
			expect(phase("full")).not.toBeCloseTo(slotPhaseRad(rpm, 3_600), 3);
		},
		120_000,
	);

	test("a hull with no ring ignores the clock", () => {
		for (const id of ["patrol", "raider", "prospector"] as const) {
			const root = hullOf(id);
			expect(root.userData.habitats).toBeUndefined();
			advanceAuthoredHabitat(root, 1_234);
			const { full } = levelsOf(root, id);
			expect(full.getObjectByName(HABITAT_ROTOR_NAME)).toBeUndefined();
		}
	});

	test("a procedural stand-in answers the clock with nothing to turn", () => {
		const builder = authoredHullBuilder("carrier");
		installAuthoredHull("carrier", undefined);
		const loft = buildShipMesh("carrier", HULL_SPECS.explorer.variant).root;
		expect(() => advanceAuthoredHabitat(loft, 60)).not.toThrow();
		expect(loft.userData.habitats).toBeUndefined();
		installAuthoredHull("carrier", builder);
	});
});

describe("the roster kept what the models did not come to change", () => {
	test("every hull keeps its mass, thrust, hold and economy", () => {
		const pinned: Partial<Record<HullId, [number, number, number]>> = {
			patrol: [46, 126, 6],
			raider: [42, 113, 10],
			carrier: [14_000, 8_400, 400],
			prospector: [58, 110, 12],
			dreadnought: [12_000, 8_400, 200],
		};
		for (const id of HULLS) {
			const spec = HULL_SPECS[id];
			expect({ id, row: [spec.massT, spec.thrustMN, spec.holdT] }).toEqual({
				id,
				row: pinned[id] as [number, number, number],
			});
		}
	});

	test("every hull in the roster builds, and each one is one of the five or a loft", () => {
		for (const id of HULL_IDS) {
			const root = buildShipMesh(id, HULL_SPECS[id].variant).root;
			expect([id, root.children.length > 0]).toEqual([id, true]);
		}
	});
});
