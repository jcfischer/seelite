import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import * as THREE from "three";
import { interiorMaterial } from "../src/interior-kit";
import { EMISSIVE_CEILING } from "../src/light-rig";

test("review viewer delegates authored assembly and materials to the game kit", () => {
	const viewer = readFileSync("spikes/interiors/viewer.ts", "utf8");
	expect(viewer).toContain('from "../../src/interior-kit"');
	expect(viewer).toContain("buildInteriorKit(");
	expect(viewer).not.toContain("function material(");
	expect(viewer).not.toContain("const panelWall =");
	expect(viewer).not.toContain("const octagon =");
});

test("shared themed material preserves paint and scales bump depth with local units", () => {
	const source = new THREE.MeshStandardMaterial({ map: new THREE.Texture() });
	source.name = "paint-review";
	const metres = interiorMaterial(source, "works", 1);
	const km = interiorMaterial(source, "works");
	expect(metres).not.toBe(km);
	expect(metres.map).toBe(source.map);
	expect(km.map).toBe(source.map);
	expect(km.color.equals(metres.color)).toBe(true);
	expect(km.bumpScale).toBeCloseTo(metres.bumpScale * 0.001, 10);
	const lamp = new THREE.MeshStandardMaterial();
	lamp.name = "neutral-light";
	expect(interiorMaterial(lamp, "works", 1).emissiveIntensity).toBe(
		EMISSIVE_CEILING,
	);
	expect(interiorMaterial(lamp, "works").emissiveIntensity).toBe(
		EMISSIVE_CEILING,
	);
});
