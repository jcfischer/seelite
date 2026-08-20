/**
 * A query-gated visual prototype for the cockpit language decided on issue #34.
 * It does not talk to `Game`: docking, communications, panels, and scanner
 * contacts are still design consumers, not completed simulation systems.
 */

/** A probe-guard fingerprint for this browser-only prototype. */
export const GALLERY_VERSION = 1;

export type GalleryStateId =
	| "assist-on"
	| "assist-off"
	| "cruise"
	| "target-acquisition"
	| "docking-granted"
	| "docking-denied";

type GalleryState = {
	id: GalleryStateId;
	label: string;
	mode: string;
	target: string;
	director: string;
	targetBearingDeg?: number;
	notice: string;
	panel: "Navigation" | "Flight" | "Communications" | "Drive";
	panelDetail: string;
	accent: "cyan" | "amber" | "green" | "red";
};

type RightTab = "Flight" | "Drive" | "Tuning";

/** The six states Jens-Christian asked the gallery to make inspectable. */
export const GALLERY_STATES: readonly GalleryState[] = [
	{
		id: "assist-on",
		label: "Assist on",
		mode: "NORMAL · ASSIST ON · THROTTLE 62%",
		target: "No target selected",
		director: "ATTITUDE · PROGRADE",
		notice: "Flight floor stays quiet until something needs attention.",
		panel: "Flight",
		panelDetail: "2.0 km/s cap · prograde centred · damped drift",
		accent: "cyan",
	},
	{
		id: "assist-off",
		label: "Assist off",
		mode: "NORMAL · ASSIST OFF · THROTTLE 0%",
		target: "Drifting clear",
		director: "PROGRADE 34° RIGHT",
		notice: "The green velocity marker separates from the cyan nose reference.",
		panel: "Flight",
		panelDetail: "18.4 km/s · lateral drift persists · rotate to recover",
		accent: "amber",
	},
	{
		id: "cruise",
		label: "Cruise",
		mode: "CRUISE · 20.00 c · CHARGE 8.4/12.0 AU",
		target: "VETIN · 0.837 AU · ETA 68s",
		director: "TARGET AHEAD · CLOSING 2,450 km/s",
		notice: "Cruise speed changes the ship, never the game clock.",
		panel: "Drive",
		panelDetail:
			"8.4 AU remaining · regenerates 1 AU/min · no time compression",
		accent: "cyan",
	},
	{
		id: "target-acquisition",
		label: "Target acquisition",
		mode: "NORMAL · ASSIST ON · THROTTLE 40%",
		target: "TRADE STATION · 6,240 km",
		director: "TURN TOWARD TARGET",
		targetBearingDeg: -112,
		notice:
			"The arrow on the target circle makes the next turn actionable, without angle reading.",
		panel: "Navigation",
		panelDetail: "Stations · planets · contacts · range and ETA filters",
		accent: "amber",
	},
	{
		id: "docking-granted",
		label: "Docking granted",
		mode: "NORMAL · ASSIST ON · THROTTLE 12%",
		target: "TRADE STATION · 2.4 km",
		director: "ALIGN AXIS · MATCH ROLL · CLEARANCE 08:41",
		notice: "Clearance is live. The director makes the active checks visible.",
		panel: "Communications",
		panelDetail: "DOCKING GRANTED · slot clear · grant expires in 08:41",
		accent: "green",
	},
	{
		id: "docking-denied",
		label: "Docking denied",
		mode: "NORMAL · ASSIST ON · THROTTLE 0%",
		target: "SHIPYARD · 1.8 km",
		director: "DO NOT ENTER · CLEARANCE DENIED",
		notice: "Red is blocking, and the reason is written beside the warning.",
		panel: "Communications",
		panelDetail: "DOCKING DENIED · hostile status · leave the approach",
		accent: "red",
	},
];

export function galleryState(id: string | null): GalleryState {
	return GALLERY_STATES.find((state) => state.id === id) ?? GALLERY_STATES[0];
}

