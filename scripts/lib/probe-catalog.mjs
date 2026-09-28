/**
 * Behavioral contracts for every gating browser probe.
 *
 * The runner still discovers executable files from disk. This catalog is the
 * semantic half of that inventory: the TypeSafe selector needs to know what a
 * probe proves, not merely what its filename is. `tests/probe-selection.test.ts`
 * holds both halves together so adding or removing a gate cannot silently leave
 * the selector behind.
 */

const entry = (file, contract, evidence) =>
	Object.freeze({
		file,
		id: file.replace(/\.mjs$/, "").replaceAll("-", "_"),
		contract,
		evidence: Object.freeze(evidence),
	});

export const PROBE_CATALOG = Object.freeze(
	[
		entry(
			"measure-cruise-detour.mjs",
			"Runs the corpus gate for automatic cruise detours through the real Game steering loop.",
			["cruise routing", "detour geometry", "Game steering"],
		),
		entry(
			"probe-adaptive-resolution.mjs",
			"Proves the live browser wiring and render-target effects of automatic resolution scaling.",
			["adaptive resolution", "render scale", "frame pressure", "composer"],
		),
		entry(
			"probe-approach-handoff.mjs",
			"Checks the spatial handoff from long-range approach into the local station flight frame.",
			["approach", "station handoff", "local frame", "render layers"],
		),
		entry(
			"probe-arrival.mjs",
			"Flies cruise arrivals to stations beside or behind host planets and checks reachable geometry.",
			["cruise arrival", "host planet", "moving body", "station reachability"],
		),
		entry(
			"probe-audio-cues.mjs",
			"Renders every sound cue offline through the engine's buses and limiter, holds each in bands centred on the pre-bus engine, and checks the mute, the bus rows and the voice cap on a burst.",
			[
				"audio",
				"sound cues",
				"buses",
				"limiter",
				"voice pool",
				"volume settings",
			],
		),
		entry(
			"probe-console-sound.mjs",
			"Plays the running game's consoles and reads back which cue each act asks for: a tab or a purchase is a press, a refused purchase a refusal, a cursor move and a hover a tick, a clearance answer one message, and the legacy arm none of them.",
			[
				"audio",
				"console sound",
				"notifications",
				"button clicks",
				"refusal",
				"pad focus",
				"hover",
				"docking clearance",
			],
		),
		entry(
			"probe-flight-sound.mjs",
			"Flies the running game and reads back the ship's loop levels: a burn raises the drive and holding speed idles it, a turn fires the thrusters, cruise spools, engages and drops with one cue each, and the legacy arm plays only the old bed.",
			[
				"audio",
				"flight sound",
				"drive",
				"thrusters",
				"cruise",
				"throttle",
				"flight assist",
			],
		),
		entry(
			"probe-boot.mjs",
			"Checks that the normal page boots cleanly and exposes the renderer, world, and deterministic seed contract.",
			["application boot", "renderer", "seed", "window handle", "page errors"],
		),
		entry(
			"probe-bounty.mjs",
			"Flies the Bounty checkpoint: a locked row without the Long-Range Scanner, a Wanted refusal, accept, the relay kill, and one paid report.",
			[
				"bounty",
				"Requests UI",
				"pirate relay",
				"equipment gate",
				"legal standing",
			],
		),
		entry(
			"probe-carrier-scan.mjs",
			"Exercises the cockpit carrier scan and Target-panel transition from unknown to identified standing.",
			[
				"carrier identity",
				"scanner",
				"Target panel",
				"standing",
				"last-known state",
			],
		),
		entry(
			"probe-cockpit-surface.mjs",
			"Verifies live cockpit surface geometry, plating materials, and reversible renderer controls.",
			["cockpit", "surface", "plating", "materials", "scene graph"],
		),
		entry(
			"probe-commander.mjs",
			"Exercises the Commander overlay, new/load choices, held game clock, and store attachment in a page.",
			["Commander", "new game", "load", "save store", "overlay", "game clock"],
		),
		entry(
			"probe-controls-reference.mjs",
			"Checks the Controls tab through keyboard, pointer, and gamepad interactions at desktop and narrow sizes.",
			[
				"controls reference",
				"console tab",
				"keyboard",
				"gamepad",
				"responsive layout",
			],
		),
		entry(
			"probe-cruise-detour.mjs",
			"Flies a bounded automatic station detour through the live Game loop and checks route progress.",
			["cruise", "automatic detour", "station target", "route progress"],
		),
		entry(
			"probe-cruise-light.mjs",
			"Checks the cruise light shift on the star backdrop: the shader places a star where aberration says, bodies and markers stay true, the keys still fly and a drop-out eases.",
			["cruise", "light shift", "star field", "backdrop layer", "starbow"],
		),
		entry(
			"probe-cruise.mjs",
			"Flies the normal cruise regime through charge, travel, layer handoff, exit, and arrival behavior.",
			[
				"cruise",
				"cruise 12 AU reserve",
				"layer handoff",
				"arrival",
				"flight regime",
			],
		),
		entry(
			"probe-death.mjs",
			"Exercises live death handling for saved recovery and permadeath retirement paths.",
			["ship death", "save recovery", "permadeath", "reload", "world state"],
		),
		entry(
			"probe-derived-names.mjs",
			"Moves a command to a free key, reads each surface that names it off the screen — the settings and Commander footers, the Commanders door, the cruise and target prompts, the combat rig's legend and the legacy dial line — presses the key the surface names, and checks it does what the surface says; also that the key legend strip is gone and that the pad reaches the settings door.",
			[
				"derived key names",
				"rebind",
				"settings footer",
				"Commander overlay",
				"cruise prompt",
				"combat rig legend",
				"Controls tab door",
			],
		),
		entry(
			"probe-display-contacts.mjs",
			"Checks that contact producers feed live target selection, Navigation, and scanner presentation.",
			["display contacts", "target selection", "Navigation", "scanner"],
		),
		entry(
			"probe-dock-arrival.mjs",
			"Checks successful dock arrival geometry, berth surfaces, bay visibility, and approach/interior shields.",
			["docking arrival", "station interior", "berth", "bay", "name shield"],
		),
		entry(
			"probe-docking-traffic.mjs",
			"Checks that a cleared docking computer progresses while live Traffic uses the same station.",
			["docking computer", "Traffic", "clearance", "berth arbitration"],
		),
		entry(
			"probe-docking.mjs",
			"Flies successful and refused docking approaches through clearance, alignment, containment, and crossing checks.",
			["docking", "clearance", "aperture", "alignment", "containment"],
		),
		entry(
			"probe-duel-hud.mjs",
			"Checks the live raider-duel HUD, selected-hostile styling, warnings, and on-target sightline.",
			["duel", "combat HUD", "raider", "target ring", "on target"],
		),
		entry(
			"probe-first-day.mjs",
			"Flies a guided new game's first day: docked boot through clearance and its lastDocked checkpoint, station control's line, the First day tab, the Local run accepted, launched, docked, delivered and reported, the glass prompt and the Communications log; and a free pilot left unpushed.",
			[
				"first useful day",
				"onboarding",
				"guided new game",
				"docked start",
				"Local run",
				"station control",
				"First day tab",
			],
		),
		entry(
			"probe-frame-acceleration.mjs",
			"Parks co-moving beside USBISO's gas-giant shipyard with the throttle at zero, assist on and off, and checks the ship stays at rest in the station's accelerating frame.",
			[
				"flight assist",
				"assist off",
				"local frame",
				"frame acceleration",
				"docking approach",
			],
		),
		entry(
			"probe-frame-attribution.mjs",
			"Checks query-gated frame-attribution labels, renderer facts, timer states, and default-route isolation.",
			["frame attribution", "GPU timer", "performance panel", "render passes"],
		),
		entry(
			"probe-galaxy-map.mjs",
			"Exercises orbiting, picking, reading, and routing on the projected three-dimensional galaxy map.",
			["galaxy map", "projection", "picking", "route", "navigation"],
		),
		entry(
			"probe-gamepad.mjs",
			"Checks that the browser gamepad API reaches the frame loop and drives analog ship controls.",
			["gamepad", "navigator.getGamepads", "analog input", "flight controls"],
		),
		entry(
			"probe-gimbal.mjs",
			"Checks live pulse-laser gimbal slew, cone limits, selected-target tracking, and true-hull hits.",
			["laser gimbal", "combat", "targeting", "beam", "hull hit"],
		),
		entry(
			"probe-gun-feedback.mjs",
			"Fires the pulse laser through real keyboard, mouse, and gamepad inputs and checks visible and audible feedback.",
			["weapon input", "laser", "sound", "muzzle feedback", "heat"],
		),
		entry(
			"probe-handoff.mjs",
			"Measures apparent-size continuity as bodies cross between far and near render layers.",
			["render layer", "handoff", "apparent size", "camera distance"],
		),
		entry(
			"probe-hold.mjs",
			"Flies the right console's Hold page in flight and docked: capacity, ownership, and the station's bid.",
			[
				"hold",
				"cargo capacity",
				"what is aboard",
				"entrusted cargo",
				"right console",
				"station bid",
			],
		),
		entry(
			"probe-hud.mjs",
			"Checks full-screen HUD sizing and projection of attitude, velocity, target, and docking markers.",
			["HUD", "projection", "canvas resize", "markers", "cockpit"],
		),
		entry(
			"probe-interdiction.mjs",
			"Exercises a live cruise interdiction, normal-flight drop, hostile contact, damage, and duel transition.",
			["interdiction", "cruise", "raider", "damage", "combat transition"],
		),
		entry(
			"probe-key-dispatch.mjs",
			"Checks the browser keyboard dispatch law for held chords, Alt/Ctrl/Meta routing, head look, flight controls, and F1 Controls access.",
			[
				"keyboard dispatch",
				"Alt Ctrl Meta",
				"held chords",
				"head look",
				"Controls tab",
			],
		),
		entry(
			"probe-binding-store.mjs",
			"Checks that a rebound control survives a page reload and still flies the ship, and that a stored layout the build cannot apply prints a notice naming the control on the Controls tab.",
			[
				"binding storage",
				"localStorage",
				"page reload",
				"player layout",
				"rejected row notice",
				"collision warning",
			],
		),
		entry(
			"probe-capture.mjs",
			"Checks the rebind modal launched from the Controls tab: a stick pushed while it is open is caught by the modal once and ignored by the ship, a pad button is captured and then flies the command it was bound to, and moving every keyboard trigger of every door elsewhere still leaves the tab reachable and settings openable from it. It does not move the doors' pad triggers, so a keyboard-and-pad lockout is not covered.",
			[
				"rebind modal",
				"capture context",
				"gamepad binding",
				"pad stick",
				"settings bootstrap",
				"Controls tab",
			],
		),
		entry(
			"probe-rebind.mjs",
			"Checks that rebinding a flight command onto a new key reaches the simulation: the ship answers the new trigger, stops answering the old one, and a rebind off a trigger the command does not have is refused.",
			[
				"rebind",
				"key binding",
				"binding registry",
				"command dispatch",
				"flight controls",
			],
		),
		entry(
			"probe-light-rig.mjs",
			"Checks live baked-environment orientation, star lighting, material response, and light-rig exposure.",
			[
				"light rig",
				"environment map",
				"star direction",
				"materials",
				"exposure",
			],
		),
		entry(
			"probe-lane-wait.mjs",
			"Checks, against live Traffic at sampled start times, that arrival and launch lane waits show their reason and a figure the measured wait did not exceed.",
			["lane wait", "Traffic", "docking director", "clearance", "estimate"],
		),
		entry(
			"probe-live-cockpit.mjs",
			"Checks the normal cockpit route with the real renderer, world contacts, target cues, and head-look states.",
			["live cockpit", "contacts", "target cues", "head look", "renderer"],
		),
		entry(
			"probe-model-viewer.mjs",
			"Checks that the procedural model workbench renders models while remaining isolated from Game.",
			["model viewer", "workbench", "procedural models", "Game isolation"],
		),
		entry(
			"probe-moving-guard.mjs",
			"Checks the moving-body cruise stop and the handoff into the correct local flight frame.",
			["moving body", "cruise guard", "local frame", "collision avoidance"],
		),
		entry(
			"probe-navigation-console.mjs",
			"Exercises the cockpit Navigation list and chart as distinct finding and spatial-reading surfaces.",
			["Navigation console", "system list", "galaxy chart", "cockpit panels"],
		),
		entry(
			"probe-occlusion.mjs",
			"Checks near-layer sun shadows and screen-space ambient occlusion before bloom in the live renderer.",
			["shadows", "SSAO", "occlusion", "render pass", "bloom"],
		),
		entry(
			"probe-opening.mjs",
			"Flies the opening cinematic: a guided start watched, skipped at boot and skipped by the key ending in one state and docked with lastDocked, a free start ending in flight near the arrival point, no sequence under ?boot=direct or ?system=, no interdiction, the fallback, the phase handle repeatable, and a capture of every shot.",
			[
				"opening cinematic",
				"new game",
				"guided new game",
				"skip",
				"phase handle",
				"docked start",
			],
		),
		entry(
			"probe-output-stage.mjs",
			"Uses paired live renders to check antialiasing, encoding, vignette, dithering, and final-pass order.",
			["output stage", "antialiasing", "encoding", "vignette", "dither"],
		),
		entry(
			"probe-pad-instrument.mjs",
			"Checks that gamepad controls operate the frame instrument without making the instrument modal.",
			["gamepad", "frame instrument", "performance panel", "focus"],
		),
		entry(
			"probe-pad-panels.mjs",
			"Checks gamepad focus and activation across every cockpit panel using observable actions.",
			["gamepad", "panel focus", "cockpit consoles", "activation"],
		),
		entry(
			"probe-planet-surfaces.mjs",
			"Checks generated planet classes, live shader surfaces, terminators, bands, rings, and handoff behavior.",
			["planet surface", "shader", "planet class", "rings", "atmosphere"],
		),
		entry(
			"probe-planets.mjs",
			"Checks that gallery planet classes render as visually distinct, spherical, and star-lit bodies.",
			["planet gallery", "planet classes", "lighting", "pixels"],
		),
		entry(
			"probe-pointer-lock.mjs",
			"Checks that head-turning to a console releases pointer lock so real panel clicks can land.",
			["pointer lock", "head look", "console interaction", "mouse input"],
		),
		entry(
			"probe-postcard.mjs",
			"Opens the Postcard screen, saves and shares a canonical card, copies its fragment link, and opens that link in the read-only viewer against a stored Commander, holding every stored byte and every request.",
			[
				"postcard",
				"image export",
				"share link",
				"read-only viewer",
				"save isolation",
				"no network",
			],
		),
		entry(
			"probe-public-site.mjs",
			"Checks every static public page for its route, privacy promise, navigation, and Play-now handoff without booting the game.",
			[
				"public site",
				"static routes",
				"privacy promise",
				"Play now",
				"no tracking",
			],
		),
		entry(
			"probe-raider-consequence.mjs",
			"Checks live persistence and presentation after a raider kill, including operational condition, wreck, scoop, and revisit.",
			["raider kill", "world state", "wreck", "cargo scoop", "revisit"],
		),
		entry(
			"probe-raider-frame.mjs",
			"Checks that raider flight assist uses the player's local moving frame during a live duel.",
			["raider flight", "local frame", "flight assist", "duel"],
		),
		entry(
			"probe-relay.mjs",
			"Exercises the pirate relay discovery, targeting, intervention, persistence, and revisit loop.",
			[
				"pirate relay",
				"discovery",
				"intervention",
				"persistence",
				"raider rate",
			],
		),
		entry(
			"probe-relay-defender.mjs",
			"Flies the relay's defender beside a moving relay: a downed drawn slot sends none, and a defended relay kill and a defended tender kill each call one raider that arrives in 3–5 s inside beam range at rest in the target's frame.",
			[
				"pirate relay",
				"relay tender",
				"raider encounter",
				"local frame",
				"combat",
			],
		),
		entry(
			"probe-requests.mjs",
			"Exercises Requests-tab accept, track, cancel, report, and cockpit cue flows through real inputs.",
			["requests", "Requests UI", "tracking", "cockpit cue", "panel focus"],
		),
		entry(
			"probe-save.mjs",
			"Checks browser IndexedDB save/load, transaction failure, migration, autosave, and storage-scale behavior.",
			["save", "IndexedDB", "migration", "autosave", "storage failure"],
		),
		entry(
			"probe-ship-visuals.mjs",
			"Checks procedural hull identity in the live chase renderer while keeping cockpit flight instrument-first.",
			["ship visuals", "hull mesh", "chase view", "cockpit view"],
		),
		entry(
			"probe-sky.mjs",
			"Proves the derived star layer sits in the backdrop, paired point to system, and is re-drawn on a jump while the invented population's geometry is never swapped.",
			["star field", "derived sky", "witchspace arrival", "backdrop layer"],
		),
		entry(
			"probe-state-gallery.mjs",
			"Checks every fixed HUD design-gallery state for legibility at desktop and narrow viewports.",
			["state gallery", "HUD states", "responsive layout", "workbench"],
		),
		entry(
			"probe-station-console.mjs",
			"Checks docked station-console tabs, market and service interactions, negatives, and docked gallery state.",
			["station console", "docked UI", "market", "services", "cockpit panels"],
		),
		entry(
			"probe-station-mouth.mjs",
			"Checks adjacent frames at turning station mouths for coplanar geometry flicker and one-frame disappearance.",
			["station mouth", "flicker", "coplanar geometry", "aperture", "interior"],
		),
		entry(
			"probe-station-route-traffic.mjs",
			"Checks that one live Traffic carrier retains its route and presentation identity around a station.",
			["Traffic", "station route", "carrier identity", "presentation"],
		),
		entry(
			"probe-station-visuals.mjs",
			"Checks live station-role signatures, fixtures, plating, wear, motion, and detail-level presentation.",
			["station visuals", "station roles", "lights", "plating", "detail"],
		),
		entry(
			"probe-station.mjs",
			"Measures station silhouettes, drawn reach, aperture geometry, docking fit, and repeatable framing.",
			["station geometry", "silhouette", "aperture", "docking fit", "framing"],
		),
		entry(
			"probe-traffic-continuity.mjs",
			"Checks that live multi-carrier arbitration does not rewrite an existing Traffic trip.",
			["Traffic", "route continuity", "multi-carrier", "arbitration"],
		),
		entry(
			"probe-traffic-engagement.mjs",
			"Fires on ordinary Traffic and checks visible condition, reaction, diversion, destruction, law, and cargo effects.",
			["civilian combat", "Traffic", "damage", "legal heat", "manifest"],
		),
		entry(
			"probe-traffic-mouth.mjs",
			"Checks a departing live Traffic hull as it crosses and occludes the station mouth, including bloom.",
			["Traffic", "station mouth", "departure", "occlusion", "bloom"],
		),
		entry(
			"probe-witchspace.mjs",
			"Flies a real jump and checks the starbow and aberration, the dark closing to the point, the tunnel behind the cabin, the held controls, the arrival rift and its lens, cancel retract and the arrival-only path.",
			["jump", "witchspace transition", "composer", "arrival rift"],
		),
		entry(
			"probe-witnesses.mjs",
			"Exercises the live station-witness legal loop: offence attribution, Wanted refusals, persistence across jumps, and heat-decay clearance.",
			[
				"station witness",
				"legal heat",
				"Wanted refusal",
				"shipyard",
				"persistence",
				"jump",
			],
		),
	].sort((a, b) => a.file.localeCompare(b.file)),
);
