/**
 * What a shadow map and an ambient-occlusion pass need to know, with no
 * renderer in it — #201.
 *
 * The split is `station-interior.ts` / `station-interior-mesh.ts`'s: everything
 * decidable without a GPU is decided here and headless-tested, and
 * `occlusion-mesh.ts` is the half that touches Three.js. What lives here is the
 * arithmetic that makes **one** shadow map serve subjects four orders of
 * magnitude apart, and the one rule that says which surfaces take part.
 *
 * ## The problem this module is the answer to
 *
 * The near layer holds three kinds of subject and their sizes are not close.
 * The cabin is around the camera, the player hull is 146 m ahead of it in
 * chase, and a station is a kilometre of structure anywhere out to
 * `HANDOFF_KM` — ten thousand of them.
 *
 * **No table of radii here, and that is deliberate.** The first version of this
 * docstring carried one, and every figure in it was arithmetic done in my head
 * rather than a reading — which is the failure this repo has a rule about. What
 * a shadow's quality actually depends on is the *texel*, and
 * `scripts/probe-occlusion.mjs` prints it on every run for two framings and
 * goes red if either leaves its ceiling. On a passing run it reports **1.85 m**
 * for the `station-flank` box, which spans the hull and the station beyond it,
 * and **68 mm** for the cabin's — three runs, no digit moving. Read them there.
 *
 * A 2048² shadow map is 2048 texels across whatever box it is given, so the
 * box has to be *fitted to the subject* every frame or it is either a metre of
 * resolution over a cabin or eight kilometres of it over everything. Fitting
 * the box is the easy half. The half that is not obvious, and the reason this
 * is arithmetic rather than four constants, is that **the two biases that keep
 * a shadow off its own caster do not scale the same way**:
 *
 * - `normalBias` is a push along the surface normal in **world units**, and it
 *   exists to cover one shadow texel's worth of surface. It is therefore
 *   proportional to the subject.
 * - `bias` is added to the depth read out of the map, in the shadow camera's
 *   **own** depth units — and that camera's depth range is itself `2 ×
 *   halfExtent`, i.e. proportional to the subject. So a bias of *k* texels is
 *   the same number at every scale, and this module states it as a constant
 *   rather than deriving it, because deriving it would hide that.
 *
 * The ambient-occlusion half has the identical problem and solves it a
 * different way: three's `GTAOPass` takes `screenSpaceRadius`, which measures
 * the AO footprint in drawing-buffer pixels rather than in kilometres. A
 * screen-space radius is the same fraction of the frame on a cabin and on a
 * station, so nothing is re-fitted per frame and there is no second set of
 * scale arithmetic to keep in step with the first.
 */

/**
 * The shadow map's resolution, and a top-level number on purpose.
 *
 * `probe-guard.mjs` fingerprints a checkout by reading top-level `const NAME =
 * <number>` out of the modules a probe names. Every figure below is nested
 * inside `OCCLUSION`, which the guard cannot see — so naming this module in a
 * guard list without this line would make the probe throw before it started,
 * which is the trap `CLAUDE.md` records against `station-visuals.ts`.
 *
 * 2048 rather than 1024 or 4096 because #201 asked for it. What that buys is
 * `shadowFit`'s to describe and `scripts/probe-occlusion.mjs`'s to measure.
 */
export const SHADOW_MAP_TEXELS = 2048;

/** How much wider than its subject the orthographic box is cut. Margin rather
 *  than a snug fit because a bounding sphere is not a bounding box: a subject
 *  rotated inside its own sphere still has to project inside the map. */
const SHADOW_MARGIN = 1.15;

/** How far off the subject's centre the shadow camera stands, in subject
 *  radii. An orthographic projection does not care about distance, so this
 *  only has to put the near plane in front of the subject and keep the far
 *  plane behind it — four radii leaves a radius of slack at both ends. */
const SHADOW_PUSHBACK = 4;

/** The world-space normal push, in shadow texels. Scales with the subject
 *  because a texel does. */
const SHADOW_NORMAL_BIAS_TEXELS = 1.5;

