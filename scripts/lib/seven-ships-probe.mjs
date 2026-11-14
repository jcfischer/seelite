import { bootedGame } from "../probe-guard.mjs";
import { gameUrl } from "./game-url.mjs";

export async function probeSevenShips(page, origin, params, { check }) {
	await page.goto(
		gameUrl(origin, { ...params, fleet: 1, "models-full": true }),
	);
	await bootedGame(page, 120000);
	await page.waitForFunction(
		() => window.__seelite.modelsSettled(),
		undefined,
		{ timeout: 120000 },
	);
	const rows = await page.evaluate(async () => {
		const g = window.__seelite;
		const { SEVEN_SHIP_STUDIES, sevenShipLevelNames } = await import(
			"/src/seven-ships-hulls.ts"
		);
		const { HABITAT_ROTOR_NAME } = await import("/src/ship-detail.ts");
		const { slotPhaseRad } = await import("/src/station.ts");
		g.clockHeld = true;
		const roots = Object.keys(SEVEN_SHIP_STUDIES).map((id) => ({
			id,
			mesh: g.fleet.find((p) => p.slot.id === id)?.mesh,
		}));
		const snapshot = (seconds) => {
			g.world.gameTime = seconds;
			g.render(0);
			return roots.map(({ id, mesh }) => {
				const levels = Object.values(sevenShipLevelNames(id)).map((name) =>
					mesh?.getObjectByName(name),
				);
				const rotors = levels.map((level) =>
					level?.getObjectByName(HABITAT_ROTOR_NAME),
				);
				return {
					id,
					authored: mesh?.userData.authored === true,
					levels: levels.every(Boolean),
					visible: levels.filter((level) => level?.visible).length,
					rotors: rotors.filter(Boolean).length,
					phases: rotors.filter(Boolean).map((rotor) => rotor.rotation.z),
					expected: slotPhaseRad(2.5, seconds),
				};
			});
		};
		return [snapshot(123), snapshot(130)];
	});
	for (const [i, row] of rows[1].entries()) {
		check(
			`${row.id}: the live fleet installs three levels and draws one`,
			row.authored && row.levels && row.visible === 1,
			JSON.stringify(row),
		);
		const habitat = row.id === "carrier" || row.id === "dreadnought";
		check(
			`${row.id}: the render loop applies the game clock to every habitat level`,
			habitat
				? row.rotors === 3 &&
						row.phases.every(
							(phase) => Math.abs(phase - row.expected) < 1e-12,
						) &&
						rows[0][i].phases.every(
							(phase) => Math.abs(phase - rows[0][i].expected) < 1e-12,
						) &&
						row.phases[0] !== rows[0][i].phases[0]
				: row.rotors === 0,
			JSON.stringify(row),
		);
	}
}
