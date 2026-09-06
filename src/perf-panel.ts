/**
 * A live cost-attribution panel, for finding out what a frame is actually
 * spending its time on.
 *
 * The problem this exists for: a planet filling the screen costs a class
 * shader, a cloud shell, an atmosphere shell and a full-screen bloom pass, and
 * the honest way to price them is to remove one at a time and read the meter.
 * Reloading with a query flag can do that, but badly — a reload puts the ship
 * somewhere else, and comparing two frames taken from two positions measures
 * the positions as much as the terms.
 *
 * So every switch is **live**. Fly to the body once, then toggle in place: the
 * only thing that changes between two readings is the term.
 *
 * **It is diagnostic, not a feature.** Every switch changes what is drawn, so
 * it is query-gated behind `?perf`, and nothing reads it by default.
 *
 * The isolation is exactly that and no more: the key listener is a plain
 * `window` handler installed at mount, so a page that mounts the panel *and*
 * is driven by a probe would see both. What keeps that from happening is that
 * no probe URL carries `?perf`. `check-launcher-wiring.mjs` refuses a probe
 * whose source contains it, and `npm run probe` runs that before any browser
 * starts — so adding `?perf` to a probe to see something fails the wiring
 * check rather than quietly putting a keystroke-driven diagnostic under a
 * rendering assertion.
 *
 * **It is a text match, and text is the limit of it.** A URL assembled from
 * variables, or with the flag appended somewhere else, walks past it. That
 * catches the way it would actually happen — someone adding the flag to a URL
 * to look at something — and does not make the isolation a property of the
 * program. Calling it "enforced" was too strong. `hud-and-scanner.md` §5 keeps
 * developer tuning readouts off the persistent player flight floor; this obeys
 * that the same way the frame meter does, by never being on unless asked for.
 *
 * The state lives in the scene rather than here: the toggles walk the three
 * layers and set uniforms and `visible` flags. That is deliberate — a registry
 * of materials would have to be kept in step with a world that regenerates on
 * every jump, and this cannot go stale.
 */
import type * as THREE from "three";
import type { FrameAttribution } from "./frame-attribution";

/** What a switch does to the frame, and the key that flips it. */
type Switch = {
	key: string;
	label: string;
	/** Read back from the scene, so the panel cannot claim a state it does not have. */
	state: () => string;
	toggle: () => void;
};

const STYLE_ID = "seelite-perf-style";
const STYLE = `
#seelite-perf {
  position: fixed; top: 34px; right: 10px; z-index: 40;
  font: 11px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace;
  color: #cfe3ff; background: rgba(6,10,18,0.82);
  border: 1px solid rgba(120,160,220,0.35); border-radius: 4px;
  padding: 6px 9px; pointer-events: none; white-space: pre;
}
#seelite-perf b { color: #ffd479; font-weight: 600; }
#seelite-perf .off { color: #ff9a8a; }
`;

/**
 * Every planet material carries `perfAblate`, so setting it is a walk rather
 * than a lookup. Returns the value it set, for the panel to read back.
 */

function setAblate(scenes: THREE.Object3D[], value: number) {
	for (const scene of scenes)
		scene.traverse((object) => {
			const material = (object as THREE.Mesh).material;
			for (const m of [material].flat()) {
				const u = (m as THREE.ShaderMaterial)?.uniforms;
				if (u?.perfAblate) u.perfAblate.value = value;
			}
		});
	return value;
}

function readAblate(scenes: THREE.Object3D[]): number {
	let found = 0;
	for (const scene of scenes)
		scene.traverse((object) => {
			const material = (object as THREE.Mesh).material;
			for (const m of [material].flat()) {
				const u = (m as THREE.ShaderMaterial)?.uniforms;
				if (u?.perfAblate) found = u.perfAblate.value as number;
			}
		});
	return found;
}

