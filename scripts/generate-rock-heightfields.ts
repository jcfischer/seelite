/** Regenerate node #966 data after changing the authored GLB:
 * bun scripts/generate-rock-heightfields.ts
 */
import { writeFileSync } from "node:fs";
import { decodeRockHeightfields } from "../src/rock-heightfields";
import {
	generateRockHeightfields,
	ROCK_HEIGHTFIELDS_BIN,
} from "./lib/rock-heightfields";

const bytes = await generateRockHeightfields();
writeFileSync(ROCK_HEIGHTFIELDS_BIN, bytes);
console.log(
	`${ROCK_HEIGHTFIELDS_BIN}: ${bytes.length} bytes; source SHA-256 ${decodeRockHeightfields(bytes).sourceSha256}`,
);
