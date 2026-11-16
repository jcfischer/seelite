import { mkdir } from "node:fs/promises";
import { gameUrl } from "./lib/game-url.mjs";
import { stopLoop } from "./lib/view-placement.mjs";
import {
	bootedGame,
	guardedOrigin,
	launchChromium,
	tally,
} from "./probe-guard.mjs";

const origin = await guardedOrigin(
	process.env.PROBE_ORIGIN ?? process.argv[2] ?? "http://localhost:5173",
);
const browser = await launchChromium();
const { check, watch, exit } = tally();
const shots = process.env.LASER_ORIGIN_SHOTS ?? "/tmp/seelite-laser-origin";
await mkdir(shots, { recursive: true });
try {
	for (const [hull, mining] of [
		["miner", undefined],
		["interceptor", undefined],
		["miner", "1"],
	]) {
		const page = await browser.newPage({
			viewport: { width: 1280, height: 800 },
		});
		watch(page);
		await page.goto(
			gameUrl(origin, { seed: 47, hull, mining, "no-save": "", raider: "off" }),
		);
		await bootedGame(page, 90000);
		await stopLoop(page);
		const setup = await page.evaluate(async () => {
			const g = window.__seelite;
			const { HULL_SPECS } = await import("/src/hull.ts");
			const { makeModule } = await import("/src/loadout.ts");
			const { shipMuzzlesKm } = await import("/src/ship-mesh.ts");
			const { fullCondition } = await import("/src/ship-condition.ts");
			const { PLAYER_BEAM_RGB, BEAM_VERTICES_PER_STROKE } = await import(
				"/src/beam-glass.ts"
			);
			const { NEAR_KM } = await import("/src/chase-view.ts");
			const { PLAYER_LASER_RANGE_KM } = await import("/src/laser.ts");

			function fireGroup(group, view) {
				g.armedFireGroup.reset();
				for (let n = 0; n < group; n++) g.armedFireGroup.cycle(g.fireGroups);
				g.view = view;
				g.setHeadLook("forward");
				g.condition = fullCondition(g.flownHull);
				g.keys.add(" ");
				g.step(g.units.MAX_DT);
				g.render(0);
				g.keys.delete(" ");

				return g.armedFireGroup.current(g.fireGroups);
			}
			function expectedBeams() {
				const armed = g.armedFireGroup.current(g.fireGroups);
				const keys = HULL_SPECS[g.flownHull].slots
					.filter((s) => s.kind === "hardpoint")
					.map((s) => s.key);
				const mounts = shipMuzzlesKm(
					g.flownHull,
					HULL_SPECS[g.flownHull].variant,
				);
				const V = g.nearCamera.position.constructor;
				const eye = g.cameraPos();
				const inverse = g.cameraRotation().clone().invert();
				const aim = g.beamAim();
				const frame = (p) => {
					const ndc = p.clone().applyMatrix4(g.nearCamera.projectionMatrix);
					return { x: (ndc.x + 1) / 2, y: (1 - ndc.y) / 2 };
				};
				return keys.flatMap((slot, index) => {
					if (!armed.slots.includes(slot)) return [];
					const m = mounts[index];
					const mount = new V(m.x, m.y, m.z)
						.applyQuaternion(g.orientation)
						.add(g.world.ship.pos);
					const from = mount.clone().sub(eye).applyQuaternion(inverse);
					const to = mount
						.clone()
						.addScaledVector(aim, PLAYER_LASER_RANGE_KM)
						.sub(eye)
						.applyQuaternion(inverse);
					if (-from.z < NEAR_KM)
						from.lerp(to, (NEAR_KM + from.z) / (from.z - to.z));
					return [{ slot, index, mount, from: frame(from), to: frame(to) }];
				});
			}
			function drawnBeams(view) {
				return view === "cockpit"
					? g.cockpitStrokes
							.filter((s) => s.rgb.every((v, i) => v === PLAYER_BEAM_RGB[i]))
							.map(({ from, to }) => ({ from, to }))
					: (g.beamRender ?? []).map(({ from, to }) => ({
							from: {
								x: from.x / g.overlay.width,
								y: from.y / g.overlay.height,
							},
							to: {
								x: to.x / g.overlay.width,
								y: to.y / g.overlay.height,
							},
						}));
			}
			window.__laserOriginProbe = {
				fireGroup,
				expectedBeams,
				drawnBeams,
				verticesPerStroke: BEAM_VERTICES_PER_STROKE,
			};

			const loadout = { ...g.commander.loadout };
			for (const slot of HULL_SPECS[g.flownHull].slots)
				if (slot.kind === "hardpoint")
					loadout[slot.key] = makeModule("pulse-laser", 1);
			g.commander = { ...g.commander, loadout };
			g.armedFireGroup.reset();
			return {
				hull: g.flownHull,
				groups: g.fireGroups.filter((group) => group.kind === "lasers").length,
			};
		});
		check(
			`boots the requested ${hull} with multiple fitted mounts`,
			setup.hull === hull && setup.groups > 1,
			JSON.stringify(setup),
		);
		for (let group = 0; group < setup.groups; group++) {
			for (const view of ["cockpit", "chase"]) {
				const row = await page.evaluate(
					({ group, view }) => {
						const g = window.__seelite;
						const probe = window.__laserOriginProbe;
						const armed = probe.fireGroup(group, view);
						return {
							view,
							label: armed.label,
							fired: g.firedMuzzleIndices,
							expected: probe.expectedBeams(),
							actual: probe.drawnBeams(view),
							vertices: g.beamLayer.vertexCount,
							verticesPerStroke: probe.verticesPerStroke,
						};
					},
					{ group, view },
				);
				const same = (a, b) =>
					["x", "y"].every(
						(axis) =>
							Number.isFinite(a?.[axis]) &&
							Math.abs(a[axis] - b[axis]) / Math.max(1, Math.abs(b[axis])) <
								1e-6,
					);
				const matches =
					row.actual.length === row.expected.length &&
					row.expected.every(
						(beam, i) =>
							row.fired[i] === beam.index &&
							same(row.actual[i]?.from, beam.from) &&
							same(row.actual[i]?.to, beam.to),
					);
				check(
					`${hull} mining=${mining ?? "absent"} ${view} ${row.label}: every beam starts at its selected mount`,
					matches,
					JSON.stringify(row),
				);
				check(
					`${view}: beam reaches the drawing layer`,
					view === "cockpit"
						? row.vertices === row.actual.length * row.verticesPerStroke &&
								row.vertices > 0
						: row.vertices === 0 && row.actual.length > 0,
					JSON.stringify({ vertices: row.vertices, beams: row.actual.length }),
				);
				console.log(JSON.stringify({ hull, mining, ...row }));
				await page.screenshot({
					path: `${shots}/${hull}-${mining ?? "plain"}-${group}-${view}.png`,
				});
			}
		}
		await page.close();
	}
} finally {
	await browser.close();
}
exit();
