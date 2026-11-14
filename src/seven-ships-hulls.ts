/**
 * The six authored exteriors of design PR #829 (node #1035): the Warden patrol,
 * the Pilgrim explorer, the Shiv raider, the Bastion carrier, the Sluice
 * prospector and the Rampart dreadnought, beside the Lance interceptor that
 * node #1034 installed.
 *
 * Each is the study's full model, metres with +Z forward, drawn at its own size
 * through `createAuthoredHullBuilder`, which applies the one conversion to the
 * game's kilometres and -Z nose. The drive mouths below are the study's, not the
 * drawn hull's: `build_model.py` places each engine and its nozzle, and
 * `tests/seven-ships-hulls.test.ts` measures every glow against the triangles
 * that surround it.
 *
 * The three habitats (Pilgrim, Bastion, Rampart) keep the accepted rings: an
 * 80 m walking floor at 3 RPM and 180 m at 2.5 RPM, carried by the model's
 * `habitat-rotor` node and its `rotationRPM`. They turn on the game clock
 * (`advanceAuthoredHabitat`), so a level switch cannot reset a phase.
 */
import * as THREE from "three";
import { authoredHullLoader, createAuthoredHullBuilder } from "./authored-hull";
import {
	BASTION_CARRIER_GLB_URL,
	PILGRIM_EXPLORER_GLB_URL,
	RAMPART_DREADNOUGHT_GLB_URL,
	SHIV_RAIDER_GLB_URL,
	SLUICE_PROSPECTOR_GLB_URL,
	WARDEN_PATROL_GLB_URL,
} from "./model-urls";
import type { AuthoredHullBuilder } from "./ship-mesh";

/** One study metre in kilometres: the model is drawn at its own size. */
const KM_PER_M = 0.001;

const ships = {
	patrol: {
		url: WARDEN_PATROL_GLB_URL,
		what: "the Warden",
		nozzles: {
			x: 12.5,
			y: 0,
			throatZ: -24.7,
			lipZ: -27.1,
			throatRadius: 2.66,
			lipRadius: 3.83,
		},
		habitat: false,
	},
	explorer: {
		url: PILGRIM_EXPLORER_GLB_URL,
		what: "the Pilgrim",
		nozzles: {
			x: 7,
			y: 0,
			throatZ: -35.2,
			lipZ: -37.6,
			throatRadius: 2.4,
			lipRadius: 3.44,
		},
		habitat: true,
	},
	raider: {
		url: SHIV_RAIDER_GLB_URL,
		what: "the Shiv",
		nozzles: {
			x: 12.5,
			y: 0,
			throatZ: -24.7,
			lipZ: -27.1,
			throatRadius: 2.66,
			lipRadius: 3.83,
		},
		habitat: false,
	},
	carrier: {
		url: BASTION_CARRIER_GLB_URL,
		what: "the Bastion",
		nozzles: {
			x: 32,
			y: 16,
			mounts: [
				{ side: "port-dorsal", x: 32, y: 16 },
				{ side: "starboard-dorsal", x: -32, y: 16 },
				{ side: "port-keel", x: 32, y: -16 },
				{ side: "starboard-keel", x: -32, y: -16 },
			],
			throatZ: -215.2,
			lipZ: -217.6,
			throatRadius: 9.85,
			lipRadius: 14.16,
		},
		habitat: true,
	},
	prospector: {
		url: SLUICE_PROSPECTOR_GLB_URL,
		what: "the Sluice",
		nozzles: {
			x: 6.2,
			y: 0,
			throatZ: -29.7,
			lipZ: -32.1,
			throatRadius: 2.26,
			lipRadius: 3.25,
		},
		habitat: false,
	},
	dreadnought: {
		url: RAMPART_DREADNOUGHT_GLB_URL,
		what: "the Rampart",
		nozzles: {
			x: 32,
			y: 16,
			mounts: [
				{ side: "port-dorsal", x: 32, y: 16 },
				{ side: "starboard-dorsal", x: -32, y: 16 },
				{ side: "port-keel", x: 32, y: -16 },
				{ side: "starboard-keel", x: -32, y: -16 },
			],
			throatZ: -227.2,
			lipZ: -229.6,
			throatRadius: 9.85,
			lipRadius: 14.16,
		},
		habitat: true,
	},
} as const;

export type SevenShipRole = keyof typeof ships;

/** The frame every level and drive glow of one hull hangs under. */
export const sevenShipFrameName = (role: SevenShipRole): string =>
	`${role}-hull-frame`;

/** The three levels' object names under that frame. */
export const sevenShipLevelNames = (role: SevenShipRole) =>
	({
		full: `${role}-hull-model`,
		reduced: `${role}-hull-reduced`,
		outline: `${role}-hull-outline`,
	}) as const;

export function createSevenShipBuilder(
	role: SevenShipRole,
	template: THREE.Object3D,
): Promise<AuthoredHullBuilder> {
	const ship = ships[role];
	return createAuthoredHullBuilder(template, {
		hull: role,
		frameName: sevenShipFrameName(role),
		levelNames: sevenShipLevelNames(role),
		kmPerM: () => KM_PER_M,
		nozzles: ship.nozzles,
		habitat: ship.habitat,
	});
}

/** The model queue starts one of these when a hull of that role is drawn or
 *  owed, and the postcard viewer and the workbench wait before drawing. */
export const prepareWardenHullModel = authoredHullLoader(
	"patrol",
	ships.patrol.url,
	(template) => createSevenShipBuilder("patrol", template),
);
export const preparePilgrimHullModel = authoredHullLoader(
	"explorer",
	ships.explorer.url,
	(template) => createSevenShipBuilder("explorer", template),
);
export const prepareShivHullModel = authoredHullLoader(
	"raider",
	ships.raider.url,
	(template) => createSevenShipBuilder("raider", template),
);
export const prepareBastionHullModel = authoredHullLoader(
	"carrier",
	ships.carrier.url,
	(template) => createSevenShipBuilder("carrier", template),
);
export const prepareSluiceHullModel = authoredHullLoader(
	"prospector",
	ships.prospector.url,
	(template) => createSevenShipBuilder("prospector", template),
);
export const prepareRampartHullModel = authoredHullLoader(
	"dreadnought",
	ships.dreadnought.url,
	(template) => createSevenShipBuilder("dreadnought", template),
);

/** Each role's study, for the tests and the instruments that decode the
 *  shipping files: the model URL, the drive mouths and whether it has a rotor. */
export const SEVEN_SHIP_STUDIES = ships;
