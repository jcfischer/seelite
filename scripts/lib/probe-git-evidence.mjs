import { execFileSync } from "node:child_process";

/**
 * Read every path affected by a PR range. Rename detection is disabled so both
 * the removed runtime path and its destination remain visible to the selector.
 *
 * @param {string} base
 * @param {string} head
 * @param {string} cwd
 */
export function readGitEvidence(base, head, cwd) {
	const range = `${base}...${head}`;
	return {
		changedFiles: execFileSync(
			"git",
			["diff", "--name-only", "--no-renames", range],
			{
				cwd,
				encoding: "utf8",
				stdio: ["ignore", "pipe", "pipe"],
			},
		)
			.split("\n")
			.map((line) => line.trim())
			.filter(Boolean),
	};
}
