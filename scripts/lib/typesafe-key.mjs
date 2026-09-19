import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const parseDotEnvValue = (value) => {
	const trimmed = value.trim();
	const quoted = trimmed.match(/^(["'])(.*)\1(?:\s+#.*)?$/);
	if (quoted) return quoted[2];
	return trimmed.replace(/\s+#.*$/, "").trim();
};

/**
 * Read only the TypeSafe credential, never export or return other .env data.
 *
 * @param {{env?: NodeJS.ProcessEnv, home?: string, readFile?: (path: string, encoding: "utf8") => string}} options
 */
export function readTypeSafeApiKey({
	env = process.env,
	home = homedir(),
	readFile = (path, encoding) => readFileSync(path, encoding),
} = {}) {
	const ambient = env.TYPESAFE_API_KEY?.trim();
	if (ambient) return ambient;
	let source;
	try {
		source = readFile(join(home, ".env"), "utf8");
	} catch {
		return undefined;
	}
	for (const line of source.split(/\r?\n/)) {
		const match = line.match(
			/^\s*(?:export\s+)?TYPESAFE_API_KEY\s*=\s*(.*?)\s*$/,
		);
		if (!match) continue;
		const value = parseDotEnvValue(match[1]);
		if (value) return value;
	}
	return undefined;
}
