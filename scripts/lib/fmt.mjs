/**
 * Formatting a number that might not be there, for probe evidence strings.
 *
 * A probe reading `Building.yard` or a `hubView` entry is reading
 * `number | undefined` — see `HubView` in `src/materials.ts` for why those are
 * optional — and `undefined.toFixed(1)` throws.
 *
 * **That throw lands in the worst possible place: the evidence string.** It kills
 * the run while assembling the message for a check, so the check is never
 * reported, nor the ones after it, nor the number that would have said what went
 * wrong. A crash where the point was a report.
 *
 * How much is lost depends on the call shape, and the probes have two.
 * `probe-granary`'s `expect(message, cond)` takes the message first, so the
 * condition is never even evaluated — the check does not merely go unreported,
 * it never decides. `probe-storehouse` and `probe-demolish` use
 * `(label, cond, evidence)`, where the condition has already been computed and
 * only the reporting is lost. Both are bad; only the first is worse than it
 * looks.
 *
 * **Every non-number prints as what it is**, which is the whole job: the reader
 * of a failed probe is trying to tell "held nothing" from "had no entry", and a
 * formatter that flattens those has thrown away the answer. `undefined` prints
 * `"undefined"`, and `null` prints `"null"` rather than being relabelled —
 * `probe-determinism` spells absence as `null` on purpose, and this used to call
 * that `undefined`.
 *
 * `NaN` needs no branch here: `toFixed` yields `"NaN"` on its own. It is worth
 * knowing that it does, because a NaN reaching an evidence string means an
 * arithmetic path went wrong rather than a value being absent — a third answer,
 * and one this function is content to pass through rather than dress up.
 *
 * Node-side, not page-side: these strings are built after `page.evaluate`
 * returns, from its serialized result. That is why this can live in
 * `scripts/lib/` where a *game-state* helper could not — nothing here has to be
 * importable by the browser.
 */
export function fmt(n, digits = 1) {
	return typeof n === "number" ? n.toFixed(digits) : String(n);
}