function setCrater(scenes: THREE.Object3D[], slow: boolean) {
	for (const scene of scenes)
		scene.traverse((object) => {
			const material = (object as THREE.Mesh).material;
			for (const m of [material].flat()) {
				const u = (m as THREE.ShaderMaterial)?.uniforms;
				if (u?.craterSlow) u.craterSlow.value = slow ? 1 : 0;
			}
		});
}

function readCrater(scenes: THREE.Object3D[]): boolean {
	let slow = false;
	for (const scene of scenes)
		scene.traverse((object) => {
			const material = (object as THREE.Mesh).material;
			for (const m of [material].flat()) {
				const u = (m as THREE.ShaderMaterial)?.uniforms;
				if (u?.craterSlow && u.craterSlow.value) slow = true;
			}
		});
	return slow;
}

/**
 * Every class a planet can be drawn as, in the order the cycle steps through.
 *
 * Restated here rather than imported from `planet-appearance.ts`, and that is
 * a deliberate exception to this repo's habit: importing `CLASS_GLSL`'s keys
 * would pull the whole shader table into the eagerly-loaded graph for a
 * diagnostic that is off by default. The cost of the copy is that a tenth
 * class would not appear in the cycle, which is a missing entry in a debug
 * panel rather than a divergence anything renders.
 */
export const PERF_CLASSES = [
	"terran",
	"desert",
	"ice",
	"lava",
	"venusian",
	"airless",
	"jovian",
	"iceGiant",
] as const;

/**
 * Cycle every planet's class at once, not just the one in front of the camera.
 *
 * Picking "the nearest body" needs a camera, a body list and a distance rule,
 * and gets them wrong at the layer handoff. Changing all of them means the one
 * being looked at changes too, which is the whole requirement — and it makes
 * the panel's reading unambiguous, since they are all the same class.
 */
function cycleClass(scenes: THREE.Object3D[], step: number) {
	const at = PERF_CLASSES.indexOf(
		readClass(scenes) as (typeof PERF_CLASSES)[number],
	);
	const next =
		PERF_CLASSES[(at + step + PERF_CLASSES.length) % PERF_CLASSES.length];
	for (const scene of scenes)
		scene.traverse((object) => {
			object.userData?.setSurfaceClass?.(next);
		});
	return next;
}

/**
 * The class the *planets* are wearing.
 *
 * Skipping `star` is what makes the cycle work rather than a nicety: the star
 * is tagged like any other body and refuses to change, so reading it back gave
 * a name that is not in the cycle, `indexOf` returned -1, and every press
 * stepped to the first entry instead of the next one. The cycle appeared to
 * stick on `terran`.
 */
/**
 * The relief path is a `#define`, so switching it recompiles — the same
 * mechanism as the class cycle, and for a harder reason: `dFdx` inside a branch
 * on a uniform is undefined on some drivers, so the derivative calls must not
 * be in the program at all when the four-tap path is selected.
 */
function setRelief(scenes: THREE.Object3D[], path: string) {
	for (const scene of scenes)
		scene.traverse((object) => {
			object.userData?.setReliefPath?.(path);
		});
}

/**
 * Put every planet in `scenes` into one class on one relief path.
 *
 * Exported because #206's sweep drives the same two switches from outside the
 * page and had its own copy of this traversal — which meant the scene set and
 * the setter contract had two homes that a change would have to be kept
 * synchronised across (sage, PR #214). The panel's own cycles stay separate
 * because each moves *one* of the two while reading the other back; this is
 * the both-at-once case, which is what an instrument wants.
 */
export function setSurfaceAndRelief(
	scenes: THREE.Object3D[],
	surface: string,
	relief: string,
) {
	for (const scene of scenes)
		scene.traverse((object) => {
			object.userData?.setSurfaceClass?.(surface);
			object.userData?.setReliefPath?.(relief);
		});
}

