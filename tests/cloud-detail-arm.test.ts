import { expect, test } from "bun:test";
import * as THREE from "three";
import { withCloudDetailCap } from "../scripts/lib/cloud-detail-arm.mjs";
import { appearanceFor } from "../src/planet-appearance";
import { buildBodyVisual } from "../src/planet-surface";

test("a cloud-only capture holds ground detail fixed and restores quality sharing", () => {
	const visual = buildBodyVisual(
		appearanceFor("planet", "cloud-47", 1, false),
		new THREE.SphereGeometry(1, 8, 6),
	);
	const shell = visual.group.children.find(
		(o) => o.userData.shell === "cloud",
	) as THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
	const original = shell.material.uniforms;
	try {
		const result = withCloudDetailCap([visual], 0, () => {
			visual.setDetailQuality("high");
			expect(visual.uniforms.extraOctaveCap.value).toBe(6);
			expect(shell.material.uniforms.extraOctaveCap.value).toBe(0);
			expect(shell.material.uniforms.cloudPixelAngle).toBe(
				visual.uniforms.cloudPixelAngle,
			);
			return "captured";
		});
		expect(result).toBe("captured");
		expect(shell.material.uniforms).toBe(original);
		visual.setDetailQuality("low");
		expect(shell.material.uniforms.extraOctaveCap.value).toBe(0);
		expect(() =>
			withCloudDetailCap([visual], 6, () => {
				throw new Error("capture failed");
			}),
		).toThrow("capture failed");
		expect(shell.material.uniforms).toBe(original);
	} finally {
		visual.dispose();
	}
});
