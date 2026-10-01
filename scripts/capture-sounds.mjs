/**
 * Render every cue to WAV at a labelled ref, and build the listening page —
 * the audio twin of `npm run views` (#552, after #542's D7).
 *
 *   npm run sounds -- --label before --ref origin/main
 *   npm run sounds -- --label after
 *   open sound-set/index.html
 *
 * A sound node closes on the principal's ear, the way a visual node closes on
 * the sheet: a probe can band a cue's level, onset and brightness, and it
 * cannot hear that the cue is right. This writes what the ear judges.
 *
 * ## Two refs, one command each
 *
 * With `--ref`, the ref is checked out into a throwaway detached worktree and
 * served from there, then removed. Without it, this checkout is served. Each
 * run starts its own vite server on a free port with its **own** dependency
 * cache, and runs alone: two servers sharing one `.vite` re-optimise against
 * each other and the page never boots. The server's tree declaration is read
 * back and must name the root this script served, so a capture cannot be of
 * the wrong tree.
 *
 * ## What is rendered
 *
 * `scripts/lib/sound-set.mjs`'s list, through `renderInPage`: offline, at
 * 48 kHz, after half a second of the engine running silent, with a fixed seed.
 * The seed is what makes the pair comparable sample for sample: the engine
 * draws its noise from `Math.random()` (#542 D6), and two builds that draw the
 * same numbers in the same order render the same noise. The engine before
 * #552 is reached through its own `ensure()` (`renderInPage` says how).
 *
 * `SEED` (default 552) picks the stream; `SEED=off` renders with the engine's
 * own randomness, which is what a player hears. `--out` moves the folder, and
 * `--only a,b` renders just those entries.
 *
 * ## Not a probe
 *
 * It asserts nothing and exits 0 when it wrote every cue the served engine can
 * play; an entry newer than the ref is logged as absent. `sound-set/` is
 * gitignored: before/after is two runs at two refs, not a baseline in git.
 */
import { execFileSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	realpathSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { cueStats, roundStats } from "./lib/audio-stats.mjs";
import { CLASSICAL_SET, renderInPage, SOUND_SET } from "./lib/sound-set.mjs";
import { TREE_ENDPOINT } from "./lib/tree-declaration.mjs";
import { launchChromium } from "./probe-guard.mjs";

const HERE = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SR = 48000;

function arg(name) {
	const at = process.argv.indexOf(`--${name}`);
	return at >= 0 ? process.argv[at + 1] : undefined;
}
const label = arg("label");
// `--only a,b`: render just those entries — a re-render of what one change
// moved, rather than the whole set.
const only = arg("only")?.split(",");
const ref = arg("ref");
// `--set classical`: #589's set-pieces instead of the cue set. They are a
// listening pass for the grilling, so no probe bands them.
const SET = arg("set") === "classical" ? CLASSICAL_SET : SOUND_SET;
const out = resolve(arg("out") ?? join(HERE, "sound-set"));
const seed =
	process.env.SEED === "off" ? null : Number(process.env.SEED ?? 552);
if (!label || !/^[\w.-]+$/.test(label)) {
	console.error("usage: npm run sounds -- --label <name> [--ref <git ref>]");
	process.exit(2);
}

const git = (...args) =>
	execFileSync("git", args, { cwd: HERE, encoding: "utf8" }).trim();

/** The tree to serve: this checkout, or a throwaway worktree at `ref`. */
let root = HERE;
let scratch = null;
let server = null;
let browser = null;
// Opened before the worktree is made, so a ref whose config will not load still
// has its worktree and scratch folder removed.
try {
	if (ref) {
		// Real path: macOS `tmpdir()` is under a symlinked `/var`. Served from the
		// unresolved path, the first capture failed in the page with "Unexpected
		// identifier 'ctx'" — TypeScript reaching the browser — and served from
		// the resolved one it renders.
		scratch = realpathSync(mkdtempSync(join(tmpdir(), "seelite-sounds-")));
		root = join(scratch, "tree");
		git("worktree", "add", "--detach", root, ref);
		// The dependencies are this checkout's. The cache is not: see the header.
		symlinkSync(join(HERE, "node_modules"), join(root, "node_modules"));
	}
	const sha = execFileSync("git", ["rev-parse", "HEAD"], {
		cwd: root,
		encoding: "utf8",
	}).trim();

	server = await createServer({
		root,
		configFile: join(root, "vite.config.ts"),
		// Never inside `node_modules`: in a worktree that is a symlink to the
		// primary checkout's, so two captures would share one cache.
		cacheDir: join(scratch ?? HERE, ".vite-sounds"),
		logLevel: "error",
		server: { port: 0, host: "127.0.0.1", strictPort: false },
	});
	await server.listen();
	const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
	const declared = await (await fetch(`${origin}${TREE_ENDPOINT}`)).json();
	if (realpathSync(declared.root) !== realpathSync(root))
		throw new Error(`served ${declared.root}, meant to serve ${root}`);

	browser = await launchChromium();
	const page = await browser.newPage();
	// Collected and thrown after the renders, inside this `try`, so the
	// throwaway worktree is still removed; a throw in the handler would not be.
	const pageErrors = [];
	page.on("pageerror", (e) => pageErrors.push(e));
	await page.goto(`${origin}${TREE_ENDPOINT}`);

	const dir = join(out, label);
	rmSync(dir, { recursive: true, force: true });
	mkdirSync(dir, { recursive: true });
	const entries = [];
	let modern = null;
	const chosen = only ? SET.filter((e) => only.includes(e.name)) : SET;
	if (only && chosen.length !== only.length) {
		const known = new Set(SET.map((e) => e.name));
		throw new Error(
			`--only names no entry: ${only.filter((n) => !known.has(n))}`,
		);
	}
	for (const entry of chosen) {
		const r = await page.evaluate(renderInPage, {
			entry,
			sampleRate: SR,
			seed,
		});
		modern ??= r.modern;
		// Nothing to play on this engine: an entry newer than the ref (#544).
		// Left out of the manifest, so the listening page shows it as absent.
		if (r.absent) {
			console.log(JSON.stringify({ label, name: entry.name, absent: true }));
			continue;
		}
		const file = `${entry.name}.wav`;
		writeFileSync(
			join(dir, file),
			r.right ? wav16([r.left, r.right], SR) : wav16([r.samples], SR),
		);
		const s = cueStats(r.samples, SR);
		const stats = {
			rms: s.rms,
			peak: s.peak,
			onsetMs: s.onsetMs,
			centroidHz: s.centroidHz,
		};
		entries.push({ name: entry.name, file, stats });
		console.log(
			JSON.stringify({ label, name: entry.name, ...roundStats(stats) }),
		);
	}
	if (pageErrors.length)
		throw new Error(
			`the page threw: ${pageErrors.map((e) => e.message).join("; ")}`,
		);
	const manifest = {
		label,
		ref: ref ?? "(this checkout)",
		sha,
		engine: modern ? "buses (#552)" : "single master (before #552)",
		seed,
		sampleRate: SR,
		at: new Date().toISOString(),
		entries,
	};
	writeFileSync(
		join(dir, "manifest.json"),
		JSON.stringify(manifest, null, "\t"),
	);
	writeFileSync(join(out, "index.html"), listeningPage(out));
	console.log(`wrote ${entries.length} of ${chosen.length} cues to ${dir}`);
	console.log(`open ${join(out, "index.html")}`);
} finally {
	await browser?.close();
	await server?.close();
	if (scratch && existsSync(root)) git("worktree", "remove", "--force", root);
	if (scratch) rmSync(scratch, { recursive: true, force: true });
}

/** 16-bit PCM, one channel per array: mono for a cue, stereo for music.
 *  The cues peak far below full scale, so 16 bits lose nothing an ear can
 *  hear, and every browser plays it. */
function wav16(channels, sampleRate) {
	const n = channels.length;
	const len = channels[0].length;
	const data = Buffer.alloc(len * n * 2);
	for (let i = 0; i < len; i++)
		for (let c = 0; c < n; c++) {
			const v = Math.max(-1, Math.min(1, channels[c][i]));
			data.writeInt16LE(Math.round(v * 32767), (i * n + c) * 2);
		}
	const head = Buffer.alloc(44);
	head.write("RIFF", 0);
	head.writeUInt32LE(36 + data.length, 4);
	head.write("WAVE", 8);
	head.write("fmt ", 12);
	head.writeUInt32LE(16, 16);
	head.writeUInt16LE(1, 20);
	head.writeUInt16LE(n, 22);
	head.writeUInt32LE(sampleRate, 24);
	head.writeUInt32LE(sampleRate * 2 * n, 28);
	head.writeUInt16LE(2 * n, 32);
	head.writeUInt16LE(16, 34);
	head.write("data", 36);
	head.writeUInt32LE(data.length, 40);
	return Buffer.concat([head, data]);
}

/**
 * The listening page: every label captured so far, two chosen side by side,
 * cue by cue, with each render's figures and the second's ratio to the first.
 * Static, with the manifests inlined, so it opens from disk.
 */
function listeningPage(dir) {
	const manifests = readdirSync(dir, { withFileTypes: true })
		.filter(
			(d) => d.isDirectory() && existsSync(join(dir, d.name, "manifest.json")),
		)
		.map((d) =>
			JSON.parse(readFileSync(join(dir, d.name, "manifest.json"), "utf8")),
		)
		.sort((a, b) => a.at.localeCompare(b.at));
	const data = JSON.stringify(manifests).replaceAll("<", "\\u003c");
	return `<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sound set</title>
<style>
:root { color-scheme: light dark; --bg: #f6f5f2; --fg: #1d1d1b; --muted: #6b6a66; --rule: #d9d7d0; --warn: #a33b1f; }
@media (prefers-color-scheme: dark) { :root { --bg: #151514; --fg: #ecebe6; --muted: #9a9892; --rule: #34332f; --warn: #f08a6c; } }
body { margin: 0; padding: 16px; background: var(--bg); color: var(--fg); font: 14px/1.4 system-ui, sans-serif; }
h1 { font-size: 18px; margin: 0 0 4px; }
p { color: var(--muted); margin: 0 0 12px; max-width: 70ch; }
.pick { display: flex; gap: 16px; flex-wrap: wrap; margin-bottom: 12px; }
table { border-collapse: collapse; width: 100%; }
th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--rule); vertical-align: middle; }
th { font-weight: 600; color: var(--muted); }
td.fig { font: 12px ui-monospace, monospace; color: var(--muted); white-space: nowrap; }
td.ratio { font: 12px ui-monospace, monospace; white-space: nowrap; }
.off { color: var(--warn); }
audio { width: 220px; }
.meta { font: 12px ui-monospace, monospace; color: var(--muted); }
</style>
<h1>Sound set</h1>
<p>Every cue rendered offline at two refs. Play each pair and listen. The figures are a guide to where to listen; your ear gives the verdict. A ratio far from 1 is marked.</p>
<div class="pick">
  <label>A <select id="a"></select></label>
  <label>B <select id="b"></select></label>
</div>
<div class="meta" id="meta"></div>
<table>
  <thead><tr><th>Cue</th><th>A</th><th>B</th><th>A figures</th><th>B figures</th><th>B / A</th></tr></thead>
  <tbody id="rows"></tbody>
</table>
<script>
const SETS = ${data};
const a = document.getElementById("a"), b = document.getElementById("b");
for (const sel of [a, b]) for (const m of SETS) sel.add(new Option(m.label, m.label));
// The newest two, newest as B (#560): the first two hid a third capture's rows.
b.selectedIndex = SETS.length - 1; a.selectedIndex = Math.max(0, SETS.length - 2);
const fig = (s) => s ? "rms " + s.rms.toFixed(4) + "  peak " + s.peak.toFixed(3) + "  onset " + s.onsetMs.toFixed(1) + " ms  " + Math.round(s.centroidHz) + " Hz" : "—";
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
function draw() {
  const A = SETS.find((m) => m.label === a.value), B = SETS.find((m) => m.label === b.value);
  document.getElementById("meta").textContent = [A, B].map((m) => m.label + ": " + m.ref + " @ " + m.sha.slice(0, 8) + ", " + m.engine + ", seed " + m.seed).join("   |   ");
  const names = [...new Set([...A.entries, ...B.entries].map((e) => e.name))];
  document.getElementById("rows").innerHTML = names.map((n) => {
    const ea = A.entries.find((e) => e.name === n), eb = B.entries.find((e) => e.name === n);
    const player = (m, e) => e ? '<audio controls preload="none" src="' + esc(m.label + "/" + e.file) + '"></audio>' : "—";
    let ratio = "—";
    if (ea && eb) {
      const r = eb.stats.rms / ea.stats.rms, c = eb.stats.centroidHz / ea.stats.centroidHz, d = eb.stats.onsetMs - ea.stats.onsetMs;
      const mark = (ok, t) => '<span class="' + (ok ? "" : "off") + '">' + t + "</span>";
      ratio = mark(Math.abs(r - 1) < 0.05, "rms x" + r.toFixed(3)) + "  " + mark(Math.abs(c - 1) < 0.05, "centroid x" + c.toFixed(3)) + "  " + mark(Math.abs(d) < 10, "onset " + (d >= 0 ? "+" : "") + d.toFixed(1) + " ms");
    }
    return "<tr><td>" + esc(n) + "</td><td>" + player(A, ea) + "</td><td>" + player(B, eb) + '</td><td class="fig">' + fig(ea && ea.stats) + '</td><td class="fig">' + fig(eb && eb.stats) + '</td><td class="ratio">' + ratio + "</td></tr>";
  }).join("");
}
a.onchange = b.onchange = draw;
if (SETS.length) draw();
</script>
`;
}
