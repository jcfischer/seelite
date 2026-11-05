import type * as THREE from "three";

/** The two renderer members `compileWhenReady` reads. */
export interface CompilingRenderer {
	compile(
		object: THREE.Object3D,
		camera: THREE.Camera,
		scene?: THREE.Object3D | null,
	): Set<THREE.Material>;
	properties: { get(material: THREE.Material): unknown };
}

const POLL_MS = 10;

/**
 * `WebGLRenderer.compileAsync`, minus its throw on a material disposed mid-wait.
 *
 * Three r170's poll calls `currentProgram.isReady()` on every material it
 * compiled. A jump that disposes a station while the poll waits leaves that
 * material with no program, and the poll throws an uncaught page error from a
 * timer. A disposed material has nothing left to wait for, so it counts as ready.
 */
export function compileWhenReady(
	renderer: CompilingRenderer,
	object: THREE.Object3D,
	camera: THREE.Camera,
	scene?: THREE.Object3D | null,
): Promise<void> {
	const pending = renderer.compile(object, camera, scene);
	return new Promise((resolve) => {
		const poll = () => {
			for (const material of pending) {
				const { currentProgram: program } = renderer.properties.get(
					material,
				) as {
					currentProgram?: { isReady(): boolean };
				};
				if (program === undefined || program.isReady())
					pending.delete(material);
			}
			if (pending.size === 0) resolve();
			else setTimeout(poll, POLL_MS);
		};
		poll();
	});
}
