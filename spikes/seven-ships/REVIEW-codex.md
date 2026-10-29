## Address Sage review round 3 — LOD continuation

Review at a9d5e8743e6a05d4caa09b8a7ef280e5f3c6014a: changes-requested, 46 important and two suggestions. One substantive test defect was confirmed and repaired; the other 45 important findings are glossary matches in mechanical descriptions and historical review records.

- **Taken:** vertex radii did not prove triangle-surface clearance. The exported-GLB test now minimizes radius over each projected triangle, including its edges and interior. Regression fixtures include Sage's edge example, origin-containing triangles and degenerate projected segments. Both capital full models measure **1.558017 m** conservative radial clearance, above the 0.5 m test gate. The authoring report's older 1.60 m number is now explicitly `authoredVertexGapMetres`, a diagnostic rather than a surface-clearance claim. No model geometry changed in this review fix.
- **Deferred suggestion:** progressively showing the full model before both LODs load is a useful viewer enhancement, but this isolated comparison page deliberately declares ready only when all selectable levels are available. Production boot/background installation remains separate (node 838). No production loader is changed here.
- **Declined nit:** the empty historical service-light loop is inert; it does not affect these models or LOD behavior. It can be removed in a viewer cleanup.
- **Declined glossary findings:** nautical bridge/crew command descriptions are not the game-economy Intervention operand; a comparison judge's use of reward is not the Bounty mechanic. Historical review language and approved image prompts remain verbatim. Inserting comment syntax into JSON would be invalid. Prior review dispositions already explain these same domain mismatches.

Verification after the test correction: **15 tests / 1,565 assertions passed**. Existing final asset captures remain valid because no geometry or viewer behavior changed. Stop reviewing under map #1's rule when the remaining findings are suggestions or arguments about prose. This records dispositions; it does not relabel Sage's raw changes-requested verdict as approval. PR remains a draft for separate production adoption.

---

# Sage round 1 response — Codex

Reviewed head 7648c98, PR #829. Configured Claude substrate could not launch; the Codex retry completed all seven lenses. Verdict changes-requested: 37 glossary findings and six suggestions, no code blockers.

Taken: own-property ship-role validation prevents inherited query keys from crashing the viewer. Whole-hull front/top/rear/underside presets now fit camera-space bounds with a margin; the accepted overview and detail view remain unchanged. Capture drives the actual preset buttons and checks the selected view. Removed stale Porter title/loading copy.

Deferred: idle render scheduling changes the instrument used for recorded performance and should be considered with production rendering; capital-builder extraction and unused Porter helper cleanup are optional prototype maintenance, not acceptance blockers.

Declined glossary substitutions: nautical command/bridge geometry is unrelated to the fiction's Intervention resource. Carrier hangar and weapon throat describe physical ship structures, not station domain types. Historical independent reviews and approved generation prompts are evidence and remain verbatim. Replacing their words with Station interior or Intervention would change their meaning. These are scoped terminology false positives; the review's changes-requested status is retained, not presented as approval.

Validation: standalone viewer typecheck and fresh hardware captures of Pilgrim and Lance exercise revised presets and real buttons. Earlier fleet/model evidence remains recorded in HANDOFF-codex.md. The selected canonical PR run at 7648c98 passed model-viewer and mandatory pointer-lock (2/2); 94 other probes were not run. No full-suite or production-merge claim.
