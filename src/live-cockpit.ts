/** The crisp DOM instruments that sit over Game's one WebGL renderer. */

import { range } from "./units";
import {
	REQUESTS_STYLE,
	requestCue,
	requestsBody,
	type RequestsView,
} from "./requests-view";
import {
	RELAY_CUE_STYLE,
	type RelayCue,
	relayCueKey,
	relayCueMarkup,
} from "./relay-cue";
import {
	type HeadLook,
	NAV_FILTER_KINDS,
	type NavFilter,
	type NavRow,
	type ScannerContact,
	cockpitView,
} from "./cockpit";
import type { DockPhase } from "./dock-session";
import type { TaskGroup } from "./commands";
import { CONTROLS, type ControlsCatalogue } from "./controls-catalogue";
import {
	type ControlsAction,
	controlsBody,
	controlsTreeMarkup,
	focusAfterFold,
	groupFocusId,
	rowFocusId,
	toggleGroup,
} from "./controls-reference";
import { padHintFor } from "./key-names";
import type { ScanConsoleReadout } from "./carrier-scan";
import type { DuelConsoleReadout } from "./duel-hud";
import type { HullOffer, StationAction } from "./station-commerce";
import type { HullId } from "./hull";
import type { HoldBids, HoldSummary } from "./hold";
import { escapeHtml } from "./escape-html";
import { HOLD_STYLE, holdBody } from "./hold-view";
import {
	LADDER_STYLE,
	type LadderView,
	commanderBody,
	ladderViewKey,
} from "./ladder-view";
import type {
	ConsoleEquipmentScreen,
	ConsoleMarketRow,
	StationConsoleTab,
} from "./station-console";
import {
	entrustedClause,
	marketDisplayValues,
	SHELF_MAX_TITLE,
} from "./station-console";
import { LANE_WAIT_REASON, withLaneWait } from "./docking-director";
import type { LaneRefusal } from "./station-traffic";
import { FIRST_DAY_STEPS, type FirstDayStepId } from "./first-day";
import {
	type FocusCursor,
	NO_FOCUS,
	focusedItem,
	moveFocus,
	refreshFocus,
	setFocus,
} from "./panel-focus";

export type RightTab =
	| "Flight"
	| "Drive"
	/**
	 * #445's page: what is aboard. `Hold` is the word `CONTEXT.md` uses — not
	 * Inventory, not Cargo, and **not Manifest**, which that glossary gives to
	 * what an ordinary carrier carries on one voyage.
	 */
	| "Hold"
	/**
	 * #564's page: the three ladders (#183 D9). What the pilot *is*, beside
	 * what is aboard; the Commander overlay is saves and slots, not this.
	 */
	| "Commander"
	| "Controls"
	| "Tuning";

/**
 * The docked consoles' words for a held launch (#314). **SHIP, not CARRIER**:
 * the keys keep the consequence model's word, and the player reads a ship —
 * a `carrier` is also a capital hull on the roster. The reason is
 * `LANE_WAIT_REASON`'s, the glass's own spelling, so the console and the
 * arrival wait cannot word one refusal two ways (#521).
 */
export const LAUNCH_HOLD_NOTICE: Readonly<Record<LaneRefusal, string>> =
	Object.fromEntries(
		Object.entries(LANE_WAIT_REASON).map(([refusal, reason]) => [
			refusal,
			`LAUNCH HELD — ${reason.toUpperCase()}`,
		]),
	) as Record<LaneRefusal, string>;

/** A held launch's notice: the reason, then Traffic's estimate when it has
 *  one (#521). Keyed into the value key, so the figure re-renders as it runs
 *  down rather than freezing at the first frame's. */
export function launchHoldText(hold: LiveCockpitState["launchHold"]): string {
	if (!hold) return "";
	return withLaneWait(LAUNCH_HOLD_NOTICE[hold.refusal], hold.waitS);
}

// #370 D1: `Controls` ahead of `Tuning`, which keeps the last slot as the one tab
// on this console that is not fiction.
const RIGHT_TABS: readonly RightTab[] = [
	"Flight",
	"Drive",
	// #445 sits with the other readouts, ahead of the two tabs that are not
	// about the ship in front of you. #370 D1's rule is unchanged: `Tuning`
	// stays last.
	"Hold",
	"Commander",
	"Controls",
	"Tuning",
];

/**
 * The left console's tabs.
 *
 * `Galaxy Map` sits here rather than being its own surface because
 * `galaxy-map.md` §1 ratified it as "a tab on the left Navigation console. Not
 * a full-screen mode, not a fifth panel, not an application" — #70's rule that
 * a screen answers *which wall or which tab*, never *which application*.
 */
export type LeftTab =
	| "Navigation"
	| "Galaxy Map"
	| "Communications"
	| "Requests"
	// #408 D3 and D5: on-demand guidance, on every commander's console. Last,
	// because it is the one tab a pilot stops needing.
	| "First day";
const LEFT_TABS: readonly LeftTab[] = [
	"Navigation",
	"Galaxy Map",
	"Communications",
	"Requests",
	"First day",
];

/** What the First day tab shows (#408), all of it derived by `first-day.ts`. */
export interface FirstDayPanel {
	current: FirstDayStepId;
	/** What to do now, in the keys as bound. */
	text: string;
	/**
	 * Station control's line on the docked station console: a guided pilot's
	 * push (D5), `null` for a free pilot and once the day is over. The docked
	 * console fills the forward view and the glass prompt is not drawn there, so
	 * this is where a docked step is said.
	 */
	stationLine: string | null;
	/**
	 * Station control's line on the port console, where a guided pilot selects
	 * a station with the head turned and the glass is not drawn (playtest,
	 * 2026-09-25). `null` docked, for a free pilot, and after the day.
	 */
	consoleLine: string | null;
	/** The flight controls as bound, keyboard and controller (#408). */
	controls: { keyboard: string; controller: string };
}

export interface LiveCockpitState {
	requests?: RequestsView;
	/** #408: the First day tab's content, and station control's line on the
	 *  docked console. */
	firstDay?: FirstDayPanel;
	visible: boolean;
	dockPhase: DockPhase;
	headLook: HeadLook;
	leftTab: LeftTab;
	rightTab: RightTab;
	contacts: ScannerContact[];
	/** The Navigation console's filtered target list, nearest first. */
	navRows: NavRow[];
	navFilter: NavFilter;
	/** The system the ship is in, for the Navigation rail. */
	systemName: string;
	targetId: string | null;
	targetName: string | null;
	target: string;
	targetBearingDeg: number | null;
	mode: string;
	throttle: string;
	speed: string;
	/** §5 gives the Flight console assist as well as speed, throttle and
	 *  regime; it rendered the label with an empty value. */
	assist: string;
	/** §5 gives the Drive console the cruise charge. Same story. */
	charge: string;
	/** The player's standing, CLEAN, WANTED or FUGITIVE (#8, civilian-combat
	 *  H7), stepping back as heat decays. */
	legalStatus: string;
	/**
	 * The Signals rail's `HAILS` value: the callsign transmitting now, or NONE
	 * (#396). **This label has been authored in this file since the console was
	 * and has never carried a value** — which is the fact #396's ruling was
	 * written against, and the reason the row is wired rather than added.
	 */
	hails: string;
	/** #324's duel detail for the Flight console — fore, aft, hull, energy bank and
	 *  heat — or `null` in peace. */
	duel: DuelConsoleReadout | null;
	/** #364: what the scan channel has recorded about the selected carrier, or
	 *  `null` when the target is not a carrier a scan can answer for. §6 puts the
	 *  manifest here rather than on the designation line. */
	scan: ScanConsoleReadout | null;
	/** #324 part d: the Communications console's raider lifecycle lines,
	 *  newest first, each with its game-clock time. */
	raiderLog: readonly string[];
	/** #43: the pirate relay's signal cue, or null with nothing to show. */
	relay?: RelayCue | null;
	tuning: string;
	/** §8's one forward-wall screen, supplied only for the docked station. */
	stationConsole: {
		label: string;
		tab: StationConsoleTab;
		market: readonly ConsoleMarketRow[];
		equipment: ConsoleEquipmentScreen;
		/**
		 * The Shipyard tab (#556 D1, D8): the flown hull and one `hullOffer`
		 * per purchasable hull, or `null` at every station that is not a
		 * shipyard — where the tab is absent rather than empty.
		 */
		shipyard: {
			flown: HullId;
			offers: readonly HullOffer[];
		} | null;
		credits: number;
		/**
		 * What is aboard, whose it is, and how much room is left (#443).
		 *
		 * The one projection the hold line, the commander footer and the till's
		 * `cargo-full` sentence all read — `commanderHold`'s figures, not a
		 * second count.
		 */
		hold: HoldSummary;
		/** The till's last refusal, in the console's words, or `null`. */
		message: string | null;
		cargo: readonly string[];
		ownedEquipment: readonly string[];
		/** The hyperspace tank, light years, and its capacity (#187) — the Fuel
		 *  row prints the tank where a unit item prints nothing. */
		fuelLy: number;
		fuelCapacityLy: number;
		/** Changes only when an accepted action replaces the displayed state. */
		revision: number;
	} | null;
	/**
	 * What is aboard, for the right console's **Hold** page (#445).
	 *
	 * Top level rather than under `stationConsole`, because the right console
	 * is the flight console: a pilot deciding whether to detour for a scoop
	 * needs this away from a station, which is the point of putting the page
	 * there rather than on the station's tab.
	 */
	hold: HoldSummary;
	/**
	 * The docked station's bid per good, or `null` in flight (#445).
	 *
	 * The value column is a **docked** fact. Away from a station it reads as a
	 * dash rather than as a figure from wherever the ship last was, which is
	 * the stale-number failure `stockResponse`'s screen already guards against.
	 */
	holdBids: HoldBids;
	/** The three ladders, for the right console's **Commander** page (#564). */
	ladders: LadderView;
	/** A held launch (#314), and Traffic's estimate of how long (#521):
	 *  `waitS` is `null` when Traffic cannot say, never a guess. */
	launchHold: { refusal: LaneRefusal; waitS: number | null } | null;
}

/** Both left tabs' readout block, one copy so the two cannot drift apart. */
const LEFT_READOUT = `<div class="lc-readout"><span><b>SCANNER RANGE</b><em>10,000 km</em></span><span><b>CONTACTS</b><em data-live-contact-count></em></span><span><b>STANDING</b><em data-live-legal-status></em></span></div>`;

export interface LiveCockpitCallbacks {
	onRequestAction?: (action: string, id: string) => void;
	onRightTab: (tab: RightTab) => void;
	onLeftTab: (tab: LeftTab) => void;
	/** `source` is the control that changed it: a chip is a press, a
	 *  character typed into the query is not (#546). */
	onNavFilter: (filter: NavFilter, source: "chip" | "query") => void;
	onSelectTarget: (id: string) => void;
	onStationTab: (tab: StationConsoleTab) => void;
	onStationAction: (action: StationAction["type"], name: string) => void;
	onLaunch: () => void;
	/** Give up a held launch (#314). */
	onCancelLaunch: () => void;
	/**
	 * A `Controls` row was selected: open the rebind modal on it (#381 S4).
	 *
	 * A callback rather than this module opening one, for the reason every
	 * other door here is a callback: the modal needs the layout in force and
	 * the commit path, and neither is this surface's.
	 */
	onRebindRow: (command: string) => void;
	/**
	 * A door on the `Controls` tab was selected — today only `settings`.
	 *
	 * #369 D12's bootstrap: `z` is remappable, so the tab carries a route to
	 * the settings panel that no binding table holds.
	 */
	onControlsAction: (action: ControlsAction) => void;
	/**
	 * The Galaxy Map tab's chart host has appeared or gone away.
	 *
	 * A callback rather than this module importing the chart: `galaxy-map.ts`
	 * pulls in Three.js and `live-cockpit.ts` is the DOM tier. The owner mounts
	 * into the element handed up here and disposes when it is handed `null`.
	 */
	onChartHost: (host: HTMLElement | null) => void;
	/**
	 * The pointer landed on another of this surface's own rows (#546). Once
	 * per row entered, not per pixel moved.
	 */
	onHover?: () => void;
}

/**
 * The handles `update` caches per structural render.
 *
 * **Every field is nullable, and that is the point.** Each left tab draws a
 * different body, so several of these simply do not exist on a given render.
 * The first version had every tab emit hidden placeholder elements to keep the
 * lookups non-null, which shaped the panel's markup around this interface
 * rather than around what each tab shows, and made a fourth entry here a
 * required edit in three unrelated branches that had to agree by inspection.
 */
