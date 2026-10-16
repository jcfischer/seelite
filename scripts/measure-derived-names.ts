/**
 * CPU-only name-builder microbenchmark for node #500; no renderer or frame
 * cost is measured. Run unchanged before and after a source edit:
 *
 *   bun run scripts/measure-derived-names.ts
 *
 * A and B call the same shipped functions on the same layouts in alternating
 * order. Their difference is a same-build control, not an optimisation arm.
 * Each block cycles the default, mouse-flight and rebound layouts; construction
 * and cold misses are outside the timed loop. Raw blocks and a consumed output
 * checksum are printed so a comparison cannot quietly time unused answers.
 */
import { cpus } from "node:os";
import { rigLegend } from "../src/combat-rig";
import {
	DEFAULT_BINDINGS,
	type Layout,
	MOUSE_FLIGHT_BINDINGS,
	rebind,
} from "../src/commands";
import { type DialStem, dialKeys } from "../src/key-names";

const beam = DEFAULT_BINDINGS.find(
	(b) => b.command === "fight.fireBeam" && b.trigger.kind === "key",
);
if (!beam || beam.trigger.kind !== "key") throw new Error("beam key missing");
const layouts = [
	DEFAULT_BINDINGS,
	MOUSE_FLIGHT_BINDINGS,
	rebind(DEFAULT_BINDINGS, "fight.fireBeam", beam.trigger, {
		kind: "key",
		key: "backspace",
		hold: true,
	}),
];
const dials: readonly DialStem[] = [
	"vMax",
	"exponent",
	"dropRadius",
	"dropSpeed",
	"vicinity",
	"approachLead",
];
const iterations = 30_000;
const blocks = 12;
let checksum = 0;
const median = (values: number[]) => {
	const sorted = [...values].sort((a, b) => a - b);
	return (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
};

function measure(name: string, read: (layout: Layout) => string) {
	const sample = () => {
		const start = performance.now();
		for (let i = 0; i < iterations; i++) {
			const value = read(layouts[i % layouts.length]);
			checksum += value.length + value.charCodeAt(i % value.length);
		}
		const us = ((performance.now() - start) * 1000) / iterations;
		if (!Number.isFinite(us) || us <= 0)
			throw new Error(`${name}: invalid timing ${us}`);
		return us;
	};
	sample();
	sample();
	const a: number[] = [];
	const b: number[] = [];
	for (let block = 0; block < blocks; block++) {
		if (block % 2 === 0) {
			a.push(sample());
			b.push(sample());
		} else {
			b.push(sample());
			a.push(sample());
		}
	}
	return {
		name,
		unit: "us/call",
		medianA: median(a),
		medianB: median(b),
		controlDelta: median(b) - median(a),
		a,
		b,
	};
}

console.log(
	JSON.stringify(
		{
			runtime: `Bun ${Bun.version}`,
			cpu: cpus()[0].model,
			lane: "headless CPU name builders; no renderer",
			iterations,
			blocks,
			layouts: layouts.length,
			rows: [
				measure("rigLegend", rigLegend),
				measure("six dialKeys calls and join", (layout) =>
					dials.map((dial) => dialKeys(layout, dial)).join("   "),
				),
			],
			checksum,
		},
		null,
		2,
	),
);
