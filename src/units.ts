/**
 * The unit scheme, and the distances the three render layers are cut at.
 *
 * A leaf: it imports nothing, and that is its job. Both the headless simulation
 * and the renderer read these, and neither should have to import the other to
 * find out how big a kilometre is.
 *
 * The scheme comes from the scale research
 * (`docs/research/space-scale-rendering.md`, node #3) and is not a free choice
 * to make locally:
 *
 * - **Sim space is kilometres in float64**, plain JS numbers, outside Three.js.
 *   1 AU ≈ 1.5·10⁸ km sits well inside float64's 53-bit mantissa — sub-
 *   millimetre precision at that distance — so nothing in the simulation needs
 *   a split-double trick.
 * - **Render space is float32**, so everything the GPU sees must stay within
 *   ~10⁴ units of the origin. Past ~10⁵ the quantisation is visible as jitter;
 *   past ~10⁶ it is obvious.
 *
 * Those two facts are why there is a `FAR_SCALE` at all: no single float
 * coordinate space spans a solar system, so distant bodies are drawn shrunk and
 * pulled in by the same factor, which preserves their angular size while
 * bringing their coordinates back into budget.
 */

/** One astronomical unit, in kilometres. The IAU's exact definition. */
export const AU_KM = 1.495978707e8;

/**
 * How far out the near layer reaches, in kilometres.
 *
 * Ships, stations, cargo, weapons fire — anything drawn at 1:1 — lives inside
 * this radius, so the largest coordinate the GPU sees from the near layer is
 * 2·10⁴. That is an order of magnitude below where jitter starts, which leaves
 * room for the layer to grow without a precision review.
 */
export const NEAR_FAR_KM = 2e4;

/**
 * The near camera's near plane, in kilometres — 10 metres.
 *
 * With a far plane of `NEAR_FAR_KM` this is a near:far ratio of 2·10⁶, which a
 * 24-bit depth buffer carries without z-fighting. That ratio is the whole
 * reason the layering exists, and it is why `logarithmicDepthBuffer` is *not*
 * enabled: log-depth writes `gl_FragDepth`, which disables early-Z and costs
 * several milliseconds a frame, to solve a problem this scheme does not have.
 */
export const NEAR_NEAR_KM = 0.01;

/**
 * The far layer's scale factor — "scaled space", the KSP trick.
 *
 * A body's position *and* radius are both multiplied by this, so its angular
 * size is unchanged and it looks exactly as big as it should. A star at 1 AU
 * lands at 1,495 units; a planet 5 AU out lands at ~7,500. Both comfortably
 * inside the f32 budget, which is what the factor was chosen for.
 */
export const FAR_SCALE = 1e-5;

/**
 * Where an approaching body changes layers, in kilometres.
 *
 * Deliberately below `NEAR_FAR_KM`: the handoff has to happen while the object
 * is still inside the near layer's reach, or it would vanish for the span
 * between leaving one layer and being admitted to the other.
 *
 * Nothing crosses it yet — the scaffold's bodies are all far and its ship and
 * station are all near — and the exact distance is one of the open questions
 * the scale research left. It is named here so that when something does cross,
 * there is one number to argue about rather than two call sites to find.
 */
export const HANDOFF_KM = 1e4;

/**
 * The radius the background star sphere is drawn at, in *background-layer*
 * units — which are not kilometres and are not meant to be.
 *
 * The background layer has no depth of its own: it is drawn first, with depth
 * writes off, and re-centred on the camera every frame so it never parallaxes.
 * The radius is therefore arbitrary and only has to sit between that layer's
 * near and far planes.
 */
export const BACKDROP_RADIUS = 5;
