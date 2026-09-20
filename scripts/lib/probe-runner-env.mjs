import { PLAYWRIGHT_ENV_VARS, PROBE_RENDERER_ENV } from "../probe-guard.mjs";

/**
 * Build the environment for the browser runner from a completed selection.
 * Only runtime necessities and documented probe controls cross into the PR's
 * Vite/Chromium processes. Ambient filters and unrelated secrets do not.
 *
 * @param {NodeJS.ProcessEnv} env
 * @param {string[] | undefined} selectedProbes
 */
export function probeRunnerEnvironment(env, selectedProbes = undefined) {
	const passThrough = new Set([
		"CI",
		"PATH",
		"HOME",
		"USER",
		"LOGNAME",
		"SHELL",
		"TMPDIR",
		"TMP",
		"TEMP",
		"LANG",
		"LC_ALL",
		"LC_CTYPE",
		"TERM",
		"COLORTERM",
		"NO_COLOR",
		"FORCE_COLOR",
		// The launcher owns these names. Reading them from it keeps this list from
		// being a second copy, and keeps the wiring gate's "nothing else resolves
		// Playwright" rule true of this file rather than exempted for it.
		...PLAYWRIGHT_ENV_VARS,
		PROBE_RENDERER_ENV,
		"HEADED",
		"DISPLAY",
		"WAYLAND_DISPLAY",
		"REQUESTS_EVIDENCE",
		"RELAY_EVIDENCE",
		"SHOT_DIR",
		"PROBE_CONCURRENCY",
		"PROBE_TIMEOUT_MS",
		"PROBE_URL",
		"PROBE_NEUTRAL_URL",
		"PROBE_RING_BODY",
		"PROBE_RING_URL",
		"PROBE_SCREENSHOT",
	]);
	const childEnv = Object.fromEntries(
		Object.entries(env).filter(
			([key, value]) => value !== undefined && passThrough.has(key),
		),
	);
	if (selectedProbes?.length) {
		childEnv.PROBE_SELECTION = "1";
		childEnv.PROBE_FILES = selectedProbes.join(",");
	}
	return childEnv;
}
