/** Stable salvage aliases, independent of catalogue projections and world state. */
import type { ModuleKind } from "./module-catalog";
export const LEGACY_MODULES: Readonly<Record<string, ModuleKind>> = {
	Missile: "missile-rack",
	"Large Cargo Bay": "cargo-rack",
	"Extra Pulse Laser": "pulse-laser",
	"Extra Beam Laser": "beam-laser",
	"Military Laser": "military-laser",
	"Mining Laser": "mining-laser",
	"E.C.M. System": "ecm",
	"Docking Computer": "docking-computer",
	"Identity Scanner": "identity-scanner",
	"Long-Range Scanner": "long-range-scanner",
	"Fuel Scoops": "fuel-scoop",
	"Escape Pod": "escape-pod",
	"Extra Energy Unit": "extra-energy-unit",
};
