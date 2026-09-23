/**
 * Measurement helpers for the pirate relay (#351), read by its test and by
 * `scripts/measure-relay-route.ts` and never by the game — which is why they
 * live here and not in `pirate-relay.ts`, and why that module does not import
 * the galaxy generator.
 */
import { generateGalaxy } from "./galaxy";
import { relayActive } from "./pirate-relay";

/**
 * Over every galaxy of a world seed, per government: how many systems there
 * are and how many rolled an active relay. The one tally the test and the
 * script both read, so they cannot count differently.
 */
export function relayActiveShare(
	worldSeed: number,
): { n: number; active: number }[] {
	const byGov = Array.from({ length: 8 }, () => ({ n: 0, active: 0 }));
	for (let g = 0; g < 8; g++)
		for (const record of generateGalaxy(worldSeed, g).systems) {
			const bucket = byGov[record.government];
			bucket.n++;
			if (relayActive(record)) bucket.active++;
		}
	return byGov;
}
