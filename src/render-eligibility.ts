import type { HeadLook } from "./cockpit";
import type { DockPhase } from "./dock-session";

export interface SceneRenderState {
	dockPhase: DockPhase;
	view: "cockpit" | "chase";
	headLook: HeadLook;
}

/**
 * The station console is an opaque forward cockpit takeover only while parked.
 * All other states need the scene on the very next frame.
 */
export const sceneRenderEligible = ({
	dockPhase,
	view,
	headLook,
}: SceneRenderState) =>
	!(dockPhase === "docked" && view === "cockpit" && headLook === "forward");
