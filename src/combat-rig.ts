/**
 * THROWAWAY #48's combat prototype, as one removable thing.
 *
 * ## Why it is a file rather than eight guarded branches
 *
 * The rig used to live inside `Game`: ten fields, two meshes built in the
 * constructor, two keys in the command switch, a step branch, a render branch,
 * a resize hook, and the whole fitted-overlay block on the glass. Every one of
 * those sites sat in a production path behind an `if (combatPrototypeEnabled)`,
 * so removing the prototype — which is the *point* of a prototype — meant
 * surgery across code that has nothing to do with combat. #61 is that bill
 * coming due before #8's production combat lands and doubles it.
 *
 * The rig therefore owns everything the prototype touches: its scene objects,
 * its input mapping, its simulation step, its glass, and the hooks the browser
 * probe drives it with. `Game` reaches it through one nullable field.
 *
 * **What removal costs is a grep, not a number in a comment.** Two earlier
 * drafts of this paragraph put a figure here and both were wrong — the first
 * said "a file and a field" and undercounted by an order of magnitude, the
 * second gave a precise reference count that was off by two and omitted four
 * files. A frozen inventory in prose is a claim that rots on the next commit,
 * which is the failure this file is otherwise about. So:
 *
 * ```
 * rg -l 'combat' src tests scripts     # every file the prototype reaches
 * rg -c 'combatRig' src/main.ts scripts/probe-live-cockpit.mjs
 * ```
 *
 * That spans this file, `combat-prototype.ts` and its test, the boundary test,
 * the absence block in `probe-boot.mjs`, and the rig's references in
 * `probe-live-cockpit.mjs`. It is a lot more than a file and a field.
 *
 * **The claim worth making is about shape rather than size.** Every site in
 * `Game` is now a `?.` call on one nullable field, which the compiler finds and
 * a source scan can hold at zero (`tests/combat-rig-boundary.test.ts`). Before,
 * it was ten fields and eight guarded branches threaded through the
 * constructor, the command switch, the step, the render and two draw paths —
 * and nothing could hold that line, because there was no line to hold.
 *
 * ## What it is not
 *
 * It is not production combat and it couples to no world entity (#48). The
 * target is a renderer-only silhouette on a scripted bearing, never one of
 * #35's traffic actors, and the duel schedule is a function of elapsed time
 * rather than of aim — this rig measures *pacing*, and a claim that aim decides
 * hits would be false of it.
 *
 * ## Existence is the flag
 *
 * There is no `enabled` field. `Game` constructs a rig only for `?combat=1`, so
 * a normal flight holds `null` and every branch that used to test a boolean is
 * now a branch that does not exist. That is what makes the first acceptance
 * line — no allocation, no input interception, no chrome — checkable rather
 * than merely intended.
 */
import * as THREE from "three";
import {
	type CombatPrototypeState,
	createCombatPrototype,
	duelInputs,
	duelTargetInCone,
	stepCombatPrototype,
} from "./combat-prototype";
import { PROMPT_FILL, PROMPT_FONT, TextRaster } from "./text-raster";

/** The legend, and the widest text each status line is fitted against. */
const LEGEND =
	"COMBAT PROTOTYPE — hold SPACE pulse · S beam · / warning · Q ECM";
const WIDEST_TARGET = "TARGET  SHIELDS F 999  A 999  HULL 999";
const WIDEST_PLAYER = "PLAYER  SHIELDS F 999  A 999  HULL 999";
const WIDEST_STATUS =
	"FIRE LOCKED · H 100 E 100 · LOCK READY · MISSILE WARNING · INTD ACTIVE";

/**
 * The frame loop, as much of it as the rig is allowed to touch.
 *
 * **It stops the world, so only the rig may hold one.** `Game` builds it as an
 * inline literal at the rig's construction and keeps neither a field nor a
 * method — both are reachable through `window.__seelite`, because `private` is
 * erased at runtime and the instance is published whole. Two attempts got this
 * wrong in turn, a field and then a prototype method, before the closure.
 * `probe-boot.mjs` fails a default boot that exposes a loop control or any of
 * the names that have carried one; its docstring records the shape it still
 * cannot see.
 *
 * `probe-live-cockpit.mjs` uses it to compare tracer pixels against a fixed
 * simulation state. The mechanism is `Game`'s — it owns the
 * `requestAnimationFrame` handle — and the gate is the rig's existence.
 */
