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
 * - `killed` — the harness's own timeout. Its output is cut off wherever the
 *   kill landed, so nothing in it is evidence.
 * - `crash` — exited without the tail: a throw outside a check, such as a
 *   navigation timeout or a destroyed execution context. Usually load or a
 *   page left behind; the code under test is possible, never established.
 * - `pageerror` — the game threw, or a shader did not link. Before `assert`
 *   because a game that threw answers later checks with plausible garbage.
 * - `assert` — a check failed on a probe that ran to the end.
 * - `exit` — none of the above: a non-zero exit after a clean tail. Nothing
 *   prints that today, so it is named rather than folded into another kind.
 *
 * @param {{ code: number | string, out: string }} result
 * @returns {"killed" | "crash" | "pageerror" | "assert" | "exit"}
 */
export function failureKind({ code, out }) {
	if (typeof code === "string" && code.startsWith("killed")) return "killed";
	if (!/^-?\d+\/\d+ checks passed$/m.test(out)) return "crash";
	if (/^(PAGEERROR|SHADERERROR) /m.test(out)) return "pageerror";
	if (/^ FAIL /m.test(out)) return "assert";
	return "exit";
}