interface CockpitElements {
	requestAges: HTMLElement[];
	director: HTMLElement | null;
	leftPanelCopy: HTMLElement | null;
	rightPanelCopy: HTMLElement | null;
	contactCount: HTMLElement | null;
	legalStatus: HTMLElement | null;
	hails: HTMLElement | null;
	assistReadout: HTMLElement | null;
	chargeReadout: HTMLElement | null;
	/** #324's duel detail block and its five readings. */
	duel: HTMLElement | null;
	duelFore: HTMLElement | null;
	duelAft: HTMLElement | null;
	duelHull: HTMLElement | null;
	duelBank: HTMLElement | null;
	duelHeat: HTMLElement | null;
	/** #364's reading block and its five readings. */
	scanReadout: HTMLElement | null;
	scanName: HTMLElement | null;
	scanRegistry: HTMLElement | null;
	scanStanding: HTMLElement | null;
	scanManifest: HTMLElement | null;
	scanAge: HTMLElement | null;
	/** #324 part d: the Communications console's raider log list. */
	raiderLog: HTMLElement | null;
	/** #43: the relay signal cue, patched per frame. */
	relayCue: HTMLElement | null;
	navList: HTMLElement | null;
	navQuery: HTMLInputElement | null;
	arrow: HTMLElement | null;
	/** One per docked console: a hold is shown wherever the player looks. */
	launchNotices: HTMLElement[];
}

const STYLE_ID = "seelite-live-cockpit-style";

/** Seconds as the panel prints them. `null` reads `—`, never `0s`. */
function navEta(seconds: number | null) {
	if (seconds === null) return "—";
	if (seconds < 90) return `${seconds.toFixed(0)}s`;
	if (seconds < 5_400) return `${(seconds / 60).toFixed(1)}m`;
	if (seconds < 172_800) return `${(seconds / 3_600).toFixed(1)}h`;
	return `${(seconds / 86_400).toFixed(0)}d`;
}

const STYLE = `${REQUESTS_STYLE}${HOLD_STYLE}${LADDER_STYLE}${RELAY_CUE_STYLE}
#live-cockpit { position: fixed; inset: 0; z-index: 4; pointer-events: none; color: #c8e7f7; font: 12px/1.35 ui-monospace, "SF Mono", Menlo, monospace; text-shadow: 0 0 8px rgba(0, 0, 0, .92); }
#live-cockpit[data-live-active="false"] { display: none; }
#live-cockpit * { box-sizing: border-box; }
.lc-director { position: absolute; top: 38%; left: 50%; width: 172px; transform: translate(-50%, -50%); color: #ffe0a2; text-align: center; }
#live-cockpit[data-live-target-director="false"] .lc-director { display: none; }
.lc-director::before { content: ""; display: block; width: 66px; height: 66px; margin: 0 auto 8px; border: 2px solid currentColor; border-radius: 50%; box-shadow: 0 0 18px currentColor; }
.lc-target-arrow { position: absolute; left: 50%; top: 21px; color: #ffe0a2; font-size: 24px; line-height: 1; transform: rotate(var(--target-bearing)) translateX(48px); transform-origin: 0 50%; }
.lc-panel { display: none; position: absolute; inset: 7% 8% 12%; overflow: auto; padding: 20px 30px; border: 1px solid rgba(229, 170, 82, .9); border-radius: 8px; background: linear-gradient(104deg, rgba(46, 18, 5, .96), rgba(12, 8, 6, .93)); box-shadow: inset 0 0 68px rgba(231, 123, 31, .17), 0 0 28px rgba(227, 133, 39, .15); color: #ffd48c; pointer-events: auto; }
#live-cockpit[data-live-head-look="left"] .lc-panel[data-live-panel="left"], #live-cockpit[data-live-head-look="right"] .lc-panel[data-live-panel="right"] { display: block; }
#live-cockpit[data-live-head-look="left"] .lc-director, #live-cockpit[data-live-head-look="right"] .lc-director { opacity: .12; }
.lc-panel header { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; padding-bottom: 11px; border-bottom: 2px solid #e5aa52; }
.lc-panel h2 { margin: 0; color: #ffe1a9; font-size: 18px; letter-spacing: .1em; }
.lc-panel header small { color: #cb8c51; }
.lc-tabs { display: flex; gap: 7px; margin: 12px 0; border-bottom: 1px solid rgba(229, 170, 82, .55); }
.lc-tab { border: 0; border-bottom: 2px solid transparent; background: transparent; color: #d49352; cursor: pointer; font: inherit; font-size: 11px; letter-spacing: .05em; padding: 7px 10px; }
.lc-tab[aria-selected="true"] { border-color: #ffe0a2; color: #fff0c9; background: rgba(223, 122, 20, .18); }
.lc-panel-body { display: grid; grid-template-columns: minmax(135px, .42fr) 1fr; gap: 18px; min-height: 240px; }
/* The chart tab takes the panel's whole height. Left as a block panel the
   chart sat at its 300px minimum with half the console empty below it — every
   check green and a third of the surface wasted. */
#live-cockpit[data-live-head-look="left"][data-live-left-view="Galaxy Map"] .lc-panel[data-live-panel="left"] { display: flex; flex-direction: column; }
.lc-panel-body[data-live-chart-body] { grid-template-columns: 1fr; flex: 1 1 auto; min-height: 0; }
.lc-panel-body.lc-hold-body { grid-template-columns: 1fr; }
.lc-panel-body.lc-ladders-body { grid-template-columns: 1fr; }
.lc-rail { display: grid; align-content: start; gap: 8px; padding: 14px 12px; border-right: 1px solid rgba(229, 170, 82, .42); color: #e9a766; font-size: 11px; }
.lc-rail b { color: #ffe1a9; letter-spacing: .08em; }
.lc-rail em { display: block; color: #fff0c9; font-style: normal; letter-spacing: .05em; }
.lc-rail button { border: 0; padding: 0; background: transparent; color: inherit; cursor: pointer; font: inherit; text-align: left; letter-spacing: .05em; }
.lc-rail button:hover { color: #fff0c9; }
.lc-panel-copy { display: grid; align-content: start; gap: 12px; padding: 14px 2px; }
.lc-panel-copy h3, .lc-panel-copy p { margin: 0; }
.lc-panel-copy h3 { color: #ffe1a9; font-size: 15px; letter-spacing: .08em; }
.lc-panel-copy p { max-width: 48ch; color: #ffdcb0; line-height: 1.6; }
.lc-readout { display: grid; gap: 6px; color: #f5bd78; font-size: 11px; }
.lc-readout span { display: flex; justify-content: space-between; gap: 12px; padding-bottom: 4px; border-bottom: 1px solid rgba(229, 170, 82, .34); }
/* The Controls tab (#372): a header line, then a two-level tree of task groups.
   The body is replaced wholesale, so these rules own the whole panel width. */
.lc-panel-body.lc-controls { display: flex; flex-direction: column; gap: 10px; }
.lc-controls-head { display: flex; flex-wrap: wrap; gap: 4px 16px; color: #f5bd78; font-size: 11px; }
.lc-controls-head b { color: #ffe1a9; letter-spacing: .08em; }
/* #381 S3's band: what the stored layout could not do. Amber rather than
   red - hud-and-scanner.md §4 owns red as *refusal*, and every one of these is
   a thing the player can still act on. */
.lc-controls-notices { display: grid; gap: 2px; margin: 6px 0; padding: 6px 10px; list-style: none; border-left: 2px solid #f5bd78; background: rgba(245,189,120,.08); }
.lc-controls-notice { color: #ffd9a0; font-size: 11px; line-height: 1.45; }
.lc-controls-tree { display: grid; gap: 1px; }
.lc-controls-group { display: flex; justify-content: space-between; width: 100%; margin-top: 8px; padding: 5px 6px; border: 0; border-bottom: 1px solid rgba(229, 170, 82, .55); background: rgba(223, 122, 20, .12); color: #ffe1a9; cursor: pointer; font: inherit; letter-spacing: .1em; text-align: left; }
.lc-controls-group:hover { color: #fff0c9; }
.lc-controls-group small { color: #cb8c51; }
/* The settings door (#369 D12). **Deliberately quieter than a group header**,
   which is what it inherited when it had no rule of its own: unstyled it drew
   a full-width bar and read as the most important thing on the tab, which a
   door out of a reference is not. Right-aligned and narrow, so it reads as a
   way out rather than as a section of the list it sits above. */
.lc-controls-door { display: block; margin: 0 0 4px auto; padding: 3px 10px; border: 1px solid rgba(139, 168, 209, .35); border-radius: 3px; background: transparent; color: #8ba8d1; cursor: pointer; font: inherit; letter-spacing: .08em; }
.lc-controls-door:hover { color: #cfe3ff; border-color: rgba(139, 168, 209, .6); }
.lc-controls-row { display: grid; grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr) minmax(0, 1.2fr); gap: 2px 14px; align-items: baseline; padding: 3px 6px; border-bottom: 1px solid rgba(229, 170, 82, .18); font-size: 11px; }
.lc-controls-name { color: #ffdcb0; }
.lc-controls-keys { display: flex; flex-wrap: wrap; gap: 4px; }
.lc-controls-keys kbd, .lc-controls-keys em { padding: 0 5px; border: 1px solid rgba(229, 170, 82, .6); border-radius: 3px; color: #fff0c9; font: inherit; font-style: normal; }
.lc-controls-note { color: #cb8c51; font-size: 10px; }
@media (max-width: 600px) { .lc-controls-row { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); font-size: 10px; } .lc-controls-note { grid-column: 1 / -1; } }
.lc-nav-filters { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.lc-chip { border: 1px solid rgba(229, 170, 82, .5); border-radius: 3px; padding: 4px 9px; background: transparent; color: #d49352; cursor: pointer; font: inherit; font-size: 10px; letter-spacing: .08em; }
.lc-chip[aria-pressed="true"] { border-color: #ffe0a2; background: rgba(223, 122, 20, .26); color: #fff0c9; }
.lc-nav-query { flex: 1 1 96px; min-width: 84px; border: 1px solid rgba(229, 170, 82, .5); border-radius: 3px; padding: 4px 7px; background: rgba(8, 5, 3, .6); color: #ffe1a9; font: inherit; font-size: 11px; }
.lc-nav-list { display: grid; gap: 2px; margin: 0; padding: 0; list-style: none; max-height: 234px; overflow: auto; }
.lc-nav-row { display: grid; grid-template-columns: 1fr auto auto; gap: 10px; width: 100%; border: 0; border-bottom: 1px solid rgba(229, 170, 82, .22); padding: 5px 6px; background: transparent; color: #ffdcb0; cursor: pointer; font: inherit; font-size: 11px; text-align: left; }
.lc-nav-row:hover { background: rgba(223, 122, 20, .14); }
.lc-nav-row[aria-current="true"] { background: rgba(223, 122, 20, .3); color: #fff0c9; }
/* The pad's cursor. A ring *and* a wash rather than a ring alone: a 2px amber
   outline on an amber console was the principal's first finding on the flown
   leg — it does not read, least of all on a nav row that already carries
   aria-current's fill. The wash is cool where every other highlight here is
   warm, so the two answer their different questions in different colours:
   which row is selected, and which row the pad would act on next. #283. */
[data-live-focus="true"] {
  outline: 2px solid #9fe8ff; outline-offset: 2px; border-radius: 3px;
  /* The wash is an inset shadow, not a background. Written as a background it
     needed !important to win, and winning is exactly wrong: it replaced
     aria-current's amber fill on a row that is both selected and ringed —
     the one row this comment's "two highlights, two questions" is about. A
     shadow layers over the fill instead of fighting it for one property. */
  box-shadow: 0 0 12px rgba(120, 210, 255, .55),
    inset 0 0 0 100vmax rgba(96, 200, 255, .22);
}
/* Which surface the pad is on. Same cool family as the ring, on the panel's own
   border, so "the d-pad is walking this one" is answerable without pressing
   anything. */
[data-live-pad-scope="true"] { border-color: #9fe8ff !important; box-shadow: inset 0 0 68px rgba(231, 123, 31, .17), 0 0 22px rgba(120, 210, 255, .4); }
.lc-pad-hint { margin-top: 8px; color: #9fe8ff; font-size: 10px; letter-spacing: .05em; opacity: .85; }
.lc-nav-row i { color: #cb8c51; font-style: normal; }
.lc-nav-row em { color: #f5bd78; font-style: normal; }
.lc-nav-empty { padding: 10px 6px; color: #cb8c51; font-size: 11px; }
.lc-chart-host[data-live-chart-error]::after { content: "CHART UNAVAILABLE — reload"; position: absolute; inset: 0; display: grid; place-content: center; color: #ffb0a2; letter-spacing: .08em; }
.lc-chart-host { position: relative; min-height: 300px; height: 100%; border: 1px solid rgba(229, 170, 82, .34); border-radius: 4px; overflow: hidden; background: #05080d; }
.lc-station-console { display: none; position: absolute; inset: 0; overflow: auto; padding: 20px 30px; background: linear-gradient(104deg, #2e1205, #0c0806); box-shadow: inset 0 0 68px rgba(231, 123, 31, .17); color: #ffd48c; pointer-events: auto; }
#live-cockpit[data-live-docked="true"][data-live-head-look="forward"] .lc-station-console { display: flex; flex-direction: column; }
#live-cockpit[data-live-docked="true"] .lc-director { display: none; }
.lc-station-console header { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; padding-bottom: 11px; border-bottom: 2px solid #e5aa52; }
.lc-station-console h2 { margin: 0; color: #ffe1a9; font-size: 18px; letter-spacing: .1em; }
.lc-station-console header small { color: #cb8c51; }
.lc-station-market { flex: 1; overflow: auto; margin-top: 8px; padding-right: 6px; }
.lc-station-row { display: grid; grid-template-columns: minmax(120px, 1.4fr) 1fr 1fr auto; gap: 10px; align-items: baseline; padding: 3px 2px; border-bottom: 1px solid rgba(229, 170, 82, .22); font-size: 11px; }
.lc-station-row[data-live-listed="false"] { color: #8d7057; }
/* §5.6 gave the market a fifth cell — GOOD, BUY, SELL, SHELF, ACTION — and #473 D10 a
 * sixth, HELD, before ACTION; the
 * shared four-column rule above is what the equipment list still wants. Without
 * this the ACTION button wrapped onto a second grid line in every listed row and
 * in the header, which no probe sees because a wrapped button is still a button:
 * The check that does exist is tests/live-cockpit.test.ts's row-arity row: it reads this
 * rule back as six tracks and the row templates as six spans, and holds the shared rule
 * at four. A sixth cell beside four tracks would wrap the price into the name's column,
 * and a wrapped button is still a button, so no probe would see it. (No backticks here:
 * this comment lives inside the stylesheet's template literal.) 
*/
.lc-station-market .lc-station-row { grid-template-columns: minmax(120px, 1.4fr) 1fr 1fr 1.2fr .7fr auto; }
.lc-station-head { position: sticky; top: 0; color: #d8833b; border-bottom-width: 2px; letter-spacing: .08em; background: #150a03; }
.lc-station-cell { text-align: right; }
.lc-station-delta { margin-left: 5px; color: #f0b05e; }
.lc-station-max { color: #ffe1a9; font-weight: normal; letter-spacing: .06em; cursor: help; }
.lc-station-section { margin: 14px 0 6px; color: #cb8c51; font-size: 11px; letter-spacing: .08em; }
.lc-station-equipment { flex: 1; overflow: auto; margin-top: 8px; }
/* A fixed action column: each row is its own grid, so BUY, OWNED and LOCKED at their own widths moved the price column (#564). */
.lc-station-equipment .lc-station-row { grid-template-columns: minmax(120px, 1.4fr) 1fr 1fr 64px; }
.lc-station-equipment .lc-station-row > :nth-child(4) { justify-self: end; }
.lc-station-action { border: 1px solid rgba(229, 170, 82, .52); border-radius: 3px; padding: 2px 6px; background: rgba(223, 122, 20, .16); color: #ffe1a9; cursor: pointer; font: inherit; font-size: 10px; }
.lc-station-action:hover { background: rgba(223, 122, 20, .32); }
.lc-station-owned { color: #9ed89b; font-size: 10px; letter-spacing: .06em; }
.lc-station-shipyard .lc-station-row { grid-template-columns: minmax(96px, 1fr) .9fr 1fr 1.8fr 64px; }
.lc-station-shipyard .lc-station-row > :nth-child(5) { justify-self: end; }
.lc-station-locked { color: #a9814f; font-size: 10px; letter-spacing: .06em; }
.lc-station-commander { margin: 9px 0 0; color: #f5bd78; font-size: 11px; }
.lc-station-hold { margin: 6px 0 0; color: #f5bd78; font-size: 11px; letter-spacing: .06em; }
/* Red is refusal (hud-and-scanner.md section 4), which is exactly what this
   is, and it is the colour the held launch already uses. An empty live region
   is collapsed rather than left as a gap above the rows. */
.lc-station-message { margin: 4px 0 0; color: #ff8a73; font-size: 11px; }
/* An empty region keeps its place in the document and in the accessibility
   tree; only its margin goes, so there is no gap above the rows. display:none
   would take it out of both, which is the one thing a live region may not do. */
.lc-station-message:empty { margin: 0; }
/* #408: station control's line to a guided pilot. Amber is the actionable
   prompt (hud-and-scanner.md section 4). */
.lc-station-control { margin: 8px 0 0; color: #ffd17a; font-size: 12px; letter-spacing: .02em; }
.lc-station-control b { margin-right: 8px; color: #f5bd78; font-size: 10px; letter-spacing: .12em; }
.lc-first-day-steps { margin: 4px 0 0; padding-left: 18px; font-size: 12px; line-height: 1.9; }
.lc-first-day-step[data-first-day-state="done"] { color: #9ed89b; }
.lc-first-day-step[data-first-day-state="current"] { color: #ffd17a; font-weight: 600; }
.lc-first-day-step[data-first-day-state="ahead"] { color: #a8837f; }
.lc-launch { margin-top: 12px; border: 1px solid #ffe0a2; background: rgba(223, 122, 20, .28); color: #fff0c9; cursor: pointer; font: inherit; font-size: 13px; letter-spacing: .12em; padding: 8px 18px; }
.lc-launch-hold { margin-top: 12px; }
.lc-launch-hold p { margin: 0 0 4px; color: #ff8a73; font-size: 12px; letter-spacing: .08em; }
.lc-launch-hold .lc-launch { margin-top: 4px; border-color: #ff8a73; background: rgba(190, 48, 30, .28); }
@media (max-width: 600px) { .lc-station-console { inset: 8px; padding: 13px; } .lc-station-row { grid-template-columns: minmax(90px, 1.3fr) 1fr .8fr auto; gap: 6px; font-size: 10px; } .lc-station-market .lc-station-row { grid-template-columns: minmax(84px, 1.3fr) .9fr .9fr .9fr .6fr auto; } }
@media (max-width: 600px) { .lc-panel { inset: 8px; padding: 13px; clip-path: none; } .lc-panel h2 { font-size: 14px; } .lc-panel-body { grid-template-columns: .45fr 1fr; gap: 8px; min-height: 0; } .lc-rail, .lc-panel-copy { padding-top: 7px; } .lc-panel-copy p { font-size: 11px; line-height: 1.4; } .lc-readout { display: none; } .lc-nav-list { max-height: 148px; } .lc-chart-host { min-height: 190px; } }
`;

