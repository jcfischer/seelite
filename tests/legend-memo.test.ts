import { describe, expect, test } from "bun:test";
import { type FitCache, fitLine, rigLegend } from "../src/combat-rig";
import {
	DEFAULT_BINDINGS,
	type Layout,
	layoutOf,
	rebind,
} from "../src/commands";
import { type DialStem, dialKeys } from "../src/key-names";

/** Count actual layout scans without changing its frozen rows or global mocks. */
function counted(layout: Layout) {
	let scans = 0;
	return {
		layout: new Proxy(layout, {
			get(target, key, receiver) {
				if (key === "filter") {
					scans++;
				}
				return Reflect.get(target, key, receiver);
			},
		}),
		scans: () => scans,
	};
}

describe("names are derived once per layout identity (node #500)", () => {
	test("a warm rig legend performs no further layout scans", () => {
		const subject = counted(layoutOf([...DEFAULT_BINDINGS]));
		const first = rigLegend(subject.layout);
		expect(subject.scans()).toBe(4);
		for (let i = 0; i < 10; i++) expect(rigLegend(subject.layout)).toBe(first);
		expect(subject.scans()).toBe(4);

		const beam = subject.layout.find((b) => b.command === "fight.fireBeam");
		if (!beam) throw new Error("beam missing");
		const moved = counted(
			rebind(subject.layout, "fight.fireBeam", beam.trigger, {
				kind: "key",
				key: "backspace",
				hold: true,
			}),
		);
		expect(rigLegend(moved.layout)).toContain("hold Backspace or");
		expect(rigLegend(subject.layout)).toBe(first);
		rigLegend(moved.layout);
		expect(moved.scans()).toBe(4);
	});

	test("all six dial labels are cached independently on each layout", () => {
		const subject = counted(layoutOf([...DEFAULT_BINDINGS]));
		const dials: readonly DialStem[] = [
			"vMax",
			"exponent",
			"dropRadius",
			"dropSpeed",
			"vicinity",
			"approachLead",
		];
		const first = dials.map((dial) => dialKeys(subject.layout, dial));
		expect(subject.scans()).toBe(12);
		for (let i = 0; i < 10; i++)
			expect(dials.map((dial) => dialKeys(subject.layout, dial))).toEqual(
				first,
			);
		expect(subject.scans()).toBe(12);

		const up = subject.layout.find((b) => b.command === "tune.vMaxUp");
		if (!up) throw new Error("dial key missing");
		const moved = counted(
			rebind(subject.layout, "tune.vMaxUp", up.trigger, {
				kind: "key",
				key: "4",
			}),
		);
		expect(dialKeys(moved.layout, "vMax")).toBe("(-/4)");
		expect(dialKeys(subject.layout, "vMax")).toBe(first[0]);
		expect(dialKeys(moved.layout, "vMax")).toBe("(-/4)");
		expect(moved.scans()).toBe(2);
	});

	test("a longer rebound legend is fitted again at the same width", () => {
		const original = layoutOf([...DEFAULT_BINDINGS]);
		const beam = original.find((b) => b.command === "fight.fireBeam");
		if (!beam) throw new Error("beam missing");
		const moved = rebind(original, "fight.fireBeam", beam.trigger, {
			kind: "key",
			key: "backspace",
			hold: true,
		});
		const ctx = {
			font: "",
			measureText: (text: string) => ({
				width: text.length * 0.6 * Number.parseFloat(ctx.font),
			}),
		};
		const cache: FitCache = new Map();
		// The fitter only reads width; this mirrors the existing derived-name stub.
		const measuring = ctx as unknown as Pick<
			CanvasRenderingContext2D,
			"font" | "measureText"
		>;
		const fit = (layout: Layout) =>
			fitLine(measuring, cache, {
				key: "legend",
				widest: rigLegend(layout),
				startSize: 12,
				width: 540,
			});
		const first = fit(original);
		const rebound = fit(moved);
		expect(Number.parseFloat(rebound.font)).toBeLessThan(
			Number.parseFloat(first.font),
		);
		expect(rebound.worstWidth).toBeLessThanOrEqual(540 - 16);
		expect(fit(original)).toBe(first);
		expect(fit(moved)).toBe(rebound);
	});
});