/**
 * The depth push, in shadow texels — and it is the scale-free one.
 *
 * `shadow.bias` is added to the depth sampled from the map, which for the
 * orthographic camera below runs `[near, far]` → `[0, 1]` over a span of
 * `2 × halfExtent`. One texel of slope is `texelKm / (2 × halfExtent)`, and
 * `texelKm` is `2 × halfExtent / SHADOW_MAP_TEXELS` — so the span cancels and
 * a bias of k texels is `k / SHADOW_MAP_TEXELS` at every subject size.
 */
const SHADOW_DEPTH_BIAS_TEXELS = 1;

/**
 * The smallest subject the fit will take, in kilometres.
 *
 * Not a tuning value: a subject of zero radius divides every length below to
 * zero and hands three a shadow camera with `near === far`, which renders a
 * frame of nothing and shadows everything. It happens for real — a hull hidden
 * this frame, or bounds asked for before a mesh has any.
 */
const SHADOW_MIN_RADIUS_KM = 1e-4;

/** A subject the shadow map is fitted to: a bounding sphere in **near-layer
 *  scene units**, which are kilometres relative to the camera. */
export type ShadowSubject = {
	readonly center: readonly [number, number, number];
	readonly radiusKm: number;
};

/** Everything the renderer needs to place and bias one frame's shadow camera. */
export type ShadowFit = {
	/** Half the orthographic box, in kilometres — `left`/`right`/`top`/`bottom`. */
	readonly halfExtentKm: number;
	/** How far along the light direction the camera stands off the centre. */
	readonly pushbackKm: number;
	readonly nearKm: number;
	readonly farKm: number;
	/** One shadow texel's footprint on the subject. The figure a framing is
	 *  judged by: it is what the smallest shadow this map can draw measures. */
	readonly texelKm: number;
	/** `DirectionalLightShadow.bias`, in the shadow camera's depth units. */
	readonly bias: number;
	/** `DirectionalLightShadow.normalBias`, in kilometres. */
	readonly normalBias: number;
};

/**
 * Fit the orthographic shadow camera to a subject of this radius.
 *
 * `texelKm` is the figure a framing's shadow quality is read from, and it is
 * the one this returns for somebody else to print rather than one this
 * docstring asserts: `main.ts` holds the last frame's on `Game.shadowTexelKm`
 * and `scripts/probe-occlusion.mjs` reads it back and bounds it.
 *
 * What the two framings it bounds actually measure, and what that buys: the
 * `station-flank` box spans the hull and the station beyond it at **1.85 m** a
 * texel, and the cabin's box at **68 mm**. At metres, a station's aperture and
 * its booms — hundreds of metres each — cast cleanly and a greeble of ten or
 * twenty casts something soft. The bay's corners are the ambient-occlusion
 * pass's to darken rather than this one's, and that division is `main.ts`'s to
 * state where the two are wired.
 */
export function shadowFit(radiusKm: number): ShadowFit {
	const r = Math.max(radiusKm, SHADOW_MIN_RADIUS_KM);
	const halfExtentKm = r * SHADOW_MARGIN;
	const pushbackKm = r * SHADOW_PUSHBACK;
	const texelKm = (2 * halfExtentKm) / SHADOW_MAP_TEXELS;
	return {
		halfExtentKm,
		pushbackKm,
		nearKm: pushbackKm - halfExtentKm,
		farKm: pushbackKm + halfExtentKm,
		texelKm,
		// See `SHADOW_DEPTH_BIAS_TEXELS`: the depth span cancels, so this is one
		// number for every subject rather than a function of `r`.
		bias: -SHADOW_DEPTH_BIAS_TEXELS / SHADOW_MAP_TEXELS,
		normalBias: texelKm * SHADOW_NORMAL_BIAS_TEXELS,
	};
}

/**
 * The bounding sphere of two, which is not the larger of the two.
 *
 * Both containment arms are written out because only one of them was, once: a
 * union that tests `d + b.r <= a.r` and not the mirror grows the sphere every
 * time the *second* argument is the container, so the box drifts wider as the
 * ship flies around a station and the shadows go soft with no other symptom.
 */