function installStyle() {
	if (document.getElementById(STYLE_ID)) return;
	const style = document.createElement("style");
	style.id = STYLE_ID;
	style.textContent = STYLE;
	document.head.append(style);
}

export class LiveCockpit {
	private readonly root: HTMLElement;
	private lastKey = "";
	private lastValueKey = "";
	private lastNavKey = "";
	private lastLogKey: string | null = null;
	private lastRelayKey = "";
	/** #408: the port console's station control line last written; `undefined`
	 *  after a rebuild, so the rebuilt element is always filled. */
	private lastConsoleLine: string | null | undefined = undefined;
	private readonly navRowsById = new Map<
		string,
		{
			item: HTMLLIElement;
			button: HTMLButtonElement;
			name: HTMLSpanElement;
			kind: HTMLElement;
			range: HTMLElement;
		}
	>();
	private elements: CockpitElements | null = null;
	/** The element handed to `onChartHost`, so it is handed back exactly once. */
	private chartHost: HTMLElement | null = null;
	/**
	 * The Controls tab's folded groups (#370 D9): one set beside the tab, not
	 * the DOM, so a structural rebuild draws the tree as the player left it.
	 */
	private controlsCollapsed: ReadonlySet<TaskGroup> = new Set();
	/**
	 * The layout the Controls tab prints, and what the store could not do
	 * (#381 S3).
	 *
	 * Beside the fold rather than in `LiveCockpitState`, because it changes
	 * twice a session — at boot and on a rebind — while the state struct is
	 * rebuilt every frame by every caller that draws a cockpit. The shipped
	 * catalogue is the value until `Game` hands over the one it is flying, so
	 * a probe or a workbench that never calls the setter prints the defaults
	 * rather than nothing.
	 */
	private controls: ControlsCatalogue = CONTROLS;

	/**
	 * What the Controls tab prints from now on. `Game` owns the layout, so
	 * `Game` is what says when it changed.
	 *
	 * **The assignment is not enough, and that was the first version.** The
	 * body is drawn from `lastKey` and the catalogue is not in that key, so a
	 * rebind while the tab is open changed the field and nothing on the
	 * screen — until some unrelated tab change happened to rebuild it (sage
	 * round 1). Invalidating the key is the mechanism this class already has
	 * for "the structure moved", and the cost the comment beside it warns
	 * about — a rebuild losing a filter field's caret — is not this caller's:
	 * a layout changes twice a session, not on a keystroke.
	 *
	 * **No identity guard**, and the one that was here could never fire:
	 * `publishControls` builds a fresh catalogue on every call, so
	 * `catalogue === this.controls` was false every time and the early return
	 * was unreachable (sage round 2). A guard that never guards reads as a
	 * cost this method does not pay.
	 */
	setControls(catalogue: ControlsCatalogue) {
		this.controls = catalogue;
		this.lastKey = "";
	}

	constructor(private readonly callbacks: LiveCockpitCallbacks) {
		installStyle();
		this.root = document.createElement("section");
		this.root.id = "live-cockpit";
		this.root.setAttribute("data-live-cockpit", "true");
		// Delegation keeps clicks live after a structural render is replaced.
		this.root.addEventListener("click", (event) => {
			const element = event.target as HTMLElement;
			// Accept replaces itself with Track at the same location. The second
			// click of a double-click must not activate that newly drawn action.
			if (event.detail > 1 && element.closest("[data-live-request-action]"))
				return;
			// **The id is read before the dispatch and applied after it**, and
			// both halves are the point. An accepted transaction rebuilds the
			// market synchronously, so the clicked element is *detached* by the
			// time the dispatch returns and an `indexOf` against the fresh list
			// silently finds nothing — round 1 put the whole sync after the
			// dispatch and left the ring on the previous row, so clicking BUY on
			// one commodity and then pressing Cross bought a different one. And
			// the cursor cannot simply be set first either: a click that changes
			// the tab replaces the rows, and an id that is gone must leave the
			// cursor alone, which is what `setFocus` does. Sage found it, round 2.
			this.syncFocusToPointer(
				element.closest<HTMLElement>(LiveCockpit.FOCUSABLE),
				() => this.handleClick(element),
			);
			this.applyFocusRing();
		});
		this.root.addEventListener("input", (event) => {
			const field = event.target as HTMLElement;
			if (field.matches("[data-live-nav-query]"))
				this.callbacks.onNavFilter(
					{ ...this.filter, query: (field as HTMLInputElement).value },
					"query",
				);
		});
		this.root.addEventListener("pointerover", (event) => {
			const row = (event.target as HTMLElement).closest(
				LiveCockpit.OWN_FOCUSABLE,
			);
			if (row === this.hovered) return;
			this.hovered = row;
			if (row) this.callbacks.onHover?.();
		});
		this.root.addEventListener("pointerleave", () => {
			this.hovered = null;
		});
		this.root.addEventListener("focusin", (event) => {
			const element = event.target as HTMLElement;
			if (!element.matches("[data-live-request-action]")) return;
			this.syncFocusToPointer(element, () => {});
			this.applyFocusRing();
		});
		document.body.append(this.root);
	}

