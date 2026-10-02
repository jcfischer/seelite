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