const STYLE = `
#state-gallery { position: fixed; inset: 0; z-index: 20; overflow: auto; color: #d8eeff; background: #02080e; font: 13px/1.35 ui-monospace, "SF Mono", Menlo, monospace; }
#state-gallery * { box-sizing: border-box; }
.sg-wrap { min-height: 100%; max-width: 1180px; margin: auto; padding: 20px; display: grid; gap: 14px; }
.sg-head { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; border-bottom: 1px solid #355369; padding-bottom: 12px; }
.sg-head h1 { margin: 0; color: #9fd4ff; font-size: 16px; letter-spacing: .08em; }
.sg-head p { margin: 4px 0 0; color: #8299aa; font-size: 11px; }
.sg-close, .sg-state { border: 1px solid #355369; border-radius: 3px; background: #07121c; color: #b8dfff; cursor: pointer; font: inherit; padding: 7px 9px; }
.sg-close:hover, .sg-state:hover, .sg-state[aria-pressed="true"] { border-color: #e5aa52; color: #ffe0a2; }
.sg-states { display: flex; flex-wrap: wrap; gap: 6px; }
.sg-shell { min-height: 470px; display: grid; grid-template-columns: minmax(180px, .85fr) minmax(330px, 1.7fr) minmax(180px, .85fr); gap: 12px; }
.sg-panel, .sg-glass { border: 1px solid #355369; background: linear-gradient(145deg, rgba(13, 36, 53, .82), rgba(2, 9, 15, .96)); box-shadow: inset 0 0 42px rgba(60, 162, 220, .08); }
.sg-panel { padding: 14px; }
.sg-panel h2 { margin: 0 0 10px; color: #9fd4ff; font-size: 12px; letter-spacing: .1em; }
.sg-panel p { color: #bed4e2; margin: 0; }
.sg-panel small { display: block; color: #7893a6; margin-top: 14px; }
.sg-tabs { display: flex; gap: 4px; margin: 0 0 10px; }
.sg-tab { border: 0; border-bottom: 1px solid #355369; background: transparent; color: #7795aa; cursor: pointer; font: inherit; font-size: 10px; padding: 4px 6px; }
.sg-tab[aria-selected="true"] { border-color: #e5aa52; color: #ffe0a2; }
.sg-glass { position: relative; overflow: hidden; min-height: 470px; }
.sg-stars { position: absolute; inset: 0; opacity: .72; background-image: radial-gradient(circle at 17% 23%, #fff 0 1px, transparent 1.5px), radial-gradient(circle at 76% 16%, #bde7ff 0 1px, transparent 1.5px), radial-gradient(circle at 61% 64%, #fff 0 1px, transparent 1.5px), radial-gradient(circle at 28% 71%, #85c8f7 0 1px, transparent 1.5px); background-size: 127px 101px, 163px 149px, 109px 173px, 211px 191px; }
.sg-director { position: absolute; left: 50%; top: 42%; width: 185px; transform: translate(-50%, -50%); color: #ffe0a2; text-align: center; text-shadow: 0 0 14px rgba(229, 170, 82, .65); }
.sg-director::before { content: ""; display: block; width: 68px; height: 68px; margin: 0 auto 9px; border: 2px solid currentColor; border-radius: 50%; box-shadow: 0 0 18px currentColor; }
.sg-target-arrow { position: absolute; left: 50%; top: 23px; color: #ffe0a2; font-size: 24px; line-height: 1; text-shadow: 0 0 12px rgba(229, 170, 82, .9); transform: rotate(var(--target-bearing)) translateX(48px); transform-origin: 0 50%; }
.sg-director[data-accent="green"] { color: #a8ffbf; } .sg-director[data-accent="red"] { color: #ff9c8e; } .sg-director[data-accent="cyan"] { color: #a7dcff; }
.sg-docking { margin-top: 8px; color: inherit; font-size: 11px; }
.sg-scanner { position: absolute; left: 50%; bottom: 65px; width: 330px; height: 156px; transform: translateX(-50%); }
.sg-scanner::before { content: ""; position: absolute; inset: 25px 5px 10px; border: 2px solid #eaa632; border-radius: 50%; background: repeating-radial-gradient(ellipse at center, transparent 0 12px, rgba(234, 166, 50, .65) 13px 14px); box-shadow: 0 0 18px rgba(234, 166, 50, .35), inset 0 0 18px rgba(234, 166, 50, .15); }
.sg-scanner::after { content: ""; position: absolute; left: 50%; top: 15px; bottom: 14px; width: 1px; background: #eaa632; opacity: .65; }
.sg-contact { position: absolute; width: 9px; height: 9px; border: 1px solid #ffd274; border-radius: 50%; background: #221b08; z-index: 1; } .sg-contact::after { content: ""; position: absolute; top: 7px; left: 3px; width: 2px; height: var(--height); background: currentColor; box-shadow: 0 0 5px currentColor; opacity: .9; }
.sg-contact-anchor { position: absolute; width: 28px; height: 9px; border: 1px solid currentColor; border-radius: 50%; background: rgba(15, 25, 12, .5); box-shadow: 0 0 8px currentColor; opacity: .85; }
.sg-contact.one { left: 68%; top: 40%; color: #ffd274; --height: 47px; } .sg-contact-anchor.one { left: calc(68% - 9px); top: 72%; color: #ffd274; } .sg-contact.two { left: 24%; top: 62%; border-color: #a6ffbf; color: #a6ffbf; --height: 34px; } .sg-contact-anchor.two { left: calc(24% - 9px); top: 85%; color: #a6ffbf; } .sg-contact.three { left: 52%; top: 32%; border-color: #81c9ef; color: #81c9ef; --height: 60px; } .sg-contact-anchor.three { left: calc(52% - 9px); top: 73%; color: #81c9ef; }
.sg-scanner-label { position: absolute; left: 50%; top: 2px; color: #d2a860; font-size: 10px; transform: translateX(-50%); white-space: nowrap; }
.sg-floor { position: absolute; left: 14px; right: 14px; bottom: 14px; display: flex; justify-content: space-between; gap: 12px; padding: 9px; border: 1px solid #355369; background: rgba(3, 14, 23, .82); color: #9fd4ff; font-size: 11px; }
.sg-floor strong { color: #ffe0a2; font-weight: 600; } .sg-note { margin: 0; color: #b4c8d4; }
@media (max-width: 600px) { .sg-wrap { padding: 12px; } .sg-head { align-items: flex-start; } .sg-states { display: grid; grid-template-columns: 1fr 1fr; } .sg-shell { position: relative; min-height: 480px; display: block; } .sg-panel { display: none; } .sg-panel[data-active="true"] { position: absolute; z-index: 2; left: 8px; right: 8px; top: 8px; display: block; } .sg-glass { min-height: 480px; } .sg-scanner { width: min(330px, calc(100% - 24px)); bottom: 65px; } .sg-floor { bottom: 12px; font-size: 10px; flex-direction: column; gap: 3px; } }
`;

