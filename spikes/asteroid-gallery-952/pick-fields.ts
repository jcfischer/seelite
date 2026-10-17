/**
 * Node #952: pick the gallery's fixed fields from galaxy 0 of the fingerprint
 * world 0x5ee11e. Prints #950's fixture field (s173, looked up by system), the median charted
 * field, and the median rare field of each placement kind. `capture.mjs` copies
 * its choices and their rock counts by hand, and refuses a field whose count
 * no longer matches.
 *
 *   bun spikes/asteroid-gallery-952/pick-fields.ts
 */
import { generateGalaxy } from "../../src/galaxy";
import { generateContents } from "../../src/system";
import * as F from "../asteroid-fields-948/field-proto";

const WORLD = 0x5ee11e;
const g = generateGalaxy(WORLD, 0);
const charted: { system: number; rocks: number }[] = [];
const rare: { system: number; kind: string; rocks: number }[] = [];
for (const record of g.systems) {
	const c = generateContents(record);
	const plan = F.chartedField(record, c);
	if (plan)
		charted.push({ system: record.index, rocks: F.rocks(record, plan).length });
	const r = F.rareField(record, c);
	if (r)
		rare.push({
			system: record.index,
			kind: r.kind,
			rocks: F.rocks(record, r).length,
		});
}
charted.sort((a, b) => a.rocks - b.rocks);
const med = charted[Math.floor(charted.length / 2)];
console.log(
	"charted fields:",
	charted.length,
	"min",
	charted[0],
	"median",
	med,
	"max",
	charted.at(-1),
);
console.log(
	"s173:",
	charted.find((x) => x.system === 173),
);
const kinds = [...new Set(rare.map((x) => x.kind))];
for (const k of kinds) {
	const of = rare.filter((x) => x.kind === k).sort((a, b) => a.rocks - b.rocks);
	console.log("rare", k, of.length, "median", of[Math.floor(of.length / 2)]);
}