export interface LoopControl {
	freeze(): void;
	resume(): void;
}

export type CombatView = "cockpit" | "chase";

/**
 * The status line's text: a terminal verdict, or the live readout.
 *
 * Out of the draw because it is the one part of the overlay that is a decision
 * rather than a placement, and `probe-live-cockpit.mjs` asserts on the strings
 * it produces (`FIRE LOCKED`, `MISSILE WARNING`, `DUEL WON`) rather than on
 * pixels. `WIDEST_STATUS` is the bound every branch of it must fit inside.
 */
function statusText(s: CombatPrototypeState): string {
	if (s.playerHull <= 0) return "DUEL LOST";
	if (s.targetHull <= 0) return "DUEL WON";
	const fire = s.heatLocked ? "LOCKED" : (s.firing?.toUpperCase() ?? "SAFE");
	return `FIRE ${fire} · H ${s.heat.toFixed(0)} E ${s.energy.toFixed(0)} · LOCK ${s.missileLock ? "READY" : "ACQ"} · MISSILE ${s.incomingMissile ? "WARNING" : "CLEAR"} · INTD ${s.interdiction ? "ACTIVE" : "CLEAR"}`;
}

export class CombatPrototypeRig {
	/** Throwaway #48 balance state: it is not world or persistent combat state. */
	state: CombatPrototypeState = createCombatPrototype();
	/** Prototype-only glass status, exposed for the browser probe. */
	readonly overlayStatus = new TextRaster();
	/** The overlay lines drawn last frame, at the font each was fitted to. */
	overlayLines: { text: string; font: string; width: number }[] = [];
	/** The fitted width of the widest status text at the current glass width. */
	statusWorstWidth = 0;
	/** Probe-only laser visibility override; the renderer honours it. */
	forceLaserHidden = false;

	/** Throwaway #48 target: a renderer-only silhouette, never a #35 traffic actor. */
	private readonly targetMesh: THREE.Mesh;
	/** Bright, camera-local tracer shown only while the throwaway weapon is held. */
	private readonly laser: THREE.Line;
	private incoming = false;
	private ecm = false;
	/** Fitted overlay font cache: keyed by role + glass width; the fit is
	 *  computed against a widest-case text so any live state fits. */
	private readonly statusFit = new Map<
		string,
		{ font: string; worstWidth: number }
	>();

	constructor(
		scene: THREE.Scene,
		private readonly loop: LoopControl,
	) {
		this.targetMesh = new THREE.Mesh(
			new THREE.ConeGeometry(0.45, 1.3, 4),
			new THREE.MeshStandardMaterial({
				color: 0x9d2f35,
				emissive: 0x450308,
				emissiveIntensity: 1.2,
			}),
		);
		this.targetMesh.name = "combat-prototype-target";
		this.targetMesh.rotation.x = Math.PI / 2;
		scene.add(this.targetMesh);
		this.laser = new THREE.Line(
			new THREE.BufferGeometry().setFromPoints([
				new THREE.Vector3(0, 0, -0.6),
				new THREE.Vector3(0, 0, -12),
			]),
			new THREE.LineBasicMaterial({
				color: 0x74eaff,
				transparent: true,
				opacity: 0.95,
			}),
		);
		this.laser.name = "combat-prototype-laser";
		scene.add(this.laser);
	}

	/**
	 * One discrete key, or a refusal.
	 *
	 * **`command` is deliberate, and `CONTEXT.md` says so.** Its scope note on
	 * the `Command` alias (added by #71) bans the word as a name for *a player
	 * act on a carrier* — "not as an English word" — and names
	 * `Game.command(key)` dispatching a keypress as the sanctioned case. This is
	 * that method's delegate. Renaming it to `Intervention` would make the
	 * canonical consequence-model term mean two things, which is the outcome the
	 * scope note exists to prevent.
	 *
	 * Returns whether the rig consumed it, so `Game`'s switch asks rather than
	 * knows: the two keys the prototype borrows (`/` and `q`) both have other
	 * meanings, and the branch that decides which one applies used to be spelled
	 * twice inside that switch.
	 */
	command(key: string): boolean {
		if (key === "/") {
			this.incoming = true;
			return true;
		}
		if (key === "q") {
			this.ecm = true;
			return true;
		}
		return false;
	}

