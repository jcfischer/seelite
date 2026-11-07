# Rare-field discovery implementation — node #1191

This implements the six rulings on parent #1190 and the principal's 2026-11-07
Q1 radius of exactly 1,000 km. It replaces the parked domain-only preparation.

Unknown rare fields retain their physical rocks but do not enter the shared
selection projection, Navigation, target markers or scanner scope. Charted
fields remain public. Normal flight and cruise discover against the ship's
motion and the field centres at the corresponding start/end clocks, including
a frame that crosses the radius entirely. Each motion method owns its previous
point locally; jumps and reloads cannot create a synthetic swept crossing.
The selection cache follows the immutable discovery set, exposing a newly
discovered contact immediately without freezing its orbital position.

This rollout applies to all pilots, including existing saves and boots without
the mining flag. Navigation's SYSTEM MAP caption is presently static, and the
galaxy chart plots systems only; no separate field chart was introduced.

The existing Long-Range Scanner sweep reports a regional system-space field
signal with own-sensors provenance and its original observation time. It does
not discover, select, identify a point contact, charge a separate resource or
invent a carrier. Fresh sweeps read actual present fields. Historical field
source IDs validate stable rare slots and survive a generator no longer
populating one. The existing stale-age and deliberate-resweep rules remain.

Save 19 admits field readings and per-galaxy `fieldDiscoveries`, with bounded,
strict stable-ID parsing independent of deposits, surveys and generator pins.
The optional world-4 domain is omitted when empty, retaining old integrity.
Legacy envelopes reject assembled discoveries or field readings. The immutable
save18 fixture was serialized by unmodified main c8a9f3c0, with system 4 already
visited; it loads with unknown rare fields. A real SaveStore refusal/export test
proves unsupported discovery bytes remain intact and exportable.

Pre-review verification on the implementation included 599 affected tests and
108,566 assertions across 22 files, typecheck, format, script/comment lint,
launcher wiring and production build. The registered live discovery probe
drives both mining-flag settings, actual points rendering while unknown,
scanner-free flight across the threshold, a real Sweep press, selection,
IndexedDB save/reload and the original lead's stale display.

The side-effect-free `scripts/lib/capability-save-case.ts` extraction keeps the
existing timing measurement reusable. `scripts/measure-field-discovery-save.ts`
measures all eight galaxies, all generated timing anchors, all 2,048 retained
rare-slot IDs and every currently generated field lead, with the other live
sweep sources held equal for the incremental comparison. It round-trips the
complete envelope; it does not claim a future refinery queue/custody payload or
simultaneous saturation of every other persistence domain.

Three discovery views extend the canonical set to 101: unknown Navigation,
the regional sweep lead, and discovered Navigation. Capture manifests identify
their real source tree, renderer, camera and fixture. Exact-head Sage responses,
final browser results, complete canonical comparison and actual principal visual
approval are recorded on PR #1202 and the canonical node closure; this receipt
does not substitute for those merge gates.
