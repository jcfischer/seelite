/**
 * `src/occlusion.ts` — the arithmetic behind #201's sun shadow map and its
 * screen-space ambient occlusion, and the rule that decides which surfaces take
 * part.
 *
 * ## Why any of this is arithmetic rather than four constants in `main.ts`
 *
 * The near layer holds subjects four orders of magnitude apart: the cabin is a
 * ~30 m box at the camera, the player hull ~100 m at 146 m, and a station a
 * kilometre of structure some kilometres away. One shadow map serves all three,
 * so every figure that a shadow's quality depends on — the orthographic box,
 * the light's stand-off, and above all the two biases — is a *function of the
 * subject* rather than a number. A fixed `normalBias` tuned on the cabin puts a
 * station's shadows into the surface that casts them; tuned on the station it
 * lifts the cabin's shadows off the console by metres.
 *
 * What is worth pinning here, and what the tests below are shaped around, is
 * that **one of the two biases is scale-free and the other is not**, and that
 * this is a consequence rather than a choice: three's `shadow.bias` is added in
 * the shadow camera's own depth units, whose range is itself proportional to
 * the subject, so a bias of *k* texels is the same number at every scale.
 * `normalBias` is a world-space offset along the normal and is not.
 */
import { expect, test } from "bun:test";
import {
	CLOSED_GATE,
	type FieldGateInput,
	OCCLUSION,
	SHADOW_MAP_TEXELS,
	participatesInShadow,
	shadowBox,
	shadowFit,
	stepOcclusionGate,
	unionOfSubjects,
} from "../src/occlusion";

/** The three subjects the near layer actually holds, in kilometres. Named so a
 *  failure says which one it broke rather than printing a float. */
const CABIN_KM = 0.03;
const HULL_KM = 0.1;
const STATION_KM = 1.4;

test("the shadow box contains its subject at every scale", () => {
	for (const r of [CABIN_KM, HULL_KM, STATION_KM]) {
		const fit = shadowFit(r);
		// Sideways: the ortho half-extent has to reach past the subject, or the
		// subject's own silhouette is clipped out of its shadow.
		expect(fit.halfExtentKm).toBeGreaterThan(r);
		// Along the light: the whole subject sits between the two planes. The
		// light stands `pushbackKm` off the centre, so the subject spans
		// `pushback ± r`.
		expect(fit.nearKm).toBeLessThan(fit.pushbackKm - r);
		expect(fit.farKm).toBeGreaterThan(fit.pushbackKm + r);
		// An ortho shadow camera behind its own subject is a black frame.
		expect(fit.nearKm).toBeGreaterThan(0);
	}
});

test("the texel is the subject's size divided by the map, not a constant", () => {
	// The property that makes one rig serve a cabin and a station: every length
	// the fit produces is proportional to the subject.
	const cabin = shadowFit(CABIN_KM);
	const station = shadowFit(STATION_KM);
	const ratio = STATION_KM / CABIN_KM;
	expect(station.texelKm / cabin.texelKm).toBeCloseTo(ratio, 6);
	// And it is genuinely the map's own footprint, so a reader can price a
	// framing from it: half-extent to edge is `SHADOW_MAP_TEXELS` texels across.
	expect(cabin.texelKm * SHADOW_MAP_TEXELS).toBeCloseTo(
		2 * cabin.halfExtentKm,
		9,
	);
});

test("the normal bias follows the texel and the depth bias does not", () => {
	// This pair is the whole reason the module exists. `normalBias` is a
	// world-space push along the surface normal, so it has to grow with the
	// texel it is compensating for; `bias` is added in the shadow camera's
	// depth units, whose range is itself `2 × halfExtent`, so a bias of k texels
	// is one number at every scale.
	const cabin = shadowFit(CABIN_KM);
	const station = shadowFit(STATION_KM);
	expect(station.normalBias / cabin.normalBias).toBeCloseTo(
		STATION_KM / CABIN_KM,
		6,
	);
	expect(station.bias).toBeCloseTo(cabin.bias, 12);
	// Negative: three adds it to the depth read out of the map, and acne is
	// fixed by pushing the occluder further from the light.
	expect(cabin.bias).toBeLessThan(0);
	expect(cabin.normalBias).toBeGreaterThan(0);
});

test("a subject smaller than the floor is fitted at the floor", () => {
	// A degenerate subject — a mesh whose bounds have not been computed, or a
	// hull hidden this frame — would otherwise divide the whole fit to zero and
	// hand three a shadow camera with `near === far`.
	const fit = shadowFit(0);
	expect(fit.halfExtentKm).toBeGreaterThan(0);
	expect(fit.farKm).toBeGreaterThan(fit.nearKm);
	expect(fit.texelKm).toBeGreaterThan(0);
});

