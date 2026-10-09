# Sage round 1 response — Codex

Reviewed head 7648c98, PR #829. Configured Claude substrate could not launch; the Codex retry completed all seven lenses. Verdict changes-requested: 37 glossary findings and six suggestions, no code blockers.

Taken: own-property ship-role validation prevents inherited query keys from crashing the viewer. Whole-hull front/top/rear/underside presets now fit camera-space bounds with a margin; the accepted overview and detail view remain unchanged. Capture drives the actual preset buttons and checks the selected view. Removed stale Porter title/loading copy.

Deferred: idle render scheduling changes the instrument used for recorded performance and should be considered with production rendering; capital-builder extraction and unused Porter helper cleanup are optional prototype maintenance, not acceptance blockers.

Declined glossary substitutions: nautical command/bridge geometry is unrelated to the fiction's Intervention resource. Carrier hangar and weapon throat describe physical ship structures, not station domain types. Historical independent reviews and approved generation prompts are evidence and remain verbatim. Replacing their words with Station interior or Intervention would change their meaning. These are scoped terminology false positives; the review's changes-requested status is retained, not presented as approval.

Validation: standalone viewer typecheck and fresh hardware captures of Pilgrim and Lance exercise revised presets and real buttons. Earlier fleet/model evidence remains recorded in HANDOFF-codex.md. The selected canonical PR run at 7648c98 passed model-viewer and mandatory pointer-lock (2/2); 94 other probes were not run. No full-suite or production-merge claim.