	/**
	 * One simulation frame of the duel.
	 *
	 * The held keys and the regime are the pilot's half; everything else the
	 * schedule decides, and `duelInputs` is the one place it does — the same
	 * function `tests/combat-prototype.test.ts` paces both weapon arms with.
	 */
	step(dt: number, keys: Set<string>, inCruise: boolean): void {
		this.state = stepCombatPrototype(
			this.state,
			duelInputs(
				this.state,
				dt,
				keys.has("s") ? "beam" : keys.has(" ") ? "pulse" : null,
				{
					incomingMissile: this.incoming,
					ecm: this.ecm,
					// Interdiction only charges in cruise (it is a cruise mechanic);
					// the probe therefore never observes ACTIVE in normal flight.
					interdicting: inCruise,
					breakAngle: keys.has("q") || keys.has("e"),
				},
			),
		);
		// One-shot inputs, cleared after the step that read them.
		this.incoming = false;
		this.ecm = false;
	}

	/**
	 * The scene objects, placed for this frame.
	 *
	 * The target holds a fixed bearing off the nose (ship frame, not the
	 * head-look camera rotation). The cone test is scripted by elapsed time, so
	 * this prototype measures pacing, not aiming skill.
	 */
	render(
		view: CombatView,
		orientation: THREE.Quaternion,
		viewRotation: THREE.Quaternion,
	): void {
		const { elapsed } = this.state;
		this.targetMesh.position
			.set(3 * Math.sin(elapsed * 0.7), 1.2 * Math.cos(elapsed * 1.1), -12)
			.applyQuaternion(orientation);
		this.targetMesh.visible = view === "cockpit";
		const material = this.targetMesh.material as THREE.MeshStandardMaterial;
		// Flash on the same scripted cone that scores damage, so the swell tracks
		// hits. The cone is a coarse proxy (up to ~13 degrees off the nose), not a
		// pixel-accurate aim test.
		const hitting = this.state.firing !== null && duelTargetInCone(elapsed);
		material.emissive.setHex(hitting ? 0x9df6ff : 0x450308);
		material.emissiveIntensity = hitting ? 4 : 1.2;
		this.targetMesh.scale.setScalar(hitting ? 1.25 : 1);
		this.laser.quaternion.copy(viewRotation);
		this.laser.visible = this.beamShown(view);
	}

	/**
	 * The readable weapon feedback, on the glass.
	 *
	 * The Three line `render` places is spatial reference; this is what makes a
	 * shot legible at every viewport, and it shares the cockpit-view gate of the
	 * 3D beam it represents. `glassBottom` is passed rather than imported: the
	 * lower third of the frame is physical cockpit hardware, that fraction is
	 * the renderer's to own, and a second copy of it here is exactly the kind
	 * that let the docking director draw its rings over the dash deck.
	 */
	drawTracer(
		ctx: CanvasRenderingContext2D,
		w: number,
		h: number,
		view: CombatView,
		glassBottom: number,
	): void {
		if (!this.beamShown(view)) return;
		ctx.save();
		// Clip the glass effect to the windscreen rather than drawing a laser over
		// an instrument panel.
		ctx.beginPath();
		ctx.rect(0, 0, w, h * glassBottom);
		ctx.clip();
		ctx.strokeStyle = "rgba(116, 234, 255, 0.98)";
		ctx.lineWidth = 3;
		ctx.beginPath();
		ctx.moveTo(w * 0.24, h * 0.64);
		ctx.lineTo(w / 2, h * 0.46);
		ctx.moveTo(w * 0.76, h * 0.64);
		ctx.lineTo(w / 2, h * 0.46);
		ctx.stroke();
		ctx.restore();
	}

	/**
	 * The font one status line fits in, and the width its worst case occupies.
	 *
	 * **Fitted against the widest text the line can ever hold, not against the
	 * live digits**, so a reading that grows by a character does not resize the
	 * line under the player. That makes the answer a property of the line and
	 * the glass width alone, which is what lets it be cached: the loop below
	 * measures once per role per width, not once per frame.
	 */
	private fitFont(
		ctx: CanvasRenderingContext2D,
		key: string,
		widest: string,
		startSize: number,
		w: number,
	): { font: string; worstWidth: number } {
		const cacheKey = `${key}|${w}`;
		const held = this.statusFit.get(cacheKey);
		if (held) return held;
		let size = startSize;
		ctx.font = `${size}px ui-monospace, monospace`;
		while (size > 8 && ctx.measureText(widest).width > w - 16) {
			size -= 1;
			ctx.font = `${size}px ui-monospace, monospace`;
		}
		const fitted = {
			font: ctx.font,
			worstWidth: ctx.measureText(widest).width,
		};
		this.statusFit.set(cacheKey, fitted);
		return fitted;
	}

