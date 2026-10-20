/** Draw a cloud-only cap arm while the ground keeps its quality-selected cap.
 * @template T
 * @param {Iterable<import('../../src/planet-surface.ts').BodyVisual>} visuals
 * @param {number} cap
 * @param {() => T} draw
 * @returns {T}
 */
export function withCloudDetailCap(visuals, cap, draw) {
	const saved = [];
	try {
		for (const visual of visuals) {
			for (const shell of visual.group.children) {
				if (shell.userData.shell !== "cloud") continue;
				const original = shell.material;
				const arm = original.clone();
				saved.push([shell, original, arm]);
				arm.uniforms = {
					...original.uniforms,
					extraOctaveCap: {
						value: visual.surfaceClass() === "terran" ? cap : 0,
					},
				};
				shell.material = arm;
			}
		}
		return draw();
	} finally {
		for (const [shell, original, arm] of saved) {
			shell.material = original;
			arm.dispose();
		}
	}
}