test("the union of two subjects contains both", () => {
	const a = { center: [0, 0, 0] as const, radiusKm: 0.1 };
	const b = { center: [4, 0, 0] as const, radiusKm: 1.4 };
	const u = unionOfSubjects([a, b]);
	if (!u) throw new Error("two subjects unioned to nothing");
	const reach = (s: { center: readonly number[]; radiusKm: number }) => {
		const dx = s.center[0] - u.center[0];
		const dy = s.center[1] - u.center[1];
		const dz = s.center[2] - u.center[2];
		return Math.hypot(dx, dy, dz) + s.radiusKm;
	};
	// Containment, both ways, with a hair of tolerance for the float — this is
	// the assertion a "just return the first one" union fails.
	expect(reach(a)).toBeLessThanOrEqual(u.radiusKm + 1e-9);
	expect(reach(b)).toBeLessThanOrEqual(u.radiusKm + 1e-9);
	// And it is *tight*: a union that simply doubled the radius would contain
	// both and waste half the map.
	expect(u.radiusKm).toBeCloseTo((0.1 + 1.4 + 4) / 2, 9);
});

test("a contained subject does not grow the union", () => {
	const big = { center: [0, 0, 0] as const, radiusKm: 1.4 };
	const inside = { center: [0.2, 0, 0] as const, radiusKm: 0.1 };
	const u = unionOfSubjects([big, inside]);
	expect(u?.radiusKm).toBeCloseTo(big.radiusKm, 9);
	// Order cannot matter, and it did in the first arithmetic: the containment
	// test has two arms and only one of them was written.
	expect(unionOfSubjects([inside, big])?.radiusKm).toBeCloseTo(big.radiusKm, 9);
});

test("no subjects union to nothing, and one unions to itself", () => {
	expect(unionOfSubjects([])).toBeNull();
	const one = { center: [1, 2, 3] as const, radiusKm: 0.4 };
	expect(unionOfSubjects([one])).toEqual(one);
});

test("only an opaque lit surface takes part in the shadow", () => {
	// The rule, as a truth table rather than as a list of mesh names. #201 asks
	// for hull, cockpit fittings, station structure, greebles and the bay's
	// walls out of one predicate, and for the lamps, the canopy glass, the
	// planets and the star field left out of it — and every one of those falls
	// out of "is this material lit, and is it opaque".
	expect(
		participatesInShadow({ lit: true, transparent: false, opacity: 1 }),
	).toBe(true);
	// The canopy glass: lit-adjacent, but a transparent caster needs an alpha
	// shadow pass this renderer does not have, and a transparent receiver would
	// take the shadow on a surface the player is looking through.
	expect(
		participatesInShadow({ lit: true, transparent: true, opacity: 0.08 }),
	).toBe(false);
	// A lamp strip, a nameplate, an instrument canvas: `MeshBasicMaterial`,
	// which no light reaches, so a shadow on it would be a dark patch on
	// something that is supposed to be its own light source.
	expect(
		participatesInShadow({ lit: false, transparent: false, opacity: 1 }),
	).toBe(false);
	// A planet's surface and the cruise streaks: `ShaderMaterial` and
	// `LineSegments`, neither of which three lights either.
	expect(
		participatesInShadow({ lit: false, transparent: true, opacity: 1 }),
	).toBe(false);
	// Opaque in the flag and not in fact. `transparent: false` with a partial
	// opacity is how a fade-out is written, and it is still not a caster.
	expect(
		participatesInShadow({ lit: true, transparent: false, opacity: 0.5 }),
	).toBe(false);
});

test("the ambient occlusion radius is screen-space, so it is not a length", () => {
	// The same problem the shadow fit solves with arithmetic, solved by three's
	// own `SCREEN_SPACE_RADIUS` define instead: a world-space AO radius that
	// reads on a 30 m cabin is invisible on a 1.4 km station. In screen-space
	// mode the figure is in hundreds of drawing-buffer pixels, so the AO
	// footprint is the same fraction of the frame at every scale and nothing
	// has to be re-fitted per frame.
	expect(OCCLUSION.ao.screenSpaceRadius).toBe(true);
	expect(OCCLUSION.ao.radius).toBeGreaterThan(0);
	// `thickness` stays a length, and it is the term that keeps the AO off the
	// background: a sample whose view-space depth differs by more than this is
	// not an occluder but a different object entirely. A near-layer planet
	// thousands of kilometres behind the subject is rejected by it.
	expect(OCCLUSION.ao.thicknessKm).toBeGreaterThan(0);
	expect(OCCLUSION.ao.thicknessKm).toBeLessThan(10);
});