/**
 * The four levers the ablation ladder moves, and the arms it moves them to.
 *
 * #242 measured a planet at 95.4% of an open-space frame and #248 asks what is
 * *inside* that number. The existing sweep has four axes — class, relief path,
 * apparent size, pixel ratio — and none of them subtracts a term, so the table
 * could say a desert costs 36 ms without saying whether the 36 was relief,
 * class surface, or the two shells drawn around it.
 *
 * These are the same levers the panel's own keys move; the ladder is the
 * both-at-once form of them, exported for the same reason `setSurfaceAndRelief`
 * is — the sweep drives the page from outside and must not carry a second copy
 * of what the levers are.
 *
 * **Every arm sets every lever absolutely**, so the ladder can be walked in any
 * order and a failed cell cannot leak its state into the next one. A ladder of
 * deltas would price whatever the previous arm left behind.
 */
export const ABLATION_LEVERS = [
	"relief",
	"perfAblate",
	"atmosphere",
	"clouds",
] as const;

export type AblationArm = {
	name: string;
	relief: string;
	perfAblate: number;
	atmosphere: boolean;
	clouds: boolean;
	/** What subtracting this arm from `full` prices. Printed as the table's key. */
	prices: string;
};

/**
 * The ladder, `full` first and `bare` last.
 *
 * **`no-relief` is the normal perturbation and not all height evaluation.**
 * `perfAblate` 1 makes `reliefNormal` return the geometric normal, so the four
 * extra `height()` taps (or the two derivatives) are gone — but a class body
 * still calls `height(p)` once for its own albedo banding, and `desert` still
 * runs `canyons` and an `fbm4` for iron on top. So `full − no-relief` is what
 * the *slope* costs, which is smaller than what the class's noise costs, and
 * reading it as the latter overstates what #207's bands can buy.
 *
 * `flat` skips `surface()` outright (`planet-shaders.ts`, `perfAblate < 1.5`),
 * so `full − flat` is the slope **and** the class body, and every `prices`
 * string above is written as `full − arm` because that is the subtraction the
 * table prints. The class body on its own is `no-relief − flat`, which is a
 * difference of two rows and not a column: sage caught the first version
 * labelling the `flat` column with it, which attributed 35.7 ms to a term
 * measured at 8.0 and double-counted the slope.
 *
 * Within that class body, its noise and its palette cannot be separated by any
 * lever that exists — and none of #207, #217 or #224 acts at that granularity,
 * so the resolution says the split was not measured rather than implying it was.
 */
export const ABLATION_ARMS: readonly AblationArm[] = Object.freeze([
	{
		name: "full",
		relief: "four-tap",
		perfAblate: 0,
		atmosphere: true,
		clouds: true,
		prices:
			"the shipped frame — the denominator every other arm subtracts from",
	},
	{
		name: "screen-space",
		relief: "screen-space",
		perfAblate: 0,
		atmosphere: true,
		clouds: true,
		prices: "what the four-tap slope costs over the two-derivative one",
	},
	{
		name: "no-relief",
		relief: "four-tap",
		perfAblate: 1,
		atmosphere: true,
		clouds: true,
		prices: "the normal perturbation alone, not the class's other height calls",
	},
	{
		name: "flat",
		relief: "four-tap",
		perfAblate: 2,
		atmosphere: true,
		clouds: true,
		prices:
			"everything surface() does — the slope and the class body together, so it is not the class body alone: subtract no-relief from it for that",
	},
	{
		name: "no-atmosphere",
		relief: "four-tap",
		perfAblate: 0,
		atmosphere: false,
		clouds: true,
		prices: "the atmosphere shell, a second full-disc pass in its own mesh",
	},
	{
		name: "no-clouds",
		relief: "four-tap",
		perfAblate: 0,
		atmosphere: true,
		clouds: false,
		prices: "the cloud shell, on the classes that carry one",
	},
	{
		name: "bare",
		relief: "four-tap",
		perfAblate: 2,
		atmosphere: false,
		clouds: false,
		prices:
			"everything the ladder can turn off at once — surface(), both shells — leaving a lit sphere and the rest of the frame",
	},
]);

