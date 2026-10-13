/**
 * Node #952: build the gallery's contact sheet from `capture.mjs`'s output.
 *
 *   node spikes/asteroid-gallery-952/build-sheet.mjs && open spikes/asteroid-gallery-952/gallery/index.html
 *
 * Refuses a sheet with a hole: every field × view × arm in the manifest must
 * have its file. Level changes are cut from the transition frames: for each
 * direction, the largest on-screen rocks whose level changed between two
 * consecutive frames, one pair per kind of change (L0↔L1, L1↔L2, L2↔point).
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const OUT = process.env.OUT ?? "spikes/asteroid-gallery-952/gallery";
const DSF = 2;
const CROP = 200; // CSS px square around the rock
const MIN_PX = 4; // a rock smaller than this (physical px radius) is not judged
const m = JSON.parse(readFileSync(join(OUT, "manifest.json"), "utf8"));
const missing = m.fields.flatMap((f) =>
	f.views.filter((v) => !existsSync(join(OUT, v.file))).map((v) => v.file),
);
if (missing.length)
	throw new Error(`sheet refused, missing: ${missing.join(", ")}`);

const LEVEL = ["L0", "L1", "L2", "point"];
const ARM_LABEL = {
	"none@high": "no field (high)",
	"batch-k@high": "before: procedural K=16 (high)",
	"batch-authored@high": "after: authored (high)",
	"batch-authored@low": "after: authored (low)",
};
const VIEW_LABEL = {
	far: "far: from the refinery (charted) or 200 km sunward (rare)",
	approach: "approach: 16 km off the long axis' end, toward the refinery",
	edge: "edge: 2 km off the end of the long axis, along it",
	inside: "inside: a cell corner near the centre, down the long axis",
	near: "near: the largest rock at 3 radii, sunlit side",
	backdrop:
		"backdrop: behind the field, looking through it toward the refinery",
};

function events(dir, steps) {
	const frames = JSON.parse(
		readFileSync(join(OUT, dir, "frames.json"), "utf8"),
	);
	const found = { in: [], out: [] };
	for (let n = 1; n < frames.length; n++) {
		const a = frames[n - 1];
		const b = frames[n];
		if (!a.levels || !b.levels) continue;
		const direction = n <= steps ? "in" : "out";
		for (let i = 0; i < b.levels.length; i++) {
			if (a.levels[i] === b.levels[i]) continue;
			const r = b.rocks[i];
			if (!r.front || r.px < MIN_PX) continue;
			if (r.x < CROP / 2 || r.y < CROP / 2) continue;
			if (
				r.x > m.viewport.width - CROP / 2 ||
				r.y > m.viewport.height - CROP / 2
			)
				continue;
			found[direction].push({
				n,
				slot: r.slot,
				from: LEVEL[a.levels[i]],
				to: LEVEL[b.levels[i]],
				px: r.px,
				x: r.x,
				y: r.y,
				prev: a.name,
				next: b.name,
			});
		}
	}
	const pick = (list) => {
		const byKind = new Map();
		for (const e of list.sort((p, q) => q.px - p.px)) {
			const k = `${e.from}→${e.to}`;
			if (!byKind.has(k)) byKind.set(k, e);
		}
		return [...byKind.values()];
	};
	return {
		in: pick(found.in),
		out: pick(found.out),
		counts: { in: found.in.length, out: found.out.length },
	};
}

function crop(dir, frame, e, tag) {
	mkdirSync(join(OUT, "pairs"), { recursive: true });
	const file = `pairs/${dir}-${tag}-${e.n}-${e.slot}.jpg`;
	const s = CROP * DSF;
	const x = Math.round(e.x * DSF - s / 2);
	const y = Math.round(e.y * DSF - s / 2);
	execFileSync("magick", [
		join(OUT, dir, frame),
		"-crop",
		`${s}x${s}+${x}+${y}`,
		"+repage",
		join(OUT, file),
	]);
	return file;
}

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");
let html = `<!doctype html><meta charset="utf-8"><title>Asteroid field gallery</title>
<style>
:root{--bg:#111;--fg:#ddd;--mute:#999}
body{background:var(--bg);color:var(--fg);font:14px system-ui;margin:16px}
h1{font-size:20px}h2{margin-top:32px;font-size:17px}h3{font-size:14px;color:var(--mute);font-weight:500}
.row{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-bottom:14px}
figure{margin:0}img{width:100%;display:block;cursor:zoom-in}figcaption{color:var(--mute);font-size:12px;padding:2px 0}
.pairs{display:flex;flex-wrap:wrap;gap:14px}.pair{display:flex;gap:4px}.pair img{width:200px}
video{width:48%;margin-right:1%}p{max-width:900px;color:var(--mute)}
</style>
<h1>Asteroid field gallery (node #952)</h1>
<p>Spike gallery, not the canonical view set. World 0x5ee11e, galaxy 0. Every field is drawn at its charted position in its own system, at a held clock, 1440×900 at device scale 2, chase view, on the GPU lane. Same pose, seed and clock in every column. The in-game exposure is unchanged: the 0.85 exposure approved on #953 was a setting of the standalone viewer only. Click an image to open it at full size.</p>`;
for (const f of m.fields) {
	html += `<h2>${esc(f.key)} · ${esc(f.system)} (${esc(f.note)}), ${esc(f.plan.kind)}${f.plan.hostId && f.refineryKm ? `, refinery ${f.refineryKm.toFixed(0)} km` : ""}, rock radius ${f.radiiM[0]}–${f.radiiM[1]} m</h2>`;
	const views = [...new Set(f.views.map((v) => v.view))];
	for (const view of views) {
		html += `<h3>${esc(VIEW_LABEL[view] ?? view)}</h3><div class="row">`;
		for (const v of f.views.filter((x) => x.view === view))
			html += `<figure><a href="${v.file}" target="_blank"><img loading="lazy" src="${v.file}"></a><figcaption>${esc(ARM_LABEL[v.arm] ?? v.arm)}</figcaption></figure>`;
		html += "</div>";
	}
	for (const t of f.transitions ?? []) {
		const ev = events(t.dir, t.steps);
		html += `<h3>LOD transitions, ${esc(ARM_LABEL[t.arm] ?? t.arm)}: flown in from 8 km outside the long axis' end to the centre, then out on the same line (${t.steps} steps each way). Level changes on rocks ≥ ${MIN_PX} px radius: ${ev.counts.in} in, ${ev.counts.out} out.</h3>`;
		html += `<video controls src="${t.dir}-in.mp4"></video><video controls src="${t.dir}-out.mp4"></video>`;
		for (const d of ["in", "out"]) {
			html += `<h3>${d === "in" ? "Inbound (stepping up)" : "Outbound (stepping down, at the hysteresis edge)"}: frame before | frame after, ${CROP}×${CROP} px around the rock</h3><div class="pairs">`;
			for (const e of ev[d]) {
				const a = crop(t.dir, e.prev, e, "a");
				const b = crop(t.dir, e.next, e, "b");
				html += `<figure><div class="pair"><img src="${a}"><img src="${b}"></div><figcaption>${e.from} → ${e.to}, rock ${e.slot}, ${e.px.toFixed(1)} px radius, frame ${e.n}</figcaption></figure>`;
			}
			if (!ev[d].length)
				html += "<p>No judgeable level change in this direction.</p>";
			html += "</div>";
		}
	}
}
writeFileSync(join(OUT, "index.html"), html);
console.log(`sheet: ${join(OUT, "index.html")}`);
