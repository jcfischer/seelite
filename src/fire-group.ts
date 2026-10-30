/** Loadout-derived primary groups (#385/#893). Selection is flight state, never saved. */
import { HULL_SPECS, type HullId } from "./hull";
import type { Loadout } from "./loadout";

export interface FireGroup {
	readonly label: string;
	readonly trigger: "primary" | "secondary";
	readonly kind: "lasers" | "scanner";
	readonly slots: readonly string[];
}
const LASERS = new Set([
	"pulse-laser",
	"beam-laser",
	"military-laser",
	"mining-laser",
]);
/**
 * The primary groups a loadout arms. `mining` is `?mining=1`: with two or more
 * Mining Lasers fitted it adds `MINING LASERS` after `ALL LASERS`
 * (https://github.com/jcfischer/seelite/issues/1147, #920 D-D11).
 */
export function fireGroups(
	loadout: Loadout,
	hull: HullId,
	mining = false,
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
	const miningLasers = lasers.filter(
		(g) => loadout[g.slots[0]].module === "mining-laser",
	);
	if (mining && miningLasers.length > 1)
		result.splice(lasers.length > 1 ? 1 : 0, 0, {
			label: "MINING LASERS",
			trigger: "primary",
			kind: "lasers",
			slots: miningLasers.flatMap((g) => g.slots),
		});
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
