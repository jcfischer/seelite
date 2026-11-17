/**
 * https://github.com/jcfischer/seelite/issues/1302
 * A charted rock carries a realistic reserve.
 *
 * Boots the production game at seed 2 in the Longwall and reads the start
 * system's charted field through `window.__seelite`: every rock's surface and
 * deep reserve, the field's median total and its largest rock. The principal's
 * ruling of 2026-11-17 makes a few dozen tonnes per asteroid unrealistic; the
 * median rock must hold at least 400 t of minable ore, and the largest must
 * scale up by the unchanged area and volume laws.
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
		return {
			charted: g.fields.filter((entry) => entry.plan.profile === "charted")
				.length,
			field: draw.plan.id,
			rocks: contents.length,
			surface: contents.map((entry) => entry.surfaceT),
			deep: contents.map((entry) => entry.deepT),
			total: contents.map((entry) => entry.surfaceT + entry.deepT),
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
			"the largest rock scales up by the area and volume laws",
			summary.largestSurfaceT >= 40000 && summary.largestDeepT >= 100000,
			JSON.stringify(summary),
		);
	}
} finally {
	await browser.close();
}
exit();
