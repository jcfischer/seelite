/**
 * The exit code `probe-all` records for a probe ended by a signal, which has
 * no numeric code. One definition, so the runner that writes it and the
 * classifier that reads it cannot drift apart.
 *
 * @param {string | null} signal
 */
export const killedCode = (signal) => `killed:${signal}`;

/** @param {number | string} code */
export const isKilled = (code) =>
	typeof code === "string" && code.startsWith("killed:");

/**
 * What kind of red a failed probe is (#84).
 *
 * `probe-all` reported every failure the same way, so a navigation that timed
 * out on a starved machine read exactly like an assertion that caught a
 * regression — and the response to the first is "what else was running", while
 * the response to the second is "what did this change break". #84's incidents
 * were all of the first kind and were read as the second.
 *
 * The kind is read off what `tally()` (`probe-guard.mjs`) prints, which every
 * probe reports through: ` FAIL ` for a failed check, `PAGEERROR` /
 * `SHADERERROR` for a fault in the page, and a closing `N/M checks passed` that
 * a probe prints only if it got to the end. So the tail is the test for
 * whether the probe finished, and no text of Playwright's is matched — its
 * messages are not this repo's to keep stable.
 *
 * In order, first match wins:
 *
 * - `killed` — ended by a signal. Usually the harness's own timeout, which
 *   appends `[probe-all] killed after …` to the output; without that line it
 *   was something else (an OOM kill, another session's `pkill`). The output
 *   is cut off wherever the signal landed, so nothing in it is evidence.
 * - `pageerror` — the game threw, or a shader did not link. Before `crash`
 *   because a game that threw can take the probe down before its tail, and
 *   before `assert` because it answers later checks with plausible garbage.
 * - `crash` — exited without the tail: a throw outside a check. That is a
 *   navigation timeout or a destroyed execution context on a starved machine,
 *   and equally a regression that throws inside `page.evaluate`. The kind
 *   names no cause; a rerun alone does.
 * - `assert` — a check failed on a probe that ran to the end.
 * - `exit` — none of the above: a non-zero exit after a clean tail. Nothing
 *   prints that today, so it is named rather than folded into another kind.
 *
 * @param {{ code: number | string, out: string }} result
 * @returns {"killed" | "pageerror" | "crash" | "assert" | "exit"}
 */
export function failureKind({ code, out }) {
	if (isKilled(code)) return "killed";
	if (/^(PAGEERROR|SHADERERROR) /m.test(out)) return "pageerror";
	if (!/^-?\d+\/\d+ checks passed$/m.test(out)) return "crash";
	if (/^ FAIL /m.test(out)) return "assert";
	return "exit";
}
