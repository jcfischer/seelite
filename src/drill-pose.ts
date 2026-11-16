/**
 * https://github.com/jcfischer/seelite/issues/920
 * The drill's pose of Longwall B's feed and struts at `extension`
 * 0…1: what the game draws each frame and what the cockpit occlusion table is
 * measured on, so the two cannot pose the drill differently.
 */
import type * as THREE from "three";
import type { HullCutter } from "./hull";
import { strutPose, strutReach } from "./rock-drill";
import { LONGWALL_LEVEL_NAMES, poseLongwallStrut } from "./ship-mesh";

/** Pose the full level's feed, rotor and four struts; a foot without a target reaches to the cutter's face plane. */
export function poseLongwallDrill(
	root: THREE.Object3D,
	cutter: HullCutter,
	extension: number,
	rotorRad = 0,
	targets: readonly ([number, number, number] | undefined)[] = [],
): void {
	const full = root.getObjectByName(LONGWALL_LEVEL_NAMES.full);
	const feed = full?.getObjectByName("feed");
	if (!full || !feed) return;
	feed.userData.stowedZ ??= feed.position.z;
	feed.position.z =
		feed.userData.stowedZ + cutter.feedTravelKm * 1000 * extension;
	const rotor = feed.getObjectByName("rotor");
	if (rotor) rotor.rotation.z = rotorRad;
	for (let i = 0; i < 4; i++)
		poseLongwallStrut(
			full,
			i,
			strutPose(i, extension, targets[i] ?? strutReach(i).foot),
		);
}
