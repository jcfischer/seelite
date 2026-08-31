/**
 * `scripts/probe-arrival.mjs` names its fixture seed **once**, and everything
 * else reads it.
 *
 * The defect this is built on is node #169's: the two `bailIfMissing` messages
 * still said "seed 47" after #118 re-picked the fixture to 481, so the one line
 * a reader sees when the fixture is gone sent them to a seed that has neither
 * station. Nothing could go red for it — a bail message only prints when the
 * probe is already broken, and the browser tier does not run in CI at all.
 *
 * So the fix was structural rather than a corrected literal: the seed is read
 * back off the URL the probe actually flies, and the message is composed from
 * it. What is checkable about that is the shape, and only the shape — this test
 * cannot say the message is *true*, only that no copy of the seed exists to
 * drift away from the one that is flown. Truth follows from there being one
 * value, which is the whole of the claim.
 *
 * Scoped to this one file on purpose. `scripts/lib/view-set.mjs` names seeds in
 * runtime strings legitimately — its §13.6.6 row declares a seed of its own and
 * says why — so a repo-wide ban would be red for a file doing the right thing.
 */
import { expect, test } from "bun:test";
import { codeOf } from "./lib/source-scan";

const SUBJECT = "scripts/probe-arrival.mjs";

test("no runtime string in probe-arrival restates a seed number", () => {
	// Comments are blanked by `codeOf`, so the header's history — "it was
	// `?seed=47` until #118" — is exempt, as it should be: that sentence is about
	// a seed the probe no longer flies and is true because it says so.
	//
	// Asserted as a list of offending lines rather than on the file, because the
	// stripper keeps line numbering intact and a failure here is worth an
	// address. Matched on the file as a whole, the output is four hundred blanked
	// lines and the reader still has to go and find it.
	const offenders = codeOf(SUBJECT)
		.split("\n")
		.map((line, i) => `${SUBJECT}:${i + 1}: ${line.trim()}`)
		.filter((line) => /seed \d/i.test(line));
	expect(offenders).toEqual([]);
});

test("the flown seed is written down once", () => {
	const code = codeOf(SUBJECT);
	const declared = code.match(/const SEED = (\d+);/);
	// Asserted present, so a rename cannot turn the count below into zero
	// occurrences of nothing agreeing with itself.
	expect(declared).not.toBeNull();
	const seed = declared?.[1] ?? "";
	expect(code.split(seed).length - 1).toBe(1);
});
