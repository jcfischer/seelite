/** Compare actual face pixels with the complete reading and a source-omitted control. */
export async function installCockpitTextProbe(page) {
	await page.evaluate(async () => {
		const { paintCockpitText } = await import("/src/cockpit-text.ts");
		const { Raycaster, Vector3 } = await import(
			"/node_modules/three/build/three.module.js"
		);
		window.__cockpitNoReadoutsOnGlass = () => {
			const game = window.__seelite;
			const ctx = game.overlayCtx;
			const fillText = ctx.fillText;
			const drawn = [];
			const forbidden = new Set(["MODE", "THR", "ASSIST", "CHARGE"]);
			for (const lines of game.cockpit.text.readings.values())
				for (const line of lines) forbidden.add(line.text);
			ctx.fillText = function (text, ...args) {
				drawn.push(String(text));
				return fillText.call(this, text, ...args);
			};
			try {
				game.render(0);
			} finally {
				ctx.fillText = fillText;
			}
			return drawn.length > 0 && drawn.every((text) => !forbidden.has(text));
		};
		window.__cockpitSurfaceObstruction = {};
		window.__cockpitSurfaceVisible = (source) => {
			window.__cockpitSurfaceObstruction[source] = "";
			const game = window.__seelite;
			const face =
				game.cockpit.text.faces.get(source) ??
				game.cockpit.text.faces.get("fallback");
			const instrumentName = {
				flight: "flight-instrument",
				target: "target-instrument",
				radar: "scanner",
			}[source];
			const mesh = instrumentName
				? game.cabinScene.getObjectByName(instrumentName)
				: face?.mount.children.find((child) => child.isMesh);
			if (!mesh) return false;
			mesh.updateWorldMatrix(true, false);
			game.cabinCamera.updateMatrixWorld(true);
			const origin = game.cabinCamera.getWorldPosition(new Vector3());
			const position = mesh.geometry.getAttribute("position");
			const ray = new Raycaster();
			const points = [new Vector3()];
			for (let i = 0; i < position.count; i++)
				points.push(
					new Vector3().fromBufferAttribute(position, i).multiplyScalar(0.9),
				);
			return points.every((point) => {
				point.applyMatrix4(mesh.matrixWorld);
				const projected = point.clone().project(game.cabinCamera);
				if (
					Math.abs(projected.x) > 1 ||
					Math.abs(projected.y) > 1 ||
					projected.z > 1
				)
					return false;
				ray.set(origin, point.clone().sub(origin).normalize());
				ray.far = point.distanceTo(origin) + 0.00001;
				const first = ray
					.intersectObjects(game.cabinScene.children, true)
					.find((hit) => {
						if (!hit.object.isMesh) return false;
						const materials = Array.isArray(hit.object.material)
							? hit.object.material
							: [hit.object.material];
						if (
							!materials.some(
								(material) =>
									material.depthTest !== false &&
									(!material.transparent || material.opacity >= 0.99),
							)
						)
							return false;
						for (let object = hit.object; object; object = object.parent)
							if (!object.visible) return false;
						return true;
					});
				if (first?.object !== mesh)
					window.__cockpitSurfaceObstruction[source] =
						first?.object.name ?? "no hit";
				return first?.object === mesh;
			});
		};
		window.__cockpitSourcePainted = (source) => {
			const text = window.__seelite.cockpit.text;
			const face = text.faces.get(source) ?? text.faces.get("fallback");
			if (!face || !text.readings.get(source)?.some((line) => line.text))
				return false;
			const { width, height } = face.ctx.canvas;
			const lines = [];
			const without = [];
			for (const [name, reading] of text.readings) {
				if (face !== (text.faces.get(name) ?? text.faces.get("fallback")))
					continue;
				lines.push(...reading);
				if (name !== source) without.push(...reading);
			}
			const actual = face.ctx.getImageData(0, 0, width, height).data;
			const compare = (willReadFrequently) => {
				const expected = document.createElement("canvas");
				expected.width = width;
				expected.height = height;
				const ctx = expected.getContext("2d", { willReadFrequently });
				const pixels = () => ctx.getImageData(0, 0, width, height).data;
				paintCockpitText(ctx, lines);
				const wanted = pixels();
				paintCockpitText(ctx, without);
				const control = pixels();
				let ink = 0;
				let mismatched = 0;
				for (let i = 0; i < actual.length; i += 4) {
					if (
						Math.max(
							Math.abs(wanted[i] - control[i]),
							Math.abs(wanted[i + 1] - control[i + 1]),
							Math.abs(wanted[i + 2] - control[i + 2]),
						) > 8
					)
						ink++;
					if (
						Math.max(
							Math.abs(wanted[i] - actual[i]),
							Math.abs(wanted[i + 1] - actual[i + 1]),
							Math.abs(wanted[i + 2] - actual[i + 2]),
						) > 2
					)
						mismatched++;
				}
				return ink > 10 && mismatched === 0;
			};
			return compare(false) || compare(true);
		};
		window.__cockpitRefusalRed = (source) => {
			const text = window.__seelite.cockpit.text;
			const face = text.faces.get(source) ?? text.faces.get("fallback");
			if (!face) return null;
			const { width, height } = face.ctx.canvas;
			const data = face.ctx.getImageData(0, 0, width, height).data;
			let red = 0;
			for (let i = 0; i < data.length; i += 4)
				if (
					data[i] > 120 &&
					data[i + 1] < 0.6 * data[i] &&
					data[i + 2] < 0.6 * data[i]
				)
					red++;
			return red;
		};
	});
}
