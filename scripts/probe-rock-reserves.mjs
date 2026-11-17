/**
 * https://github.com/jcfischer/seelite/issues/1302
 * A charted rock carries a realistic reserve.
 *
 * Boots the production game at seed 2 in the Longwall and reads the start
 * system's charted field through `window.__seelite`: every rock's surface and
 * deep reserve, the field's median total and its largest rock. The principal's
 * ruling of 2026-11-17 makes a few dozen tonnes per asteroid unrealistic; the
 * median rock must hold at least 400 t of minable ore. Every rock's reserve is
 * checked against the area and volume laws the reserve scale is read through,
 * not against a threshold on one rock.
 */
import { gameUrl } from "./lib/game-url.mjs";
import {
	bootedGame,
	guardedOrigin,
	installViewPlacement,
	launchChromium,
	tally,
} from "./probe-guard.mjs";

const origin = await guardedOrigin(
	process.env.PROBE_ORIGIN ?? process.argv[2] ?? "http://localhost:5173",
);
const browser = await launchChromium();
const { check, watch, exit } = tally();

const median = (values) => {
	const sorted = [...values].sort((a, b) => a - b);
	return sorted[Math.floor((sorted.length - 1) / 2)];
};
const largest = (values) => Math.max(...values);

try {
	const page = await browser.newPage({
		viewport: { width: 1280, height: 800 },
	});
	watch(page);
	await installViewPlacement(page);
	await page.goto(
		gameUrl(origin, {
			seed: 2,
			hull: "miner",
			"no-save": "",
			raider: "off",
		}),
	);
	await bootedGame(page, 120000);
	const field = await page.evaluate(async () => {
		const S = await import("/src/rock-survey.ts");
		const A = await import("/src/asteroid-field.ts");
		const g = window.__seelite;
		g.clockHeld = true;
		const draw = g.fields.find((entry) => entry.plan.profile === "charted");
		if (!draw) return { charted: 0 };
		const contents = draw.rocks.map((rock) =>
			S.rockContents(
				g.world.system.record.seed,
				draw.plan.slot,
				draw.plan.profile,
				rock,
			),
		);
		const [, r1] = A.FIELD_PROFILE[draw.plan.profile].rockRadiusKm;
		const laws = draw.rocks.map((rock, i) => {
			const size = rock.radiusKm / r1;
			const surface = S.RESERVE.surfaceAtLargestT * size * size;
			const deep = S.RESERVE.deepAtLargestT * size ** 3;
			const surfaceT = contents[i].surfaceT;
			const deepT = contents[i].deepT;
			const surfaceInside =
				surfaceT >=
					Math.min(S.RESERVE.surfaceMinT, Math.round(surface * 0.5)) &&
				surfaceT <= Math.max(S.RESERVE.surfaceMinT, Math.round(surface * 1.5));
			const deepInside =
				deepT === 0 ||
				(deepT >= Math.min(S.RESERVE.deepMinT, Math.round(deep * 0.5)) &&
					deepT <= Math.max(S.RESERVE.deepMinT, Math.round(deep * 1.5)));
			return {
				slot: rock.slot,
				radiusKm: rock.radiusKm,
				surfaceInside,
				deepInside,
			};
		});
		const largestIndex = draw.rocks.reduce(
			(best, rock, i) => (rock.radiusKm > draw.rocks[best].radiusKm ? i : best),
			0,
		);
		return {
			charted: g.fields.filter((entry) => entry.plan.profile === "charted")
				.length,
			field: draw.plan.id,
			rocks: contents.length,
			surface: contents.map((entry) => entry.surfaceT),
			deep: contents.map((entry) => entry.deepT),
			total: contents.map((entry) => entry.surfaceT + entry.deepT),
			lawViolations: laws.filter(
				(rock) => !rock.surfaceInside || !rock.deepInside,
			),
			largestRock: {
				radiusKm: draw.rocks[largestIndex].radiusKm,
				surfaceT: contents[largestIndex].surfaceT,
				deepT: contents[largestIndex].deepT,
			},
		};
	});
	check(
		"the boot system draws a charted field",
		field.charted > 0 && field.rocks > 0,
		JSON.stringify({ charted: field.charted, rocks: field.rocks }),
	);
	if (field.rocks > 0) {
		const present = field.deep.filter((tonnes) => tonnes > 0);
		const summary = {
			field: field.field,
			rocks: field.rocks,
			medianTotalT: median(field.total),
			medianSurfaceT: median(field.surface),
			largestSurfaceT: largest(field.surface),
			deepRocks: present.length,
			medianDeepT: present.length ? median(present) : 0,
			largestDeepT: largest(field.deep),
		};
		check(
			"the median charted rock holds at least 400 t of minable ore",
			summary.medianTotalT >= 400,
			JSON.stringify(summary),
		);
		check(
			"the median rock's surface reserve carries the median total",
			summary.medianSurfaceT >= 400,
			JSON.stringify(summary),
		);
		check(
			"every rock's reserve falls inside the area and volume laws",
			field.lawViolations.length === 0,
			JSON.stringify({
				rocks: field.rocks,
				violations: field.lawViolations.slice(0, 5),
				largestRock: field.largestRock,
			}),
		);
	}
} finally {
	await browser.close();
}
exit();