/**
 * ## The rule that decides what is *in* the box
 *
 * `unionOfSubjects` above is arithmetic. What to hand it is a decision, and it
 * was got wrong first: the node says "the station when it is in the near
 * layer", the fixture's start system has **two** stations, and the near layer
 * reaches `HANDOFF_KM` — ten thousand kilometres. Unioning both put the box at
 * a measured 405 km radius in the `station-flank` framing, a shadow texel of
 * **455 m**, and every shadow in the frame smaller than a texel. It rendered,
 * it cost a pass, and it showed nothing.
 *
 * So two admissions, each with its own reason, and both pure so they are tested
 * here rather than discovered on a contact sheet.
 */
test("a subject too small on screen is not admitted", () => {
	// The near scene is camera-relative and every camera sits at the origin
	// (`main.ts`, `render`), so a candidate's apparent size is its radius over
	// its distance and needs nothing else.
	const near = { center: [0, 0, -2.4] as const, radiusKm: 0.87 };
	const farOff = { center: [0, 0, -405] as const, radiusKm: 0.87 };
	expect(shadowBox([near])).not.toBeNull();
	// The second station of the start system, at the distance it was measured
	// at. Its silhouette is a couple of pixels tall; a shadow on it could not be
	// seen if the map were perfect.
	expect(shadowBox([farOff])).toBeNull();
});

test("a distant station does not drag the box off the hull", () => {
	// The defect, as the frame that produced it. Hull and station together are
	// the subject `station-flank` needs; the station 405 km away is not.
	const hull = { center: [0, -0.04, -0.14] as const, radiusKm: 0.02 };
	const station = { center: [0, 0, -2.4] as const, radiusKm: 0.87 };
	const elsewhere = { center: [300, 0, -270] as const, radiusKm: 0.87 };
	const box = shadowBox([hull, station, elsewhere]);
	if (!box) throw new Error("no box");
	// Both of the two that matter are inside it...
	const reaches = (s: { center: readonly number[]; radiusKm: number }) =>
		Math.hypot(
			s.center[0] - box.center[0],
			s.center[1] - box.center[1],
			s.center[2] - box.center[2],
		) + s.radiusKm;
	expect(reaches(hull)).toBeLessThanOrEqual(box.radiusKm + 1e-9);
	expect(reaches(station)).toBeLessThanOrEqual(box.radiusKm + 1e-9);
	// ...and the box is a couple of kilometres rather than four hundred, which
	// is the difference between a metre-scale texel and a 455 m one.
	expect(box.radiusKm).toBeLessThan(3);
	expect(shadowFit(box.radiusKm).texelKm).toBeLessThan(0.01);
});

test("two close subjects are both admitted and the box holds them", () => {
	// The admission must not become "the biggest one only": a hull beside a
	// station is exactly the case `station-flank` is, and dropping the hull
	// would leave the thing in the foreground unshadowed.
	const hull = { center: [0, -0.04, -0.14] as const, radiusKm: 0.02 };
	const station = { center: [0, 0, -2.4] as const, radiusKm: 0.87 };
	const box = shadowBox([hull, station]);
	if (!box) throw new Error("no box");
	expect(box.radiusKm).toBeGreaterThan(station.radiusKm);
});

test("a subject at the camera is always admitted", () => {
	// The cabin. Its centre is essentially the camera's own position, so the
	// apparent-size arithmetic has to survive a distance of zero rather than
	// dividing by it.
	const cabin = { center: [0, 0, 0] as const, radiusKm: 0.09 };
	expect(shadowBox([cabin])?.radiusKm).toBeCloseTo(0.09, 9);
	const atZero = { center: [0, 0, 0] as const, radiusKm: 0 };
	expect(shadowBox([atZero])).not.toBeNull();
});

test("nothing in the near layer means no box rather than a box of nothing", () => {
	expect(shadowBox([])).toBeNull();
});

