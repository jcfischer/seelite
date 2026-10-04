/** Render node #213's actual bake shader into linear float targets. No light,
 * tone mapping or relief shading enters the albedo variance measurement.
 * Every cube face contributes its face-on lit patch (cosine > 0.65); the
 * parent shader is a frozen control, with identical seed, warmth and sampling.
 * Called inside the page by probe-planet-surfaces, not a standalone probe.
 */
export async function airlessAlbedoReadings(game) {
	const THREE = await import("/node_modules/three/build/three.module.js");
	const shaders = await import("/src/planet-shaders.ts");
	const { AIRLESS } = await import("/src/planet-classes.glsl.ts");
	const { AIRLESS: before } = await import(
		"/scripts/lib/fixtures/airless-before-213.ts"
	);
	const { albedoContrastReading } = await import(
		"/scripts/lib/airless-contrast.mjs"
	);
	const { airlessFeatures, applyAirlessFeatures, smallCrater } = await import(
		"/src/airless-features.ts"
	);
	const { planetSeedOffset } = await import("/src/planet-appearance.ts");
	const { raySourceFragment } = await import(
		"/scripts/lib/airless-ray-source.mjs"
	);
	const { cubeFaceBasis } = await import("/src/planet-bake.ts");
	const sourceUniforms = [...game.bodyVisuals.values()].find(
		(v) => v.surface === "airless",
	)?.uniforms;
	if (!sourceUniforms)
		throw new Error("airless measurement has no live airless body");
	const px = 160;
	const target = new THREE.WebGLRenderTarget(px, px, { type: THREE.FloatType });
	const rayTarget = new THREE.WebGLRenderTarget(1, 1, {
		type: THREE.FloatType,
	});
	const scene = new THREE.Scene();
	const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
	camera.position.z = 1;
	const geometry = new THREE.PlaneGeometry(2, 2);
	const u = {
		...sourceUniforms,
		seedOffset: { value: 0 },
		warmth: { value: 0 },
		craterSlow: { value: 0 },
		perfAblate: { value: 0 },
		basinCount: { value: 0 },
		basins: { value: Array.from({ length: 4 }, () => new THREE.Vector4()) },
		rayCount: { value: 0 },
		rayCells: { value: Array.from({ length: 3 }, () => new THREE.Vector3()) },
		rayCell: { value: new THREE.Vector3() },
		faceBasis: { value: new THREE.Matrix3() },
	};
	const makeMaterial = (channel, old = false, brighter = false) => {
		let fragmentShader = shaders.bakeFragmentFor("airless", channel);
		if (old) {
			if (!fragmentShader.includes(AIRLESS))
				throw new Error("airless baseline splice missed");
			fragmentShader = fragmentShader.replace(AIRLESS, before);
			if (brighter) {
				const highland = "vec3 highland = vec3(0.235, 0.225, 0.210)";
				if (!fragmentShader.includes(highland))
					throw new Error("airless brightness control splice missed");
				fragmentShader = fragmentShader.replace(
					highland,
					"vec3 highland = vec3(0.400, 0.385, 0.360)",
				);
			}
		}
		return new THREE.ShaderMaterial({
			vertexShader: shaders.BAKE_VERTEX,
			fragmentShader,
			uniforms: u,
		});
	};
	const current = makeMaterial("albedo"),
		baseline = makeMaterial("albedo", true),
		brightnessOnly = makeMaterial("albedo", true, true),
		normal = makeMaterial("normal");
	const rayMaterials = {};
	for (const mode of ["ray", "walk", "eligibility"]) {
		const fragment = raySourceFragment(
			current.fragmentShader,
			shaders.CRATER_CELL,
			mode,
		);
		const marker = "return vec4(centre, radius);";
		if (!fragment.includes(marker))
			throw new Error("ray-source mutation splice missed");
		for (const mutated of [false, true]) {
			rayMaterials[`${mode}${mutated ? "Mutated" : ""}`] =
				new THREE.ShaderMaterial({
					vertexShader: shaders.BAKE_VERTEX,
					fragmentShader: mutated
						? fragment.replace(
								marker,
								"return vec4(centre + vec3(0.02, 0.0, 0.0), radius);",
							)
						: fragment,
					uniforms: u,
				});
		}
	}
	const mesh = new THREE.Mesh(geometry, current);
	scene.add(mesh);
	const renderer = game.renderer;
	const oldTarget = renderer.getRenderTarget();
	const oldClear = renderer.getClearColor(new THREE.Color());
	const oldAlpha = renderer.getClearAlpha(),
		oldAuto = renderer.autoClear;
	const read = (material, basis) => {
		mesh.material = material;
		u.faceBasis.value.copy(basis);
		renderer.setRenderTarget(target);
		renderer.render(scene, camera);
		const data = new Float32Array(px * px * 4);
		renderer.readRenderTargetPixels(target, 0, 0, px, px, data);
		return data;
	};
	const luma = (a, i) => a[i] * 0.2126 + a[i + 1] * 0.7152 + a[i + 2] * 0.0722;
	const measureRaySources = (features) => {
		const readSource = (key) => {
			mesh.material = rayMaterials[key];
			renderer.setRenderTarget(rayTarget);
			renderer.render(scene, camera);
			const data = new Float32Array(4);
			renderer.readRenderTargetPixels(rayTarget, 0, 0, 1, 1, data);
			return Array.from(data);
		};
		return features.rayCells.map((cell) => {
			u.rayCell.value.fromArray(cell);
			const cpu = smallCrater(cell, u.seedOffset.value);
			const reading = (suffix) => ({
				cpu,
				ray: readSource(`ray${suffix}`),
				walk: readSource(`walk${suffix}`),
				eligibility: readSource(`eligibility${suffix}`),
			});
			return { cell, ...reading(""), mutated: reading("Mutated") };
		});
	};
	const variance = (a) => {
		const mean = a.reduce((s, v) => s + v, 0) / a.length;
		return a.reduce((s, v) => s + (v - mean) ** 2, 0) / a.length;
	};
	const rows = [];
	try {
		renderer.autoClear = true;
		renderer.setClearColor(0, 0);
		// 0/1 supply the two/three-basin buckets; 47/48 exercise seed movement,
		// and 1 also supplies three ray sources. The corpus covers all counts.
		for (const seed of [47, 48, 179, 0, 1]) {
			const features = airlessFeatures(seed);
			u.seedOffset.value = planetSeedOffset(seed);
			applyAirlessFeatures(u, features);
			const raySources = measureRaySources(features);
			const a = [],
				b = [],
				featureOff = [],
				brightOnly = [],
				brightOnlyOff = [],
				featureOffRepeat = [];
			let nearLuma = 0,
				farLuma = 0;
			let rayPixels = 0,
				rayNormalDelta = 0;
			for (let face = 0; face < 6; face++) {
				const basis = cubeFaceBasis(face);
				const after = read(current, basis),
					beforePixels = read(baseline, basis);
				const brighterPixels = read(brightnessOnly, basis);
				const withRayNormal = read(normal, basis);
				u.rayCount.value = 0;
				const withoutRays = read(current, basis),
					withoutRayNormal = read(normal, basis);
				u.basinCount.value = 0;
				const withoutFeatures = read(current, basis);
				// Render the ablated arm of each negative control, just as for
				// current. No feature ratio is supplied by the instrument.
				const brighterWithoutFeatures = read(brightnessOnly, basis);
				const withoutFeaturesRepeat = read(current, basis);
				u.warmth.value = 7;
				const coldHighlands = read(current, basis);
				u.warmth.value = 0;
				u.basinCount.value = features.basins.length;
				u.rayCount.value = features.rayCells.length;
				for (let y = 0; y < px; y++)
					for (let x = 0; x < px; x++) {
						const cos =
							1 /
							Math.hypot(((x + 0.5) / px) * 2 - 1, ((y + 0.5) / px) * 2 - 1, 1);
						const i = (y * px + x) * 4;
						if (cos > 0.65) {
							a.push(luma(after, i));
							b.push(luma(beforePixels, i));
							featureOff.push(luma(withoutFeatures, i));
							brightOnly.push(luma(brighterPixels, i));
							brightOnlyOff.push(luma(brighterWithoutFeatures, i));
							featureOffRepeat.push(luma(withoutFeaturesRepeat, i));
							nearLuma += luma(withoutFeatures, i);
							farLuma += luma(coldHighlands, i);
						}
						if (luma(after, i) - luma(withoutRays, i) > 0.015) rayPixels++;
						for (let j = 0; j < 3; j++)
							rayNormalDelta = Math.max(
								rayNormalDelta,
								Math.abs(withRayNormal[i + j] - withoutRayNormal[i + j]),
							);
					}
			}
			// Sample an actual basin's floor head-on: a narrow patch with the
			// camera's forward along its centre, using the bake's own direction map.
			const c = new THREE.Vector3().fromArray(features.basins[0]);
			const t = new THREE.Vector3()
				.crossVectors(
					Math.abs(c.y) < 0.94
						? new THREE.Vector3(0, 1, 0)
						: new THREE.Vector3(1, 0, 0),
					c,
				)
				.normalize();
			const up = new THREE.Vector3().crossVectors(c, t);
			const basis = new THREE.Matrix3().set(
				t.x,
				up.x,
				c.x,
				t.y,
				up.y,
				c.y,
				t.z,
				up.z,
				c.z,
			);
			const floor = read(current, basis),
				floorNormal = read(normal, basis);
			u.basinCount.value = 0;
			const control = read(current, basis),
				controlNormal = read(normal, basis);
			u.basinCount.value = features.basins.length;
			let floorLuma = 0,
				highlandLuma = 0,
				floorTilt = 0,
				craterTilt = 0,
				n = 0;
			for (let y = px / 2 - 3; y < px / 2 + 3; y++)
				for (let x = px / 2 - 3; x < px / 2 + 3; x++) {
					const i = (y * px + x) * 4;
					const p = new THREE.Vector3(
						((x + 0.5) / px) * 2 - 1,
						((y + 0.5) / px) * 2 - 1,
						1,
					)
						.applyMatrix3(basis)
						.normalize();
					const tilt = (data) =>
						new THREE.Vector3(
							data[i] * 2 - 1,
							data[i + 1] * 2 - 1,
							data[i + 2] * 2 - 1,
						).distanceTo(p);
					floorLuma += luma(floor, i);
					highlandLuma += luma(control, i);
					floorTilt += tilt(floorNormal);
					craterTilt += tilt(controlNormal);
					n++;
				}
			const comparison = albedoContrastReading(b, a, featureOff);
			const brightnessControl = albedoContrastReading(
				b,
				brightOnly,
				brightOnlyOff,
			);
			const featureOffControl = albedoContrastReading(
				b,
				featureOff,
				featureOffRepeat,
			);
			rows.push({
				seed,
				samples: a.length,
				beforeVariance: variance(b),
				afterVariance: variance(a),
				...comparison,
				controls: [brightnessControl, featureOffControl],
				nearFarRatio: nearLuma / farLuma,
				rayPixels,
				rayNormalDelta,
				raySources,
				floorRatio: floorLuma / highlandLuma,
				floorTilt: floorTilt / n,
				craterTilt: craterTilt / n,
				basins: features.basins,
				rays: features.rayCells.map((cell) =>
					smallCrater(cell, planetSeedOffset(seed)),
				),
			});
		}
		return rows;
	} finally {
		renderer.setRenderTarget(oldTarget);
		renderer.setClearColor(oldClear, oldAlpha);
		renderer.autoClear = oldAuto;
		for (const material of [
			current,
			baseline,
			brightnessOnly,
			normal,
			...Object.values(rayMaterials),
		])
			material.dispose();
		geometry.dispose();
		target.dispose();
		rayTarget.dispose();
	}
}
