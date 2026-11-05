import { expect, test } from "bun:test";
import { auditCheckPredicates } from "../scripts/lib/probe-check-audit.mjs";

test("the audit detects a weakened predicate even with an unchanged check count", () => {
	const audit = auditCheckPredicates(
		'check("same label", reading > 5, reading);',
		'check("same label", reading >= 0, reading);',
	);
	expect(audit.missing).toHaveLength(1);
	expect(audit.added).toHaveLength(1);
});

test("predicate matching ignores formatting and labels, and consumes duplicates", () => {
	const audit = auditCheckPredicates(
		'check("old label", a && b); check("repeat", a && b);',
		'check("new label", a/* spacing */&&b);',
	);
	expect(audit.matched).toBe(1);
	expect(audit.missing).toHaveLength(1);
	expect(audit.added).toHaveLength(0);
});

test("the audit sees a changed input expression but does not claim data-flow equivalence", () => {
	expect(
		auditCheckPredicates(
			'check("x", page.read());',
			'check("x", other.read());',
		).missing,
	).toHaveLength(1);
	expect(
		auditCheckPredicates(
			'const reading = sample(); check("x", reading);',
			'const reading = true; check("x", reading);',
		).matched,
	).toBe(1);
});

test("tagged template raw text is predicate data", () => {
	expect(
		auditCheckPredicates('check("x", tag`a\\nb`);', 'check("x", tag`a\nb`);')
			.missing,
	).toHaveLength(1);
});
