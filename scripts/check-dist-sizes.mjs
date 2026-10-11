/**
 * Refuse a built site that holds a file the host will not serve.
 *
 * Cloudflare Pages rejects any single asset over 25 MiB, and it says so only
 * in the deploy stage, after the merge: #843 merged a 27 MiB GLB and `main`
 * could not publish until a hotfix landed. `npm run build` runs this, so a
 * pull request's build goes red instead. The voice model carries its own
 * split check (`tests/voice-model.test.ts`); this one covers every file.
 */
import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

export const MAX_ASSET_BYTES = 25 * 1024 * 1024;

/** Every file under `dir` larger than the host's per-asset limit. */
export function oversizedFiles(dir, limit = MAX_ASSET_BYTES) {
	const found = [];
	const walk = (d) => {
		for (const entry of readdirSync(d, { withFileTypes: true })) {
			const path = join(d, entry.name);
			if (entry.isDirectory()) walk(path);
			else if (entry.isFile()) {
				const bytes = statSync(path).size;
				if (bytes > limit) found.push({ file: relative(dir, path), bytes });
			}
		}
	};
	walk(dir);
	return found.sort((a, b) => b.bytes - a.bytes);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const dir = process.argv[2] ?? "dist";
	const found = oversizedFiles(dir);
	const mib = (n) => (n / 1024 / 1024).toFixed(1);
	if (found.length) {
		for (const { file, bytes } of found)
			console.error(
				`FAIL ${dir}/${file}: ${mib(bytes)} MiB, over the host's ${mib(MAX_ASSET_BYTES)} MiB per-asset limit`,
			);
		process.exit(1);
	}
	console.log(
		`ok   every file in ${dir}/ is within ${mib(MAX_ASSET_BYTES)} MiB`,
	);
}
