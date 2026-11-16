import { describe, expect, test } from "bun:test";
import type * as THREE from "three";
import {
	type CompilingRenderer,
	compileWhenReady,
} from "../src/compile-when-ready";

const material = (name: string) => ({ name }) as unknown as THREE.Material;
const nothing = {} as THREE.Object3D;
const camera = {} as THREE.Camera;

function fakeRenderer(materials: THREE.Material[]) {
	const programs = new Map<THREE.Material, { ready: boolean }>();
	for (const m of materials) programs.set(m, { ready: false });
	const renderer: CompilingRenderer = {
		compile: () => new Set(materials),
		properties: {
			get: (m) => {
				const p = programs.get(m);
				return p ? { currentProgram: { isReady: () => p.ready } } : {};
			},
		},
	};
	return {
		renderer,
		ready: (m: THREE.Material) => {
			const p = programs.get(m);
			if (p) p.ready = true;
		},
		dispose: (m: THREE.Material) => programs.delete(m),
	};
}

describe("compileWhenReady", () => {
	test("waits until every compiled program is ready", async () => {
		const a = material("a");
		const fake = fakeRenderer([a]);
		let done = false;
		const compiled = compileWhenReady(fake.renderer, nothing, camera).then(
			() => {
				done = true;
			},
		);
		await new Promise((r) => setTimeout(r, 30));
		expect(done).toBe(false);
		fake.ready(a);
		await compiled;
		expect(done).toBe(true);
	});

	test("a compiled material disposed before its program is read counts as ready", async () => {
		const a = material("a");
		const b = material("b");
		const fake = fakeRenderer([a, b]);
		fake.dispose(a);
		fake.ready(b);
		const compiled = compileWhenReady(fake.renderer, nothing, camera);
		await expect(compiled).resolves.toBeUndefined();
	});
});