	/**
	 * One click, dispatched to the first branch whose target it is inside.
	 *
	 * **Order is load-bearing and the branches return.** The rail's `GALAXY MAP`
	 * carries `data-live-left-tab` and sits inside the Navigation body, so the
	 * tab branch must be tried before the row branch. The failure mode this
	 * shape has is silent: the root itself once carried `data-live-left-tab` as
	 * a state attribute, which made `closest` match it for *every* click in the
	 * cockpit and swallowed row selection and the filter chips without an error
	 * anywhere. A method rather than a closure in the constructor, so the order
	 * is one readable unit the next target has to be placed into deliberately.
	 */
	private handleClick(element: HTMLElement) {
		const request = element.closest<HTMLElement>("[data-live-request-action]");
		if (request) {
			const { liveRequestAction, liveRequestId } = request.dataset;
			if (liveRequestAction && liveRequestId)
				this.callbacks.onRequestAction?.(liveRequestAction, liveRequestId);
			return;
		}
		const stationTab = element.closest<HTMLElement>("[data-live-station-tab]");
		const stationAction = element.closest<HTMLElement>(
			"[data-live-station-action]",
		);
		if (stationAction) {
			const action = stationAction.dataset.liveStationAction;
			const name = stationAction.dataset.liveStationName;
			if (
				name &&
				(action === "buy-commodity" ||
					action === "sell-commodity" ||
					action === "buy-equipment" ||
					action === "buy-fuel" ||
					action === "buy-hull")
			)
				this.callbacks.onStationAction(action, name);
			return;
		}
		if (stationTab) {
			const value = stationTab.dataset.liveStationTab;
			if (
				value === "Market" ||
				value === "Equipment" ||
				value === "Shipyard" ||
				value === "Requests"
			)
				this.callbacks.onStationTab(value);
			return;
		}
		if (element.closest("[data-live-launch-cancel]")) {
			this.callbacks.onCancelLaunch();
			return;
		}
		if (element.closest("[data-live-launch]")) {
			this.callbacks.onLaunch();
			return;
		}
		const group = element.closest<HTMLElement>("[data-live-controls-group]");
		if (group) {
			this.foldControlsGroup(group.dataset.liveControlsGroup as TaskGroup);
			return;
		}
		// **A door before a row**, because the door is drawn inside the same
		// tree and `closest` would otherwise never reach it.
		const door = element.closest<HTMLElement>("[data-live-controls-action]");
		if (door) {
			// The cast is the DOM boundary: `dataset` is `string | undefined`
			// whatever the markup writes, and the union is what every consumer
			// downstream then gets.
			this.callbacks.onControlsAction(
				door.dataset.liveControlsAction as ControlsAction,
			);
			return;
		}
		// A reference row opens the rebind modal on its command since #381 S4.
		// It did nothing when selected while the registry could not store a
		// player layout; it is still in the walk for the reason it always was,
		// so the ring can scroll a long group into view.
		const control = element.closest<HTMLElement>("[data-live-controls-row]");
		if (control) {
			this.callbacks.onRebindRow(control.dataset.liveControlsRow as string);
			return;
		}
		const right = element.closest<HTMLElement>("[data-live-right-tab]");
		if (right) {
			const value = right.dataset.liveRightTab;
			if (RIGHT_TABS.includes(value as RightTab))
				this.callbacks.onRightTab(value as RightTab);
			return;
		}
		const left = element.closest<HTMLElement>("[data-live-left-tab]");
		if (left) {
			const value = left.dataset.liveLeftTab as LeftTab | undefined;
			if (value && LEFT_TABS.includes(value)) this.callbacks.onLeftTab(value);
			return;
		}
		const chip = element.closest<HTMLElement>("[data-live-nav-kind]");
		if (chip) {
			this.toggleKind(chip.dataset.liveNavKind as string);
			return;
		}
		const row = element.closest<HTMLElement>("[data-live-nav-target]");
		if (row) this.callbacks.onSelectTarget(row.dataset.liveNavTarget as string);
	}

	// -------------------------------------------------------------------------
	// The pad's cursor (#283)
	// -------------------------------------------------------------------------

	/**
	 * Everything on a console a pad can act on, in the order it is drawn.
	 *
	 * **Not the nav filter's text field.** `[data-live-nav-query]` is free text
	 * and a pad cannot type; the kind chips are what narrow the list for it, and
	 * an on-screen keyboard was refused (#283's F7) because #70 already refused
	 * a second UI grammar.
	 */
	/**
	 * What the cursor walks — **content, not chrome**.
	 *
	 * The tabs are deliberately absent, and that is the principal's finding on
	 * the first flown leg: walking every focusable element in draw order meant
	 * reaching a list by passing through the tab row first, which reads as the
	 * cursor going somewhere nobody asked for. Tabs have their own control — the
	 * two shoulders — so they need no place in the walk, and `stepTab` finds
	 * them by class rather than through this list.
	 *
	 * `[data-live-launch]` stays: it is an action on the right console, not a
	 * way of getting to one.
	 */
	private static readonly OWN_FOCUSABLE = [
		"[data-live-request-action]",
		"[data-live-station-action]",
		"[data-live-launch]",
		"[data-live-launch-cancel]",
		"[data-live-nav-kind]",
		"[data-live-nav-target]",
		// **The rail's GALAXY MAP button, which is not a tab.** It carries
		// `data-live-left-tab` and no `lc-tab` class, so dropping that attribute
		// wholesale took it out of the walk *and* out of `stepTab`'s reach — a
		// control that left the pad entirely, which neither the PR body nor the
		// "never lands on a tab" check could see. Sage found it. The `:not`
		// keeps the tab row out while leaving the button in.
		"[data-live-left-tab]:not(.lc-tab)",
		// The Controls tab (#372). A header folds on `A` through the click path;
		// a row is walked so the ring can bring the bottom of a long group into
		// view, and selecting one does nothing. Left and right are not a fold:
		// on a console they fall through to head-look (`padIntents`), which is
		// how the pad moves between consoles, and taking them here would
		// reverse #283 — the principal's ruling on this node.
		"[data-live-controls-group]",
		"[data-live-controls-row]",
		// The settings door (#369 D12). It is on the walk as well as clickable,
		// because a pad player who has moved `system.settings` onto a button
		// they forgot has to be able to reach it without a mouse — the mouse is
		// the *modal's* bootstrap, and this is the tab's.
		"[data-live-controls-action]",
	].join(",");

	/**
	 * The chart's controls, which are drawn **inside** the left panel but are
	 * not this class's to act on.
	 *
	 * The Galaxy Map tab hosts `galaxy-map.ts`, which brings its own DOM and its
	 * own `Handle`. Those elements join the cursor's list so the ring can walk
	 * them in the order they are drawn — but `activateFocus` refuses them and
	 * hands them back, because acting on one means calling the chart's handle
	 * and this class holds no reference to a chart. Teaching it their vocabulary
	 * is exactly the coupling that handle exists to avoid.
	 *
	 * `[data-map-finder-query]` is again absent, and again because a pad cannot
	 * type.
	 */
	private static readonly FOREIGN_FOCUSABLE = [
		"[data-map-haze]",
		"[data-map-course]",
		"[data-map-clear]",
		"[data-map-finder-economy]",
		"[data-map-finder-budget-down]",
		"[data-map-finder-budget-up]",
		"[data-map-finder-row]",
		"[data-map-finder-centre]",
	].join(",");

	private static readonly FOCUSABLE =
		`${LiveCockpit.OWN_FOCUSABLE},${LiveCockpit.FOREIGN_FOCUSABLE}`;

	private focusCursor: FocusCursor = NO_FOCUS;
	/** The row the pointer is over, so a hover ticks once per row (#546). */
	private hovered: Element | null = null;

	/**
	 * Reveal the ring on the next render, once.
	 *
	 * A transaction rebuilds the market rows and the rebuild resets the box's
	 * `scrollTop` to zero, so a row the pad had scrolled to and bought came back
	 * below the fold while Cross went on buying it. Scrolling on *every* render
	 * is not the fix — that would drag a player who is scrolling with the mouse
	 * back to the ring sixty times a second — so it is a one-shot, set where the
	 * pad acts and consumed where the ring is drawn. Sage found it, round 2.
	 */
	private revealOnNextRing = false;

	/**
	 * Which surface the cursor is on: the console the head is turned to, or the
	 * station console on the forward wall while docked.
	 *
	 * Read off the **rendered DOM** rather than off the state that produced it.
	 * A list derived from state can name a row the renderer skipped, and the
	 * ring would then sit on nothing; this cannot disagree with what the player
	 * is looking at.
	 */
	private focusScope(): HTMLElement | null {
		return (
			this.root.querySelector<HTMLElement>(
				'[data-live-panel][data-active="true"]',
			) ?? this.root.querySelector<HTMLElement>("[data-live-station-console]")
		);
	}

	private focusElements(): HTMLElement[] {
		const scope = this.focusScope();
		return scope
			? [...scope.querySelectorAll<HTMLElement>(LiveCockpit.FOCUSABLE)]
			: [];
	}

	/**
	 * A stable name for a focusable element, built from the attributes the click
	 * path already reads.
	 *
	 * Stable across a redraw is the whole requirement: `panel-focus` follows a
	 * row by identity so a re-sorting Navigation list cannot slide the cursor
	 * onto a different body. A name is not always unique on its own — the
	 * Navigation rail carries a second `GALAXY MAP` button with the same
	 * `data-live-left-tab` as the tab — so a repeat gets an occurrence suffix,
	 * which is stable because the two are always drawn in the same order.
	 */
	private focusIds(elements: readonly HTMLElement[]): string[] {
		const seen = new Map<string, number>();
		return elements.map((el) => {
			const base = LiveCockpit.focusIdOf(el);
			const count = (seen.get(base) ?? 0) + 1;
			seen.set(base, count);
			return count === 1 ? base : `${base}#${count}`;
		});
	}

	/**
	 * One element's name, before the occurrence suffix.
	 *
	 * A flat walk rather than the nested ternary this started as: eight branches
	 * indented eight deep read as one expression a reader has to unpick, and the
	 * ninth would have been worse. Sage asked, round 2.
	 */
	private static focusIdOf(el: HTMLElement): string {
		if (el.dataset.liveRequestAction)
			return `request:${el.dataset.liveRequestAction}:${el.dataset.liveRequestId}`;
		const d = el.dataset;
		if (d.liveStationAction !== undefined)
			return `station-action:${d.liveStationAction}:${d.liveStationName}`;
		if (d.liveStationTab !== undefined)
			return `station-tab:${d.liveStationTab}`;
		if (d.liveLaunch !== undefined) return "launch";
		if (d.liveRightTab !== undefined) return `right-tab:${d.liveRightTab}`;
		if (d.liveLeftTab !== undefined) return `left-tab:${d.liveLeftTab}`;
		if (d.liveNavKind !== undefined) return `nav-kind:${d.liveNavKind}`;
		if (d.liveNavTarget !== undefined) return `nav-target:${d.liveNavTarget}`;
		if (d.liveControlsGroup !== undefined)
			return groupFocusId(d.liveControlsGroup as TaskGroup);
		if (d.liveControlsRow !== undefined) return rowFocusId(d.liveControlsRow);
		return LiveCockpit.foreignFocusId(el);
	}

	/** Whether the pad has anything to walk here at all. */
	hasFocusScope(): boolean {
		return this.focusScope() !== null;
	}

	/**
	 * Draw the ring, and only there.
	 *
	 * Called after every render because a structural rebuild replaces the
	 * elements the attribute was on — the cursor survives it, the attribute does
	 * not. Clearing by query rather than by remembering the last element, for
	 * the same reason.
	 */
	/** The element the ring was last written on, so clearing it is not a query. */
	private ringed: HTMLElement | null = null;