function render(state: GalleryState, rightTab: RightTab): string {
	const isLeft =
		state.panel === "Navigation" || state.panel === "Communications";
	const isRight = state.panel === "Flight" || state.panel === "Drive";
	const sideDetail =
		"Target discovery, filters, clearance requests, and replies live here — never under the mouse.";
	const technicalDetail =
		"Speed, throttle, assist, relative motion, charge and drive state belong here.";
	const tuningDetail =
		"v_max 20 c · exponent 0.60 · drop 50 km · vicinity 10,000 km · lead 3 s";
	return `<div class="sg-wrap" data-gallery-state-active="${state.id}">
		<header class="sg-head"><div><h1>SEELITE · COCKPIT STATE GALLERY</h1><p>Issue #34 prototype — visual contract, not simulated docking.</p></div><button class="sg-close" type="button">return to flight</button></header>
		<nav class="sg-states" aria-label="Cockpit states">${GALLERY_STATES.map((candidate) => `<button class="sg-state" type="button" data-gallery-state="${candidate.id}" aria-pressed="${candidate.id === state.id}">${candidate.label}</button>`).join("")}</nav>
		<div class="sg-shell">
			<aside class="sg-panel" data-gallery-panel="left" data-active="${isLeft}"><h2>${isLeft ? state.panel : "NAVIGATION"}</h2><p>${isLeft ? state.panelDetail : sideDetail}</p><small>Simulation continues while this panel is open.</small></aside>
			<main class="sg-glass" aria-live="polite"><div class="sg-stars"></div><div class="sg-director" data-gallery-director data-accent="${state.accent}">${state.targetBearingDeg === undefined ? "" : `<i class="sg-target-arrow" data-gallery-target-arrow data-gallery-target-bearing="${state.targetBearingDeg}" style="--target-bearing:${state.targetBearingDeg}deg" aria-label="turn toward target bearing">➤</i>`}${state.director}${state.id.startsWith("docking-") ? `<div class="sg-docking" data-gallery-docking>AXIS FUNNEL · ROLL RING · ${state.id === "docking-granted" ? "CLEAR TO APPROACH" : "DO NOT ENTER"}</div>` : ""}</div><div class="sg-scanner" data-gallery-scanner aria-label="Elite-style 3D local radar, 10,000 kilometre vicinity"><i class="sg-contact one" data-gallery-contact-stem></i><i class="sg-contact-anchor one" data-gallery-contact-anchor></i><i class="sg-contact two" data-gallery-contact-stem></i><i class="sg-contact-anchor two" data-gallery-contact-anchor></i><i class="sg-contact three" data-gallery-contact-stem></i><i class="sg-contact-anchor three" data-gallery-contact-anchor></i><span class="sg-scanner-label">ELITE 3D RADAR · 10,000 km</span></div><div class="sg-floor" data-gallery-floor><span>${state.mode}</span><strong>${state.target}</strong></div></main>
			<aside class="sg-panel" data-gallery-panel="right" data-active="${isRight}"><nav class="sg-tabs" aria-label="Right panel tabs">${(["Flight", "Drive", "Tuning"] as RightTab[]).map((tab) => `<button class="sg-tab" type="button" data-gallery-right-tab="${tab}" aria-selected="${rightTab === tab}">${tab}</button>`).join("")}</nav><h2>${rightTab.toUpperCase()}</h2><p ${rightTab === "Tuning" ? "data-gallery-tuning" : ""}>${rightTab === "Tuning" ? tuningDetail : rightTab === state.panel ? state.panelDetail : technicalDetail}</p><small>Tuning stays in this right-panel tab, never on the flight floor.</small></aside>
		</div><p class="sg-note" data-gallery-notice>${state.notice}</p>
	</div>`;
}