/**
 * #241's gate — whether the two passes run at all this frame.
 *
 * The cost that opened the node, measured headed on an M1 Pro at 1440x900 and
 * device scale 2 on #241's build, in empty space: the pair takes a 1.666 ms
 * frame to 3.776 at the default sample count and a 6.662 ms one to 10.815 at
 * the principal's 2x, because antialias multiplies every later fill-rate term.
 * (Node #249 re-measured these; the 3.740 / 18.681 first written here did not
 * reproduce on any build, and `occlusion.ts` says why.) What it buys
 * there is 0.003% of pixels darkened at `station-flank` and 0.002% at
 * `cockpit-arrival`, against 6.06% in a bay.
 *
 * So the gate's axis is **enclosure**, and the quantity that measures it is the
 * apparent size of the largest station in the frame — the same arithmetic
 * `shadowBox` already admits by, one order of magnitude further up. Two drafts
 * were rejected on paper before this one and the node records both: "any
 * subject besides the cabin" opens at five radii where the pair shows nothing,
 * and `DockPhase !== "flying"` fires on the aperture plane, which is well after
 * the bay fills the canopy.
 *
 * The tests below are written against the exported thresholds rather than
 * against their values, because the values are a reading off the approach
 * ladder and the behaviour is not.
 */
test("a station far enough off to show no shadow does not open the gate", () => {
	// `cockpit-arrival`'s framing: five silhouette radii down the aperture axis,
	// where the *shadow* is measured to darken 0.002% of the frame. The ambient
	// occlusion darkens far more of it than that, nearly all of it the cabin's
	// own corners — `occlusion.ts` separates the two, and gating them together
	// is a look decision on the canonical sheet rather than a free saving.
	const station = { center: [0, 0, -5 * 0.87] as const, radiusKm: 0.87 };
	let gate = CLOSED_GATE;
	for (let i = 0; i < 120; i++) gate = stepOcclusionGate(gate, [station]);
	expect(gate.open).toBe(false);
});

test("a station that fills the canopy opens the gate", () => {
	const station = { center: [0, 0, -0.4] as const, radiusKm: 0.87 };
	let gate = CLOSED_GATE;
	for (let i = 0; i < OCCLUSION.gate.openFrames; i++)
		gate = stepOcclusionGate(gate, [station]);
	expect(gate.open).toBe(true);
});

test("nothing in the frame keeps the gate shut, which is empty space", () => {
	let gate = CLOSED_GATE;
	for (let i = 0; i < 120; i++) gate = stepOcclusionGate(gate, []);
	expect(gate.open).toBe(false);
});

test("the gate opens promptly and closes slowly", () => {
	// Asymmetric on purpose. Opening late is a visible pop on a view in the
	// acceptance set; closing early is a pass that flickers back on.
	expect(OCCLUSION.gate.openFrames).toBeLessThan(OCCLUSION.gate.closeFrames);
	const inside = { center: [0, 0, 0] as const, radiusKm: 0.87 };
	let gate = CLOSED_GATE;
	for (let i = 1; i < OCCLUSION.gate.openFrames; i++) {
		gate = stepOcclusionGate(gate, [inside]);
		expect(gate.open).toBe(false);
	}
	gate = stepOcclusionGate(gate, [inside]);
	expect(gate.open).toBe(true);
	for (let i = 1; i < OCCLUSION.gate.closeFrames; i++) {
		gate = stepOcclusionGate(gate, []);
		expect(gate.open).toBe(true);
	}
	expect(stepOcclusionGate(gate, []).open).toBe(false);
});

test("a station sitting between the two thresholds does not chatter", () => {
	// The hysteresis band. A subject whose apparent size is inside it must leave
	// the gate in whichever state it was already in, in both directions —
	// otherwise a station drifting across the threshold reallocates the 2048²
	// depth target and recompiles the ambient occlusion's chain on alternate
	// frames.
	expect(OCCLUSION.gate.closeRad).toBeLessThan(OCCLUSION.gate.openRad);
	const between = (OCCLUSION.gate.openRad + OCCLUSION.gate.closeRad) / 2;
	const radiusKm = 0.87;
	const band = {
		center: [0, 0, -radiusKm / Math.sin(between)] as const,
		radiusKm,
	};
	let shut = CLOSED_GATE;
	for (let i = 0; i < 240; i++) shut = stepOcclusionGate(shut, [band]);
	expect(shut.open).toBe(false);

	const inside = { center: [0, 0, 0] as const, radiusKm };
	let open = CLOSED_GATE;
	for (let i = 0; i < OCCLUSION.gate.openFrames; i++)
		open = stepOcclusionGate(open, [inside]);
	expect(open.open).toBe(true);
	for (let i = 0; i < 240; i++) open = stepOcclusionGate(open, [band]);
	expect(open.open).toBe(true);
});

test("a single frame's dropout does not close an open gate", () => {
	// A station leaving the near layer for one frame at the handoff hysteresis
	// band, or a candidate list built a frame late. The consecutive count is
	// what makes this a non-event rather than a switch.
	const inside = { center: [0, 0, 0] as const, radiusKm: 0.87 };
	let gate = CLOSED_GATE;
	for (let i = 0; i < OCCLUSION.gate.openFrames; i++)
		gate = stepOcclusionGate(gate, [inside]);
	expect(gate.open).toBe(true);
	gate = stepOcclusionGate(gate, []);
	gate = stepOcclusionGate(gate, [inside]);
	expect(gate.open).toBe(true);
	expect(gate.pending).toBe(0);
});