	/**
	 * Say which surface the pad is on, and how to work it.
	 *
	 * Both were the principal's findings on the first flown leg: nothing on
	 * screen said which panel the d-pad was walking — least of all docked with
	 * the head forward, where the station console is the surface and no head
	 * turn announced it — and nothing said what the buttons did. The settings
	 * screen has had a hint line since long before the pad; the consoles had
	 * none.
	 *
	 * The hint is drawn **only while a pad is present**, because a line telling
	 * a keyboard player about Cross is noise on every frame they ever see.
	 */
	private markPadScope(
		holds: boolean,
		scope: HTMLElement | null,
		elements: readonly HTMLElement[],
	) {
		// **Remembered, not queried — the rule the ring already follows.** The
		// first version swept the cockpit twice with `querySelectorAll`, for two
		// attributes this class is the only writer of, on every rendered frame
		// whether or not a pad was attached: it put back exactly the per-frame
		// scanning that was removed a round earlier, and doubled it. Sage found
		// that, and found that the sweep *skipped the live scope* — so a pad
		// disconnect took the hint away and left the border still claiming the
		// d-pad was walking that panel.
		// **The query is inside, and only a pad pays for it.** It was an argument
		// computed at both call sites on every rendered frame and then thrown
		// away here for every keyboard player — a full failed subtree scan under
		// a comment claiming the opposite, and a second one beside the scan
		// `focusedElement` already does. Sage found that too; the eager argument
		// was the same mistake as the sweep it replaced.
		// **The marker answers "does this panel hold the pad", and only the game
		// knows that.** Two earlier gates got it wrong in opposite directions:
		// on the walk being non-empty, which hid the marker on the very surfaces
		// this branch had emptied; and then on the scope alone, which claimed the
		// pad for a drawn panel while the instrument or the settings screen
		// actually held it. `holds` is the game's answer.
		//
		// What an empty walk changes is the *hint*, not the marker: WALK is the
		// one segment that becomes a lie there, and the others stay true.
		const wanted = holds ? scope : null;
		// **The text is part of the identity, not just the element.** Keyed on
		// the scope alone, a hint went stale whenever the *same* panel changed
		// what it had — narrow the Navigation filter to nothing and the line went
		// on promising a walk. Sage found it.
		const text = wanted
			? padHintFor(this.controls.bindings, {
					station: wanted.matches("[data-live-station-console]"),
					walkable: elements.length > 0,
				})
			: "";
		if (wanted === this.padScope && text === this.padHint?.textContent) return;
		if (this.padScope) delete this.padScope.dataset.livePadScope;
		this.padHint?.remove();
		this.padHint = null;
		this.padScope = wanted;
		if (!wanted) return;
		wanted.dataset.livePadScope = "true";
		const hint = document.createElement("p");
		hint.className = "lc-pad-hint";
		hint.dataset.livePadHint = "";
		hint.textContent = text;
		wanted.append(hint);
		this.padHint = hint;
	}

	/** The panel wearing the scope marker, and the hint line inside it. */
	private padScope: HTMLElement | null = null;
	private padHint: HTMLElement | null = null;

	/**
	 * Whether **this console** currently holds the pad.
	 *
	 * Not "is a pad attached", which is what it was and which made the marker
	 * answer the wrong question. `readPadContext` returns `instrument` and
	 * `modal` *before* it ever asks whether a console is drawn, so a panel can
	 * be on screen while something else owns the pad entirely — hand the frame
	 * instrument the pad and turn to port, and the port console wore the border
	 * and the hint while up/down walked the instrument and the ship flew on.
	 * Sage found it and called it a blocker, with that repro and a second one
	 * through the settings scrim.
	 *
	 * The game owns the context, so the game answers the question; this class
	 * is told, and does not guess from what it can see.
	 */
	private padHolds = false;

	setPadHolds(holds: boolean) {
		if (this.padHolds === holds) return;
		this.padHolds = holds;
		const elements = this.focusElements();
		this.markPadScope(holds, this.focusScope(), elements);
	}

	private applyFocusRing(scroll = false) {
		const reveal = scroll || this.revealOnNextRing;
		this.revealOnNextRing = false;
		// **Remembered, not queried.** This runs on every rendered frame, pad or
		// no pad, and a `querySelectorAll` over the cockpit for an attribute this
		// class is the only writer of is a scan for something it already knows.
		// Sage asked three rounds running; this is the half of it that needs no
		// measurement to justify — the remaining `focusElements` scan is still
		// declined, because no instrument here says it costs anything.
		if (this.ringed) delete this.ringed.dataset.liveFocus;
		this.ringed = null;
		// **One scan for the frame**, handed to both. `focusElements` is a
		// `focusScope` query plus a six-selector `querySelectorAll`, and running
		// it here *and* inside `markPadScope` took a pad player's frame from two
		// DOM queries to five — under a comment claiming only a pad paid for it,
		// which was true and beside the point. Sage found it, round 3.
		const elements = this.focusElements();
		const scope = this.focusScope();
		this.markPadScope(this.padHolds, scope, elements);
		const element = this.focusedElement(elements);
		if (!element) return;
		element.dataset.liveFocus = "true";
		this.ringed = element;
		// **A ring below the fold is worse than no ring.** The Navigation list,
		// the market rows and the finder's results are all `overflow: auto`, so a
		// cursor walked past the visible rows is drawn on a row nobody can see —
		// and Cross still buys it. `block: "nearest"` because the row is usually
		// already in view and scrolling it to the middle every press would make
		// the list jump under a player who is only stepping down it.
		//
		// Only on a *move*: a structural redraw re-applies the ring every frame,
		// and scrolling there would fight a player who had scrolled with the
		// mouse. Sage found the whole of this, round 1.
		if (reveal) element.scrollIntoView({ block: "nearest", inline: "nearest" });
	}

	/**
	 * Walk the cursor. `-1` is up the list and `1` is down it. Whether it
	 * landed on another row, which is what the tick reads (#546): a list of one
	 * wraps onto itself.
	 */
	stepFocus(delta: number): boolean {
		const ids = this.focusIds(this.focusElements()).map((id) => ({ id }));
		const from = this.focusCursor.id;
		this.focusCursor = moveFocus(ids, this.focusCursor, delta);
		this.applyFocusRing(true);
		return this.focusCursor.id !== from;
	}

	/**
	 * Do what the focused row does — **through the click path, not through a
	 * synthetic click**.
	 *
	 * `handleClick` takes an element and walks `closest` from it, so handing it
	 * the focused element runs exactly the branch a mouse would run. Dispatching
	 * a `MouseEvent` instead would be testing the DOM's hit-testing, which is
	 * not the thing that has to work.
	 */
	activateFocus(): boolean {
		const element = this.focusedElement();
		if (!element) return false;
		if (!element.closest(LiveCockpit.OWN_FOCUSABLE)) return false;
		this.handleClick(element);
		// The dispatch may rebuild this surface — a purchase does — and the
		// rebuild lands on a later frame, so the reveal is armed rather than done.
		this.revealOnNextRing = true;
		return true;
	}

	/**
	 * The element under the ring.
	 *
	 * Exposed for the one caller that owns a surface this class does not: when
	 * `activateFocus` returns `false` the focused row belongs to the chart, and
	 * the game routes it to the chart's own handle.
	 */
	focusedElement(scanned?: readonly HTMLElement[]): HTMLElement | null {
		const elements = scanned ?? this.focusElements();
		if (elements.length === 0) return null;
		const items = this.focusIds(elements).map((id) => ({ id }));
		// **Write the resolved position back.** The cursor's contract is "the id
		// it means and the index it was last drawn at", and until #283's round 3
		// only `moveFocus` ever wrote that index — so a row focused at the top of
		// the Navigation list and later re-sorted down it still remembered the
		// top, and the moment it left scanner range the fallback dropped the
		// cursor there. Resolving here is where "last drawn at" becomes true.
		this.focusCursor = refreshFocus(items, this.focusCursor);
		const item = focusedItem(items, this.focusCursor);
		if (!item) return null;
		const at = items.findIndex((each) => each.id === item.id);
		return at === -1 ? null : (elements[at] ?? null);
	}

	/**
	 * A stable name for one of the chart's controls.
	 *
	 * The finder's rows are keyed by **system index**, which is what the panel's
	 * own click handler reads — so the cursor follows a system when the result
	 * list re-sorts under a changed filter, rather than sliding onto whatever
	 * took that row.
	 */
	private static foreignFocusId(el: HTMLElement): string {
		const d = el.dataset;
		if (d.mapHaze !== undefined) return "map-haze";
		if (d.mapCourse !== undefined) return "map-course";
		if (d.mapClear !== undefined) return "map-clear";
		if (d.mapFinderEconomy !== undefined)
			return `finder-economy:${d.mapFinderEconomy}`;
		if (d.mapFinderBudgetDown !== undefined) return "finder-budget-down";
		if (d.mapFinderBudgetUp !== undefined) return "finder-budget-up";
		if (d.mapFinderCentre !== undefined)
			return `finder-centre:${d.mapFinderCentre}`;
		return `finder-row:${d.mapFinderRow}`;
	}

	/**
	 * Change the tab of whichever console the cursor is on.
	 *
	 * Found by reading `aria-selected` off the drawn tabs rather than by knowing
	 * which of three tab lists this surface has. The panel already says which
	 * one is current, in the attribute a screen reader uses; a second copy of
	 * that knowledge here is a third list to keep in step.
	 */
	stepTab(delta: number) {
		const scope = this.focusScope();
		if (!scope || delta === 0) return;
		const tabs = [...scope.querySelectorAll<HTMLElement>(".lc-tab")];
		if (tabs.length === 0) return;
		const current = tabs.findIndex(
			(tab) => tab.getAttribute("aria-selected") === "true",
		);
		const from = current === -1 ? 0 : current;
		const next = (((from + delta) % tabs.length) + tabs.length) % tabs.length;
		const tab = tabs[next];
		if (tab) this.handleClick(tab);
	}

	/**
	 * Fold or open one of the Controls tab's groups (#370 D9).
	 *
	 * Redraws the tree and nothing else: the fold is not in the structural key,
	 * so the panel's tabs, header and readouts are left standing. Then the
	 * cursor goes to the header that folded — `focusAfterFold` says why — and
	 * the ring is put back on the rebuilt element.
	 */
	private foldControlsGroup(group: TaskGroup) {
		this.controlsCollapsed = toggleGroup(this.controlsCollapsed, group);
		const tree = this.root.querySelector<HTMLElement>(
			"[data-live-controls-tree]",
		);
		if (!tree) return;
		tree.innerHTML = controlsTreeMarkup(this.controls, this.controlsCollapsed);
		const ids = this.focusIds(this.focusElements()).map((id) => ({ id }));
		this.focusCursor = focusAfterFold(ids, this.focusCursor, group);
		this.applyFocusRing(true);
	}

	requestsSurfaceOpen(): boolean {
		return !!this.focusScope()?.querySelector("[data-live-requests]");
	}

	/** Native Tab focus and the pad cursor both activate through the click path. */
	activateKeyboardFocus(target: EventTarget | null): void {
		if (
			target instanceof HTMLButtonElement &&
			this.focusScope()?.contains(target)
		)
			target.click();
		else this.activateFocus();
	}

	/**
	 * Put the cursor where the pointer just acted.
	 *
	 * So the ring the pad walks is the row the mouse last used, and neither
	 * device has to be told the other exists — seekolous's rule, which this
	 * repo inherited with the module: whichever acted last is in charge, and no
	 * flag records which.
	 */
	private syncFocusToPointer(
		element: HTMLElement | null,
		dispatch: () => void,
	) {
		const before = this.focusElements();
		const at = element ? before.indexOf(element) : -1;
		const id = at === -1 ? null : (this.focusIds(before)[at] ?? null);
		dispatch();
		if (id === null) return;
		// Against the list as it is *now*. The id is stable across a rebuild, so
		// this lands on the replacement row; if the click replaced the surface
		// entirely the id is absent and `setFocus` keeps the cursor where it was.
		this.focusCursor = setFocus(
			this.focusIds(this.focusElements()).map((each) => ({ id: each })),
			this.focusCursor,
			id,
		);
	}

	/** The filter last rendered — the base every chip toggle is applied to. */
	private filter: NavFilter = { kinds: [], query: "" };

	private toggleKind(kind: string) {
		const kinds = this.filter.kinds.includes(kind)
			? this.filter.kinds.filter((k) => k !== kind)
			: [...this.filter.kinds, kind];
		this.callbacks.onNavFilter({ ...this.filter, kinds }, "chip");
	}

	setVisible(visible: boolean) {
		const next = String(visible);
		if (this.root.dataset.liveActive !== next)
			this.root.dataset.liveActive = next;
	}

