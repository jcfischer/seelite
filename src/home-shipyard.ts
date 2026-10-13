/**
 * The shipyard form a saved Commander is docked at, if any (node #818), and
 * since node #819 the refinery form: the
 * boot holds for the home station's exterior and nothing else (map #1,
 * #830/#835), so a Commander docked at a shipyard waits for that form's
 * model. A station's carrier key names its role (`LOCAL_CARRIER_ID`), so only
 * a Commander docked at such a station pays for generating the system here, to
 * read the form it picked. A save that will not restore is the `Game`
 * constructor's to report; here it is no home shipyard.
 */
import { carrierKey } from "./carrier-key";
import { restoreWorld } from "./sim";
import { LOCAL_CARRIER_ID } from "./station";

/** The fields of a save this reads. */
export interface DockedSave {
	world: { seed: number; gameTime: number };
	commander: {
		dockedAt: string | null;
		galaxyIndex: number;
		systemIndex: number;
	};
}

/** The form of the station of `type` a saved Commander is docked at, or null. */
function homeForm(
	save: DockedSave | null,
	type: "shipyard" | "refinery",
): string | null {
	const docked = save?.commander.dockedAt;
	if (!save || !docked?.endsWith(`:${LOCAL_CARRIER_ID[type]}`)) return null;
	try {
		const { system } = restoreWorld(
			save.world.seed,
			save.commander.galaxyIndex,
			save.commander.systemIndex,
			save.world.gameTime,
		);
		return (
			system.contents.stations.find(
				(s) =>
					s.type === type &&
					carrierKey(system.record.index, s.localCarrierId) === docked,
			)?.formId ?? null
		);
	} catch {
		return null;
	}
}

export function homeShipyardForm(
	save: DockedSave | null,
): "a" | "b" | "c" | null {
	const form = homeForm(save, "shipyard");
	return form === "a" || form === "b" || form === "c" ? form : null;
}

/** The refinery form a saved Commander is docked at (node #819), for the
 *  same boot hold. */
export function homeRefineryForm(
	save: DockedSave | null,
): "a" | "b" | "c" | "d" | null {
	const form = homeForm(save, "refinery");
	return form === "a" || form === "b" || form === "c" || form === "d"
		? form
		: null;
}
