/**
 * Outpost E — Salvage (#518): the raider outpost's own form, judged against
 * the role's sentence — *welded together from salvage: hull sections, cargo
 * pods and a ship's forward half bolted around the pad; improvised,
 * asymmetric, lit by work lamps*.
 *
 * The sheet and the principal judge whether it reads as that. What this file
 * holds is the half a row can hold: that each named ingredient is built on
 * every plan, that the plan is the assembly seed's and not the berth seed's,
 * that no two plans in the spread are the same, that every plan leans off
 * the axis, and that no lamp on it is red. Reach, islands, corridor and
 * lamp seating are the pool's rows, and reach this form over the seed spread
 * through `SOLVED_FORMS`.
 */

import { describe, expect, test } from "bun:test";
import * as THREE from "three";
import { OUTPOST_FORM } from "../src/station";
import {
	STATION_FORMS,
	WORK_LAMP_COLOR,
	buildStationForm,
} from "../src/station-mesh";
import { ASSEMBLY_SEEDS, isSolvedForm } from "./helpers/solved-forms";

const GREY = 0x9aa6b2;

const build = (assemblySeed: number, berthSeed = 0) =>
	buildStationForm("outpost", "e", GREY, berthSeed, assemblySeed);

/** Every named mesh under the form, with its world box in core radii. */
function parts(root: THREE.Object3D) {
	root.updateMatrixWorld(true);
	const out: { name: string; box: THREE.Box3 }[] = [];
	root.traverse((object) => {
		if (!(object as THREE.Mesh).isMesh || !object.name) return;
		out.push({
			name: object.name,
			box: new THREE.Box3().setFromObject(object),
		});
	});
	return out;
}

/** The salvage's plan as a string: which pieces, and where. */
function plan(root: THREE.Object3D) {
	return parts(root)
		.filter(({ name }) => name.startsWith("salvage-"))
		.map(({ name, box }) => {
			const c = box.getCenter(new THREE.Vector3());
			return `${name}@${c.x.toFixed(3)},${c.y.toFixed(3)},${c.z.toFixed(3)}`;
		})
		.sort()
		.join(" ");
}

describe("outpost E is the choice, on the principal's yes", () => {
	test("it is in the outpost pool at the pool's reach", () => {
		const form = STATION_FORMS.outpost.find((f) => f.id === "e");
		expect(form?.name).toBe("Salvage");
		expect(form?.reachKm).toBe(0.42);
	});

	test("it is measured over the seed spread", () => {
		expect(isSolvedForm("outpost", "e")).toBe(true);
	});

	test("the game builds the outpost as E since the ranking round of 2026-09-24", () => {
		// Not drawn from a pool (node #717): the outpost is the fiction's form.
		expect(OUTPOST_FORM).toBe("e");
	});
});

describe("the role's sentence, piece by piece", () => {
	test("every plan carries a ship's forward half, hull sections and cargo pods", () => {
		for (const seed of ASSEMBLY_SEEDS) {
			const root = build(seed).root;
			const names = parts(root).map(({ name }) => name);
			const count = (prefix: string) =>
				names.filter((n) => n.startsWith(prefix)).length;
			expect([seed, count("salvage-bow")]).toEqual([seed, 1]);
			expect([seed, count("salvage-section") >= 2]).toEqual([seed, true]);
			expect([seed, count("salvage-pod") >= 3]).toEqual([seed, true]);
			// The work lamps by their own warm colour: they share the name
			// `bay-flood` with the pad deck's four floods, which the lamp-seating
			// row keys on, so a count by name would pass a plan with none.
			let workLamps = 0;
			root.traverse((object) => {
				const material = (object as THREE.Mesh).material as
					| THREE.MeshStandardMaterial
					| undefined;
				if (
					object.name === "bay-flood" &&
					material?.emissive?.getHex() === WORK_LAMP_COLOR
				)
					workLamps += 1;
			});
			expect([seed, workLamps >= 6]).toEqual([seed, true]);
		}
	});

	test("the plan is the assembly seed's, and the berth seed does not move it", () => {
		expect(plan(build(7).root)).toBe(plan(build(7).root));
		expect(plan(build(7, 0).root)).toBe(plan(build(7, 99).root));
	});

	test("no two plans in the spread are the same", () => {
		const plans = new Set(ASSEMBLY_SEEDS.map((seed) => plan(build(seed).root)));
		expect(plans.size).toBe(ASSEMBLY_SEEDS.length);
	});

	test("every plan leans off the axis", () => {
		// A lean, not an asymmetry: a pile mirrored about a plane through the
		// axis still leans, and would pass. What the lean buys is that no plan
		// balances round the core, which is what reads as designed.

		// The salvage's own box, not the station's: the pad deck is square
		// and centred, and would mask a lopsided plant under it.
		for (const seed of ASSEMBLY_SEEDS) {
			const box = new THREE.Box3();
			for (const { name, box: b } of parts(build(seed).root))
				if (name.startsWith("salvage-")) box.union(b);
			const offX = Math.abs(box.min.x + box.max.x) / 2;
			const offY = Math.abs(box.min.y + box.max.y) / 2;
			// In core radii: 0.1 is 15 m of lean on a 0.15 km core.
			expect([seed, Math.max(offX, offY) > 0.1]).toEqual([seed, true]);
		}
	});
});

describe("no red lamps — red is refusal (hud-and-scanner.md §4)", () => {
	/**
	 * Red as a person sees it: in sRGB, not in the linear values three keeps.
	 * The pad deck's heat ring is 0xffb347, an orange, and reads 1.00, 0.19,
	 * 0.02 in linear light, which a linear test calls red.
	 */
	const reddish = (colour: THREE.Color) => {
		const c = colour.getRGB({ r: 0, g: 0, b: 0 }, THREE.SRGBColorSpace);
		return c.r > 0.05 && c.r > 2 * c.g && c.r > 2 * c.b;
	};

	test("no emissive surface or glow on any plan is red", () => {
		for (const seed of ASSEMBLY_SEEDS) {
			const red: string[] = [];
			build(seed).root.traverse((object) => {
				const material = (object as THREE.Mesh).material as
					| THREE.Material
					| undefined;
				if (!material) return;
				const standard = material as THREE.MeshStandardMaterial;
				if (standard.emissive && standard.emissiveIntensity > 0)
					if (reddish(standard.emissive)) red.push(`${object.name} emissive`);
				const uniforms = (material as THREE.ShaderMaterial).uniforms;
				const colour = uniforms?.uColor?.value as THREE.Vector3 | undefined;
				if (
					colour &&
					reddish(
						new THREE.Color().setRGB(
							colour.x,
							colour.y,
							colour.z,
							THREE.LinearSRGBColorSpace,
						),
					)
				)
					red.push(`${object.name} glow`);
			});
			expect([seed, red]).toEqual([seed, []]);
		}
	});

	test("the check sees a red lamp when there is one", () => {
		expect(reddish(new THREE.Color(0xff2a1a))).toBe(true);
		expect(reddish(new THREE.Color(0xffd9a0))).toBe(false);
		expect(reddish(new THREE.Color(0xffb347))).toBe(false);
	});
});
