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
 * "I checked once" is not a mechanism: `tests/perf-panel-keys.test.ts` reads
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
export const PERF_KEYS = ["b", "h", "c", "r", "o", "p"] as const;
export const RESTORE_KEY = "u";

export type PerfTargets = {
	scenes: THREE.Object3D[];
	/** The bloom pass, so it can be switched without rebuilding the composer. */
	bloom: { enabled: boolean } | null;
};

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
			key: "c",
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
			state: () =>
				readAblate(scenes) === 2
					? "flat"
					: readAblate(scenes) === 1
						? "none"
						: readRelief(scenes),
			// four-tap -> screen-space -> none -> flat -> four-tap
			toggle: () => {
				const screen = readRelief(scenes) === "screen-space";
				if (readAblate(scenes) === 0 && !screen) {
					setRelief(scenes, "screen-space");
				} else if (readAblate(scenes) === 0) {
					setRelief(scenes, "four-tap");
					setAblate(scenes, 1);
				} else if (readAblate(scenes) === 1) {
					setAblate(scenes, 2);
				} else {
					setAblate(scenes, 0);
					setRelief(scenes, "four-tap");
				}
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
		panel.innerHTML = `${switches
			.map((s) => {
				const v = s.state();
				const off = v === "off" || v === "flat";
				return `<b>${s.key}</b> ${s.label.padEnd(11)}<span class="${
					off ? "off" : ""
				}">${v}</span>`;
			})
			.join("\n")}\n<b>${RESTORE_KEY}</b> restore all`;
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
			setRelief(scenes, "four-tap");
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
