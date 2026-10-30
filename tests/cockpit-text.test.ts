import { describe, expect, test } from "bun:test";
import * as THREE from "three";
import { CABIN_FAR_KM, CABIN_NEAR_KM } from "../src/cabin-pass";
import { decodeShippedGlb } from "../scripts/lib/shipped-glb";
import { buildAuthoredCabin, cockpitScreenFrames } from "../src/cockpit-model";
import {
	routeCockpitSources,
	textSurfaceSize,
	wrapCockpitText,
} from "../src/cockpit-text";

const fixture = () =>
	decodeShippedGlb("scripts/fixtures/cockpit-text-cabin.glb");

describe("model-owned cockpit text surfaces", () => {
	test("the courier routes live sources while systems stays unpowered", async () => {
		const model = await decodeShippedGlb("src/models/courier-cockpit.glb");
		const screens = cockpitScreenFrames(model);
		const routed = routeCockpitSources(screens, [
			"flight",
			"target",
			"status",
			"ore",
			"notices",
		]);
		for (const source of ["flight", "target", "status", "ore", "notices"])
			expect(routed.get(source)?.kind).toBe("named");
		expect(routed.has("systems")).toBe(false);
	});

	test("a second cabin moves and resizes screens, adds sources and omits flight", async () => {
		const model = await fixture();
		const screens = cockpitScreenFrames(model);
		const routed = routeCockpitSources(screens, [
			"survey",
			"ore",
			"flight",
			"notices",
		]);
		expect(Object.keys(screens).sort()).toEqual([
			"fallback",
			"ore",
			"survey",
			"systems",
		]);
		expect(routed.get("survey")?.frame).toBe(screens.survey);
		expect(screens.survey.widthKm).toBeCloseTo(1.5);
		expect(screens.ore.heightKm).toBeCloseTo(1);
		expect(screens.ore.center.x).toBeCloseTo(1);
		expect(screens.ore.center.y).toBeCloseTo(0.15);
		expect(screens.ore.center.z).toBeCloseTo(-1.925);
		expect(routed.get("flight")?.kind).toBe("fallback");
		expect(routed.get("notices")?.kind).toBe("fallback");
		expect(routed.get("flight")?.frame.center.y).not.toBe(
			routed.get("notices")?.frame.center.y,
		);
		expect(routed.has("systems")).toBe(false);
	});

	test("an empty model gets one physical emergency console, with separate slots", () => {
		const routed = routeCockpitSources({}, ["flight", "status"]);
		for (const surface of routed.values()) {
			expect(surface.kind).toBe("fallback");
			expect(surface.frame.center.y).toBeLessThan(0);
			expect(surface.frame.normal.z).toBeGreaterThan(0);
		}
		expect(routed.size).toBe(2);
	});

	test("the real cabin builder accepts the alternate GLB without any courier screens", async () => {
		const cabin = buildAuthoredCabin(await fixture());
		const routed = routeCockpitSources(cabin.screens, [
			"survey",
			"ore",
			"flight",
		]);
		expect(routed.get("survey")?.kind).toBe("named");
		expect(routed.get("ore")?.kind).toBe("named");
		expect(routed.get("flight")?.kind).toBe("fallback");
		const unpowered = cabin.root.getObjectByName("screen-systems");
		expect(unpowered).toBeInstanceOf(THREE.Mesh);
		if (!(unpowered instanceof THREE.Mesh))
			throw new Error("missing fixture screen");
		expect(unpowered.material).toBeInstanceOf(THREE.MeshBasicMaterial);
		if (!(unpowered.material instanceof THREE.MeshBasicMaterial))
			throw new Error("unexpected screen material");
		expect(unpowered.material.map).toBeNull();
		expect(unpowered.material.color.getHex()).toBe(0x01090b);
		for (const frame of Object.values(cabin.screens))
			for (const x of [-0.5, 0.5])
				for (const y of [-0.5, 0.5]) {
					const corner = frame.center
						.clone()
						.addScaledVector(frame.right, x * frame.widthKm)
						.addScaledVector(frame.up, y * frame.heightKm);
					expect(corner.length()).toBeLessThan(CABIN_FAR_KM);
					expect(corner.length()).toBeGreaterThan(CABIN_NEAR_KM);
				}
	});

	test("portrait wrapping preserves every word and keeps ordinary words within the face width", () => {
		const text = "ORE 12 T ABOARD · 3 FRAGMENTS · HOLD 16/40 T";
		const lines = wrapCockpitText(text, 16, (line) => line.length);
		expect(lines.length).toBeGreaterThan(1);
		expect(lines.join(" ")).toBe(text);
		expect(lines.every((line) => line.length <= 16)).toBe(true);
		expect(wrapCockpitText("UNBREAKABLE", 3, (line) => line.length)).toEqual([
			"UNBREAKABLE",
		]);
	});

	test("raster dimensions follow wide and tall surfaces without stretching", () => {
		for (const [widthKm, heightKm] of [
			[3, 1],
			[1, 2],
			[12, 1],
		]) {
			const size = textSurfaceSize({ widthKm, heightKm });
			expect(size.width / size.height).toBeCloseTo(widthKm / heightKm, 1);
			expect(Math.max(size.width, size.height)).toBe(1024);
		}
	});

	test("ambiguous duplicate source names fail at the model boundary", async () => {
		const model = await fixture();
		model.add(model.children[0].clone());
		expect(() => cockpitScreenFrames(model)).toThrow("duplicate");
	});
});