/** Mount only when a designer explicitly requests `?hud-gallery=<state>`. */
export function mountStateGallery(): void {
	const requested = new URLSearchParams(window.location.search).get(
		"hud-gallery",
	);
	if (requested === null) return;
	const style = document.createElement("style");
	style.textContent = STYLE;
	document.head.append(style);
	const root = document.createElement("section");
	root.id = "state-gallery";
	document.body.append(root);
	let current = galleryState(requested === "1" ? "assist-on" : requested);
	let rightTab: RightTab = current.panel === "Drive" ? "Drive" : "Flight";
	const paint = () => (root.innerHTML = render(current, rightTab));
	const setState = (id: string) => {
		current = galleryState(id);
		rightTab = current.panel === "Drive" ? "Drive" : "Flight";
		paint();
	};
	paint();
	root.addEventListener("click", (event) => {
		const target = event.target as HTMLElement;
		const state = target.closest<HTMLElement>("[data-gallery-state]");
		if (state) setState(state.dataset.galleryState ?? "assist-on");
		const tab = target.closest<HTMLElement>("[data-gallery-right-tab]");
		if (
			tab &&
			["Flight", "Drive", "Tuning"].includes(tab.dataset.galleryRightTab ?? "")
		) {
			rightTab = tab.dataset.galleryRightTab as RightTab;
			paint();
		}
		if (target.closest(".sg-close")) root.remove();
	});
}
