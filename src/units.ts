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
 * **Now load-bearing.** While the world was a scaffold this was a name with no
 * call site: bodies were far and the station was near, by kind, forever. Real
 * content ends that — a system's stations sit on planetary orbits an AU or more
 * from the arrival point, and a station drawn at 1:1 an AU away is past the near
 * camera's far plane, which on screen is indistinguishable from the game having
 * generated nothing. So the layer a body draws in is now its *distance* from
 * the camera against this number, for every body regardless of kind. "Bodies
 * far, stations near" is what that rule produces when you are parked at a
 * station, which is the only situation the scaffold ever had.
 *
 * The handoff is measured centre-to-camera. For a gas giant, whose radius can
 * exceed this distance, that means the swap happens when the camera is already
 * inside the sphere — a body's *surface* would be the honest test. Nothing can
 * approach a planet yet (#10's cruise regime is unbuilt) and there is no
 * collision, so the two rules are indistinguishable in play; the surface form
 * needs a near layer that reaches past `NEAR_FAR_KM`, which is a real decision
 * and not one to settle in a renderer.
 */
export const HANDOFF_KM = 1e4;

/**
 * The hysteresis on that handoff: a body admitted to the near layer is not
 * returned to the far one until it is this much further out.
 *
 * Not about apparent size, which is identical either side by construction. It is
 * about *ordering* — the near pass clears depth, so a body oscillating across
 * the threshold would swap in front of and behind its neighbours on alternate
 * frames. One band is cheaper than reasoning about when that matters.
 *
 * Here rather than in the renderer that applies it, because it widens the reach
 * the near layer must actually have: the constraint is
 * `HANDOFF_KM × HANDOFF_HYSTERESIS < NEAR_FAR_KM`, and a constant living in
 * `main.ts` could only be checked with a browser open. `tests/headless.test.ts`
 * asserts it as the arithmetic it is.
 */
export const HANDOFF_HYSTERESIS = 1.05;

/**
 * The far layer's camera planes, in *far-layer units* (kilometres × FAR_SCALE).
 *
 * The near plane must admit a body that has *not* yet crossed the handoff, or
 * there is a band between `FAR_NEAR_UNITS / FAR_SCALE` and `HANDOFF_KM` where a
 * body is in the far layer and clipped out of it. At `HANDOFF_KM` a body sits
 * at 0.1 units, so this is half that.
 *
 * The far plane is bounded by the *content*, which is what makes it affordable:
 * `MAX_ORBIT_AU` is 6 and the arrival point sits inside ~7 AU of the star, so
 * nothing in a system is more than ~13 AU from the camera. 4·10⁴ units is 26 AU
 * — comfortable headroom on that, and a near:far ratio of 8·10⁵, which is
 * *tighter* than the 10⁶ the scaffold ran at with a 1-unit near plane. Dropping
 * the near plane to make room for the handoff costs nothing in depth precision
 * because the far plane came down further.
 */
export const FAR_NEAR_UNITS = 0.05;
export const FAR_FAR_UNITS = 4e4;

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
