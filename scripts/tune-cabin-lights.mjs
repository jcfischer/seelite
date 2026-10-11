/**
 * Interactive brightness tuner — a dev tool, not a deliverable (node #887).
 *
 * It exists because a look cannot be chosen from a table. Six lamps, three console
 * lamps, the authored interior's floods and the rig's ambient are all live on screen,
 * the panel's readout is measured back off the rendered frame, and whatever the
 * principal settles on is written to /tmp/tuning.json for `src/` to adopt as a figure
 * with its provenance. Nothing here is imported by the game.
 *
 *   SEELITE_PROBE_RENDERER=hardware node scripts/tune-cabin-lights.mjs
 *
 * Opens the live game in a visible window with a slider panel over it. Every slider
 * drives the real lights in the running scene — no mock-up, nothing written to source —
 * and the readout is measured back off the rendered frame. `Dock at station` / `Launch`
 * put the ship in and out of a berth through the game's own docking computer (the same
 * placement the view set captures with), so the docked cabin and the bay lights can be
 * tuned where they are actually seen. `Save figures` writes /tmp/tuning.json; the same
 * figures are printed to this terminal every few seconds, and become the sliders'
 * starting point the next time this runs.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { gameUrl } from "../scripts/lib/game-url.mjs";
import { installViewFraming } from "./lib/view-placement.mjs";
import { installViewPlacement, launchChromium } from "./probe-guard.mjs";

const SAVED = "/tmp/tuning.json";
const defaults = {
	castIntensity: 0.24,
	castRangeKm: 0.22,
	stripGain: 1,
	consoleGain: 2.8,
	stationGain: 1,
	sunGain: 1,
	hemiGain: 1,
	fillGain: 1,
	exposure: 1,
};
let starting = defaults;
try {
	starting = { ...defaults, ...JSON.parse(readFileSync(SAVED, "utf8")) };
	console.error(`starting from ${SAVED}: ${JSON.stringify(starting)}`);
} catch {
	console.error("no saved figures, starting from the shipped values");
}

const browser = await launchChromium({ probeWindow: "visible" });
const context = await browser.newContext({
	viewport: { width: 1440, height: 900 },
});
const page = await context.newPage();
// Both installers go in as init scripts, so both must be in **before** the game boots.
// `installViewPlacement` is the one that installs `__parkInBerth`, and `__parkInBerth`
// calls `__viewAlongAxis`, `__radiusOf` and friends from `installViewFraming`: with
// only the framing half in, docking fails part-way through with
// `window.__viewAlongAxis is not a function`.
await installViewPlacement(page);
await installViewFraming(page);
await page.goto(gameUrl("http://localhost:5199", { seed: 1 }));
await page.waitForFunction(
	() => window.__seelite && window.__seelite.frames > 0,
	null,
	{
		timeout: 180000,
	},
);

await page.evaluate((initial) => {
	const g = window.__seelite;
	/** Each light's figure as the game built it, recorded the first time we see it. */
	const base = new WeakMap();
	const baseOf = (light) => {
		if (!base.has(light))
			base.set(light, {
				intensity: light.intensity,
				distance: light.distance,
			});
		return base.get(light);
	};
	const SCENES = [
		"cabinScene",
		"nearScene",
		"farScene",
		"approachScene",
		"backdropScene",
	]
		.map((key) => g[key])
		// Some handles are the game's own objects, not THREE graphs; anything
		// without a graph to walk is skipped rather than crashed on.
		.filter((scene) => typeof scene?.traverse === "function");
	const eachLight = (pattern, fn) => {
		for (const scene of SCENES)
			scene.traverse((o) => {
				if (o.isLight && pattern.test(o.name || "")) fn(o, baseOf(o));
			});
	};
	/** The fittings the authored cabin already carries, by material name. */
	const eachMaterial = (pattern, fn) => {
		for (const scene of SCENES)
			scene.traverse((o) => {
				if (!o.isMesh) return;
				for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
					if (!m?.name || !pattern.test(m.name)) continue;
					if (!base.has(m))
						base.set(m, { emissiveIntensity: m.emissiveIntensity ?? 1 });
					fn(m, base.get(m));
				}
			});
	};
	const setHeads = (level) => {
		for (const scene of SCENES)
			scene.traverse((o) => {
				if (!(o.isMesh && /-head$/.test(o.name))) return;
				o.material.color.setHex(0xffc27a).multiplyScalar(level);
				o.material.needsUpdate = true;
				o.visible = level > 0;
			});
	};
	const F = (window.__tuningFigures = { ...initial });
	const apply = () => {
		eachLight(/^perimeter-lamp-/, (l) => {
			l.intensity = F.castIntensity;
			l.distance = F.castRangeKm;
		});
		eachLight(
			/^(cockpit-light|cockpit-key-light|cockpit-centre-light)$/,
			(l, b) => {
				l.intensity = b.intensity * F.consoleGain;
			},
		);
		eachLight(/^sun$/, (l, b) => (l.intensity = b.intensity * F.sunGain));
		eachLight(
			/^hemisphere$/,
			(l, b) => (l.intensity = b.intensity * F.hemiGain),
		);
		eachLight(/^fill$/, (l, b) => (l.intensity = b.intensity * F.fillGain));
		eachLight(/flood|bay|dock|berth|station|interior/i, (l, b) => {
			l.intensity = b.intensity * F.stationGain;
		});
		eachMaterial(/amber|warm|work-light|indicator/i, (m, b) => {
			m.emissiveIntensity = b.emissiveIntensity * F.stripGain;
		});
		// No head slider: the added disc was removed as unrealistic (#898), so the
		// only `-head` meshes a build could hold here are stale; keep them hidden.
		setHeads(0);
		g.renderer.toneMappingExposure = F.exposure;
		window.__tuningApply = apply;
	};

	const SLIDERS = [
		["castIntensity", "frame lamps — cast", 0, 1.2, 0.02],
		["castRangeKm", "frame lamps — reach (km)", 0.05, 0.5, 0.01],
		["stripGain", "authored strips ×", 0, 6, 0.05],
		["headLevel", "added disc glow (0 = off)", 0, 0.4, 0.01],
		["consoleGain", "console lamps ×", 0, 4, 0.05],
		["stationGain", "station / bay / flood ×", 0, 6, 0.05],
		["sunGain", "sun ×", 0, 3, 0.05],
		["hemiGain", "hemisphere ×", 0, 3, 0.05],
		["fillGain", "fill ×", 0, 3, 0.05],
		["exposure", "tone-map exposure", 0.4, 1.6, 0.02],
	];
	const panel = document.createElement("div");
	panel.setAttribute(
		"style",
		"position:fixed;top:12px;right:12px;z-index:99999;width:300px;padding:12px 14px;background:rgba(12,14,18,.92);border:1px solid #333;border-radius:10px;font:12px/1.5 ui-monospace,Menlo,monospace;color:#dfe6ee;user-select:none",
	);
	panel.innerHTML =
		'<div style="font-weight:700;margin-bottom:6px">brightness — live</div>' +
		SLIDERS.map(
			([key, label, min, max, step]) =>
				`<div style="margin:5px 0"><label style="display:flex;justify-content:space-between">${label}<span id="v-${key}"></span></label><input type="range" data-key="${key}" min="${min}" max="${max}" step="${step}" value="${F[key]}" style="width:100%"></div>`,
		).join("") +
		'<div id="picks" style="margin-top:8px"></div>' +
		'<div style="display:flex;gap:6px;margin-top:6px"><button data-act="dock" style="flex:1;padding:6px;background:#2f855a;color:#fff;border:0;border-radius:6px;font:inherit;cursor:pointer">Dock at station</button><button data-act="launch" style="flex:1;padding:6px;background:#744210;color:#fff;border:0;border-radius:6px;font:inherit;cursor:pointer">Launch</button></div>' +
		'<div id="status" style="margin-top:6px;color:#9aa5b1"></div>' +
		'<div id="readout" style="margin-top:8px;padding-top:8px;border-top:1px solid #333;white-space:pre"></div>' +
		'<button data-act="save" style="width:100%;margin-top:8px;padding:6px;background:#2b6cb0;color:#fff;border:0;border-radius:6px;font:inherit;cursor:pointer">Save figures → /tmp/tuning.json</button>';
	document.body.appendChild(panel);
	for (const [key] of SLIDERS)
		document.getElementById(`v-${key}`).textContent = String(F[key]);
	panel.addEventListener("input", (event) => {
		const key = event.target.dataset?.key;
		if (!key) return;
		F[key] = Number(event.target.value);
		document.getElementById(`v-${key}`).textContent = String(F[key]);
		apply();
	});
	const setStatus = (text) =>
		(document.getElementById("status").textContent = text);
	/** Every station in the system, with the berths its interior offers. The
	 *  authored interior kits are fitted to `trade` and `shipyard` stations
	 *  (`interior-kit.ts`), so `trade` is what the dropdown opens on — the new
	 *  interiors are only seen there, and picking the first station with a berth
	 *  landed on a refinery, which has none of them. */
	const roster = () => {
		const byId = g.world?.system?.byId ?? {};
		return Object.entries(byId)
			.filter(([, body]) => body?.kind === "station")
			.map(([id, body]) => ({
				id,
				type: body.type ?? "?",
				berths: g.berthIdsOfStation?.(id) ?? [],
			}))
			.filter((entry) => entry.berths.length)
			.sort(
				(a, b) =>
					(a.type === "trade" ? 0 : 1) - (b.type === "trade" ? 0 : 1) ||
					a.id.localeCompare(b.id),
			);
	};
	const stationWithBerths = () => {
		// Stations are bodies in `system.byId`, not a list on the system: the
		// first shape was guessed and found nothing. `trafficCandidateHomes` names
		// home stations too, so both are consulted and the first id with berths on
		// its interior wins.
		const byId = g.world?.system?.byId ?? {};
		const ids = [
			...Object.entries(byId)
				.filter(([id, body]) => /station/.test(id) || body?.kind === "station")
				.map(([id]) => id),
			...(g.trafficCandidateHomes ?? []).map((a) => a.homeStationId),
		].filter((id, index, all) => id && all.indexOf(id) === index);
		for (const id of ids) {
			const berths = g.berthIdsOfStation?.(id) ?? [];
			if (berths.length)
				return {
					id,
					berth: berths[0],
					name: byId[id]?.name ?? id,
					berths: berths.length,
				};
		}
		window.__tuningStationIds = ids;
		return undefined;
	};
	panel.addEventListener("click", async (event) => {
		const act = event.target.dataset?.act;
		if (act === "save") window.__tuningSaved = true;
		if (!act || act === "save") return;
		const selected = document.getElementById("station")?.value;
		const berth = document.getElementById("berth")?.value;
		const target =
			selected && berth
				? { id: selected, berth, name: selected }
				: stationWithBerths();
		if (!target) {
			setStatus(
				`no berth found — station ids seen: ${(window.__tuningStationIds ?? []).join(", ") || "none"}`,
			);
			return;
		}
		setStatus(
			`${act === "dock" ? "parking" : "launching"} at ${target.id} · ${target.berth}…`,
		);
		try {
			await window.__parkInBerth(target.id, target.berth, {
				launch: act === "launch",
			});
			g.setHeadLook?.("forward");
			g.updateCockpit?.();
			setStatus(
				`${act} — ${target.id} · ${target.berth}, dockPhase ${g.dockPhase}`,
			);
		} catch (error) {
			setStatus(`${act} failed: ${String(error).slice(0, 120)}`);
		}
		// A docked or launched session rebuilds the cabin's mirrored lamps, so the
		// figures have to be re-applied to whatever the new scene holds.
		apply();
	});
	const entries = roster();
	window.__tuningRoster = entries.map(
		(e) => `${e.type} ${e.id} [${e.berths.join(",")}]`,
	);
	if (entries.length) {
		const picks = document.getElementById("picks");
		picks.innerHTML =
			'<label style="display:block">station <select id="station" style="width:100%;margin:2px 0;font:inherit;background:#1a1f26;color:#dfe6ee"></select></label>' +
			'<label style="display:block">berth <select id="berth" style="width:100%;margin:2px 0;font:inherit;background:#1a1f26;color:#dfe6ee"></select></label>';
		const station = document.getElementById("station");
		const berth = document.getElementById("berth");
		station.innerHTML = entries
			.map((e) => `<option value="${e.id}">${e.type} · ${e.id}</option>`)
			.join("");
		const fillBerths = () =>
			(berth.innerHTML = entries
				.find((e) => e.id === station.value)
				.berths.map((b) => `<option>${b}</option>`)
				.join(""));
		station.addEventListener("change", fillBerths);
		fillBerths();
	}
	apply();

	const canvas = g.renderer.domElement;
	const off = new OffscreenCanvas(canvas.width, canvas.height);
	const context = off.getContext("2d", { willReadFrequently: true });
	const tick = () => {
		try {
			context.drawImage(canvas, 0, 0);
			const data = context.getImageData(0, 0, off.width, off.height).data;
			const values = [];
			let white = 0;
			for (let y = Math.floor(off.height * 0.1); y < off.height * 0.9; y += 3)
				for (
					let x = Math.floor(off.width * 0.05);
					x < off.width * 0.95;
					x += 3
				) {
					const i = (y * off.width + x) * 4;
					const v =
						0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
					values.push(v);
					if (v > 250) white++;
				}
			values.sort((a, b) => a - b);
			const q = (f) => values[Math.floor(values.length * f)].toFixed(0);
			const mean = (values.reduce((s, v) => s + v, 0) / values.length).toFixed(
				1,
			);
			window.__tuningReadout = `mean ${mean}  q25 ${q(0.25)}  median ${q(0.5)}  p95 ${q(0.95)}\nblown ${((white / values.length) * 100).toFixed(2)}%`;
		} catch {
			/* a scene switch can beat the readback; the next frame is fine */
		}
	};
	// Read back on the frame's own rAF, straight after the game has drawn into the
	// canvas: the game's context has no preserved drawing buffer, so reading at any
	// other moment reads a cleared canvas.
	const loop = () =>
		requestAnimationFrame(() => {
			tick();
			setTimeout(loop, 600);
		});
	loop();
}, starting);