/**
 * One arm by name, or a throw naming the one that was asked for.
 *
 * A sweep is driven from a script that cannot import this module's types, so a
 * misspelt arm would otherwise arrive as `undefined` and set every lever to it:
 * `perfAblate` NaN, `visible` undefined, and a table of plausible numbers for a
 * state nothing describes. #7's rule is that an instrument fails loudly.
 */
export function armByName(name: string): AblationArm {
	const arm = ABLATION_ARMS.find((a) => a.name === name);
	if (!arm)
		throw new Error(
			`no ablation arm named "${name}" — the ladder is ` +
				`${ABLATION_ARMS.map((a) => a.name).join(", ")}`,
		);
	return arm;
}

/**
 * Put every planet in `scenes` into one arm of the ladder.
 *
 * The shell visibility goes through the same `shell` tag the panel's `h` and
 * `y` keys read, so a shell added to `planet-surface.ts` without a tag is
 * invisible to both rather than to only one of them.
 */
export function setAblation(
	scenes: THREE.Object3D[],
	name: string,
): AblationArm {
	const arm = armByName(name);
	setRelief(scenes, arm.relief);
	setAblate(scenes, arm.perfAblate);
	for (const s of shells(scenes, "atmosphere")) s.visible = arm.atmosphere;
	for (const s of shells(scenes, "cloud")) s.visible = arm.clouds;
	return arm;
}

/**
 * What the planets are wearing and whether anything is holding them there.
 *
 * **Two facts, and the panel had been asserting the second one** (sage, PR
 * #254). It printed `(pinned)` unconditionally, so on mount and after a restore
 * — the two moments when nothing is pinned — it claimed a fixed measurement arm
 * while #207's bands were free to move the program on the next frame. That is
 * the class of diagnostic error this repo has several of: a readout that says
 * what the code meant rather than what the state is.
 *
 * And `mixed`, because automatic selection is *per body*: a system with a
 * planet filling the view and another as a dot has two programs running, and
 * reporting the last one the traversal happened to reach names a scene state
 * that does not exist.
 */
function readReliefState(scenes: THREE.Object3D[]): {
	paths: Set<string>;
	pinned: boolean;
} {
	const paths = new Set<string>();
	let pinned = false;
	for (const scene of scenes)
		scene.traverse((object) => {
			const klass = object.userData?.surfaceClass;
			if (!klass || klass === "star" || !object.userData?.reliefPath) return;
			paths.add(object.userData.reliefPath);
			if (object.userData.reliefPinned) pinned = true;
		});
	return { paths, pinned };
}

function readRelief(scenes: THREE.Object3D[]): string {
	let found = "four-tap";
	for (const scene of scenes)
		scene.traverse((object) => {
			const klass = object.userData?.surfaceClass;
			if (klass && klass !== "star" && object.userData?.reliefPath)
				found = object.userData.reliefPath;
		});
	return found;
}

function readClass(scenes: THREE.Object3D[]): string {
	let found = "";
	for (const scene of scenes)
		scene.traverse((object) => {
			const klass = object.userData?.surfaceClass;
			if (klass && klass !== "star") found = klass;
		});
	return found;
}

/**
 * Hand every planet back to #207's apparent-size bands.
 *
 * Every setter in this panel pins the body it touches, because a diagnostic
 * that the frame loop overwrites on the next frame is worse than no diagnostic
 * — the panel would report a path the renderer had already replaced. So the
 * restore key has to clear the pin as well as the value, and nothing else here
 * does.
 */
function unpinRelief(scenes: THREE.Object3D[]) {
	for (const scene of scenes)
		scene.traverse((object) => {
			if (object.userData?.reliefPinned !== undefined)
				object.userData.reliefPinned = false;
		});
}

/** Shells are tagged in `planet-surface.ts`, so this needs no registry either. */
function shells(scenes: THREE.Object3D[], kind: string) {
	const out: THREE.Object3D[] = [];
	for (const scene of scenes)
		scene.traverse((object) => {
			if (object.userData?.shell === kind) out.push(object);
		});
	return out;
}