	update(state: LiveCockpitState) {
		const view = cockpitView(state.headLook);
		this.filter = state.navFilter;
		// **`targetId` is deliberately not in the structural key.** Selecting a
		// system from the Navigation list changes it, and a rebuild on that
		// keystroke would blow away the filter field's focus and caret — the
		// list would become unusable exactly while it was being used.
		const key = `${state.visible}|${state.dockPhase}|${state.headLook}|${state.leftTab}|${state.rightTab}|${state.stationConsole?.label ?? ""}|${state.stationConsole?.tab ?? ""}|${state.stationConsole?.revision ?? 0}|${state.stationConsole?.message ?? ""}|${state.launchHold ? "held" : ""}|${!!state.requests}|${state.requests?.revision ?? 0}|${state.firstDay?.current ?? ""}|${state.firstDay?.text ?? ""}|${state.firstDay?.stationLine ?? ""}|${state.firstDay?.controls.keyboard ?? ""}|${state.firstDay?.controls.controller ?? ""}|${state.rightTab === "Commander" ? ladderViewKey(state.ladders) : ""}`;
		this.setVisible(state.visible);
		this.root.dataset.liveHeadLook = state.headLook;
		this.root.dataset.liveDocked = String(state.dockPhase === "docked");
		// `liveLeftView`, **not** `liveLeftTab`. The root is an ancestor of every
		// tab button, so a state attribute sharing the buttons' name makes
		// `closest("[data-live-left-tab]")` match the root for *every* click in
		// the cockpit — which silently swallowed row selection and the filter
		// chips, because that branch returns after handling what it matched.
		this.root.dataset.liveLeftView = state.leftTab;
		this.root.dataset.liveTargetDirector = String(view.targetDirectorVisible);
		if (key !== this.lastKey) {
			this.lastKey = key;
			this.lastValueKey = "";
			this.lastNavKey = "";
			this.lastLogKey = null;
			// The rebuilt aside is empty; without this the cue stays empty until
			// its key moves (sage #350).
			this.lastRelayKey = "";
			this.lastConsoleLine = undefined;
			this.navRowsById.clear();
			this.releaseChartHost();
			this.root.innerHTML = this.markup(state);
			const find = (selector: string) =>
				this.root.querySelector<HTMLElement>(selector);
			this.elements = {
				requestAges: [
					...this.root.querySelectorAll<HTMLElement>("[data-live-request-age]"),
				],
				director: find("[data-live-director] > strong"),
				leftPanelCopy: find("[data-live-left-copy]"),
				rightPanelCopy: find('[data-live-panel="right"] .lc-panel-copy > p'),
				contactCount: find("[data-live-contact-count]"),
				legalStatus: find("[data-live-legal-status]"),
				hails: find("[data-live-hails]"),
				assistReadout: find("[data-live-assist]"),
				chargeReadout: find("[data-live-charge]"),
				duel: find("[data-live-duel]"),
				duelFore: find("[data-live-duel-fore]"),
				duelAft: find("[data-live-duel-aft]"),
				duelHull: find("[data-live-duel-hull]"),
				duelBank: find("[data-live-duel-bank]"),
				duelHeat: find("[data-live-duel-heat]"),
				scanReadout: find("[data-live-scan]"),
				scanName: find("[data-live-scan-name]"),
				scanRegistry: find("[data-live-scan-registry]"),
				scanStanding: find("[data-live-scan-standing]"),
				scanManifest: find("[data-live-scan-manifest]"),
				scanAge: find("[data-live-scan-age]"),
				raiderLog: find("[data-live-raider-log]"),
				relayCue: find("[data-live-relay-cue]"),
				navList: find("[data-live-nav-list]"),
				navQuery: this.root.querySelector<HTMLInputElement>(
					"[data-live-nav-query]",
				),
				arrow: find(".lc-target-arrow"),
				launchNotices: [
					...this.root.querySelectorAll<HTMLElement>(
						"[data-live-launch-notice]",
					),
				],
			};
			const host = this.root.querySelector<HTMLElement>(
				"[data-live-chart-host]",
			);
			if (host) {
				this.chartHost = host;
				this.callbacks.onChartHost(host);
			}
		}
		const elements = this.elements;
		if (!elements) return;
		for (const age of elements.requestAges) {
			const text = `${Math.max(0, Math.floor((state.requests?.now ?? 0) - Number(age.dataset.liveRequestAge)))}s old`;
			if (age.textContent !== text) age.textContent = text;
		}
		if (elements.director)
			elements.director.textContent = state.targetName ?? "NO TARGET SELECTED";
		if (elements.navQuery && elements.navQuery.value !== state.navFilter.query)
			elements.navQuery.value = state.navFilter.query;
		this.renderNav(state, elements);
		// After the nav rows, because `renderNav` rebuilds them and a rebuild
		// takes the attribute with it. The cursor is not in the markup, so it
		// survives; the ring has to be put back.
		this.applyFocusRing();
		const duelKey = state.duel ? Object.values(state.duel).join(",") : "";
		// **`legalStatus` and `hails` are in this key because both rows are bound
		// below the gate, and a row bound inside a key it is not in only refreshes
		// when something else moves.** Neither was in it when #396 put a value on
		// the HAILS row, and the browser row caught it: the carrier had hailed, the
		// store held the line, and the rail still read `NONE`. In flight that is
		// invisible — speed and charge are never still long enough to see the lag —
		// and the probe's frozen loop is the first caller that ever stood still. A
		// row whose value can move while the pilot holds the stick still is a row
		// this key has to name.
		const valueKey = `${state.speed}|${state.mode}|${state.throttle}|${state.assist}|${state.charge}|${duelKey}|${state.target}|${state.rightTab}|${state.tuning}|${state.contacts.length}|${launchHoldText(state.launchHold)}|${state.legalStatus}|${state.hails}`;
		// #324 part d: the raider lifecycle, a line each, on its own key so a
		// speed change does not rebuild the list (sage #330). Escaped, although
		// every line is built from a slot name and a fixed phrase.
		const logKey = state.raiderLog.join("/");
		if (elements.raiderLog && logKey !== this.lastLogKey) {
			this.lastLogKey = logKey;
			elements.raiderLog.innerHTML = state.raiderLog.length
				? state.raiderLog.map((line) => `<li>${escapeHtml(line)}</li>`).join("")
				: "<li>No signals</li>";
		}
		// #43: the relay's signal, on its own key, because its bearing moves
		// every frame and must not rebuild anything else.
		if (elements.relayCue) {
			const relayKey = relayCueKey(state.relay);
			if (relayKey !== this.lastRelayKey) {
				this.lastRelayKey = relayKey;
				elements.relayCue.hidden = !state.relay;
				elements.relayCue.innerHTML = state.relay
					? relayCueMarkup(state.relay)
					: "";
			}
		}
		// #408: station control on the port console, written in place. It changes
		// when a station is selected, and a rebuild on selection would take the
		// filter field's focus — the reason `targetId` is not in the key above.
		const consoleLine = state.firstDay?.consoleLine ?? null;
		if (consoleLine !== this.lastConsoleLine) {
			this.lastConsoleLine = consoleLine;
			const line = this.root.querySelector<HTMLElement>(
				"[data-live-console-control]",
			);
			if (line) {
				line.hidden = consoleLine === null;
				const text = line.querySelector("span");
				if (text) text.textContent = consoleLine ?? "";
			}
		}
		if (valueKey === this.lastValueKey) return;
		this.lastValueKey = valueKey;
		// The reason can change while the hold stands — a carrier clears the lane
		// and an older one is queued behind it — so it is a value, not structure.
		for (const notice of elements.launchNotices)
			notice.textContent = launchHoldText(state.launchHold);
		if (elements.leftPanelCopy)
			elements.leftPanelCopy.textContent = state.target;
		if (elements.rightPanelCopy)
			elements.rightPanelCopy.textContent =
				state.rightTab === "Tuning"
					? state.tuning
					: `${state.mode} · ${state.speed} · throttle ${state.throttle}`;
		if (elements.contactCount)
			elements.contactCount.textContent = String(state.contacts.length);
		if (elements.legalStatus)
			elements.legalStatus.textContent = state.legalStatus;
		// **The rail's HAILS row, carrying a value for the first time (#396).**
		// The markup has had the word since this file was written, and a pilot who
		// is being told to cease fire by the ship they are shooting at has until
		// now had no row on the glass that could have carried it.
		if (elements.hails) elements.hails.textContent = state.hails;
		// **These two rendered as labels with nothing beside them.** §5 gives the
		// Flight console assist and the Drive console the cruise charge, and the
		// markup has carried both rows since the console was built — with an
		// empty `<em>`, which reads as an instrument that is broken rather than
		// one that was never wired.
		if (elements.assistReadout)
			elements.assistReadout.textContent = state.assist;
		if (elements.chargeReadout)
			elements.chargeReadout.textContent = state.charge;
		// #324's duel detail. **Inline `display`, not the `hidden` attribute**:
		// `.lc-readout` sets a display of its own, and an attribute loses to a
		// class rule — the #311 badge showed on every page that way.
		if (elements.duel) {
			elements.duel.style.display = state.duel ? "" : "none";
			const duel = state.duel;
			if (duel) {
				if (elements.duelFore) elements.duelFore.textContent = duel.fore;
				if (elements.duelAft) elements.duelAft.textContent = duel.aft;
				if (elements.duelHull) elements.duelHull.textContent = duel.hull;
				if (elements.duelBank) elements.duelBank.textContent = duel.bank;
				if (elements.duelHeat) elements.duelHeat.textContent = duel.heat;
			}
		}
		// #364's reading. Same inline-`display` rule as the duel block above:
		// `.lc-readout` sets its own display, so the `hidden` attribute would lose.
		if (elements.scanReadout) {
			elements.scanReadout.style.display = state.scan ? "" : "none";
			const scan = state.scan;
			if (scan) {
				if (elements.scanName) elements.scanName.textContent = scan.name;
				if (elements.scanRegistry)
					elements.scanRegistry.textContent = scan.registry;
				if (elements.scanStanding)
					elements.scanStanding.textContent = scan.standing;
				if (elements.scanManifest)
					elements.scanManifest.textContent = scan.manifest;
				if (elements.scanAge) elements.scanAge.textContent = scan.age;
			}
		}
		if (elements.arrow) {
			elements.arrow.hidden = state.targetBearingDeg === null;
			if (state.targetBearingDeg !== null)
				elements.arrow.style.setProperty(
					"--target-bearing",
					`${-state.targetBearingDeg}deg`,
				);
		}
	}

	/**
	 * Repaint the target list, and only when what it shows has changed.
	 *
	 * Keyed on the printed strings rather than the row objects, because ranges
	 * move every frame and the panel prints them rounded: a key on the raw
	 * kilometres would rebuild the list sixty times a second to draw the same
	 * characters, and every rebuild is a lost hover.
	 */
	private renderNav(state: LiveCockpitState, elements: CockpitElements) {
		// The tabs that draw no list have no element to draw into, and nothing
		// below is worth computing for one.
		const navList = elements.navList;
		if (!navList) return;
		// **The key is derived from the cells, not computed alongside them.**
		// Formatting twice — once to build the key, once to draw — is two passes
		// whose shapes have to stay identical, or the cache stops describing
		// what is on screen. One pass, and the array is the cost of knowing.
		//
		// The formatters run every frame the tab is open because what they
		// print is what decides: the range moves continuously and the panel
		// prints it rounded, so there is no cheaper discriminator that is not
		// just a guess about when the rounded value changed.
		const cells = state.navRows.map((row) => ({
			row,
			range: range(row.distanceKm),
			eta: navEta(row.etaSeconds),
		}));
		const key = cells
			.map(({ row, range, eta }) => `${row.id}:${row.selected}:${range}:${eta}`)
			.join("|");
		if (key === this.lastNavKey) return;
		this.lastNavKey = key;
		if (cells.length === 0) {
			this.navRowsById.clear();
			if (!navList.querySelector(".lc-nav-empty")) {
				const empty = document.createElement("li");
				empty.className = "lc-nav-empty";
				empty.textContent = "NO TARGETS MATCH";
				navList.replaceChildren(empty);
			}
			return;
		}

		navList.querySelector(".lc-nav-empty")?.remove();
		const liveIds = new Set(cells.map(({ row }) => row.id));
		for (const [id, rowElements] of this.navRowsById)
			if (!liveIds.has(id)) {
				rowElements.item.remove();
				this.navRowsById.delete(id);
			}

		for (const [index, { row, range: rangeText, eta }] of cells.entries()) {
			let rowElements = this.navRowsById.get(row.id);
			if (!rowElements) {
				const item = document.createElement("li");
				const button = document.createElement("button");
				const name = document.createElement("span");
				const kind = document.createElement("i");
				const range = document.createElement("em");
				button.className = "lc-nav-row";
				button.type = "button";
				button.dataset.liveNavTarget = row.id;
				button.append(name, kind, range);
				item.append(button);
				rowElements = { item, button, name, kind, range };
				this.navRowsById.set(row.id, rowElements);
			}
			rowElements.button.setAttribute("aria-current", String(row.selected));
			rowElements.name.textContent = row.name;
			rowElements.kind.textContent = row.displayKind.toUpperCase();
			rowElements.range.textContent = `${rangeText} · ${eta}`;
			const current = navList.children.item(index);
			if (current !== rowElements.item)
				navList.insertBefore(rowElements.item, current);
		}
	}

