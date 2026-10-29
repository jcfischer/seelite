/** Loadout-derived primary groups (#385/#893). Selection is flight state, never saved. */
import { HULL_SPECS, type HullId } from "./hull";
import type { Loadout } from "./loadout";

export interface FireGroup {
	readonly label: string;
	readonly trigger: "primary" | "secondary";
	readonly kind: "lasers" | "scanner" | "drill";
	readonly slots: readonly string[];
}
const LASERS = new Set([
	"pulse-laser",
	"beam-laser",
	"military-laser",
	"mining-laser",
]);
export function fireGroups(
	loadout: Loadout,
	hull: HullId,
	drill = false,
): FireGroup[] {
	const slots = HULL_SPECS[hull].slots;
	const lasers: FireGroup[] = slots
		.filter((s) => s.kind === "hardpoint" && LASERS.has(loadout[s.key]?.module))
		.map((s) => ({
			label: `${s.key.toUpperCase()} ${loadout[s.key].module.replaceAll("-", " ").toUpperCase()}`,
			trigger: "primary",
			kind: "lasers",
			slots: [s.key],
		}));
	const mining = lasers.filter(
		(g) => loadout[g.slots[0]]?.module === "mining-laser",
	);
	const result: FireGroup[] =
		lasers.length > 1
			? [
					{
						label: "ALL LASERS",
						trigger: "primary",
						kind: "lasers",
						slots: lasers.flatMap((g) => g.slots),
					},
					...lasers,
				]
			: lasers;
	const scanners = slots
		.filter((s) => loadout[s.key]?.module === "identity-scanner")
		.map((s) => s.key);
	if (scanners.length)
		result.push({
			label: "IDENTITY SCANNER",
			trigger: "primary",
			kind: "scanner",
			slots: scanners,
		});
	if (drill && mining.length > 1)
		result.splice(lasers.length > 1 ? 1 : 0, 0, {
			label: "MINING LASERS",
			trigger: "primary",
			kind: "lasers",
			slots: mining.flatMap((g) => g.slots),
		});
	if (drill && HULL_SPECS[hull].cutter)
		result.push({
			label: "BUILT-IN DRILL",
			trigger: "primary",
			kind: "drill",
			slots: [],
		});
	return result;
}
export class ArmedFireGroup {
	private index = 0;
	reset(): void {
		this.index = 0;
	}
	cycle(groups: readonly FireGroup[]): void {
		this.index = groups.length ? (this.index + 1) % groups.length : 0;
	}
	current(groups: readonly FireGroup[]): FireGroup | undefined {
		return groups[this.index];
	}
	firesLaser(groups: readonly FireGroup[]): boolean {
		return this.current(groups)?.kind === "lasers";
	}
	label(groups: readonly FireGroup[]): string {
		const group = this.current(groups);
		return group
			? `${group.label} · ${this.index + 1}/${groups.length}`
			: "NO WEAPONS";
	}
}
