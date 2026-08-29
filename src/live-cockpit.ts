/** The crisp DOM instruments that sit over Game's one WebGL renderer. */

import { range } from "./units";
import {
	type HeadLook,
	NAV_FILTER_KINDS,
	type NavFilter,
	type NavRow,
	type ScannerContact,
	cockpitView,
} from "./cockpit";

export type RightTab = "Flight" | "Drive" | "Tuning";
const RIGHT_TABS: readonly RightTab[] = ["Flight", "Drive", "Tuning"];

/**
 * The left console's tabs.
 *
 * `Galaxy Map` sits here rather than being its own surface because
 * `galaxy-map.md` §1 ratified it as "a tab on the left Navigation console. Not
 * a full-screen mode, not a fifth panel, not an application" — #70's rule that
 * a screen answers *which wall or which tab*, never *which application*.
 */
export type LeftTab = "Navigation" | "Galaxy Map" | "Communications";
const LEFT_TABS: readonly LeftTab[] = [
	"Navigation",
	"Galaxy Map",
	"Communications",
];

export interface LiveCockpitState {
	visible: boolean;
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
	tuning: string;
}

export interface LiveCockpitCallbacks {
	onRightTab: (tab: RightTab) => void;
	onLeftTab: (tab: LeftTab) => void;
	onNavFilter: (filter: NavFilter) => void;
	onSelectTarget: (id: string) => void;
	/**
	 * The Galaxy Map tab's chart host has appeared or gone away.
	 *
	 * A callback rather than this module importing the chart: `galaxy-map.ts`
	 * pulls in Three.js and `live-cockpit.ts` is the DOM tier. The owner mounts
	 * into the element handed up here and disposes when it is handed `null`.
	 */
	onChartHost: (host: HTMLElement | null) => void;
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
	director: HTMLElement | null;
	leftPanelCopy: HTMLElement | null;
	rightPanelCopy: HTMLElement | null;
	contactCount: HTMLElement | null;
	assistReadout: HTMLElement | null;
	chargeReadout: HTMLElement | null;
	navList: HTMLElement | null;
	navQuery: HTMLInputElement | null;
	arrow: HTMLElement | null;
}

const STYLE_ID = "seelite-live-cockpit-style";

