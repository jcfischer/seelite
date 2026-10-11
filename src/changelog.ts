/**
 * The public changelog: the major changes a returning player would notice,
 * newest first. The home threshold prints the latest `HOME_CHANGELOG_COUNT`,
 * and Field Notes prints them all (#573).
 *
 * **What counts as major.** A player-visible change that a returning player
 * would notice: a new ship, system, kind of work, mechanic or screen. Not a
 * refactor, probe work, performance tuning or an internal fix. #573 adds this
 * question to the delivery SOP in the Notes of the machine map (#1): a node
 * that answers yes adds its entry here in the same pull request, and the
 * principal approves the sentence before the merge.
 *
 * **The canon boundary holds here too.** An entry names a thing a pilot can
 * do or see. It does not name a story fact, a discovery or a resolution
 * (`docs/specs/product-and-website-direction.md`, "Voice and canon boundary").
 *
 * `node` is provenance only. The repo is private, so the page never prints it.
 *
 * This module imports nothing, so the headless tier can read it whole.
 */
export type ChangelogEntry = {
	/** `YYYY-MM-DD`, the day the change reached `main`. */
	readonly date: string;
	/** One plain sentence. No markup: it is printed as it stands. */
	readonly text: string;
	/** The work-graph node that shipped it. Never rendered. */
	readonly node?: number;
};