	/** Whether the weapon is showing at all. One predicate, because the 3D beam
	 *  and the glass tracer are two renderings of one thing: spelled twice, a
	 *  new suppression term would silently reach only one of them. */
	private beamShown(view: CombatView): boolean {
		return (
			view === "cockpit" && this.state.firing !== null && !this.forceLaserHidden
		);
	}

	/** The glass, when there is none to draw: a focused console or a docked ship
	 *  has replaced it, and a stale record would let a probe assert a line that
	 *  is not on screen. */
	clearOverlay(): void {
		this.overlayStatus.reset();
		this.overlayLines = [];
		// The third record, and it was missed: `probe-live-cockpit.mjs` asserts
		// `statusWorstWidth > 0`, so leaving it set is exactly the stale reading
		// this method's own docstring says it exists to prevent.
		this.statusWorstWidth = 0;
	}

	/** The status block, fitted to the glass width. */
	drawOverlay(
		ctx: CanvasRenderingContext2D,
		w: number,
		h: number,
		view: CombatView,
	): void {
		if (view !== "cockpit") {
			this.clearOverlay();
			return;
		}
		ctx.save();
		ctx.textAlign = "center";
		const drawnLines: { text: string; font: string; width: number }[] = [];
		const drawFitted = (
			text: string,
			y: number,
			fill: string,
			startSize: number,
			key: string,
			widest: string,
		) => {
			const fit = this.fitFont(ctx, key, widest, startSize, w);
			ctx.font = fit.font;
			const width = ctx.measureText(text).width;
			drawnLines.push({ text, font: fit.font, width });
			ctx.fillStyle = fill;
			ctx.fillText(text, w / 2, y);
			return fit;
		};
		const s = this.state;
		drawFitted(
			LEGEND,
			h * 0.72,
			"rgba(255, 214, 120, 0.9)",
			12,
			"legend",
			LEGEND,
		);
		drawFitted(
			`TARGET  SHIELDS F ${s.targetForeShield.toFixed(0)}  A ${s.targetAftShield.toFixed(0)}  HULL ${s.targetHull.toFixed(0)}`,
			h * 0.76,
			"rgba(255, 115, 130, 0.95)",
			12,
			"target",
			WIDEST_TARGET,
		);
		drawFitted(
			`PLAYER  SHIELDS F ${s.foreShield.toFixed(0)}  A ${s.aftShield.toFixed(0)}  HULL ${s.playerHull.toFixed(0)}`,
			h * 0.8,
			"rgba(116, 234, 255, 0.95)",
			12,
			"player",
			WIDEST_PLAYER,
		);
		const status = statusText(s);
		// The status line goes through the same fitter, keyed on its widest text
		// so any live state fits whatever the first frame displayed. Its fit
		// comes back from the draw rather than being solved a second time or
		// fetched out of the cache, so the width the probe asserts on and the
		// width the line was drawn at are the same value.
		const statusFit = drawFitted(
			status,
			h * 0.84,
			PROMPT_FILL,
			Number.parseInt(PROMPT_FONT, 10),
			"status",
			WIDEST_STATUS,
		);
		this.statusWorstWidth = statusFit.worstWidth;
		const statusWidth = drawnLines.at(-1)?.width ?? 0;
		this.overlayStatus.setCenteredPrompt(
			status,
			w / 2,
			h * 0.84,
			statusWidth,
			statusFit.font,
		);
		this.overlayLines = drawnLines;
		ctx.restore();
	}

	/** A resize invalidates every fit, which was solved against the old width. */
	onResize(): void {
		this.statusFit.clear();
	}

	/** Freeze the frame loop; the caller renders manually with a fixed sim state. */
	freezeLoop(): void {
		this.loop.freeze();
	}

	/** Resume the frame loop. */
	resumeLoop(): void {
		this.loop.resume();
	}

	// **No `dispose`.** One was written and removed before this landed: nothing
	// tears a `Game` down, so it had no caller, no test, and a doc comment
	// claiming it was "the half of removable that runs" — a claim about code
	// that never ran. The removability #61 asks for is the *diff*: this file
	// plus one field. A teardown belongs here the day something calls it.
}
