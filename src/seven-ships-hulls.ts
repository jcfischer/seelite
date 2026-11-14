import * as THREE from "three";
import { authoredHullLoader, createAuthoredHullBuilder } from "./authored-hull";
import {
	BASTION_CARRIER_GLB_URL,
	RAMPART_DREADNOUGHT_GLB_URL,
	SHIV_RAIDER_GLB_URL,
	SLUICE_PROSPECTOR_GLB_URL,
	WARDEN_PATROL_GLB_URL,
} from "./model-urls";
import type { AuthoredHullBuilder } from "./ship-mesh";

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
