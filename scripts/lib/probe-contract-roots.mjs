/** Reviewed behavior owners. Imports of each root are followed at both git refs.
 * Script roots include page.evaluate imports and fixture dependencies. main.ts
 * is handled separately: importing the whole orchestrator erases ownership.
 * An unmapped source or new probe expands to the full suite.
 */
const OWNERS = Object.freeze({
	"probe-variants-loadouts.mjs": [
		"scripts/probe-variants-loadouts.mjs",
		"src/module-variants.ts",
		"src/npc-loadout.ts",
		"src/loadout.ts",
		"src/kill-credit.ts",
	],
	"probe-production-boot.mjs": [
		"scripts/probe-production-boot.mjs",
		"src/entry.ts",
		"src/model-catalog.ts",
		"scripts/lib/async-import-guard.mjs",
	],
	"probe-model-queue.mjs": [
		"scripts/probe-model-queue.mjs",
		"src/model-queue.ts",
		"src/model-catalog.ts",
		"src/system-models.ts",
	],
	"probe-asteroid-field.mjs": [
		"scripts/probe-asteroid-field.mjs",
		"src/field-draw.ts",
		"src/field-lod.ts",
		"src/asteroid-model.ts",
		"src/asteroid-field.ts",
		"src/model-catalog.ts",
		"src/system-models.ts",
	],
	"probe-missiles.mjs": [
		"scripts/probe-missiles.mjs",
		"src/missiles.ts",
		"src/missile-combat.ts",
	],
	"probe-nebula.mjs": [
		"scripts/probe-nebula.mjs",
		"src/nebula.ts",
		"src/nebula-bake.ts",
	],
	"measure-cruise-detour.mjs": [
		"scripts/measure-cruise-detour.mjs",
		"src/cruise-detour.ts",
	],
	"probe-adaptive-resolution.mjs": [
		"scripts/probe-adaptive-resolution.mjs",
		"src/adaptive-resolution.ts",
	],
	"probe-approach-handoff.mjs": [
		"scripts/probe-approach-handoff.mjs",
		"src/planet-surface.ts",
		"src/arrival.ts",
		"src/station-traffic.ts",
		"src/docking.ts",
	],
	"probe-arrival.mjs": [
		"scripts/probe-arrival.mjs",
		"src/arrival.ts",
		"src/field-contact.ts",
	],
	"probe-audio-cues.mjs": [
		"scripts/probe-audio-cues.mjs",
		"src/audio.ts",
		"src/audio-cue.ts",
		"src/punch-sound.ts",
	],
	"probe-binding-store.mjs": [
		"scripts/probe-binding-store.mjs",
		"src/binding-store.ts",
	],
	"probe-boot.mjs": [
		"scripts/probe-boot.mjs",
		"src/entry.ts",
		"src/boot-mode.ts",
		"src/boot-system.ts",
		"src/model-progress.ts",
	],
	"probe-bounty.mjs": [
		"scripts/probe-bounty.mjs",
		"src/kill-credit.ts",
		"src/legal.ts",
		"src/ladder.ts",
	],
	"probe-cabin-pass.mjs": ["scripts/probe-cabin-pass.mjs", "src/cabin-pass.ts"],
	"probe-capture.mjs": [
		"scripts/probe-capture.mjs",
		"src/capture-modal.ts",
		"src/postcard.ts",
	],
	"probe-carrier-scan.mjs": [
		"scripts/probe-carrier-scan.mjs",
		"src/carrier-scan.ts",
	],
	"probe-chase-orbit.mjs": [
		"scripts/probe-chase-orbit.mjs",
		"src/chase-orbit.ts",
	],
	"probe-chase-view.mjs": ["scripts/probe-chase-view.mjs", "src/chase-view.ts"],
	"probe-cockpit-laser.mjs": [
		"scripts/probe-cockpit-laser.mjs",
		"src/beam-layer.ts",
		"src/beam-glass.ts",
		"src/laser.ts",
		"src/cockpit.ts",
	],
	"probe-cockpit-surface.mjs": [
		"scripts/probe-cockpit-surface.mjs",
		"src/cockpit-surface.ts",
	],
	"probe-collision-surface.mjs": [
		"scripts/probe-collision-surface.mjs",
		"src/collision.ts",
		"src/station-mesh.ts",
		"src/ship-mesh.ts",
	],
	"probe-collision.mjs": ["scripts/probe-collision.mjs", "src/collision.ts"],
	"probe-commander.mjs": [
		"scripts/probe-commander.mjs",
		"src/commander-flow.ts",
		"src/commander-overlay.ts",
	],
	"probe-console-sound.mjs": [
		"scripts/probe-console-sound.mjs",
		"src/console-sound.ts",
	],
	"probe-controls-reference.mjs": [
		"scripts/probe-controls-reference.mjs",
		"src/controls-reference.ts",
	],
	"probe-cruise-detour.mjs": [
		"scripts/probe-cruise-detour.mjs",
		"src/cruise-detour.ts",
	],
	"probe-cruise-light.mjs": [
		"scripts/probe-cruise-light.mjs",
		"src/light-shift.ts",
		"src/witchspace-pass.ts",
		"src/cruise.ts",
	],
	"probe-cruise.mjs": ["scripts/probe-cruise.mjs", "src/cruise.ts"],
	"probe-death-wreck.mjs": [
		"scripts/probe-death-wreck.mjs",
		"src/death-wreck.ts",
	],
	"probe-death.mjs": [
		"scripts/probe-death.mjs",
		"src/death-checkpoint.ts",
		"src/death-cost.ts",
	],
	"probe-derelict.mjs": ["scripts/probe-derelict.mjs", "src/derelict.ts"],
	"probe-derived-names.mjs": [
		"scripts/probe-derived-names.mjs",
		"src/body-name.ts",
		"src/carrier-name.ts",
		"src/station-name.ts",
	],
	"probe-display-contacts.mjs": [
		"scripts/probe-display-contacts.mjs",
		"src/display-contact.ts",
		"src/scanner-view.ts",
	],
	"probe-dock-arrival.mjs": [
		"scripts/probe-dock-arrival.mjs",
		"src/dock-session.ts",
		"src/arrival.ts",
		"src/docking.ts",
	],
	"probe-docking-traffic.mjs": [
		"scripts/probe-docking-traffic.mjs",
		"src/station-traffic.ts",
		"src/docking-computer.ts",
		"src/docking.ts",
	],
	"probe-docking.mjs": [
		"scripts/probe-docking.mjs",
		"src/docking.ts",
		"src/docking-computer.ts",
		"src/docking-director.ts",
		"src/station-traffic.ts",
	],
	"probe-fire-groups.mjs": [
		"scripts/probe-fire-groups.mjs",
		"src/fire-group.ts",
	],
	"probe-duel-hud.mjs": ["scripts/probe-duel-hud.mjs", "src/duel-hud.ts"],
	"probe-eject.mjs": ["scripts/probe-eject.mjs", "src/eject.ts"],
	"probe-first-day.mjs": [
		"scripts/probe-first-day.mjs",
		"src/first-day.ts",
		"src/first-day-choice.ts",
		"src/station-console.ts",
	],
	"probe-flight-sound.mjs": [
		"scripts/probe-flight-sound.mjs",
		"src/flight-sound.ts",
	],
	"probe-flown-mass.mjs": [
		"scripts/probe-flown-mass.mjs",
		"src/loadout.ts",
		"src/flown-hull.ts",
		"src/pilot-demand.ts",
	],
	"probe-frame-acceleration.mjs": [
		"scripts/probe-frame-acceleration.mjs",
		"src/sim.ts",
		"src/attitude-hold.ts",
		"src/station-traffic.ts",
	],
	"probe-frame-attribution.mjs": [
		"scripts/probe-frame-attribution.mjs",
		"src/frame-attribution.ts",
	],
	"probe-galaxy-map.mjs": ["scripts/probe-galaxy-map.mjs", "src/galaxy-map.ts"],
	"probe-gamepad.mjs": ["scripts/probe-gamepad.mjs", "src/gamepad.ts"],
	"probe-gimbal.mjs": ["scripts/probe-gimbal.mjs", "src/gimbal.ts"],
	"probe-gun-feedback.mjs": [
		"scripts/probe-gun-feedback.mjs",
		"src/gun-feedback.ts",
	],
	"probe-handoff.mjs": [
		"scripts/probe-handoff.mjs",
		"src/hyperspace.ts",
		"src/arrival.ts",
		"src/world-state.ts",
	],
	"probe-hold.mjs": [
		"scripts/probe-hold.mjs",
		"src/hold.ts",
		"src/hold-view.ts",
		"src/holdings.ts",
		"src/station-commerce.ts",
	],
	"probe-horizon-views.mjs": [
		"scripts/probe-horizon-views.mjs",
		"src/planet-surface.ts",
		"src/planet-approach-boundary.ts",
		"src/station.ts",
	],
	"probe-hud.mjs": ["scripts/probe-hud.mjs", "src/hud.ts"],
	"probe-inter-system-traffic.mjs": [
		"scripts/probe-inter-system-traffic.mjs",
		"src/inter-system-traffic.ts",
	],
	"probe-interdiction.mjs": [
		"scripts/probe-interdiction.mjs",
		"src/interdiction.ts",
	],
	"probe-key-dispatch.mjs": [
		"scripts/probe-key-dispatch.mjs",
		"src/key-dispatch.ts",
	],
	"probe-ladders.mjs": [
		"scripts/probe-ladders.mjs",
		"src/ladder.ts",
		"src/ladder-view.ts",
	],
	"probe-lane-wait.mjs": [
		"scripts/probe-lane-wait.mjs",
		"src/station-traffic.ts",
		"src/docking-computer.ts",
	],
	"probe-light-rig.mjs": ["scripts/probe-light-rig.mjs", "src/light-rig.ts"],
	"probe-live-cockpit.mjs": [
		"scripts/probe-live-cockpit.mjs",
		"src/live-cockpit.ts",
		"src/cockpit-surface.ts",
		"src/scanner-view.ts",
		"src/station-console.ts",
	],
	"probe-market-shelf.mjs": [
		"scripts/probe-market-shelf.mjs",
		"src/market.ts",
		"src/station-commerce.ts",
		"src/station-console.ts",
	],
	"probe-model-download.mjs": [
		"scripts/probe-model-download.mjs",
		"src/model-urls.ts",
		"src/model-progress.ts",
		"src/interior-install.ts",
	],
	"probe-model-viewer.mjs": [
		"scripts/probe-model-viewer.mjs",
		"src/model-viewer.ts",
	],
	"probe-mouse-flight-layout.mjs": [
		"scripts/probe-mouse-flight-layout.mjs",
		"src/pilot-demand.ts",
		"src/layout-choice.ts",
		"src/pointer.ts",
	],
	"probe-mouse-sensitivity.mjs": [
		"scripts/probe-mouse-sensitivity.mjs",
		"src/pointer.ts",
		"src/settings.ts",
		"src/settings-panel.ts",
	],
	"probe-moving-guard.mjs": [
		"scripts/probe-moving-guard.mjs",
		"src/collision.ts",
		"src/cruise-guidance.ts",
	],
	"probe-music-game.mjs": [
		"scripts/probe-music-game.mjs",
		"src/music.ts",
		"src/music-director.ts",
		"src/audio.ts",
		"src/audio-unlock.ts",
		"src/docking-computer.ts",
	],
	"probe-music.mjs": [
		"scripts/probe-music.mjs",
		"src/music.ts",
		"src/music-worklet.ts",
		"src/music-engine.ts",
		"src/music-sequencer.ts",
		"src/music-voices.ts",
		"src/audio.ts",
		"src/music-director.ts",
		"src/music-danube-variants.ts",
	],
	"probe-navigation-console.mjs": [
		"scripts/probe-navigation-console.mjs",
		"src/station-console.ts",
		"src/galaxy-finder.ts",
		"src/galaxy-route.ts",
	],
	"probe-neural-voice.mjs": [
		"scripts/probe-neural-voice.mjs",
		"src/neural-voice.ts",
		"src/neural-voice.worker.ts",
		"src/neural-voice-core.ts",
		"src/speech.ts",
	],
	"probe-occlusion.mjs": ["scripts/probe-occlusion.mjs", "src/occlusion.ts"],
	"probe-opening-cinematic.mjs": [
		"scripts/probe-opening-cinematic.mjs",
		"src/opening.ts",
		"src/opening-camera.ts",
		"src/opening-overlay.ts",
		"src/arrival-rift.ts",
	],
	"probe-opening.mjs": [
		"scripts/probe-opening.mjs",
		"src/opening.ts",
		"src/boot-mode.ts",
		"src/first-day.ts",
		"src/save-store.ts",
	],
	"probe-outfitting.mjs": [
		"scripts/probe-outfitting.mjs",
		"src/outfitting.ts",
		"src/outfitting-view.ts",
		"src/station-commerce.ts",
		"src/station-console.ts",
	],
	"probe-output-stage.mjs": [
		"scripts/probe-output-stage.mjs",
		"src/output-stage.ts",
	],
	"probe-pad-instrument.mjs": [
		"scripts/probe-pad-instrument.mjs",
		"src/pad-bindings.ts",
		"src/live-cockpit.ts",
	],
	"probe-pad-panels.mjs": [
		"scripts/probe-pad-panels.mjs",
		"src/pad-bindings.ts",
		"src/station-console.ts",
	],
	"probe-planet-surfaces.mjs": [
		"scripts/probe-planet-surfaces.mjs",
		"src/planet-surface.ts",
		"src/planet-appearance.ts",
	],
	"probe-planet-footprint.mjs": [
		"scripts/probe-planet-footprint.mjs",
		"src/planet-surface.ts",
		"src/planet-footprint.ts",
	],
	"probe-planets.mjs": [
		"scripts/probe-planets.mjs",
		"src/planet-surface.ts",
		"src/planet-appearance.ts",
	],
	"probe-pointer-lock.mjs": [
		"scripts/probe-pointer-lock.mjs",
		"src/pointer.ts",
	],
	"probe-postcard.mjs": ["scripts/probe-postcard.mjs", "src/postcard.ts"],
	"probe-public-site.mjs": [
		"scripts/probe-public-site.mjs",
		"src/public-site.ts",
	],
	"probe-quality-bloom.mjs": [
		"scripts/probe-quality-bloom.mjs",
		"src/output-stage.ts",
		"src/settings.ts",
	],
	"probe-raider-consequence.mjs": [
		"scripts/probe-raider-consequence.mjs",
		"src/raider-wreck.ts",
		"src/kill-credit.ts",
		"src/death-cost.ts",
	],
	"probe-raider-frame.mjs": [
		"scripts/probe-raider-frame.mjs",
		"src/combat-rig.ts",
		"src/encounter.ts",
	],
	"probe-raider-outpost.mjs": [
		"scripts/probe-raider-outpost.mjs",
		"src/raider-slots.ts",
		"src/encounter.ts",
	],
	"probe-rebind.mjs": [
		"scripts/probe-rebind.mjs",
		"src/binding-store.ts",
		"src/key-dispatch.ts",
		"src/controls-reference.ts",
	],
	"probe-relay-defender.mjs": [
		"scripts/probe-relay-defender.mjs",
		"src/relay-defender.ts",
	],
	"probe-relay.mjs": [
		"scripts/probe-relay.mjs",
		"src/pirate-relay.ts",
		"src/relay-mesh.ts",
		"src/relay-cue.ts",
	],
	"probe-requests.mjs": [
		"scripts/probe-requests.mjs",
		"src/requests.ts",
		"src/requests-view.ts",
		"src/jobs.ts",
		"src/station-console.ts",
	],
	"probe-save.mjs": [
		"scripts/probe-save.mjs",
		"src/save-store.ts",
		"src/save-envelope.ts",
	],
	"probe-ship-visuals.mjs": [
		"scripts/probe-ship-visuals.mjs",
		"src/ship-mesh.ts",
		"src/ship-surface.ts",
		"src/ship-detail.ts",
	],
	"probe-shipyard.mjs": [
		"scripts/probe-shipyard.mjs",
		"src/station-console.ts",
		"src/station-commerce.ts",
		"src/hull.ts",
	],
	"probe-sky.mjs": ["scripts/probe-sky.mjs", "src/backdrop.ts", "src/warp.ts"],
	"probe-state-gallery.mjs": [
		"scripts/probe-state-gallery.mjs",
		"src/state-gallery.ts",
	],
	"probe-station-console.mjs": [
		"scripts/probe-station-console.mjs",
		"src/station-console.ts",
		"src/station-commerce.ts",
		"src/outfitting-view.ts",
		"src/system-sweep-view.ts",
		"src/requests-view.ts",
	],
	"probe-station-interior-kit.mjs": [
		"scripts/probe-station-interior-kit.mjs",
		"src/interior-kit.ts",
		"src/interior-install.ts",
		"src/interior-lod.ts",
		"src/interior-model.ts",
	],
	"probe-station-mouth.mjs": [
		"scripts/probe-station-mouth.mjs",
		"src/station-mesh.ts",
		"src/station-interior-mesh.ts",
		"src/docking-tunnel-mesh.ts",
	],
	"probe-station-route-traffic.mjs": [
		"scripts/probe-station-route-traffic.mjs",
		"src/station-route.ts",
		"src/station-traffic.ts",
	],
	"probe-station-visuals.mjs": [
		"scripts/probe-station-visuals.mjs",
		"src/station-visuals.ts",
	],
	"probe-station.mjs": ["scripts/probe-station.mjs", "src/station.ts"],
	"probe-system-sweep.mjs": [
		"scripts/probe-system-sweep.mjs",
		"src/system-sweep.ts",
		"src/system-sweep-view.ts",
		"src/station-console.ts",
	],
	"probe-traffic-continuity.mjs": [
		"scripts/probe-traffic-continuity.mjs",
		"src/station-traffic.ts",
		"src/inter-system-traffic.ts",
	],
	"probe-traffic-engagement.mjs": [
		"scripts/probe-traffic-engagement.mjs",
		"src/traffic-engagement.ts",
	],
	"probe-traffic-mouth.mjs": [
		"scripts/probe-traffic-mouth.mjs",
		"src/station-traffic.ts",
		"src/station-mesh.ts",
	],
	"probe-npc-vents.mjs": [
		"scripts/probe-npc-vents.mjs",
		"scripts/lib/npc-vent-state.mjs",
		"src/npc-plumes.ts",
		"src/vent-plumes.ts",
	],
	"probe-vent-display.mjs": [
		"scripts/probe-vent-display.mjs",
		"src/vent-plumes.ts",
		"src/vent-cue.ts",
	],
	"probe-vent-keys.mjs": [
		"scripts/probe-vent-keys.mjs",
		"src/pilot-demand.ts",
		"src/key-dispatch.ts",
	],
	"probe-voices.mjs": [
		"scripts/probe-voices.mjs",
		"src/speech.ts",
		"src/comms-voice.ts",
		"src/radio.ts",
		"src/voice-pool.ts",
	],
	"probe-weapon-sound.mjs": [
		"scripts/probe-weapon-sound.mjs",
		"src/weapon-sound.ts",
	],
	"probe-witchspace.mjs": ["scripts/probe-witchspace.mjs", "src/witchspace.ts"],
	"probe-witnesses.mjs": [
		"scripts/probe-witnesses.mjs",
		"src/legal.ts",
		"src/encounter.ts",
		"src/carrier-standing.ts",
	],
});

