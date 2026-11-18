/** Both Longwall side arms contribute pixels at their projected positions from either seat. */
export async function cockpitArmPixels(page, seat) {
	return page.evaluate(async (seat) => {
		const { cockpitSeenParts } = await import(
			"/src/cockpit-occlusion-table.ts"
		);
		const g = window.__seelite;
		g.setMinerSeat(seat);
		g.render(0);
		const canvas = g.renderer.domElement;
		const gl = g.renderer.getContext();
		const read = () => {
			g.render(0);
			const pixels = new Uint8Array(canvas.width * canvas.height * 4);
			gl.readPixels(
				0,
				0,
				canvas.width,
				canvas.height,
				gl.RGBA,
				gl.UNSIGNED_BYTE,
				pixels,
			);
			return pixels;
		};
		const seen = cockpitSeenParts(g.drill.extension, g.cabinId, seat);
		const camera = g.nearCamera;
		camera.updateMatrixWorld(true);
		const exterior = g.shipMesh.getObjectByName("longwall-exterior");
		const parts = exterior.children[0].children;
		const arms = [];
		for (const arm of [0, 1]) {
			const sections = parts.filter((p) => p.name.startsWith(`anchor-${arm}-`));
			const meshes = [];
			const points = [];
			for (const section of sections.filter((p) =>
				/-(elbow|lower)$/.test(p.name),
			))
				section.traverse((mesh) => {
					if (!mesh.isMesh) return;
					meshes.push(mesh);
					const pos = mesh.geometry.getAttribute("position");
					const V = mesh.position.constructor;
					for (let n = 0; n < pos.count; n++) {
						const q = new V()
							.fromBufferAttribute(pos, n)
							.applyMatrix4(mesh.matrixWorld);
						if (q.clone().applyMatrix4(camera.matrixWorldInverse).z >= 0)
							continue;
						q.project(camera);
						points.push([
							(q.x * 0.5 + 0.5) * canvas.width,
							(q.y * 0.5 + 0.5) * canvas.height,
						]);
					}
				});
			const box = {
				x0: Math.max(0, Math.floor(Math.min(...points.map((p) => p[0])))),
				x1: Math.min(
					canvas.width,
					Math.ceil(Math.max(...points.map((p) => p[0]))),
				),
				y0: Math.max(0, Math.floor(Math.min(...points.map((p) => p[1])))),
				y1: Math.min(
					canvas.height,
					Math.ceil(Math.max(...points.map((p) => p[1]))),
				),
			};
			const before = read();
			const layers = meshes.map((m) => m.layers.mask);
			let hidden;
			try {
				for (const mesh of meshes) mesh.layers.mask = 0;
				hidden = read();
			} finally {
				meshes.forEach((mesh, n) => {
					mesh.layers.mask = layers[n];
				});
			}
			const restored = read();
			const visibility = sections.map((part) =>
				Object.getOwnPropertyDescriptor(part, "visible"),
			);
			let unculled;
			try {
				for (const part of sections)
					Object.defineProperty(part, "visible", {
						get: () => true,
						set: () => {},
						configurable: true,
					});
				unculled = read();
			} finally {
				sections.forEach((part, n) =>
					Object.defineProperty(part, "visible", visibility[n]),
				);
				g.render(0);
			}
			let changed = 0;
			let unstable = 0;
			let missing = 0;
			for (let y = box.y0; y < box.y1; y++)
				for (let x = box.x0; x < box.x1; x++) {
					const i = (y * canvas.width + x) * 4;
					const delta = Math.max(
						...[0, 1, 2].map((c) => Math.abs(before[i + c] - hidden[i + c])),
					);
					const noise = Math.max(
						...[0, 1, 2].map((c) => Math.abs(before[i + c] - restored[i + c])),
					);
					if (delta > 12 && noise <= 2) changed++;
					if (noise > 2) unstable++;
					if (
						noise <= 2 &&
						[0, 1, 2].some(
							(c) => Math.abs(before[i + c] - unculled[i + c]) > 12,
						)
					)
						missing++;
				}
			arms.push({
				arm,
				box,
				changed,
				unstable,
				missing,
				shown: sections.filter((p) => p.visible).map((p) => p.name),
			});
		}
		return { seat, extension: g.drill.extension, seen, arms };
	}, seat);
}
