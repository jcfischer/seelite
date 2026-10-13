/**
 * The authored refineries' pad frame (node #819), Three-free so the sim's
 * proxy can read it: `pad_housing` in `spikes/refineries/build_model.py`
 * builds a 200 m clear half-width, 236 m to its outer edge, its face 24 m in
 * front of the plane. The game stands the refinery's lights on it
 * (`buildRefineryPadCues`) and the sim makes its vent banks solid
 * (`station-proxy.ts`); `tests/refinery-flight-asset.test.ts` holds each
 * shipped model to it.
 */
import { STATION_GEOMETRY } from "./station";

export interface RefineryPadFrame {
	innerKm: number;
	outerKm: number;
	frontKm: number;
}

export const REFINERY_PAD_FRAME: RefineryPadFrame = {
	innerKm: 0.2,
	outerKm: 0.236,
	frontKm: STATION_GEOMETRY.refinery.aperturePlaneKm + 0.024,
};

/** How far in front of the frame's face the lights stand: clear of its ochre
 *  armour, 1.8 m proud, so no lit face lies on a face of the model. */
export const PAD_CUE_PROUD_KM = 0.0025;

/** The two vent banks on the frame's top border: their length, and where
 *  each stands across it. */
export const PAD_VENT_BANK_KM = 0.12;
export const PAD_VENT_BANK_X_KM = [-0.11, 0.11] as const;
