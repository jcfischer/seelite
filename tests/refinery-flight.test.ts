/**
 * Node #819: the four authored refineries as the game builds them.
 *
 * `installShippedRefineries` installs `src/models/refinery-*.glb` through the
 * browser's loader and `createRefineryBuilder`, as the game does after boot.
 * These rows hold what a built station must be, in the station's own frame:
 * drawn from the model, its aperture plane on the sim's, the sim's pad deck
 * drawn into it, nothing turning, and inside the form's declared reach.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import * as THREE from "three";
import {
	installShippedRefineries,
	uninstallRefineries,
} from "../scripts/lib/shipped-refineries";
import { REFINERY_FORMS } from "../src/refinery-flight";
import { STATION_GEOMETRY } from "../src/station";
import { INTERIOR_GROUP_NAME } from "../src/station-interior-mesh";
import { buildStationForm, stationSilhouetteKm } from "../src/station-mesh";
import { isAuthoredStation } from "../src/station-visuals";

const PLANE_KM = STATION_GEOMETRY.refinery.aperturePlaneKm;
const CORE_KM = STATION_GEOMETRY.refinery.coreRadiusKm;

beforeAll(installShippedRefineries);
afterAll(uninstallRefineries);

describe("authored refineries (#819)", () => {
	for (const form of REFINERY_FORMS) {
		describe(`form ${form}`, () => {
			const build = () => buildStationForm("refinery", form, 0x888888, 7, 7);

			test("is drawn from its model, and does not turn", () => {
				const mesh = build();
				expect(isAuthoredStation(mesh.root)).toBe(true);
				expect(mesh.type).toBe("refinery");
				expect(mesh.formId).toBe(form);
				expect(mesh.spinner.children).toEqual([]);
				mesh.dispose();
			});

			test("puts the model's aperture plane on the sim's", () => {
				const mesh = build();
				mesh.root.updateMatrixWorld(true);
				const mark = mesh.root.getObjectByName("aperture-plane");
				expect(mark).toBeDefined();
				// The root is one core radius across; the caller scales it.
				const p = mark!
					.getWorldPosition(new THREE.Vector3())
					.multiplyScalar(CORE_KM);
				expect(Math.abs(p.x)).toBeLessThan(1e-6);
				expect(Math.abs(p.y)).toBeLessThan(1e-6);
				expect(Math.abs(p.z - PLANE_KM)).toBeLessThan(1e-6);
				mesh.dispose();
			});

			test("carries the sim's pad deck", () => {
				const mesh = build();
				expect(mesh.root.getObjectByName(INTERIOR_GROUP_NAME)).toBeDefined();
				mesh.dispose();
			});

			test("stays inside its declared reach", () => {
				const mesh = build();
				mesh.root.updateMatrixWorld(true);
				let reach = 0;
				const v = new THREE.Vector3();
				mesh.root.traverse((o) => {
					if (!(o instanceof THREE.Mesh)) return;
					const p = o.geometry.getAttribute("position");
					for (let i = 0; i < p.count; i++)
						reach = Math.max(
							reach,
							v.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld).length() *
								CORE_KM,
						);
				});
				expect(reach).toBeLessThanOrEqual(
					stationSilhouetteKm("refinery", form),
				);
				mesh.dispose();
			});
		});
	}
});