test("the largest station in the frame decides, not the nearest", () => {
	// Two subjects, and the one that opens the gate is whichever subtends more.
	// A greeble at arm's length is not a station filling the canopy, and the
	// rule that separates them is apparent size rather than distance.
	const radiusKm = 0.87;
	const looming = {
		center: [0, 0, -radiusKm / Math.sin(OCCLUSION.gate.openRad * 1.2)] as const,
		radiusKm,
	};
	const tiny = { center: [0, 0, -0.05] as const, radiusKm: 0.001 };
	let gate = CLOSED_GATE;
	for (let i = 0; i < OCCLUSION.gate.openFrames; i++)
		gate = stepOcclusionGate(gate, [tiny, looming]);
	expect(gate.open).toBe(true);

	let onlyTiny = CLOSED_GATE;
	for (let i = 0; i < 120; i++) onlyTiny = stepOcclusionGate(onlyTiny, [tiny]);
	expect(onlyTiny.open).toBe(false);
});

const rocks = (
	level0Rocks: number,
	quality: FieldGateInput["quality"] = "high",
): FieldGateInput => ({ level0Rocks, quality });

test("a level-0 rock opens the gate on quality high after the station's frame count", () => {
	let gate = CLOSED_GATE;
	for (let i = 1; i < OCCLUSION.gate.openFrames; i++) {
		gate = stepOcclusionGate(gate, [], rocks(1));
		expect(gate.open).toBe(false);
	}
	gate = stepOcclusionGate(gate, [], rocks(1));
	expect(gate.open).toBe(true);
});

test("a level-0 rock holds the gate open and its loss closes it on the station's close count", () => {
	let gate = CLOSED_GATE;
	for (let i = 0; i < OCCLUSION.gate.openFrames; i++)
		gate = stepOcclusionGate(gate, [], rocks(2));
	expect(gate.open).toBe(true);
	for (let i = 0; i < 240; i++) gate = stepOcclusionGate(gate, [], rocks(1));
	expect(gate.open).toBe(true);
	for (let i = 1; i < OCCLUSION.gate.closeFrames; i++) {
		gate = stepOcclusionGate(gate, [], rocks(0));
		expect(gate.open).toBe(true);
	}
	expect(stepOcclusionGate(gate, [], rocks(0)).open).toBe(false);
});

test("a single frame without a level-0 rock does not close the gate", () => {
	let gate = CLOSED_GATE;
	for (let i = 0; i < OCCLUSION.gate.openFrames; i++)
		gate = stepOcclusionGate(gate, [], rocks(1));
	gate = stepOcclusionGate(gate, [], rocks(0));
	gate = stepOcclusionGate(gate, [], rocks(1));
	expect(gate.open).toBe(true);
	expect(gate.pending).toBe(0);
});

test("field rocks never open the gate on quality low", () => {
	let gate = CLOSED_GATE;
	for (let i = 0; i < 240; i++)
		gate = stepOcclusionGate(gate, [], rocks(5, "low"));
	expect(gate.open).toBe(false);
});

test("quality low gives a rock-held gate up on the close count", () => {
	let gate = CLOSED_GATE;
	for (let i = 0; i < OCCLUSION.gate.openFrames; i++)
		gate = stepOcclusionGate(gate, [], rocks(1));
	expect(gate.open).toBe(true);
	for (let i = 0; i < OCCLUSION.gate.closeFrames; i++)
		gate = stepOcclusionGate(gate, [], rocks(1, "low"));
	expect(gate.open).toBe(false);
});

test("no station in range and no level-0 rock keeps the gate shut", () => {
	const farStation = { center: [0, 0, -500] as const, radiusKm: 0.87 };
	let gate = CLOSED_GATE;
	for (let i = 0; i < 240; i++)
		gate = stepOcclusionGate(gate, [farStation], rocks(0));
	expect(gate.open).toBe(false);
});

test("stations open the gate as before whatever the field says", () => {
	const inside = { center: [0, 0, 0] as const, radiusKm: 0.87 };
	let gate = CLOSED_GATE;
	for (let i = 0; i < OCCLUSION.gate.openFrames; i++)
		gate = stepOcclusionGate(gate, [inside], rocks(0, "low"));
	expect(gate.open).toBe(true);
});