export const CHANGELOG: readonly ChangelogEntry[] = [
	{
		date: "2026-10-11",
		text: "Cycle fire groups with B and see which weapons or scanner your trigger has armed.",
		node: 893,
	},
	// Node #869: sentence approved by the principal, 2026-10-11.
	{
		date: "2026-10-11",
		text: "Outfit your ship slot by slot, compare the change before buying, and carry or sell the modules you remove.",
		node: 869,
	},
	// Node #876: sentence approved by the principal, 2026-10-10.
	{
		date: "2026-10-10",
		text: "Equipment has weight: fitted modules affect handling, and changing ships keeps spare fittings in the hold.",
		node: 876,
	},
	// Node #865: approved by the principal on 2026-10-10; main date pending.
	{
		date: "2026-10-10",
		text: "Cargo has weight: a full hold makes a ship slower to accelerate and to turn, and an empty one flies as before.",
		node: 865,
	},
	// Node #815: approved by the principal on 2026-10-09; main date pending.
	{
		date: "2026-10-09",
		text: "The miner has a new hull: the Longwall, an 84-metre mining ship with three sealed ore cassettes, a two-seat bridge, four folded asteroid anchors and a cutter on an extending boom.",
		node: 815,
	},
	// Node #812: approved by the principal on 2026-10-09; main date pending.
	{
		date: "2026-10-09",
		text: "The courier has a new hull: a long tapered body between twin drive nacelles, with seated hatches, slope-aligned grilles and a pilot visible under the canopy.",
		node: 812,
	},
	// Node #792: approved by the principal on 2026-10-08.
	{
		date: "2026-10-08",
		text: "The cockpit is rebuilt: a low industrial dashboard under a tapered canopy, with the scanner, flight and navigation readouts on worn instrument screens.",
		node: 792,
	},
	// Node #790: proposed copy; principal approval and main date pending.
	{
		date: "2026-10-08",
		text: "Coriolis stations now have weathered industrial hulls, crowded machinery and illuminated approach collars around their docking bays.",
		node: 790,
	},
	// Node #705: approved by the principal on 2026-10-08.
	{
		date: "2026-10-08",
		text: "A death can now leave a wreck where it happened: fly back and scoop up whatever share of your lost cargo and fittings survived.",
		node: 705,
	},
	// Node #746: proposed copy; principal approval and main date pending.
	{
		date: "2026-10-08",
		text: "Shipyards now vary between systems: dock at a gantry with booms, a hangar slab with a floodlit bay, or a broken ring around its slip.", // glossary-ignore: Hangar
		node: 746,
	},
	// Node #734: proposed copy; principal approval and main date pending.
	{
		date: "2026-10-08",
		text: "A station that loses a ship can post a Salvage job: recover its named container and hand it over at home for 1.5 times its value there when you accept.",
		node: 734,
	},
	// Node #733: proposed copy; principal approval and main date pending.
	{
		date: "2026-10-07",
		text: "Sweep for derelict regions with a Long-Range Scanner, follow its return, or identify a wreck by flying within 10 km.",
		node: 733,
	},
	// Node #482: proposed copy; principal approval and the main date are pending.
	{
		date: "2026-10-07",
		text: "The Long-Range Scanner can sweep a system from its own console tab, recording regions to search with a sensor source and an age.",
		node: 482,
	},
	// Node #732: proposed copy; principal approval and main date pending.
	{
		date: "2026-10-07",
		text: "Dark derelicts carry tethered salvage: scoop their cargo and recover fittings to sell or fit at a station.",
		node: 732,
	},
	// Node #745: proposed copy; principal approval and the main date are pending.
	{
		date: "2026-10-07",
		text: "Refineries now vary between systems: land on a terraced rock, a collar around an asteroid, a processing spar, or a quarried industrial plant.",
		node: 745,
	},
	// Node #719: copy approved by the principal on 2026-10-07.
	{
		date: "2026-10-07",
		text: "Stars are now small, sharp points of light, and the nearby systems you can fly to glow a little brighter than the rest.",
		node: 719,
	},
	// Node #728: copy approved by the principal on 2026-10-06 (#231's rig B).
	{
		date: "2026-10-06",
		text: "The star's light is stronger and the fill light softer, so ships and stations cast real shadows and hulls show their shape against the light.",
		node: 728,
	},
	// Node #691: proposed copy; principal approval and the main date are pending.
	{
		date: "2026-10-06",
		text: "Photo mode pauses the world so you can orbit around your ship, zoom with the scroll wheel, and save the view as a postcard image or link.",
		node: 691,
	},
	// Node #664: proposed copy; principal approval and the main date are pending.
	{
		date: "2026-10-05",
		text: "Your ship is now solid to other ships: ram a raider or a passing freighter and you both take the hit, the lighter ship is thrown further, and a freighter struck through its shields is taken home for repair.",
		node: 664,
	},
	// Node #478: proposed copy; principal approval and the main date are pending.
	{
		date: "2026-10-05",
		text: "A faint CORE mark on the cockpit glass now shows which way the centre of the star cluster lies from the system you are in.",
		node: 478,
	},
	// Node #491: proposed copy; principal approval and the main date are pending.
	{
		date: "2026-10-04",
		text: "The most lawless systems now hold a raider outpost, a station of its own out along a planet's orbit; its berths are not open to anyone yet.",
		node: 491,
	},
	// Node #213: proposed copy; principal approval and the main date are pending.
	{
		date: "2026-10-04",
		text: "Airless moons now show broad dark basins and bright rays from young craters.",
		node: 213,
	},
	{
		date: "2026-10-04",
		text: "Stations are now solid: your ship bounces off hulls, landing decks and shipyard booms, so a docking approach must keep the whole ship clear of the rim.",
		node: 663,
	},
	{
		date: "2026-10-03",
		text: "Moons and stars are now solid: fly into one and your ship bounces off its surface, and a fast enough hit destroys it.",
		node: 661,
	},
	{
		date: "2026-10-03",
		text: "Dying no longer resets the world: what you did on your last flight stays done, and you restart at your last dock with what you had there.",
		node: 654,
	},
	{
		date: "2026-10-03",
		text: "Settings now offers a Mouse flight keyboard layout: W and S thrust forward and back, A and D slide sideways, Ctrl and Space lift and drop the ship, so you can thrust on all three at once while the mouse steers; on Windows and Linux, Chrome closes the tab on Ctrl+W, and Settings warns you.",
		node: 639,
	},
	{
		date: "2026-10-03",
		text: "You can now see your ship's thrusters fire, and the velocity and nose markers pulse when the flight assist cannot keep up.",
		node: 621,
	},
	{
		date: "2026-10-03",
		text: "The arrow keys now slide the ship sideways, up and down; with flight assist off, Shift and Ctrl fire the main drive and the retro thrusters while you hold them, and each of a ship's thrusters can be bound to a key of your own.",
		node: 620,
	},
	{
		date: "2026-10-02",
		text: "Ships now fly on their thrusters: with flight assist off a spin keeps going until you stop it, and a saved game keeps the spin.",
		node: 619,
	},
	{
		date: "2026-10-02",
		text: "The cockpit now tells you why an entry into a station failed, and why the docking computer let go.",
		node: 597,
	},
	{
		date: "2026-10-01",
		text: "The radio can now speak with a natural voice, made in your browser by a speech model you download once if you want it; the game asks at the start, and Settings can change your answer.",
		node: 604,
	},
	{
		date: "2026-10-01",
		text: "The docking computer now plays the Blue Danube.",
		node: 603,
	},
	{
		date: "2026-10-01",
		text: "Stations now answer docking requests over the radio, a ship under fire calls for a cease-fire, and the music has a new, faster sound of sequencers and sweeping noise.",
		node: 600,
	},
	{
		date: "2026-09-30",
		text: "Some distant planets are now rocky ice worlds, and rocky planets can have moons.",
		node: 590,
	},
	{
		date: "2026-09-30",
		text: "Shipyards now sell ships: trade in the one you fly for a freighter, an explorer or one of the others.",
		node: 583,
	},
	{
		date: "2026-09-30",
		text: "Music now plays: every star system has its own theme, and it darkens and quickens when a fight begins.",
		node: 548,
	},
	{
		date: "2026-09-29",
		text: "Three ladders now rank a pilot in combat, trade and exploration, and some ships and equipment wait for a higher rung.",
		node: 564,
	},
	{
		date: "2026-09-28",
		text: "The Far Between is live at farbetween.ch, free to play in the browser.",
		node: 569,
	},
	{
		date: "2026-09-28",
		text: "The ship can be heard now: the drive, the thrusters, the consoles and the guns.",
		node: 552,
	},
	{
		date: "2026-09-26",
		text: "A jump now passes through witchspace before the ship arrives in the new system.",
		node: 532,
	},
	{
		date: "2026-09-25",
		text: "A new pilot starts docked, with a first day of short local runs to learn the work.",
		node: 408,
	},
	{
		date: "2026-09-25",
		text: "Postcards save the view as an image, or as a link that rebuilds the scene.",
		node: 406,
	},
	{
		date: "2026-09-24",
		text: "Some systems harbour a pirate relay, and their stations post a bounty on it.",
		node: 351,
	},
];

/** How many entries the home threshold shows. The rest are on Field Notes. */
export const HOME_CHANGELOG_COUNT = 3;

const MONTHS = [
	"Jan",
	"Feb",
	"Mar",
	"Apr",
	"May",
	"Jun",
	"Jul",
	"Aug",
	"Sep",
	"Oct",
	"Nov",
	"Dec",
];

/**
 * `2026-09-28` as `28 Sep 2026`, read off the string. `new Date` parses a bare
 * date as UTC and `toLocale*` prints it in the reader's zone and language, so
 * the same entry could read as the 27th, or in German.
 */
export function changelogDate(date: string): string {
	const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
	const name = parts ? MONTHS[Number(parts[2]) - 1] : undefined;
	if (!parts || !name) throw new Error(`Not a changelog date: ${date}`);
	const [, year, , day] = parts;
	return `${Number(day)} ${name} ${year}`;
}

/** The entries as a list the public pages print. */
export function changelogList(entries: readonly ChangelogEntry[]): string {
	return `<ol class="changelog">${entries
		.map(
			(entry) =>
				`<li><time datetime="${entry.date}">${changelogDate(entry.date)}</time><span class="changelog-text">${entry.text}</span></li>`,
		)
		.join("")}</ol>`;
}
