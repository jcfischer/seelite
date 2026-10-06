# Photo mode — principal revision of #691 / PR #711

Ratified 2026-10-06 during principal review of PR #711. The principal asked
that mouse clicks while orbiting never fire weapons and that the wheel zoom.
They then chose **Separate Photo mode**, followed by **Freeze while composing**.
These instructions extend #691's original boundary, which excluded zoom.

Photo mode is enabled by its visible button or `view.photo` (default F2).
It switches to the outside view and holds simulation time, the ship, traffic
and combat while rendering continues. The locked mouse orbits horizontally
and vertically; the wheel scales the whole camera rig between 0.25 and 8
times its normal distance. `1` and `3` also orbit, and `2` centres the whole
composition and resets distance. The Photo controls offer Centre, Save
postcard and Exit Photo mode. F2 exits; V also exits to the previous view.

Camera manipulation by mouse is enabled only in Photo mode. Held clicks,
keyboard fire and controller fire cannot shoot there. Entry and exit clear
held keyboard and mouse input and pending pointer deltas. Exiting restores
the previous view and preserves any independent menu pause.
Normal outside-view flight retains mouse steering. The Controls registry
describes the fixed orbit gestures with a Photo-mode scope, keeping the same
physical mouse trigger identity and distinguishing its active modes.

Postcard preview, exported PNG and opened link carry the same angles and
zoom. Schema 3 requires a distance multiplier for exterior cards. Newly
composed cards with no multiplier use schema 2, introduced by #691 for
elevation, including clear and cockpit cards. This changes newly written links
from the previous build's schema 1. Received schema-1 and schema-2 links keep
their original framing and spelling. Older builds that read only schema 1
refuse the new schema-2 and schema-3 links; schema-2 readers refuse schema 3.
A received link remains a read-only seeded scene.

Verification: headless rig, link and real-Game-method regressions plus the
hardware `probe-chase-orbit` rows for frozen time, held click, actual camera
distance, normal flight, preview/export/link parity, panels and docked orbit.
Fresh Sage, full canonical probes and CI are required after this revision.
Principal visual approval is still required before merge.