	/** Tell the owner its chart host is going away, before the DOM drops it. */
	private releaseChartHost() {
		if (!this.chartHost) return;
		this.chartHost = null;
		this.callbacks.onChartHost(null);
	}

	private markup(state: LiveCockpitState) {
		const view = cockpitView(state.headLook);
		const targetName = escapeHtml(state.targetName ?? "NO TARGET SELECTED");
		const leftTabs = LEFT_TABS.filter(
			(tab) => tab !== "Requests" || !!state.requests,
		)
			.map(
				(tab) =>
					`<button class="lc-tab" type="button" data-live-left-tab="${tab}" aria-selected="${state.leftTab === tab}">${tab}</button>`,
			)
			.join("");
		const rightTabs = RIGHT_TABS.map(
			(tab) =>
				`<button class="lc-tab" type="button" data-live-right-tab="${tab}" aria-selected="${state.rightTab === tab}">${tab}</button>`,
		).join("");
		// A held launch replaces the control with its reason and a way out (#314):
		// pressing LAUNCH again would only re-ask for a turn it already holds.
		// **On every docked console, not only Flight.** The hold fires by itself
		// when the lane clears, so a player who pressed Enter from the station
		// console, or went back to trading, must still see it (sage round 1).
		// **`launchHoldNotice`, not `hold`.** CONTEXT.md keeps the four senses
		// of that word apart, and since #445 the same method also reads
		// `state.hold`, which is the cargo hold and not a held launch.
		const launchHoldNotice = this.launchHoldBlock(state);
		const launch =
			state.dockPhase !== "docked"
				? ""
				: launchHoldNotice ||
					(state.rightTab === "Flight"
						? '<button class="lc-launch" type="button" data-live-launch>LAUNCH</button>'
						: "");
		return `<main class="lc-director" data-live-director><i class="lc-target-arrow" data-live-target-arrow aria-label="turn toward selected target">➤</i><strong>${targetName}</strong></main>${this.stationConsole(state)}${requestCue(state.requests)}<aside class="lc-relay-cue" data-live-relay-cue hidden></aside><aside class="lc-panel" data-live-panel="left" data-active="${view.activePanel === "left"}"><header><h2>${state.leftTab.toUpperCase()}</h2><small>LOCAL · 24</small></header><nav class="lc-tabs" aria-label="left console tabs">${leftTabs}</nav><p class="lc-station-control lc-console-control" data-live-console-control hidden><b>STATION CONTROL</b> <span></span></p>${this.leftBody(state)}${launchHoldNotice}</aside><aside class="lc-panel" data-live-panel="right" data-active="${view.activePanel === "right"}"><header><h2>${state.rightTab.toUpperCase()}</h2><small>CMDR · SEELITE</small></header><nav class="lc-tabs" aria-label="right console tabs">${rightTabs}</nav>${this.rightBody(state)}${launch}</aside>`;
	}

	/** A held launch's reason and its way out, for every docked console (#314). */
	private launchHoldBlock(state: LiveCockpitState) {
		return state.dockPhase === "docked" && state.launchHold
			? '<div class="lc-launch-hold" data-live-launch-hold><p data-live-launch-notice></p><button class="lc-launch" type="button" data-live-launch-cancel>CANCEL LAUNCH</button></div>'
			: "";
	}

	/**
	 * The hold, above the rows the till refuses against (#443).
	 *
	 * Used, capacity, free and the entrusted share — the four figures whose
	 * absence made an eleven-tonne sale into a 20 t hull read as a broken till.
	 * The entrusted clause is dropped rather than zeroed when no job's cargo is
	 * aboard, for `entrustedClause`'s reason one module along: a line about a
	 * consignment that does not exist is the same confusion in reverse.
	 */
	private holdLine(hold: HoldSummary) {
		// `Number(...)` at the boundary, the way `escapeHtml` is on the sibling
		// below: these are sums over `commander.cargo` and the request journal,
		// which is deserialised state, and a non-numeric value out of a tampered
		// save would otherwise concatenate straight into the markup.
		const n = (value: number) => String(Number(value));
		return `<p class="lc-station-hold" data-live-station-hold>HOLD ${n(hold.usedT)} / ${n(hold.capacityT)} t · ${n(hold.freeT)} t free${entrustedClause(hold.entrustedT, " · ")}</p>`;
	}

	/**
	 * What the till said when it said no, or an empty live region (#443).
	 *
	 * The element is always rendered, empty or not, and carries `role="status"`
	 * — **and that is as far as the claim goes.** The console's markup is
	 * rebuilt wholesale whenever its memo key moves and the message is part of
	 * that key, so the node carrying a new refusal is a *new* node. Assistive
	 * technology does not reliably announce a region that arrives with its text
	 * already in it, and nothing here measures whether it does; what
	 * `probe-requests` checks is that the refusal is **visible**. Announcing it
	 * properly wants a persistent region outside the rebuilt subtree, which is
	 * a cockpit-wide change rather than this node's.
	 */
	private stationMessage(message: string | null) {
		return `<p class="lc-station-message" data-live-station-message role="status">${message === null ? "" : escapeHtml(message)}</p>`;
	}

	/**
	 * Station control speaking to a guided pilot (#408 D3). Amber, the colour
	 * `hud-and-scanner.md` §4 gives an actionable prompt, and absent rather than
	 * empty when there is nothing to say, because it is not a live region.
	 */
	private stationControl(line: string | null) {
		return line === null
			? ""
			: `<p class="lc-station-control" data-live-station-control><b>STATION CONTROL</b> ${escapeHtml(line)}</p>`;
	}

	private stationConsole(state: LiveCockpitState) {
		const stationConsole = state.stationConsole;
		if (!stationConsole || state.dockPhase !== "docked") return "";
		const tabs = (["Market", "Equipment", "Shipyard", "Requests"] as const)
			.filter((tab) => tab !== "Requests" || !!state.requests)
			// #556 D8: at shipyards only, and absent rather than empty elsewhere.
			.filter((tab) => tab !== "Shipyard" || !!stationConsole.shipyard)
			.map(
				(tab) =>
					`<button class="lc-tab" type="button" data-live-station-tab="${tab}" aria-selected="${stationConsole.tab === tab}">${tab}</button>`,
			)
			.join("");
		return `<section class="lc-station-console" data-live-station-console data-live-station-tab-active="${stationConsole.tab}"><header><h2>STATION</h2><small>${escapeHtml(stationConsole.label)}</small></header><nav class="lc-tabs" aria-label="station console tabs">${tabs}</nav>${this.stationControl(state.firstDay?.stationLine ?? null)}${this.holdLine(stationConsole.hold)}${this.stationMessage(stationConsole.message)}${
			stationConsole.tab === "Requests"
				? requestsBody(state.requests)
				: stationConsole.tab === "Market"
					? this.market(stationConsole.market)
					: stationConsole.tab === "Shipyard" && stationConsole.shipyard
						? this.shipyard(stationConsole.shipyard, stationConsole.credits)
						: this.equipment(
								stationConsole.equipment,
								stationConsole.ownedEquipment,
								{
									ly: stationConsole.fuelLy,
									capacityLy: stationConsole.fuelCapacityLy,
								},
							)
		}${this.launchHoldBlock(state)}<p class="lc-station-commander" data-live-commander>${this.commanderLine(stationConsole)}</p></section>`;
	}

	/**
	 * The console's bottom line: credits, and the pilot's goods by name.
	 *
	 * **The Market tab keeps only the credits (#473 D11)**, because its HELD
	 * column says the same thing per row and a second list beside it is two
	 * copies of one fact. Every other tab keeps the whole line — on the
	 * Shipyard it is the only place the cargo shows.
	 */
	private commanderLine(stationConsole: {
		tab: StationConsoleTab;
		credits: number;
		cargo: readonly string[];
	}) {
		const credits = `${stationConsole.credits.toFixed(1)} Cr`;
		return stationConsole.tab === "Market"
			? credits
			: `${credits} · HOLD ${escapeHtml(stationConsole.cargo.join(", ") || "EMPTY")}`;
	}

	private market(rows: readonly ConsoleMarketRow[]) {
		const row = (entry: ConsoleMarketRow) => {
			const display = marketDisplayValues(entry);
			const name = escapeHtml(display.name);
			// HELD (#473 D10): blank when none is aboard, so the rows that carry
			// cargo stand out. Escaped like the shelf: it is deserialised state.
			const held = escapeHtml(display.held ?? "");
			if (!entry.listed)
				return `<div class="lc-station-row" data-live-market-row="${name}" data-live-listed="false"><span>${name}</span><span class="lc-station-cell">—</span><span class="lc-station-cell">—</span><span class="lc-station-cell">—</span><span class="lc-station-cell" data-live-held>${held}</span></div>`;
			// **Two prices, both through `priceLabel`** (§5.6, #191 D3). The BUY
			// column is the market's own figure and the SELL column is that less the
			// station's cut, so the spread is something the commander reads rather
			// than discovers in the ledger. #193's rule covers both: a base price is a
			// multiple of `PRICE_STEP_CR` and a responded one is a multiple of
			// nothing, so either one rounded to whole credits is a number the till
			// will not honour.
			const buy = display.buy;
			const sell = display.sell;
			const stock = escapeHtml(display.shelf ?? "");
			// **The space is inside the mark, not after the count.** Probes compare
			// the shelf cell's first text node to `${quantity} ${unit}` exactly,
			// and a trailing space there would fail every capped row. Not a
			// `<span>`, either: the row-arity test counts those as cells.
			const shelfMark =
				display.shelfMark === null
					? ""
					: `<b class="lc-station-max" data-live-shelf-max title="${escapeHtml(SHELF_MAX_TITLE)}"> ${display.shelfMark}</b>`;
			const priceDelta =
				display.priceDelta === null
					? ""
					: `<small class="lc-station-delta">${display.priceDelta}</small>`;
			const stockDelta =
				display.quantityDelta === null
					? ""
					: `<small class="lc-station-delta">${display.quantityDelta}</small>`;
			const actions = entry.commodity.sellOnly
				? `<button class="lc-station-action" type="button" data-live-station-action="sell-commodity" data-live-station-name="${name}">SELL</button>`
				: `<button class="lc-station-action" type="button" data-live-station-action="buy-commodity" data-live-station-name="${name}">BUY</button><button class="lc-station-action" type="button" data-live-station-action="sell-commodity" data-live-station-name="${name}">SELL</button>`;
			return `<div class="lc-station-row" data-live-market-row="${name}" data-live-listed="true"><span>${name}</span><span class="lc-station-cell" data-live-buy>${buy}${priceDelta}</span><span class="lc-station-cell lc-station-bid" data-live-sell>${sell}</span><span class="lc-station-cell" data-live-shelf>${stock}${shelfMark}${stockDelta}</span><span class="lc-station-cell" data-live-held>${held}</span><span>${actions}</span></div>`;
		};
		return `<div class="lc-station-market" data-live-station-market><div class="lc-station-row lc-station-head"><span>GOOD</span><span class="lc-station-cell">BUY</span><span class="lc-station-cell">SELL</span><span class="lc-station-cell">SHELF</span><span class="lc-station-cell">HELD</span><span>ACTION</span></div>${rows.map(row).join("")}</div>`;
	}