function merge(a: ShadowSubject, b: ShadowSubject): ShadowSubject {
	const dx = b.center[0] - a.center[0];
	const dy = b.center[1] - a.center[1];
	const dz = b.center[2] - a.center[2];
	const d = Math.hypot(dx, dy, dz);
	if (d + b.radiusKm <= a.radiusKm) return a;
	if (d + a.radiusKm <= b.radiusKm) return b;
	const radiusKm = (a.radiusKm + b.radiusKm + d) / 2;
	// Concentric to within a float: the direction below would be 0/0.
	if (d < 1e-12) return { center: a.center, radiusKm };
	const t = (radiusKm - a.radiusKm) / d;
	return {
		center: [a.center[0] + dx * t, a.center[1] + dy * t, a.center[2] + dz * t],
		radiusKm,
	};
}

/** The one sphere containing all of them, or `null` for none. */
export function unionOfSubjects(
	subjects: readonly ShadowSubject[],
): ShadowSubject | null {
	if (subjects.length === 0) return null;
	let out = subjects[0];
	for (let i = 1; i < subjects.length; i++) out = merge(out, subjects[i]);
	return out;
}

/**
 * The smallest a subject may look and still be admitted to the shadow box, as
 * an angular radius in radians.
 *
 * **This is the admission that stops the box being 405 km wide.** The near
 * layer reaches `HANDOFF_KM` — ten thousand kilometres — and a system has one
 * to three stations, so "every station in the near layer" is a set whose
 * members can be hundreds of kilometres apart. Measured in the `station-flank`
 * framing before this existed: the fixture's second station sat 405 km off, the
 * union spanned both, and the shadow texel was **455 m**. The pass ran, cost a
 * frame, and drew nothing anyone could see.
 *
 * Half a degree. The near cameras have a 60° vertical field and the sheet is
 * captured at 900 px tall, so this is a subject about 15 px in radius — beside
 * #134's measured floor of 31–40 px of *width* for a station to read as a
 * station at all. Below it there is nothing a shadow could land on.
 */
const SHADOW_MIN_APPARENT_RAD = 0.0087;

/**
 * How far past the largest subject's own radius the union may grow.
 *
 * The apparent-size floor above handles the case that actually occurs. This
 * handles the one that would occur next: two stations both close enough to
 * admit but on opposite sides of the camera, where the union is legitimately
 * enormous and neither would be resolved. Candidates are taken largest-first by
 * **physical** radius rather than apparent size, which is the ordering that
 * makes this a bound on anything: the biggest thing in the frame is the one
 * whose own texel budget is being spent, and the hull — apparently the largest
 * and physically the smallest — would otherwise set a limit that excluded the
 * station it stands beside.
 */
const SHADOW_UNION_LIMIT = 4;

/**
 * The subjects the shadow box is actually cut to, or `null` for none.
 *
 * The camera sits at the origin of the near scene — every frame places the
 * world relative to it (`main.ts`, `render`) — so a candidate's apparent size
 * is its radius over its distance and needs no camera passed in.
 */
export function shadowBox(
	candidates: readonly ShadowSubject[],
): ShadowSubject | null {
	const admitted = candidates
		.filter((c) => {
			const d = Math.hypot(c.center[0], c.center[1], c.center[2]);
			// Inside the subject — the cabin, which is around the camera — is a
			// half-turn of apparent size rather than a division by nothing.
			return (
				d <= c.radiusKm || Math.asin(c.radiusKm / d) >= SHADOW_MIN_APPARENT_RAD
			);
		})
		.sort((a, b) => b.radiusKm - a.radiusKm);
	if (admitted.length === 0) return null;
	const limit = admitted[0].radiusKm * SHADOW_UNION_LIMIT;
	let box = admitted[0];
	for (let i = 1; i < admitted.length; i++) {
		// `unionOfSubjects` rather than `merge`, so the box the loop carries and
		// the box a test asserts containment on come out of the same arithmetic.
		const next = unionOfSubjects([box, admitted[i]]) as ShadowSubject;
		if (next.radiusKm > limit) continue;
		box = next;
	}
	return box;
}

/** What the predicate below reads off a material. `lit` is "does three light
 *  this at all" — `MeshBasicMaterial`, `ShaderMaterial`, points and lines do
 *  not qualify, and every unlit thing in this game is one of those. */