export const SMOKE_PROBES = Object.freeze([
	"probe-production-boot.mjs",
	"probe-boot.mjs",
	"probe-live-cockpit.mjs",
]);

/** Body-only edits to these projections have reviewed consumers. New calls or
 * this-members expand coverage, as do signatures, fields and boot wiring.
 */
export const MAIN_METHOD_ROOTS = Object.freeze({
	navRows: ["src/station-console.ts", "src/galaxy-finder.ts"],
	firstDayPanel: ["src/first-day.ts", "src/station-console.ts"],
	firstDayGlassPrompt: ["src/first-day.ts", "src/hud.ts"],
	floorCells: ["src/hud.ts", "src/live-cockpit.ts"],
	tuningSummary: ["src/settings.ts", "src/hud.ts"],
	selectOutfitting: ["src/outfitting.ts", "src/station-console.ts"],
});

/** Reviewed callers: a new consumer invalidates the narrower ownership rule. */
export const MAIN_METHOD_CALLERS = Object.freeze({
	navRows: ["updateCockpit"],
	firstDayPanel: ["updateCockpit"],
	firstDayGlassPrompt: ["cruisePrompt"],
	floorCells: ["drawFlightFloor", "updateCockpit"],
	tuningSummary: ["updateCockpit"],
	selectOutfitting: ["constructor"],
});

// Game probes also observe the shared boot, simulation and renderer. These
// implicit orchestrator dependencies must not disappear just because main.ts
// is deliberately excluded from the import closure. Standalone pages/offline
// synthesis retain their own roots.
const STANDALONE_PROBES = new Set(["probe-music.mjs", "probe-public-site.mjs"]);
const LIVE_ROOTS = [
	"src/boot-system.ts",
	"src/boot-mode.ts",
	"src/save-store.ts",
	"src/settings.ts",
	"src/sim.ts",
	"src/output-stage.ts",
	"src/light-rig.ts",
	"src/backdrop.ts",
	"src/ship-mesh.ts",
	"src/station-mesh.ts",
	"src/planet-surface.ts",
	"src/interior-install.ts",
	"src/opening.ts",
];
/** New contracts inherit shared game dependencies until explicitly reviewed standalone. */
export function contractRoots(file, roots) {
	return Object.freeze([
		...roots,
		...(STANDALONE_PROBES.has(file) ? [] : LIVE_ROOTS),
	]);
}

export const PROBE_ROOTS = Object.freeze(
	Object.fromEntries(
		Object.entries(OWNERS).map(([file, roots]) => [
			file,
			contractRoots(file, roots),
		]),
	),
);