	/**
	 * The Shipyard tab (#556): one row per purchasable hull, each carrying the
	 * one reason `hullOffer` gave it — first match wins, permanent before
	 * fixable (D9) — or, open, the net price and how many systems the hull
	 * reaches from here (#185 D3). The figures are the offer's, so a press
	 * gets exactly what the row says.
	 */
	private shipyard(
		yard: { flown: HullId; offers: readonly HullOffer[] },
		credits: number,
	) {
		const cr = (value: number) => Math.round(value).toLocaleString("en-US");
		const row = (offer: HullOffer) => {
			const name = escapeHtml(offer.hull.toUpperCase());
			const net =
				offer.netCr >= 0
					? `${cr(offer.netCr)} Cr`
					: `PAYS ${cr(-offer.netCr)} Cr`;
			let note: string;
			let action: string;
			if (offer.accepted) {
				const soldT = offer.sold.reduce((sum, lot) => sum + lot.units, 0);
				const systems = offer.reach?.ok ? offer.reach.systems : 0;
				note = `REACHES ${systems} SYSTEM${systems === 1 ? "" : "S"}${
					soldT > 0 ? ` · SELLS ${soldT} t` : ""
				}`;
				action = `<button class="lc-station-action" type="button" data-live-station-action="buy-hull" data-live-station-name="${escapeHtml(offer.hull)}">BUY</button>`;
			} else {
				note = hullRefusalNote(offer, credits);
				action =
					offer.reason === "hull-owned"
						? '<span class="lc-station-owned">FLOWN</span>'
						: offer.reason === "hull-locked"
							? '<span class="lc-station-locked">LOCKED</span>'
							: '<span class="lc-station-locked">—</span>';
			}
			return `<div class="lc-station-row" data-live-hull-row="${escapeHtml(offer.hull)}" data-live-hull-reason="${offer.reason ?? ""}"><span>${name}</span><span class="lc-station-cell">${offer.listCr > 0 ? `${cr(offer.listCr)} Cr` : "—"}</span><span class="lc-station-cell" data-live-hull-net>${offer.reason === "hull-owned" ? "—" : net}</span><span class="lc-station-cell${offer.accepted ? "" : " lc-station-locked"}" data-live-hull-note>${escapeHtml(note)}</span>${action}</div>`;
		};
		const tradeIn = yard.offers.find((offer) => offer.hull !== yard.flown);
		const head = tradeIn
			? `<p class="lc-station-hold" data-live-hull-trade-in>TRADE-IN · ${escapeHtml(yard.flown.toUpperCase())} · ${cr(tradeIn.tradeInCr)} Cr</p>`
			: "";
		return `<div class="lc-station-shipyard" data-live-station-shipyard>${head}<div class="lc-station-row lc-station-head"><span>HULL</span><span class="lc-station-cell">LIST</span><span class="lc-station-cell">NET</span><span class="lc-station-cell">FROM HERE</span><span>ACTION</span></div>${yard.offers.map(row).join("")}</div>`;
	}

	private equipment(
		screen: ConsoleEquipmentScreen,
		owned: readonly string[],
		fuel: { ly: number; capacityLy: number },
	) {
		const available = screen.available
			.map((entry) => {
				const name = escapeHtml(entry.name);
				// **The Fuel row's action, which read "FUEL SYSTEM PENDING" until
				// there was a hyperspace to spend it on** (#187). It is priced by
				// the light year rather than by the unit, so the button fills the
				// tank and the middle cell — empty on every other row — prints
				// what is in it.
				// One precedence rule for both cells: a gate blocks only new
				// purchases, so owned wins over locked (#183 D9).
				const row =
					entry.per === "ly"
						? ({ kind: "fill" } as const)
						: owned.includes(entry.name)
							? ({ kind: "owned" } as const)
							: entry.locked
								? ({ kind: "locked", locked: entry.locked } as const)
								: ({ kind: "open" } as const);
				let action: string;
				let held = "";
				switch (row.kind) {
					case "fill":
						action = `<button class="lc-station-action" type="button" data-live-station-action="buy-fuel" data-live-station-name="${name}">FILL</button>`;
						held = `${fuel.ly.toFixed(1)}/${fuel.capacityLy} LY`;
						break;
					case "owned":
						action = '<span class="lc-station-owned">OWNED</span>';
						break;
					case "locked":
						// #183 D6: the #489 locked-row pattern — listed, named and with
						// no BUY, because a vanished row says nothing about what to
						// climb. The rung goes in the middle cell, which a unit item
						// leaves empty: in the action cell it was wider than BUY, and
						// each row is its own grid, so the price column moved.
						action = `<span class="lc-station-locked" data-live-equipment-locked="${row.locked.ladder}:${row.locked.rung}">LOCKED</span>`;
						held = `<span class="lc-station-locked">${row.locked.ladder.toUpperCase()} ${row.locked.rung} · ${escapeHtml(row.locked.name.toUpperCase())}</span>`;
						break;
					default:
						action = `<button class="lc-station-action" type="button" data-live-station-action="buy-equipment" data-live-station-name="${name}">BUY</button>`;
				}
				return `<div class="lc-station-row" data-live-equipment="available"><span>${name}</span><span class="lc-station-cell">${entry.priceCr} Cr</span><span class="lc-station-cell">${held}</span>${action}</div>`;
			})
			.join("");
		const unavailable = screen.unavailable
			.map(
				(entry) =>
					`<div class="lc-station-row" data-live-equipment="unavailable"><span>${escapeHtml(entry.name)}</span><span class="lc-station-cell">—</span><span class="lc-station-cell">${escapeHtml(entry.reason)}</span></div>`,
			)
			.join("");
		return `<div class="lc-station-equipment" data-live-station-equipment><h3 class="lc-station-section">AVAILABLE</h3>${available}<h3 class="lc-station-section">UNAVAILABLE HERE</h3>${unavailable}</div>`;
	}

	/**
	 * The right console's body. `Controls` replaces it wholesale (#370 D6), on
	 * the Galaxy Map's `[data-live-chart-body]` precedent: the rail-and-copy grid
	 * would put the tree in a 48-character column.
	 */
	private rightBody(state: LiveCockpitState) {
		if (state.rightTab === "Controls")
			return controlsBody(this.controls, this.controlsCollapsed);
		// #445, on the Galaxy Map and `Controls` precedent: a page with its own
		// grid replaces the rail-and-copy body wholesale rather than being
		// squeezed into a 48-character column.
		// #564, on the Hold page's precedent: its own grid, one column.
		if (state.rightTab === "Commander")
			return `<div class="lc-panel-body lc-ladders-body">${commanderBody(state.ladders)}</div>`;
		if (state.rightTab === "Hold")
			// `lc-hold-body` collapses the rail-and-copy grid to one column, on
			// `[data-live-chart-body]`'s precedent: the default two-column body
			// put the hold's table in the 135 px rail column, which the first sheet
			// showed as a table squeezed into the left third of the panel.
			return `<div class="lc-panel-body lc-hold-body">${holdBody(state.hold, state.holdBids)}</div>`;
		return `<div class="lc-panel-body"><div class="lc-rail"><b>SHIP</b><span>POWER</span><span>MODULES</span><span>STATUS</span></div><div class="lc-panel-copy"><h3>${state.rightTab.toUpperCase()} / CONTROL</h3><p ${state.rightTab === "Tuning" ? "data-live-tuning" : ""}></p><div class="lc-readout"><span><b>ASSIST</b><em data-live-assist></em></span><span><b>CHARGE</b><em data-live-charge></em></span></div><div class="lc-readout" data-live-duel style="display: none"><span><b>FORE</b><em data-live-duel-fore></em></span><span><b>AFT</b><em data-live-duel-aft></em></span><span><b>HULL</b><em data-live-duel-hull></em></span><span><b>ENERGY BANK</b><em data-live-duel-bank></em></span><span><b>HEAT</b><em data-live-duel-heat></em></span></div><div class="lc-readout" data-live-scan style="display: none"><span><b>NAME</b><em data-live-scan-name></em></span><span><b>REGISTRY</b><em data-live-scan-registry></em></span><span><b>STANDING</b><em data-live-scan-standing></em></span><span><b>HELD</b><em data-live-scan-manifest></em></span><span><b>READ</b><em data-live-scan-age></em></span></div></div></div>`;
	}

	private leftBody(state: LiveCockpitState) {
		if (state.leftTab === "First day") return firstDayBody(state.firstDay);
		if (state.leftTab === "Requests") return requestsBody(state.requests, true);
		// The chart is the *reading* surface and the list is the *finding* one
		// (`galaxy-map.md` §5.1), so the map tab gives the chart the full body
		// rather than squeezing it beside a rail it does not need.
		if (state.leftTab === "Galaxy Map")
			return `<div class="lc-panel-body" data-live-chart-body><div class="lc-chart-host" data-live-chart-host></div></div>`;
		if (state.leftTab === "Communications")
			// **The rail's third label is the canonical Standing** (`CONTEXT.md`
			// §Language). It carried the Avoid alias until #457: #366 deferred the
			// rename to "console copy's own node" rather than make a UI change
			// from a legal-change PR, and #447's ruling is that node — the
			// principal chose to pay the alias debt in the same template line the
			// charge's voice is owed on. The old spelling is quoted in
			// `civilian-combat.md` H1's audit and deliberately nowhere here.
			//
			// **The `data-live-legal-status` selector is deliberately unchanged.**
			// It is the probe-facing name of the readout field and not a word the
			// pilot reads; renaming it is a breaking change to every probe that
			// reads the readout, for no gain in what the console says. The same
			// scope split `CONTEXT.md` §Language draws for **Commander**, where
			// the storage layer's words stay as they are.
			return `<div class="lc-panel-body"><div class="lc-rail"><b>SIGNALS</b><span>CLEARANCE</span><span>HAILS<em data-live-hails></em></span><span>STANDING</span></div><div class="lc-panel-copy"><h3>SELECTED TARGET</h3><p data-live-left-copy></p><h3>LOG</h3><ul class="lc-nav-list" data-live-raider-log></ul>${LEFT_READOUT}</div></div>`;
		const chips = NAV_FILTER_KINDS.map(
			(kind) =>
				`<button class="lc-chip" type="button" data-live-nav-kind="${kind}" aria-pressed="${state.navFilter.kinds.includes(kind)}">${kind.toUpperCase()}</button>`,
		).join("");
		return `<div class="lc-panel-body"><div class="lc-rail"><b>SYSTEM</b><span>${escapeHtml(state.systemName.toUpperCase())}</span><button type="button" data-live-left-tab="Galaxy Map">GALAXY MAP</button><span>SYSTEM MAP</span></div><div class="lc-panel-copy"><h3>SELECTED TARGET</h3><p data-live-left-copy></p><div class="lc-nav-filters">${chips}<input class="lc-nav-query" type="search" data-live-nav-query placeholder="FILTER" aria-label="filter navigation targets" value="${escapeHtml(state.navFilter.query)}"></div><ul class="lc-nav-list" data-live-nav-list></ul>${LEFT_READOUT}</div></div>`;
	}
}

/**
 * The First day tab (#408 D3, D5): the day's steps, the one the pilot is on,
 * and what to do now. Every commander has it; it pushes nothing.
 */
function firstDayBody(panel: FirstDayPanel | undefined): string {
	if (!panel) return `<div class="lc-panel-body"></div>`;
	const at = FIRST_DAY_STEPS.findIndex((step) => step.id === panel.current);
	const rows = FIRST_DAY_STEPS.map((step, i) => {
		const state = i < at ? "done" : i === at ? "current" : "ahead";
		return `<li class="lc-first-day-step" data-first-day-step="${step.id}" data-first-day-state="${state}">${escapeHtml(step.title)}</li>`;
	}).join("");
	return `<div class="lc-panel-body" data-live-first-day><div class="lc-rail"><b>FIRST DAY</b><span>A SHORT JOB</span><span>ON YOUR OWN TIME</span></div><div class="lc-panel-copy"><h3>NOW</h3><p data-live-first-day-now>${escapeHtml(panel.text)}</p><h3>THE DAY</h3><ol class="lc-first-day-steps">${rows}</ol><h3>FLYING</h3><p data-live-first-day-controls>${escapeHtml(panel.controls.keyboard)}<br>CONTROLLER · ${escapeHtml(panel.controls.controller)}</p></div></div>`;
}

/**
 * A refused hull row's one reason, in the row's words (#556 D9). The till's
 * sentence for the same refusal is `refusalSentence`'s; this is the short
 * form a row has room for, and it names the figure a pilot can act on.
 */
function hullRefusalNote(offer: HullOffer, credits: number): string {
	switch (offer.reason) {
		case "hull-owned":
			return "THE HULL YOU FLY";
		case "hull-locked":
			return offer.locked
				? `${offer.locked.ladder.toUpperCase()} ${offer.locked.rung} · ${offer.locked.name.toUpperCase()}`
				: "LOCKED";
		case "no-reach":
			return "NO SYSTEM IN RANGE FROM HERE";
		case "hull-mounts":
			return "TOO FEW HARDPOINTS FOR YOUR WEAPONS";
		case "hull-hold":
			return "HOLD TOO SMALL FOR WHAT MUST STAY ABOARD";
		case "insufficient-credits":
			return `${Math.ceil(offer.netCr - credits - offer.saleCr).toLocaleString("en-US")} Cr SHORT`;
		default:
			return "NOT SOLD HERE";
	}
}
