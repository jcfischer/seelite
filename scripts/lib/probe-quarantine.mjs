/**
 * Probes that fail on `main` today, with the issue that owns each.
 *
 * They still **run**, and their output is still printed in full — what they do
 * not do is gate. The alternative was to gate on them and have every pull
 * request open red, which trains everyone to ignore the check and is how a
 * suite stops meaning anything.
 *
 * A quarantine is a debt, so it is written where it cannot be lost: named in
 * the summary of every run with its issue, rather than commented out or
 * silently skipped. Removing an entry is the last step of fixing the thing.
 *
 * Record a red here as soon as it is shown red alone on `origin/main`. #866
 * spent 17 minutes proving `probe-adaptive-resolution` red on main, which the
 * session before it already knew. The list is its own file so that recording
 * or lifting an entry selects that probe and smoke, not the whole suite as an
 * edit to the runner would (`registryChanges` in `probe-impact.mjs`).
 *
 * @type {Map<string, string>} probe file → the issue that owns its red
 */
export const QUARANTINED = new Map([
	[
		"probe-output-stage.mjs",
		"#975 multisample lit-pixel disagreement: 1.21% on baseline, limit 1%",
	],
]);
