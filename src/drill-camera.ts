/**
 * The Longwall bridge's drill camera, https://github.com/jcfischer/seelite/issues/1229.
 *
 * The study's `screen-drillcam` fixture (`spikes/miner-cockpit/screens/drillcam.png`)
 * is a contact close-up: the rotor entering the rock from the upper right and the
 * face filling the frame. The study authored that as an image and no numeric
 * mount, so the position here is derived from the hull's cutter box (#949, #959):
 * 1.5 m aft of the bow plane, 4.8 m below the keel line and 7 m to port, which is
 * outside the rotor's ±5.5 m square and clear of its swept disc. It looks down the
 * feed at the rotor's face, four metres past it, so the rock at contact is in shot.
 *
 * This module is arithmetic and gate only: the pass that draws it is
 * `drill-camera-pass.ts`, and `docs/specs/cockpit-text-surfaces.md` holds the rule.
 */
import type { CabinId } from "./cockpit-eye";
import type { HullCutter } from "./hull";
import { add, cross, scale, type Vec3 } from "./vec3";

/** The mount, lens and frame clock, derived in the module docstring. */
export const DRILL_CAMERA = {
	fovDeg: 42,
	nearKm: 0.001,
	farKm: 5,
	widthTexels: 640,
	foreFromBowM: -1.5,
	upM: -4.8,
	starboardM: -7,
	aimAheadM: 4,
} as const;

/** Every condition the pass runs under: the miner's bridge, cockpit view, the drill
 *  out, the screen in frame, high quality and the measurement's own request. */
export interface DrillCameraGateInput {
	readonly view: "cockpit" | "chase";
	readonly cabin: CabinId;
	readonly quality: "high" | "low";
	readonly extension: number;
	readonly screenVisible: boolean;
	readonly enabled: boolean;
}

/** Whether this frame draws the feed. A veto in any slot is enough; the low
 *  quality side excludes the pass and the screen then reads off. */
export function drillCameraActive(g: DrillCameraGateInput): boolean {
	return (
		g.enabled &&
		g.view === "cockpit" &&
		g.cabin === "miner" &&
		g.quality === "high" &&
		g.extension >= 1 &&
		g.screenVisible
	);
}

/** The camera's eye, aim and up vector in the world frame the near scene is drawn
 *  in, kilometres. `nose` and `up` are the flown hull's axes. */
export interface DrillCameraPose {
	readonly eyeKm: Vec3;
	readonly aimKm: Vec3;
	readonly up: Vec3;
}

/** The mount and its aim for this frame's drill extension. */
export function drillCameraPose(
	shipPos: Vec3,
	nose: Vec3,
	up: Vec3,
	cutter: HullCutter,
	extension: number,
): DrillCameraPose {
	const starboard = cross(nose, up);
	const foreM = cutter.bowKm * 1000 + DRILL_CAMERA.foreFromBowM;
	const eyeKm = add(
		shipPos,
		add(
			add(scale(nose, foreM / 1000), scale(up, DRILL_CAMERA.upM / 1000)),
			scale(starboard, DRILL_CAMERA.starboardM / 1000),
		),
	);
	const aimForeKm =
		cutter.bowKm +
		cutter.feedTravelKm * extension +
		DRILL_CAMERA.aimAheadM / 1000;
	const aimKm = add(
		shipPos,
		add(scale(nose, aimForeKm), scale(up, -cutter.downKm)),
	);
	return { eyeKm, aimKm, up };
}

/** The frame clock, `TCR hh:mm:ss:ff` at the feed's nominal 60 frames a second,
 *  so a live picture carries a tick and a stopped pass cannot hide behind one. */
export function drillCameraTimecode(frames: number): string {
	const f = Math.max(0, Math.floor(Number.isFinite(frames) ? frames : 0));
	const pad = (n: number) => String(n).padStart(2, "0");
	const ff = f % 60;
	const ss = Math.floor(f / 60) % 60;
	const mm = Math.floor(f / 3600) % 60;
	const hh = Math.floor(f / 216000);
	return `TCR ${pad(hh)}:${pad(mm)}:${pad(ss)}:${pad(ff)}`;
}

/** What the screen's overlay says: its title always, and either the frame clock or
 *  the off reading. Off is a word rather than a dark frame, so a stopped feed
 *  cannot pass for a live one. */
export function drillCameraOverlay(
	active: boolean,
	frames: number,
): { readonly title: string; readonly line: string } {
	return {
		title: "DRILL CAM",
		line: active ? drillCameraTimecode(frames) : "FEED OFF",
	};
}
