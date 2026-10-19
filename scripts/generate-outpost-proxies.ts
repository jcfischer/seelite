/**
 * Write the authored outposts' collision proxies (nodes #1031, #1032) to
 * `src/outpost-proxies.ts`, from the shipped model. How it is fitted is
 * `scripts/lib/shipyard-proxies.ts` (`fitOutpostProxies`). Run after the
 * model changes:
 *
 *   bun scripts/generate-outpost-proxies.ts
 */
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { outpostModelHash } from "./lib/shipped-outposts";
import { fitOutpostProxies, PACK, pack } from "./lib/shipyard-proxies";

const OUT = "src/outpost-proxies.ts";
const fitted = await fitOutpostProxies();
const data: Record<string, { hull: string }> = {};
const sources: Record<string, string> = {};
for (const [form, { hull }] of Object.entries(fitted)) {
	data[form] = { hull: pack(hull) };
	sources[form] = outpostModelHash(form as "e");
	console.log(`${form}: ${hull.length} hull boxes`);
}
writeFileSync(
	OUT,
	`/**
 * The authored outposts' collision proxies (nodes #1031, #1032). **Generated** by
 * \`scripts/generate-outpost-proxies.ts\` from \`src/models/outpost-*.glb\`;
 * do not edit. The hull (the 10 m rule) is oriented boxes in the station's
 * frame, packed as the shipyards' are (\`src/shipyard-proxies.ts\`).
 * \`station-proxy.ts\` decodes them; \`OUTPOST_PROXY_SOURCES\` is the model's
 * SHA-256 when they were fitted; \`tests/outpost-flight.test.ts\` fails when
 * the model no longer matches.
 */
export const OUTPOST_PROXY_PACK = ${JSON.stringify(PACK)} as const;
export const OUTPOST_PROXY_SOURCES = ${JSON.stringify(sources)} as const;
export const OUTPOST_PROXIES = ${JSON.stringify(data)} as const;
`,
);
spawnSync("npx", ["biome", "format", "--write", OUT], { stdio: "inherit" });