function escapeHtml(value: string) {
	return value.replace(
		/[&<>"']/g,
		(character) =>
			({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
				character
			] as string,
	);
}

/** Seconds as the panel prints them. `null` reads `—`, never `0s`. */
function navEta(seconds: number | null) {
	if (seconds === null) return "—";
	if (seconds < 90) return `${seconds.toFixed(0)}s`;
	if (seconds < 5_400) return `${(seconds / 60).toFixed(1)}m`;
	if (seconds < 172_800) return `${(seconds / 3_600).toFixed(1)}h`;
	return `${(seconds / 86_400).toFixed(0)}d`;
}

const STYLE = `
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
.lc-panel header small, .lc-panel footer { color: #cb8c51; }
.lc-tabs { display: flex; gap: 7px; margin: 12px 0; border-bottom: 1px solid rgba(229, 170, 82, .55); }
.lc-tab { border: 0; border-bottom: 2px solid transparent; background: transparent; color: #d49352; cursor: pointer; font: inherit; font-size: 11px; letter-spacing: .05em; padding: 7px 10px; }
.lc-tab[aria-selected="true"] { border-color: #ffe0a2; color: #fff0c9; background: rgba(223, 122, 20, .18); }
.lc-panel-body { display: grid; grid-template-columns: minmax(135px, .42fr) 1fr; gap: 18px; min-height: 240px; }
/* The chart tab takes the panel's whole height. Left as a block panel the
   chart sat at its 300px minimum with half the console empty below it — every
   check green and a third of the surface wasted. */
#live-cockpit[data-live-head-look="left"][data-live-left-view="Galaxy Map"] .lc-panel[data-live-panel="left"] { display: flex; flex-direction: column; }
.lc-panel-body[data-live-chart-body] { grid-template-columns: 1fr; flex: 1 1 auto; min-height: 0; }
.lc-rail { display: grid; align-content: start; gap: 8px; padding: 14px 12px; border-right: 1px solid rgba(229, 170, 82, .42); color: #e9a766; font-size: 11px; }
.lc-rail b { color: #ffe1a9; letter-spacing: .08em; }
.lc-rail button { border: 0; padding: 0; background: transparent; color: inherit; cursor: pointer; font: inherit; text-align: left; letter-spacing: .05em; }
.lc-rail button:hover { color: #fff0c9; }
.lc-panel-copy { display: grid; align-content: start; gap: 12px; padding: 14px 2px; }
.lc-panel-copy h3, .lc-panel-copy p { margin: 0; }
.lc-panel-copy h3 { color: #ffe1a9; font-size: 15px; letter-spacing: .08em; }
.lc-panel-copy p { max-width: 48ch; color: #ffdcb0; line-height: 1.6; }
.lc-readout { display: grid; gap: 6px; color: #f5bd78; font-size: 11px; }
.lc-readout span { display: flex; justify-content: space-between; gap: 12px; padding-bottom: 4px; border-bottom: 1px solid rgba(229, 170, 82, .34); }
.lc-nav-filters { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.lc-chip { border: 1px solid rgba(229, 170, 82, .5); border-radius: 3px; padding: 4px 9px; background: transparent; color: #d49352; cursor: pointer; font: inherit; font-size: 10px; letter-spacing: .08em; }
.lc-chip[aria-pressed="true"] { border-color: #ffe0a2; background: rgba(223, 122, 20, .26); color: #fff0c9; }
.lc-nav-query { flex: 1 1 96px; min-width: 84px; border: 1px solid rgba(229, 170, 82, .5); border-radius: 3px; padding: 4px 7px; background: rgba(8, 5, 3, .6); color: #ffe1a9; font: inherit; font-size: 11px; }
.lc-nav-list { display: grid; gap: 2px; margin: 0; padding: 0; list-style: none; max-height: 234px; overflow: auto; }
.lc-nav-row { display: grid; grid-template-columns: 1fr auto auto; gap: 10px; width: 100%; border: 0; border-bottom: 1px solid rgba(229, 170, 82, .22); padding: 5px 6px; background: transparent; color: #ffdcb0; cursor: pointer; font: inherit; font-size: 11px; text-align: left; }
.lc-nav-row:hover { background: rgba(223, 122, 20, .14); }
.lc-nav-row[aria-current="true"] { background: rgba(223, 122, 20, .3); color: #fff0c9; }
.lc-nav-row i { color: #cb8c51; font-style: normal; }
.lc-nav-row em { color: #f5bd78; font-style: normal; }
.lc-nav-empty { padding: 10px 6px; color: #cb8c51; font-size: 11px; }
.lc-chart-host[data-live-chart-error]::after { content: "CHART UNAVAILABLE — reload"; position: absolute; inset: 0; display: grid; place-content: center; color: #ffb0a2; letter-spacing: .08em; }
.lc-chart-host { position: relative; min-height: 300px; height: 100%; border: 1px solid rgba(229, 170, 82, .34); border-radius: 4px; overflow: hidden; background: #05080d; }
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
	private elements: CockpitElements | null = null;
	/** The element handed to `onChartHost`, so it is handed back exactly once. */
	private chartHost: HTMLElement | null = null;

	constructor(private readonly callbacks: LiveCockpitCallbacks) {
		installStyle();
		this.root = document.createElement("section");
		this.root.id = "live-cockpit";
		this.root.setAttribute("data-live-cockpit", "true");
		// Delegation keeps clicks live after a structural render is replaced.
		this.root.addEventListener("click", (event) =>
			this.handleClick(event.target as HTMLElement),
		);
		this.root.addEventListener("input", (event) => {
			const field = event.target as HTMLElement;
			if (field.matches("[data-live-nav-query]"))
				this.callbacks.onNavFilter({
					...this.filter,
					query: (field as HTMLInputElement).value,
				});
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
		const right = element.closest<HTMLElement>("[data-live-right-tab]");
		if (right) {
			const value = right.dataset.liveRightTab;
			if (value === "Flight" || value === "Drive" || value === "Tuning")
				this.callbacks.onRightTab(value);
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

	/** The filter last rendered — the base every chip toggle is applied to. */
	private filter: NavFilter = { kinds: [], query: "" };

	private toggleKind(kind: string) {
		const kinds = this.filter.kinds.includes(kind)
			? this.filter.kinds.filter((k) => k !== kind)
			: [...this.filter.kinds, kind];
		this.callbacks.onNavFilter({ ...this.filter, kinds });
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
		const key = `${state.visible}|${state.headLook}|${state.leftTab}|${state.rightTab}`;
		this.setVisible(state.visible);
		this.root.dataset.liveHeadLook = state.headLook;
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
			this.releaseChartHost();
			this.root.innerHTML = this.markup(state);
			const find = (selector: string) =>
				this.root.querySelector<HTMLElement>(selector);
			this.elements = {
				director: find("[data-live-director] > strong"),
				leftPanelCopy: find("[data-live-left-copy]"),
				rightPanelCopy: find('[data-live-panel="right"] .lc-panel-copy > p'),
				contactCount: find("[data-live-contact-count]"),
				assistReadout: find("[data-live-assist]"),
				chargeReadout: find("[data-live-charge]"),
				navList: find("[data-live-nav-list]"),
				navQuery: this.root.querySelector<HTMLInputElement>(
					"[data-live-nav-query]",
				),
				arrow: find(".lc-target-arrow"),
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
		if (elements.director)
			elements.director.textContent = state.targetId ?? "NO TARGET SELECTED";
		if (elements.navQuery && elements.navQuery.value !== state.navFilter.query)
			elements.navQuery.value = state.navFilter.query;
		this.renderNav(state, elements);
		const valueKey = `${state.speed}|${state.mode}|${state.throttle}|${state.assist}|${state.charge}|${state.target}|${state.rightTab}|${state.tuning}|${state.contacts.length}`;
		if (valueKey === this.lastValueKey) return;
		this.lastValueKey = valueKey;
		if (elements.leftPanelCopy)
			elements.leftPanelCopy.textContent = state.target;
		if (elements.rightPanelCopy)
			elements.rightPanelCopy.textContent =
				state.rightTab === "Tuning"
					? state.tuning
					: `${state.mode} · ${state.speed} · throttle ${state.throttle}`;
		if (elements.contactCount)
			elements.contactCount.textContent = String(state.contacts.length);
		// **These two rendered as labels with nothing beside them.** §5 gives the
		// Flight console assist and the Drive console the cruise charge, and the
		// markup has carried both rows since the console was built — with an
		// empty `<em>`, which reads as an instrument that is broken rather than
		// one that was never wired.
		if (elements.assistReadout)
			elements.assistReadout.textContent = state.assist;
		if (elements.chargeReadout)
			elements.chargeReadout.textContent = state.charge;
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
		navList.innerHTML =
			cells.length === 0
				? '<li class="lc-nav-empty">NO TARGETS MATCH</li>'
				: cells
						.map(
							({ row, range, eta }) =>
								`<li><button class="lc-nav-row" type="button" data-live-nav-target="${escapeHtml(row.id)}" aria-current="${row.selected}"><span>${escapeHtml(row.id.toUpperCase())}</span><i>${escapeHtml(row.kind.toUpperCase())}</i><em>${range} · ${eta}</em></button></li>`,
						)
						.join("");
	}

	/** Tell the owner its chart host is going away, before the DOM drops it. */
	private releaseChartHost() {
		if (!this.chartHost) return;
		this.chartHost = null;
		this.callbacks.onChartHost(null);
	}

	private markup(state: LiveCockpitState) {
		const view = cockpitView(state.headLook);
		const targetId = escapeHtml(state.targetId ?? "NO TARGET SELECTED");
		const leftTabs = LEFT_TABS.map(
			(tab) =>
				`<button class="lc-tab" type="button" data-live-left-tab="${tab}" aria-selected="${state.leftTab === tab}">${tab}</button>`,
		).join("");
		const rightTabs = RIGHT_TABS.map(
			(tab) =>
				`<button class="lc-tab" type="button" data-live-right-tab="${tab}" aria-selected="${state.rightTab === tab}">${tab}</button>`,
		).join("");
		return `<main class="lc-director" data-live-director><i class="lc-target-arrow" data-live-target-arrow aria-label="turn toward selected target">➤</i><strong>${targetId}</strong></main><aside class="lc-panel" data-live-panel="left" data-active="${view.activePanel === "left"}"><header><h2>${state.leftTab.toUpperCase()}</h2><small>LOCAL · 24</small></header><nav class="lc-tabs" aria-label="left console tabs">${leftTabs}</nav>${this.leftBody(state)}<footer>Simulation continues while this console is open.</footer></aside><aside class="lc-panel" data-live-panel="right" data-active="${view.activePanel === "right"}"><header><h2>${state.rightTab.toUpperCase()}</h2><small>CMDR · SEELITE</small></header><nav class="lc-tabs" aria-label="right console tabs">${rightTabs}</nav><div class="lc-panel-body"><div class="lc-rail"><b>SHIP</b><span>POWER</span><span>MODULES</span><span>INVENTORY</span><span>STATUS</span></div><div class="lc-panel-copy"><h3>${state.rightTab.toUpperCase()} / CONTROL</h3><p ${state.rightTab === "Tuning" ? "data-live-tuning" : ""}></p><div class="lc-readout"><span><b>ASSIST</b><em data-live-assist></em></span><span><b>CHARGE</b><em data-live-charge></em></span></div></div></div><footer>Tuning remains on this right-console tab, never on the flight floor.</footer></aside>`;
	}

	private leftBody(state: LiveCockpitState) {
		// The chart is the *reading* surface and the list is the *finding* one
		// (`galaxy-map.md` §5.1), so the map tab gives the chart the full body
		// rather than squeezing it beside a rail it does not need.
		if (state.leftTab === "Galaxy Map")
			return `<div class="lc-panel-body" data-live-chart-body><div class="lc-chart-host" data-live-chart-host></div></div>`;
		if (state.leftTab === "Communications")
			return `<div class="lc-panel-body"><div class="lc-rail"><b>SIGNALS</b><span>CLEARANCE</span><span>HAILS</span><span>LEGAL STATUS</span></div><div class="lc-panel-copy"><h3>SELECTED TARGET</h3><p data-live-left-copy></p><div class="lc-readout"><span><b>SCANNER RANGE</b><em>10,000 km</em></span><span><b>CONTACTS</b><em data-live-contact-count></em></span></div></div></div>`;
		const chips = NAV_FILTER_KINDS.map(
			(kind) =>
				`<button class="lc-chip" type="button" data-live-nav-kind="${kind}" aria-pressed="${state.navFilter.kinds.includes(kind)}">${kind.toUpperCase()}</button>`,
		).join("");
		return `<div class="lc-panel-body"><div class="lc-rail"><b>SYSTEM</b><span>${escapeHtml(state.systemName.toUpperCase())}</span><button type="button" data-live-left-tab="Galaxy Map">GALAXY MAP</button><span>SYSTEM MAP</span></div><div class="lc-panel-copy"><h3>SELECTED TARGET</h3><p data-live-left-copy></p><div class="lc-nav-filters">${chips}<input class="lc-nav-query" type="search" data-live-nav-query placeholder="FILTER" aria-label="filter navigation targets" value="${escapeHtml(state.navFilter.query)}"></div><ul class="lc-nav-list" data-live-nav-list></ul><div class="lc-readout"><span><b>SCANNER RANGE</b><em>10,000 km</em></span><span><b>CONTACTS</b><em data-live-contact-count></em></span></div></div></div>`;
	}
}
