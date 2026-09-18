import { readdirSync } from "node:fs";

/** Naming matches which must never be counted as executable gates. */
export const NOT_PROBES = new Set(["probe-all.mjs", "probe-guard.mjs"]);

/** Gating checks whose measurement-oriented names deliberately lack `probe-`. */
export const ADDITIONAL_GATES = Object.freeze(["measure-cruise-detour.mjs"]);

/** The one inventory rule shared by the runner and catalog-parity test. */
export function discoverProbeFiles(directory) {
	return readdirSync(directory)
		.filter((file) => file.startsWith("probe-") && file.endsWith(".mjs"))
		.filter((file) => !NOT_PROBES.has(file))
		.concat(ADDITIONAL_GATES)
		.sort();
}
