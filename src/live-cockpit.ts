/** The crisp DOM instruments that sit over Game's one WebGL renderer. */

import {
	type HeadLook,
	type ScannerContact,
	cockpitView,
	screenArrowBearingDeg,
} from "./cockpit";

export type RightTab = "Flight" | "Drive" | "Tuning";

export interface LiveCockpitState {
	visible: boolean;
	headLook: HeadLook;
	rightTab: RightTab;
	contacts: readonly ScannerContact[];
	targetId: string | null;
	target: string;
	targetBearingDeg: number | null;
	mode: string;
	velocityContext: string;
	throttle: string;
	assist: string;
	charge: string;
	speed: string;
	eta: string;
	tuning: string;
}

interface CockpitElements {
	speed: HTMLElement;
	mode: HTMLElement;
	assist: HTMLElement;
	throttle: HTMLElement;
	target: HTMLElement;
	eta: HTMLElement;
	charge: HTMLElement;
	leftPanelCopy: HTMLElement;
	rightPanelCopy: HTMLElement;
	contactCount: HTMLElement;
	fill: HTMLElement;
	arrow: HTMLElement;
}

const STYLE_ID = "seelite-live-cockpit-style";

const STYLE = `
#live-cockpit { position: fixed; inset: 0; z-index: 4; pointer-events: none; color: #c8e7f7; font: 12px/1.35 ui-monospace, "SF Mono", Menlo, monospace; text-shadow: 0 0 8px rgba(0, 0, 0, .92); }
#live-cockpit[data-live-active="false"] { display: none; }
#live-cockpit * { box-sizing: border-box; }
.lc-director { position: absolute; top: 38%; left: 50%; width: 172px; transform: translate(-50%, -50%); color: #ffe0a2; text-align: center; }
#live-cockpit[data-live-target-director="false"] .lc-director { display: none; }
.lc-director::before { content: ""; display: block; width: 66px; height: 66px; margin: 0 auto 8px; border: 2px solid currentColor; border-radius: 50%; box-shadow: 0 0 18px currentColor; }
.lc-target-arrow { position: absolute; left: 50%; top: 21px; color: #ffe0a2; font-size: 24px; line-height: 1; transform: rotate(var(--target-bearing)) translateX(48px); transform-origin: 0 50%; }
.lc-forward { display: none; }
.lc-surface { position: relative; min-height: 76px; padding: 11px 14px; overflow: hidden; clip-path: polygon(7% 0, 93% 0, 100% 17%, 93% 100%, 7% 100%, 0 17%); border: 1px solid rgba(119, 191, 224, .34); background: linear-gradient(145deg, rgba(20, 45, 56, .9), rgba(3, 11, 17, .96) 55%, rgba(8, 24, 31, .92)); box-shadow: inset 0 0 0 1px rgba(0, 0, 0, .55), inset 0 12px 20px rgba(113, 193, 230, .05), 0 10px 22px rgba(0, 0, 0, .36); }
.lc-surface::before { content: ""; position: absolute; inset: 6px; border-top: 1px solid rgba(156, 219, 242, .17); border-bottom: 1px solid rgba(0, 0, 0, .64); pointer-events: none; }
.lc-surface-label { display: block; color: #72aec6; font-size: 9px; letter-spacing: .18em; }
.lc-speed-value { display: block; margin-top: 5px; color: #e2f4ff; font-size: clamp(19px, 1.85vw, 28px); font-weight: 600; letter-spacing: -.07em; line-height: .95; }
.lc-flight-meta { display: flex; justify-content: space-between; gap: 8px; margin-top: 7px; color: #9cc7d9; font-size: 9px; }
.lc-flight-meta span:first-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lc-flight-meta strong { color: #ffd888; font-weight: 600; }
.lc-throttle { display: grid; grid-template-columns: 1fr 10px; align-items: stretch; min-height: 88px; padding: 8px 7px; clip-path: polygon(18% 0, 82% 0, 100% 9%, 92% 100%, 8% 100%, 0 9%); }
.lc-throttle .lc-surface-label { writing-mode: vertical-rl; transform: rotate(180deg); align-self: center; letter-spacing: .14em; }
.lc-throttle-track { position: relative; overflow: hidden; border: 1px solid rgba(139, 205, 226, .46); background: rgba(0, 5, 9, .68); box-shadow: inset 0 0 10px rgba(0, 0, 0, .85); }
.lc-throttle-fill { position: absolute; right: 2px; bottom: 2px; left: 2px; height: var(--throttle); background: linear-gradient(0deg, #e49a37, #ffe29a); box-shadow: 0 0 10px rgba(255, 190, 76, .7); }
.lc-throttle-value { position: absolute; bottom: 7px; left: -23px; color: #ffe0a2; font-size: 9px; transform: rotate(-90deg); transform-origin: left bottom; }
.lc-scanner-space { min-width: 0; min-height: 1px; }
.lc-target { min-height: 76px; }
.lc-target-value { display: block; max-width: 22ch; margin-top: 5px; overflow: hidden; color: #ffe0a2; font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
.lc-target-meta { display: flex; justify-content: space-between; gap: 8px; margin-top: 7px; color: #9cc7d9; font-size: 9px; }
.lc-target-meta strong { color: #e2f4ff; font-weight: 600; }
.lc-panel { display: none; position: absolute; inset: 7% 8% 12%; overflow: auto; padding: 20px 30px; border: 1px solid rgba(229, 170, 82, .9); border-radius: 8px; background: linear-gradient(104deg, rgba(46, 18, 5, .96), rgba(12, 8, 6, .93)); box-shadow: inset 0 0 68px rgba(231, 123, 31, .17), 0 0 28px rgba(227, 133, 39, .15); color: #ffd48c; pointer-events: auto; }
#live-cockpit[data-live-head-look="left"] .lc-panel[data-live-panel="left"], #live-cockpit[data-live-head-look="right"] .lc-panel[data-live-panel="right"] { display: block; }
#live-cockpit[data-live-head-look="left"] .lc-director, #live-cockpit[data-live-head-look="right"] .lc-director { opacity: .12; }
#live-cockpit[data-live-head-look="left"] .lc-forward, #live-cockpit[data-live-head-look="right"] .lc-forward { display: none; }
.lc-panel header { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; padding-bottom: 11px; border-bottom: 2px solid #e5aa52; }
.lc-panel h2 { margin: 0; color: #ffe1a9; font-size: 18px; letter-spacing: .1em; }
.lc-panel header small, .lc-panel footer { color: #cb8c51; }
.lc-tabs { display: flex; gap: 7px; margin: 12px 0; border-bottom: 1px solid rgba(229, 170, 82, .55); }
.lc-tab { border: 0; border-bottom: 2px solid transparent; background: transparent; color: #d49352; cursor: pointer; font: inherit; font-size: 11px; letter-spacing: .05em; padding: 7px 10px; }
.lc-tab[aria-selected="true"] { border-color: #ffe0a2; color: #fff0c9; background: rgba(223, 122, 20, .18); }
.lc-panel-body { display: grid; grid-template-columns: minmax(135px, .42fr) 1fr; gap: 18px; min-height: 240px; }
.lc-rail { display: grid; align-content: start; gap: 8px; padding: 14px 12px; border-right: 1px solid rgba(229, 170, 82, .42); color: #e9a766; font-size: 11px; }
.lc-panel-copy { display: grid; align-content: start; gap: 12px; padding: 14px 2px; }
.lc-panel-copy h3, .lc-panel-copy p { margin: 0; }
.lc-panel-copy h3 { color: #ffe1a9; font-size: 15px; letter-spacing: .08em; }
.lc-panel-copy p { max-width: 48ch; color: #ffdcb0; line-height: 1.6; }
.lc-readout { display: grid; gap: 6px; color: #f5bd78; font-size: 11px; }
.lc-readout span { display: flex; justify-content: space-between; gap: 12px; padding-bottom: 4px; border-bottom: 1px solid rgba(229, 170, 82, .34); }
@media (max-width: 600px) { .lc-panel { inset: 8px; padding: 13px; clip-path: none; } .lc-panel h2 { font-size: 14px; } .lc-panel-body { grid-template-columns: .45fr 1fr; gap: 8px; min-height: 0; } .lc-rail, .lc-panel-copy { padding-top: 7px; } .lc-panel-copy p { font-size: 11px; line-height: 1.4; } .lc-readout { display: none; } .lc-forward { right: 10px; bottom: 42px; left: 10px; grid-template-columns: minmax(96px, 1fr) 30px minmax(70px, .8fr) minmax(108px, 1fr); gap: 5px; min-height: 76px; } .lc-surface { min-height: 68px; padding: 9px 10px; } .lc-speed-value { font-size: 18px; } .lc-flight-meta, .lc-target-meta { margin-top: 5px; font-size: 7px; } .lc-throttle { min-height: 72px; padding: 6px; } .lc-target-value { margin-top: 4px; font-size: 9px; } }
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
	private elements: CockpitElements | null = null;

	constructor(private readonly onRightTab: (tab: RightTab) => void) {
		installStyle();
		this.root = document.createElement("section");
		this.root.id = "live-cockpit";
		this.root.setAttribute("data-live-cockpit", "true");
		// Delegation keeps tab clicks live after a structural render is replaced.
		this.root.addEventListener("click", (event) => {
			const tab = (event.target as HTMLElement).closest<HTMLElement>(
				"[data-live-right-tab]",
			);
			if (!tab) return;
			const value = tab.dataset.liveRightTab;
			if (value === "Flight" || value === "Drive" || value === "Tuning")
				this.onRightTab(value);
		});
		document.body.append(this.root);
	}

	setVisible(visible: boolean) {
		const next = String(visible);
		if (this.root.dataset.liveActive !== next)
			this.root.dataset.liveActive = next;
	}

	update(state: LiveCockpitState) {
		const view = cockpitView(state.headLook);
		const targetId = state.targetId ?? "NO TARGET SELECTED";
		const key = `${state.visible}|${state.headLook}|${state.rightTab}|${targetId}`;
		this.setVisible(state.visible);
		this.root.dataset.liveHeadLook = state.headLook;
		this.root.dataset.liveTargetDirector = String(view.targetDirectorVisible);
		if (key !== this.lastKey) {
			this.lastKey = key;
			this.root.innerHTML = `<main class="lc-director" data-live-director><i class="lc-target-arrow" data-live-target-arrow aria-label="turn toward selected target">➤</i><strong>${targetId}</strong></main><footer class="lc-forward" data-live-floor><section class="lc-surface lc-flight-surface" data-live-flight-surface><span class="lc-surface-label">VELOCITY</span><strong class="lc-speed-value"></strong><span class="lc-flight-meta"><span></span><strong></strong></span></section><section class="lc-surface lc-throttle" data-live-throttle-surface><span class="lc-surface-label">THROTTLE</span><span class="lc-throttle-track"><i class="lc-throttle-fill"></i><b class="lc-throttle-value"></b></span></section><div class="lc-scanner-space" aria-hidden="true"></div><section class="lc-surface lc-target" data-live-target-surface><span class="lc-surface-label">TARGET SOLUTION</span><strong class="lc-target-value"></strong><span class="lc-target-meta"><span>ETA</span><strong></strong><span></span></span></section></footer><aside class="lc-panel" data-live-panel="left" data-active="${view.activePanel === "left"}"><header><h2>NAVIGATION</h2><small>LOCAL · 24</small></header><div class="lc-tabs"><span class="lc-tab" aria-current="page">Navigation</span><span class="lc-tab">Communications</span></div><div class="lc-panel-body"><div class="lc-rail"><b>SYSTEM</b><span>SEELITE</span><span>SET FILTERS</span><span>GALAXY MAP</span><span>SYSTEM MAP</span></div><div class="lc-panel-copy"><h3>SELECTED TARGET</h3><p></p><div class="lc-readout"><span><b>SCANNER RANGE</b><em>10,000 km</em></span><span><b>CONTACTS</b><em data-live-contact-count></em></span></div></div></div><footer>Simulation continues while this console is open.</footer></aside><aside class="lc-panel" data-live-panel="right" data-active="${view.activePanel === "right"}"><header><h2>${state.rightTab.toUpperCase()}</h2><small>CMDR · SEELITE</small></header><nav class="lc-tabs" aria-label="right console tabs">${(["Flight", "Drive", "Tuning"] as RightTab[]).map((tab) => `<button class="lc-tab" type="button" data-live-right-tab="${tab}" aria-selected="${state.rightTab === tab}">${tab}</button>`).join("")}</nav><div class="lc-panel-body"><div class="lc-rail"><b>SHIP</b><span>POWER</span><span>MODULES</span><span>INVENTORY</span><span>STATUS</span></div><div class="lc-panel-copy"><h3>${state.rightTab.toUpperCase()} / CONTROL</h3><p ${state.rightTab === "Tuning" ? "data-live-tuning" : ""}></p><div class="lc-readout"><span><b>ASSIST</b><em></em></span><span><b>CHARGE</b><em></em></span></div></div></div><footer>Tuning remains on this right-console tab, never on the flight floor.</footer></aside>`;
			const find = (selector: string) =>
				this.root.querySelector<HTMLElement>(selector) as HTMLElement;
			this.elements = {
				speed: find(".lc-speed-value"),
				mode: find(".lc-flight-meta span"),
				assist: find(".lc-flight-meta strong"),
				throttle: find(".lc-throttle-value"),
				target: find(".lc-target-value"),
				eta: find(".lc-target-meta strong"),
				charge: find(".lc-target-meta span:last-child"),
				leftPanelCopy: find('[data-live-panel="left"] .lc-panel-copy > p'),
				rightPanelCopy: find('[data-live-panel="right"] .lc-panel-copy > p'),
				contactCount: find("[data-live-contact-count]"),
				fill: find(".lc-throttle-fill"),
				arrow: find(".lc-target-arrow"),
			};
		}
		const elements = this.elements;
		if (!elements) return;
		elements.speed.textContent = state.speed;
		elements.mode.textContent = state.mode;
		elements.assist.textContent = `ASSIST ${state.assist}`;
		elements.throttle.textContent = state.throttle;
		elements.target.textContent = state.target;
		elements.eta.textContent = state.eta;
		elements.charge.textContent = `CHARGE ${state.charge}`;
		elements.leftPanelCopy.textContent = state.target;
		elements.rightPanelCopy.textContent =
			state.rightTab === "Tuning"
				? state.tuning
				: `${state.mode} · ${state.speed} · throttle ${state.throttle}`;
		elements.contactCount.textContent = String(state.contacts.length);
		elements.fill.style.setProperty("--throttle", state.throttle);
		elements.arrow.style.setProperty(
			"--target-bearing",
			`${screenArrowBearingDeg(state.targetBearingDeg ?? 0)}deg`,
		);
	}
}
