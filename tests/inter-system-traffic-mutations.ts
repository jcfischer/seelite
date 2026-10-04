/** Mutate isolated source trees, never acceptance inputs or the working tree. */
import { spawnSync } from "node:child_process";
import {
	cpSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function replaceOnce(source: string, before: string, after: string): string {
	if (source.split(before).length !== 2)
		throw new Error(`Traffic mutation target missing or ambiguous: ${before}`);
	return source.replace(before, after);
}

// Rejected implementation: choose from actual leg distances at the crossing
// clock instead of the roster's static eligible set. Keep the anchored schedule
// so the difference being tested is the destination, not a new cycle length.
const crossingEligibility = `
function crossingEligible(galaxy: Galaxy, p: HaulerPlan, contentsFor: ContentsQuery, atS: number): HaulerDestination[] {
	const home = p.homeRecord;
	const homeContents = contentsFor(home.index);
	const homeStation = placeBodies(homeContents, atS).find(b => b.id === p.actor.homeStationId)!;
	const eligible: HaulerDestination[] = [];
	for (const away of galaxy.systems) {
		if (away.galaxy !== home.galaxy || away.index === home.index || distanceLy(home.pos, away.pos) > HULL_SPECS[p.actor.hullId].tankLy) continue;
		const c = contentsFor(away.index);
		for (const station of c.stations) {
			const interior = stationInterior(station.type, STATION_GEOMETRY[station.type].aperturePlaneKm, station.berthSeed);
			if (!trafficBerths(interior).some(b => berthFits(b, HULL_SPECS[p.actor.hullId].env))) continue;
			const body = placeBodies(c, atS).find(b => b.id === station.id)!;
			const dHome = length(sub(arrivalPoint(home, homeContents, away.pos, atS), homeStation.pos));
			const dAway = length(sub(arrivalPoint(away, c, home.pos, atS), body.pos));
			if ((dHome + dAway) / AU_KM <= HULL_SPECS[p.actor.hullId].chargeAu)
				eligible.push({systemIndex: away.index, stationId: station.id, bounds: haulerBounds(away, c, station, p.actor.hullId)});
		}
	}
	return eligible.sort((a,b) => a.systemIndex - b.systemIndex || (a.stationId < b.stationId ? -1 : a.stationId > b.stationId ? 1 : 0));
}
`;

export function runTrafficControl(
	control: "crossing" | "identity" | "late" | "baseline",
) {
	const root = mkdtempSync(join(tmpdir(), "seelite-traffic-mutant-"));
	try {
		cpSync(new URL("../src/", import.meta.url), join(root, "src"), {
			recursive: true,
		});
		mkdirSync(join(root, "tests"));
		cpSync(
			new URL("./inter-system-traffic-controls.test.ts", import.meta.url),
			join(root, "tests/inter-system-traffic-controls.test.ts"),
		);
		if (control !== "baseline") {
			const file = join(
				root,
				"src",
				control === "late" ? "station-route.ts" : "inter-system-traffic.ts",
			);
			let source = readFileSync(file, "utf8");
			if (control === "identity") {
				source = replaceOnce(
					source,
					"if (currentRecord?.index === homeIndex) return currentRecord;",
					"if (currentRecord) return currentRecord;",
				);
			} else if (control === "late") {
				// Remove contention at the production leg seam. The test still
				// supplies its committed player lane and expects the observed delay.
				const start = source.indexOf("function projectHaulerInSystem(");
				if (start < 0)
					throw new Error("Hauler projection mutation target missing");
				const body = source.slice(start);
				if (!body.includes("timeline: input.playerTimeline ?? [],"))
					throw new Error("Timeline mutation target missing");
				source =
					source.slice(0, start) +
					body.replaceAll(
						"timeline: input.playerTimeline ?? [],",
						"timeline: [],",
					);
			} else {
				source =
					`import { placeBodies } from "./system";\nimport { length } from "./vec3";\n` +
					source +
					crossingEligibility;
				source = replaceOnce(
					source,
					"const v = haulerVoyage(p, ordinal);",
					`const eligible = crossingEligible(galaxy, p, contentsFor, atS);
		if (!eligible.length) return false;
		const v = haulerVoyage({ ...p, eligible }, ordinal);`,
				);
			}
			writeFileSync(file, source);
		}
		return spawnSync(
			process.execPath,
			[
				"test",
				"tests/inter-system-traffic-controls.test.ts",
				...(control === "baseline" ? [] : ["--test-name-pattern", control]),
			],
			{ cwd: root, encoding: "utf8" },
		);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}
