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
 * it is query-gated behind `?perf` alongside `?fps`, nothing reads it by
 * default, and no probe asserts through it. `hud-and-scanner.md` §5 keeps
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
export const PERF_KEYS = ["b", "h", "c", "r", "o"] as const;
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
			// 0 = full, 1 = albedo without the normal perturbation, 2 = plain sphere.
			label: "surface",
			state: () => ["full", "no relief", "flat"][readAblate(scenes)] ?? "full",
			toggle: () => setAblate(scenes, (readAblate(scenes) + 1) % 3),
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
		// No modifier. The keys are checked against the flight bindings by
		// `tests/perf-panel-keys.test.ts` rather than by assertion here.
		if (e.metaKey || e.ctrlKey || e.altKey) return;
		if (e.key === RESTORE_KEY) {
			if (targets.bloom) targets.bloom.enabled = true;
			for (const kind of ["atmosphere", "cloud"])
				for (const s of shells(scenes, kind)) s.visible = true;
			setAblate(scenes, 0);
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
