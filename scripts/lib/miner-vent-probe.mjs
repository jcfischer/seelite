import { holdVentState } from "./vent-state.mjs";

export async function probeMinerVents(page, { check, label }) {
	const state = await page.evaluate(holdVentState, {
		overCap: 0,
		spin: 2.5,
		steps: 6,
	});
	check(
		`${label}: the miner drives and turns through its own step`,
		state.hull === "miner" && state.lit.includes("main") && state.cue?.angular,
		JSON.stringify(state),
	);
	const pixels = await page.evaluate(async () => {
		const { PLUME_PARTICLES } = await import("/src/vent-plumes.ts");
		const g = window.__seelite;
		g.view = "chase";
		g.chaseYaw = 0.9;
		const firing = { ...g.ventFiring };
		const bells = [];
		g.shipMesh.traverse((o) => {
			if (o.isMesh && o.name.endsWith("-exhaust")) bells.push(o);
		});
		const scratch = document.createElement("canvas");
		const ctx = scratch.getContext("2d", { willReadFrequently: true });
		const src = g.renderer.domElement;
		scratch.width = src.width;
		scratch.height = src.height;
		const frame = (table, glow = true) => {
			g.ventFiring = table;
			for (const bell of bells) bell.visible = glow;
			g.render(0);
			ctx.drawImage(src, 0, 0);
			return ctx.getImageData(0, 0, src.width, src.height).data;
		};
		const quiet = frame({});
		const dark = frame({}, false);
		const drive = frame({ main: firing.main });
		const attitude = frame(
			Object.fromEntries(
				Object.entries(firing).filter(
					([slot]) =>
						slot !== "main" &&
						g.ventPlumes.throats.some(
							(t) =>
								t.slot === slot && ["pitch", "yaw", "roll"].includes(t.family),
						),
				),
			),
		);
		const riseNear = (lit, unlit, at) => {
			const p = at.clone().project(g.nearCamera);
			let most = 0;
			const x = Math.round((p.x * 0.5 + 0.5) * src.width);
			const y = Math.round((0.5 - p.y * 0.5) * src.height);
			for (let dy = -6; dy <= 6; dy++) {
				for (let dx = -6; dx <= 6; dx++) {
					const px = x + dx;
					const py = y + dy;
					if (px < 0 || py < 0 || px >= src.width || py >= src.height) continue;
					const k = 4 * (py * src.width + px);
					most = Math.max(
						most,
						0.2126 * (lit[k] - unlit[k]) +
							0.7152 * (lit[k + 1] - unlit[k + 1]) +
							0.0722 * (lit[k + 2] - unlit[k + 2]),
					);
				}
			}
			return most;
		};
		const bellPixels = bells.map((bell) => {
			bell.geometry.computeBoundingBox();
			const at = bell.geometry.boundingBox
				.getCenter(bell.position.clone())
				.applyMatrix4(bell.matrixWorld);
			return {
				name: bell.name,
				glow: riseNear(quiet, dark, at),
				plume: riseNear(drive, quiet, at),
			};
		});
		const vents = g.ventPlumes.throats
			.filter(
				(t) =>
					["pitch", "yaw", "roll"].includes(t.family) && firing[t.slot] > 0,
			)
			.map((t) => ({
				slot: t.slot,
				rise: riseNear(
					attitude,
					quiet,
					t.at.clone().applyMatrix4(g.ventPlumes.object.matrixWorld),
				),
			}));
		const positions = g.ventPlumes.object.geometry.getAttribute("position");
		let particleRise = 0;
		g.ventPlumes.throats.forEach((throat, n) => {
			if (
				!["pitch", "yaw", "roll"].includes(throat.family) ||
				!firing[throat.slot]
			)
				return;
			for (let i = 1; i <= PLUME_PARTICLES; i++) {
				const at = throat.at
					.clone()
					.fromBufferAttribute(positions, n * (PLUME_PARTICLES + 1) + i);
				if (at.distanceTo(throat.at) < throat.reachKm * 0.3) continue;
				particleRise = Math.max(
					particleRise,
					riseNear(
						attitude,
						quiet,
						at.applyMatrix4(g.ventPlumes.object.matrixWorld),
					),
				);
			}
		});
		g.ventFiring = firing;
		g.render(0);
		return {
			bells: bellPixels,
			vents,
			particleRise,
		};
	});
	check(
		`${label}: the miner drive glows paint their nozzle pixels`,
		pixels.bells.length > 0 && pixels.bells.every((b) => b.glow > 1),
		JSON.stringify(pixels.bells),
	);
	check(
		`${label}: throttle paints a plume at every drive nozzle`,
		pixels.bells.length > 0 && pixels.bells.every((b) => b.plume >= 24),
		JSON.stringify(pixels.bells),
	);
	check(
		`${label}: firing attitude vents paint particles at their throats`,
		pixels.particleRise >= 24 && pixels.vents.some((v) => v.rise >= 24),
		JSON.stringify(pixels),
	);
}
