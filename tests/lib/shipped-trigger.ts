/**
 * A command's shipped trigger of a given kind — the one copy (#381 S4).
 *
 * Three new test files in one PR defined this fixture, which is the third-copy
 * threshold the same PR used to justify `tests/lib/pad-frames.ts`. Sage
 * pointed at the inconsistency in round 1 on #497 and it is the right call.
 *
 * It **throws** rather than returning `undefined`: a row that silently got no
 * trigger would assert against `undefined` and pass on whatever the registry
 * did next, which is the shape of check this repo keeps finding.
 */
import { DEFAULT_BINDINGS, type Trigger } from "../../src/commands";

export const shippedTrigger = (
	command: string,
	kind: Trigger["kind"] = "key",
): Trigger => {
	const found = DEFAULT_BINDINGS.find(
		(b) => b.command === command && b.trigger.kind === kind,
	);
	if (!found) throw new Error(`${command} has no shipped ${kind} trigger`);
	return found.trigger;
};
