/**
 * Build the environment for the browser runner from a completed selection.
 * Ambient filters must never narrow a result that the selector called `all`.
 *
 * @param {NodeJS.ProcessEnv} env
 * @param {string[] | undefined} selectedProbes
 */
export function probeRunnerEnvironment(env, selectedProbes = undefined) {
	const childEnv = { ...env };
	delete childEnv.TYPESAFE_API_KEY;
	delete childEnv.PROBE_FILES;
	delete childEnv.PROBE_ONLY;
	if (selectedProbes?.length) childEnv.PROBE_FILES = selectedProbes.join(",");
	return childEnv;
}
