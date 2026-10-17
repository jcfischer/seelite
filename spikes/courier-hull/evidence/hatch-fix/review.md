# Small access hatch correction — Codex, 2026-10-08

The principal's annotated screenshot identified the smaller handled hatches on either side of the centerline and on the sloped shoulders. The previous correction had addressed only the larger centerline covers, so its claim of resolving the fittings was incomplete.

All `hatch()` fittings now have their entire geometry mapped to the local skin: longitudinal pitch and transverse slope both affect the base, lid, fasteners and handle. The bases are inset, the lids stand only slightly proud, and the former raised, horizontal boxes are gone. Main-deck sampling follows the faceted armour strips; shoulder hatches follow the shoulder slope; nacelle hatches sit on their flat armour surface.

Verification:

- Export regression: 2 tests, 3666 assertions pass. Small body-hatch seats now participate in the hull-under-every-vertex check alongside the centerline covers. The three closed backing meshes remain consistently outward-wound. <!-- glossary-ignore: wound -->
- Live `hatch-close.png` and `hatch-profile.png`: both the deck row and the shoulder hatch are seated and angled with their surfaces.
- Independent visual review: no visible floating bases or remaining alignment blocker; only thin rims, hinges and handles stand proud.
- Hardware capture on ANGLE Metal / Apple M1 Pro: zero browser errors, all viewer controls pass; short cadence sample 52.16 FPS. This is not a production benchmark or a new overall fidelity score.

The prior 6.0/10 comparison remains the last overall fidelity score. This pass specifically repairs the missed fittings.