/**
 * The keys this panel takes, and the one that restores everything.
 *
 * Exported because they have to stay out of the flight controls' way, and
 * "I checked once" is not a mechanism — which the docking model proved by
 * landing on `main` and binding `c` and `u`, the two this panel had taken for
 * clouds and restore. The test caught it; nobody had to remember. `y` and `i`
 * are the free ones left, and they are worse mnemonics than the keys they
 * replace, which is the price of the game owning the good letters: `tests/perf-panel-keys.test.ts` reads
 * the bindings out of `main.ts` and fails if any of these is claimed there.
 * An earlier revision used the digit row on the strength of a comment saying
 * the flight controls own the letters — 1, 2 and 3 swing the chase view and 0
 * resets the cruise dials, so the panel stole four working controls.
 */
/**
 * `y` is deliberately absent. It cycled resolution here while the settings
 * screen owned the same renderer state, so two owners wrote it through
 * different multipliers — panel 50% and settings 50% gave 25%, and the panel's
 * own readout reported only its half. A diagnostic may not co-own a player
 * setting; resolution belongs to `settings.ts` and this panel prices the terms
 * that are not settings.
 */
export const PERF_KEYS = ["b", "h", "y", "r", "o", "p"] as const;
export const RESTORE_KEY = "i";

export type PerfTargets = {
	scenes: THREE.Object3D[];
	/** The bloom pass, so it can be switched without rebuilding the composer. */
	bloom: { enabled: boolean } | null;
	/** Query-gated frame timing and render-shape evidence. */
	attribution: FrameAttribution;
	/**
	 * #241's occlusion gate, read fresh each redraw.
	 *
	 * A getter rather than a value because the gate is a per-frame decision and
	 * this panel redraws on a one-second interval — a snapshot handed in at mount
	 * would show the state the game booted in for the whole session. And here
	 * rather than as a HUD element because #225's build contract asks for the
	 * gate's state to be reachable "without adding a permanent HUD element", and
	 * this panel is already the query-gated surface for exactly that.
	 */
	occlusion: () => {
		wanted: { shadows: boolean; ao: boolean };
		pinned: boolean;
		open: boolean;
		enclosureRad: number;
	};
};

function metric(value: number | null): string {
	return value === null ? "—" : `${value.toFixed(2)} ms`;
}

function identity(value: string | null): string {
	return (
		value?.replace(/[&<>"']/g, (character) => {
			const escaped: Record<string, string> = {
				"&": "&amp;",
				"<": "&lt;",
				">": "&gt;",
				'"': "&quot;",
				"'": "&#39;",
			};
			return escaped[character];
		}) ?? "unavailable"
	);
}

/**
 * Mount the panel and bind its keys. Returns a teardown.
 *
 * Idempotent, like the frame meter: mounting twice gives one panel.
 */
