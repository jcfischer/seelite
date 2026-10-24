import { writeFileSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { ASSEMBLY_BLOCKS } from "../src/assembly-plan";
import { decodeShippedGlb } from "./lib/shipped-glb";
import { fitAssemblyBlock, pack } from "./lib/shipyard-proxies";

const file = "src/models/trade-assembly.glb";
const root = await decodeShippedGlb(file);
const blocks: Record<string, string> = {};
for (const block of ASSEMBLY_BLOCKS) {
	const boxes = fitAssemblyBlock(root, block);
	blocks[block] = pack(boxes);
	console.log(`${block}: ${boxes.length} fitted boxes`);
}
writeFileSync(
	"src/assembly-proxies.ts",
	`export const ASSEMBLY_PROXY_SOURCE = ${JSON.stringify(createHash("sha256").update(readFileSync(file)).digest("hex"))};\nexport const ASSEMBLY_PROXIES = ${JSON.stringify(blocks)} as const;\n`,
);