console.error(
	"panel live. Sliders drive the live scene. `Dock at station` flies you in through the docking computer — it takes a few seconds.",
);
console.error("Press Save, or just tell me the numbers.\n");
let printed = "";
try {
	while (true) {
		await new Promise((resolve) => setTimeout(resolve, 5000));
		const state = await page.evaluate(() => ({
			figures: window.__tuningFigures,
			readout: window.__tuningReadout ?? "measuring…",
			status: document.getElementById("status")?.textContent ?? "",
			roster: window.__tuningRoster ?? [],
			saved: window.__tuningSaved === true,
		}));
		const json = JSON.stringify(state.figures, null, 2);
		if (state.saved && json !== printed) {
			printed = json;
			writeFileSync(SAVED, json);
			console.error(`--- saved to ${SAVED} ---\n${json}\n`);
			if (state.roster.length)
				console.error(`stations: ${state.roster.join(" | ")}`);
		}
		const f = state.figures;
		console.error(
			`cast ${f.castIntensity} reach ${f.castRangeKm} strips ×${f.stripGain} | console ×${f.consoleGain} station ×${f.stationGain} sun ×${f.sunGain} hemi ×${f.hemiGain} fill ×${f.fillGain} exp ${f.exposure}\n  ${state.readout}${state.status ? `  |  ${state.status}` : ""}`,
		);
	}
} catch {
	const figures = await page.evaluate(() => window.__tuningFigures);
	writeFileSync(SAVED, JSON.stringify(figures, null, 2));
	console.error(`\nfinal figures:\n${JSON.stringify(figures, null, 2)}`);
	await browser.close();
}