export function mountPerfPanel(targets: PerfTargets) {
	if (document.getElementById("seelite-perf")) return () => {};
	if (!document.getElementById(STYLE_ID)) {
		const style = document.createElement("style");
		style.id = STYLE_ID;
		style.textContent = STYLE;
		document.head.append(style);
	}

	const panel = document.createElement("div");
	panel.id = "seelite-perf";
	panel.dataset.perfPanel = "";
	document.body.append(panel);

	const { scenes } = targets;
	const switches: Switch[] = [
		{
			key: "b",
			label: "bloom",
			state: () => (targets.bloom?.enabled === false ? "off" : "on"),
			toggle: () => {
				if (targets.bloom) targets.bloom.enabled = !targets.bloom.enabled;
			},
		},
		{
			key: "h",
			label: "atmosphere",
			state: () =>
				shells(scenes, "atmosphere").some((s) => s.visible) ? "on" : "off",
			toggle: () => {
				for (const s of shells(scenes, "atmosphere")) s.visible = !s.visible;
			},
		},
		{
			key: "y",
			label: "clouds",
			state: () =>
				shells(scenes, "cloud").some((s) => s.visible) ? "on" : "off",
			toggle: () => {
				for (const s of shells(scenes, "cloud")) s.visible = !s.visible;
			},
		},
		{
			key: "r",
			// Four steps rather than three: the two ways of getting the slope, then
			// the two ablations that price them. Cycling them on one key keeps
			// them in one column, which is what makes a reading comparable.
			label: "relief",
			state: () => {
				if (readAblate(scenes) === 2) return "flat";
				// **`perfAblate` 1 is not the `none` path and must not read as one**
				// (sage, PR #254, round 2). Round 1's rewrite dropped this branch,
				// so `setAblation`'s `no-relief` arm displayed `four-tap` — two
				// distinct measurement arms with one label, which is worse than the
				// unconditional `(pinned)` it replaced.
				//
				// They are genuinely different things and the ladder prices both:
				// the uniform leaves the four `height()` calls compiled in and
				// branches around them, the path compiles them out. At a filling
				// planet the sweep reads 15.8 ms for the uniform and 16.1 for the
				// path — so on **this** driver the branch is marginally the cheaper
				// of the two, which is not why the path was chosen and is worth
				// stating rather than leaving to be inferred from the ordering. The
				// path is chosen because a branch on a uniform is not reliably
				// uniform control flow to every driver, and because `perfAblate`
				// belongs to the ladder.
				if (readAblate(scenes) === 1) return "ablated (uniform)";
				const { paths, pinned } = readReliefState(scenes);
				const what =
					paths.size === 0 ? "—" : paths.size > 1 ? "mixed" : [...paths][0];
				return pinned ? `${what} (pinned)` : `${what} (auto)`;
			},
			/**
			 * four-tap → screen-space → none → flat → four-tap.
			 *
			 * **`none` is a path now, not an ablation** (#207). It used to be
			 * `perfAblate` 1, and the two are not interchangeable: the uniform
			 * leaves the four `height()` calls in the program and relies on a
			 * branch every driver is supposed to treat as uniform control flow,
			 * while the path compiles them out. The band the game ships selects
			 * the path, so the panel has to cycle the same thing the game does or
			 * it is pricing something nobody plays.
			 *
			 * `flat` stays a uniform: it is the whole class body, it is the
			 * ladder's floor, and no band selects it.
			 */
			toggle: () => {
				if (readAblate(scenes) === 2) {
					setAblate(scenes, 0);
					setRelief(scenes, "four-tap");
					return;
				}
				const next: Record<string, string> = {
					"four-tap": "screen-space",
					"screen-space": "none",
				};
				const path = readRelief(scenes);
				if (path === "none") {
					setAblate(scenes, 2);
					return;
				}
				// **Clear the ablation on the way into a path** (sage, PR #254).
				// `setAblation`'s `no-relief` arm leaves `perfAblate` at 1, and
				// without this the next press would show `screen-space` over a
				// shader with the perturbation still switched off — the panel
				// reporting one arm while the GPU drew another, which invalidates
				// whatever comparison the press was for. The two levers overlap in
				// what they mean and only one of them ships, so the cycle owns
				// putting the other back.
				setAblate(scenes, 0);
				setRelief(scenes, next[path] ?? "four-tap");
			},
		},
		{
			key: "p",
			label: "planet class",
			state: () => readClass(scenes) || "—",
			// A body's class is normally a function of its orbit, so the only way
			// to see `airless` from the cockpit is to find a moon. This makes any
			// body wear any class, which is what lets the crater path be measured
			// at all: it is the most expensive class in the set and the hardest
			// one to happen to be flying past.
			toggle: () => cycleClass(scenes, 1),
		},
		{
			key: "o",
			label: "craters",
			state: () => (readCrater(scenes) ? "differenced" : "one walk"),
			toggle: () => setCrater(scenes, !readCrater(scenes)),
		},
	];

	const draw = () => {
		const attribution = targets.attribution.snapshot();
		const occlusion = targets.occlusion();
		panel.dataset.attributionEnabled = String(attribution.enabled);
		panel.dataset.gpuStatus = attribution.gpu.status;
		panel.innerHTML = `${switches
			.map((s) => {
				const v = s.state();
				const off = v === "off" || v === "flat";
				return `<b>${s.key}</b> ${s.label.padEnd(11)}<span class="${
					off ? "off" : ""
				}">${v}</span>`;
			})
			.join("\n")}\n<b>${RESTORE_KEY}</b> restore all