export type SurfaceFacts = {
	readonly lit: boolean;
	readonly transparent: boolean;
	readonly opacity: number;
};

/**
 * Whether a surface casts and receives the sun's shadow.
 *
 * **One rule, and it is not a list of mesh names.** #201 asks for the hull,
 * the cockpit fittings, station structure, greebles and the bay's walls and
 * berths in, and the emissive lamps, the canopy glass and the star field out.
 * Every one of those falls out of *lit and opaque*: the lamps and the
 * nameplates are `MeshBasicMaterial`, the canopy is a transparent one, the
 * planets and the cruise streak field (`warp.ts`) are a `ShaderMaterial` and a
 * `LineSegments`,
 * and everything the node wants in is a `MeshStandardMaterial` or the bay's
 * `MeshLambertMaterial`.
 *
 * The one case the rule keeps that a name list would have dropped is the
 * station's **lit window panes**, which are `MeshStandardMaterial` with an
 * emissive term. They sit flush in the hull that already casts, so they add a
 * pane to the shadow map and change no pixel: three adds emissive after the
 * light, so a shadow on one is invisible.
 */
export function participatesInShadow(surface: SurfaceFacts): boolean {
	return surface.lit && !surface.transparent && surface.opacity >= 1;
}

/**
 * The screen-space ambient occlusion settings, as three's `GTAOPass` takes
 * them.
 *
 * `screenSpaceRadius` is the field that matters and it is why there is no AO
 * counterpart to `shadowFit`: with it set, `radius` is measured in hundreds of
 * drawing-buffer pixels instead of in kilometres, so the AO footprint is the
 * same fraction of the frame over a 30 m cabin and a 1.4 km station and
 * nothing is re-fitted per frame.
 *
 * `thicknessKm` is the one figure that stays a length, and it is what keeps
 * the pass off the background: a sample whose view-space depth differs from
 * the shaded point's by more than this is a different object rather than an
 * occluder. One kilometre admits every feature of every near-layer subject and
 * rejects a near-layer planet, which is thousands of kilometres behind
 * whatever is in front of it.
 */
export const OCCLUSION = {
	ao: {
		screenSpaceRadius: true,
		/** In hundreds of drawing-buffer pixels — 25 of them at this figure. */
		radius: 0.25,
		distanceExponent: 1,
		thicknessKm: 1,
		/** `pow(ao, scale)`. One is linear; above one darkens the contact and
		 *  leaves the open surface alone. */
		scale: 1,
		samples: 16,
		blendIntensity: 1,
		/**
		 * The fraction of the drawing buffer the pass runs at.
		 *
		 * **A half, and it was flown at full first.** The comment that shipped
		 * for a round said the opposite — that AO is a contact term read at the
		 * pixel, so the first thing a half-resolution one loses is the contact —
		 * and it was written before the pass was priced. It costs, on an M1 Pro
		 * at 1440x900 and device scale 2, in the `cockpit-arrival` framing whose
		 * unoccluded frame is 1.82 ms:
		 *
		 * | | full buffer | half |
		 * |---|---|---|
		 * | 16 samples | +5.215 ms | **+1.693 ms** |
		 * | 8 samples | +4.211 ms | +1.459 ms |
		 * | 4 samples | +3.741 ms | +1.331 ms |
		 *
		 * Two things fall out of that table and both are decisions. The **sample
		 * count is not the lever** — a quarter of the samples buys 28% at full
		 * resolution and 21% at half, because most of the pass is the
		 * normal-and-depth render, the denoise and two full-screen blends rather
		 * than the horizon loop. The **resolution is**: it is a 3.1x saving at
		 * the same sample count, and it is what brings **this pass** from 2.9x
		 * the whole frame down to inside #201's own estimate of one to two
		 * milliseconds. It does not bring the *pair* inside it: with the shadow
		 * map beside it the two cost 2.50–2.84 ms against a 1.91–2.11 ms frame,
		 * which `settings.ts` states and leaves open rather than answered.
		 *
		 * So the samples stay at three's default and this is the dial that
		 * moved. What a half costs in the picture is a person's to judge on the
		 * canonical sheet, which is the tier this repo has for exactly that.
		 */
		resolutionScale: 0.5,
	},
} as const;