FRAME ATTRIBUTION
CPU simulation/step         ${metric(attribution.cpu["simulation/step"].medianMs)} med  ${metric(attribution.cpu["simulation/step"].p95Ms)} p95
CPU render submission       ${metric(attribution.cpu["render submission/composer"].medianMs)} med  ${metric(attribution.cpu["render submission/composer"].p95Ms)} p95
GPU status                  ${attribution.gpu.status}
GPU composer execution      ${metric(attribution.gpu.medianMs)} med  ${metric(attribution.gpu.p95Ms)} p95
GPU samples / age           ${attribution.gpu.sampleCount} / ${attribution.gpu.sampleAgeMs === null ? "—" : `${attribution.gpu.sampleAgeMs.toFixed(0)} ms`}
draw calls / triangles      ${attribution.renderer.calls} / ${attribution.renderer.triangles}
programs / geometries       ${attribution.renderer.programs} / ${attribution.renderer.geometries}
textures                    ${attribution.renderer.textures}
drawing buffer              ${attribution.renderer.drawingBufferWidth} × ${attribution.renderer.drawingBufferHeight}
pixel ratio / render scale  ${attribution.renderer.effectivePixelRatio.toFixed(2)} / ${attribution.renderer.renderScale.toFixed(2)}
composer passes             ${attribution.renderer.composerPassCount}
occlusion gate              ${occlusion.open ? "open" : "shut"}${occlusion.pinned ? " (pinned by an instrument)" : ""}
occlusion asked / drawn     ${occlusion.wanted.shadows ? "shadow" : "—"} ${occlusion.wanted.ao ? "ao" : "—"} / ${occlusion.wanted.shadows && (occlusion.open || occlusion.pinned) ? "shadow" : "—"} ${occlusion.wanted.ao && (occlusion.open || occlusion.pinned) ? "ao" : "—"}
enclosure                   ${occlusion.enclosureRad.toFixed(3)} rad
renderer                    ${identity(attribution.renderer.api)}
rasterizer                  ${identity(attribution.renderer.rasterizer)}`;
	};

	const onKey = (e: KeyboardEvent) => {
		// No Cmd, Ctrl or Alt. The keys are checked against the flight bindings by
		// `tests/perf-panel-keys.test.ts` rather than by assertion here.
		if (e.metaKey || e.ctrlKey || e.altKey) return;
		if (e.key === RESTORE_KEY) {
			if (targets.bloom) targets.bloom.enabled = true;
			for (const kind of ["atmosphere", "cloud"])
				for (const s of shells(scenes, kind)) s.visible = true;
			setAblate(scenes, 0);
			// **Set, then un-pin, in that order and only once.** `setRelief` pins
			// the bodies it touches (#207), so clearing the pin first and setting
			// after would leave every planet held at four-tap for the rest of the
			// session — with the picture looking exactly right until a planet got
			// small. The first version did both, which worked and read as though
			// the ordering did not matter (sage, PR #254). Handing the bands back
			// is what "restore all" means for this row.
			setRelief(scenes, "four-tap");
			unpinRelief(scenes);
			setCrater(scenes, false);
			draw();
			return;
		}
		const hit = switches.find((s) => s.key === e.key);
		if (!hit) return;
		hit.toggle();
		draw();
	};
	window.addEventListener("keydown", onKey);

	// Redrawn on a timer as well as on a keypress: a jump rebuilds the bodies,
	// and the panel would otherwise keep reporting the state of a system that is
	// no longer on screen.
	const tick = window.setInterval(draw, 1000);
	draw();

	return () => {
		window.removeEventListener("keydown", onKey);
		window.clearInterval(tick);
		panel.remove();
	};
}
