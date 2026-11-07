import { existsSync, readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { median } from "../../scripts/lib/measurement.mjs";

const out = resolve(process.argv[2] ?? "/tmp/seelite-field-shape-1043-organic");
const read = (directory) => {
	const manifest = JSON.parse(
		readFileSync(join(out, directory, "manifest.json"), "utf8"),
	);
	if (manifest.errors.length) throw Error(`capture errors in ${directory}`);
	return manifest;
};
let rawWorldTimingRows = 0;
const sourceByKind = new Map();
const verifySource = (kind, directory, manifest) => {
	const hashes = manifest.sources;
	if (
		manifest.dirty !== false ||
		!/^[a-f0-9]{40}$/.test(manifest.head) ||
		!hashes ||
		Object.keys(hashes).length === 0 ||
		Object.values(hashes).some((hash) => !/^[a-f0-9]{64}$/.test(hash))
	)
		throw Error(`unclean or missing source provenance in ${directory}`);
	const signature = JSON.stringify({ head: manifest.head, hashes });
	if (sourceByKind.has(kind) && sourceByKind.get(kind) !== signature)
		throw Error(`mismatched ${kind} source head or hashes in ${directory}`);
	sourceByKind.set(kind, signature);
};
const world = [],
	navigation = [],
	sources = [];
for (const kind of ["charted", "rare"])
	for (const aa of [0, 2]) {
		const directory = `cost-${kind}-aa${aa}`,
			m = read(directory);
		verifySource("world", directory, m);
		rawWorldTimingRows += m.timing.rows.length;
		sources.push({
			directory,
			head: m.head,
			dirty: m.dirty,
			sourceHashes: m.sources,
		});
		for (const name of ["baseline", "organic"])
			for (const quality of ["high", "low"]) {
				const rows = m.timing.rows.filter(
					(r) => r.name === name && r.quality === quality,
				);
				const peak = rows.reduce((a, b) => (b.deltaMs > a.deltaMs ? b : a));
				world.push({
					kind,
					aa,
					name,
					quality,
					peakDeltaMs: peak.deltaMs,
					peakView: peak.view,
					occlusion: peak.occlusion,
					maxCalls: Math.max(...rows.map((r) => r.drawCalls)),
					dense: rows
						.filter((r) => r.view === "dense")
						.map((r) => ({
							occlusion: r.occlusion,
							deltaMs: r.deltaMs,
							calls: r.drawCalls,
						})),
					rawManifest: `${directory}/manifest.json`,
				});
			}
		const navDirectory = `nav-verified-${kind}-aa${aa}`,
			n = read(navDirectory);
		verifySource("Navigation", navDirectory, n);
		sources.push({
			directory: navDirectory,
			head: n.head,
			dirty: n.dirty,
			sourceHashes: n.sources,
		});
		for (const row of n.navigation) {
			if (
				row.setup.actualProjectionCallsPerFrame !== 1 ||
				row.setup.actualProjectedRockRowsPerFrame !== row.setup.rows ||
				!row.setup.missedRefreshDetected ||
				row.setup.domRows !== row.setup.rows
			)
				throw Error(`unverified Navigation work in ${navDirectory}`);
			if (
				row.samples.length !== 6 ||
				row.samples.some((s) => s.consumed !== row.setup.rows * 24)
			)
				throw Error(`incorrect timed row counts in ${navDirectory}`);
			const samples = row.samples.map((s) => s.ms);
			navigation.push({
				kind,
				aa,
				name: row.name,
				rows: row.setup.rows,
				domRows: row.setup.domRows,
				disabled: row.setup.disabled,
				medianMs: median(samples),
				minMs: Math.min(...samples),
				maxMs: Math.max(...samples),
				samples: row.samples,
				head: n.head,
				dirty: n.dirty,
				rawManifest: `${navDirectory}/manifest.json`,
			});
		}
	}
if (rawWorldTimingRows !== 160)
	throw Error(`expected 160 world timing rows, got ${rawWorldTimingRows}`);
writeFileSync(join(out, "world-summary.json"), JSON.stringify(world, null, 2));
writeFileSync(
	join(out, "navigation-summary.json"),
	JSON.stringify(navigation, null, 2),
);
writeFileSync(
	join(out, "summary-sources.json"),
	JSON.stringify(sources, null, 2),
);
const receipt = "docs/receipts/node-1043-organic-revision.md";
if (existsSync(receipt)) copyFileSync(receipt, join(out, "receipt.md"));
const correction =
	"Navigation correction: animate() calls render() and then updateCockpit(); render() does not own the refresh. cost-* Navigation entries time an explicit refresh plus render plus an additional navRows projection. Earlier nav-charted/nav-rare sets at b1e62e7a omit updateCockpit entirely and are invalid for live Navigation cost. Use nav-verified-* actual production projection counts and missing-refresh negative control. World-render rows remain valid. Original manifests are retained unchanged.\n";
writeFileSync(join(out, "NAVIGATION-CORRECTION.txt"), correction);
for (const kind of ["charted", "rare"])
	for (const aa of [0, 2])
		for (const directory of [`cost-${kind}-aa${aa}`, `nav-${kind}-aa${aa}`])
			if (existsSync(join(out, directory)))
				writeFileSync(
					join(out, directory, "NAVIGATION-CORRECTION.txt"),
					correction,
				);
const fmt = (n) => {
	if (!Number.isFinite(n)) throw Error("nonfinite report value");
	return n.toFixed(3);
};
let html = `<!doctype html><meta charset="utf-8"><title>Organic asteroid field — #1043</title><style>body{background:#101720;color:#eaf1fa;font:17px system-ui;margin:32px;max-width:1500px}a{color:#9cd0ff}.grid{display:grid;grid-template-columns:1fr 1fr;gap:18px}figure{margin:0}img{width:100%}p{max-width:1100px;line-height:1.5}h2{margin-top:34px}td,th{text-align:left;padding:9px;border-bottom:1px solid #456}table{border-collapse:collapse}</style><h1>Organic asteroid-field proposal — #1043</h1><p>Selected direction: continuous seeded positions in unequal asymmetric lobes, tapered density, open gaps and irregular silhouettes. Spatial buckets check complete drift envelopes after placement; they never supply layout cells. Retained numeric slots keep their production physical draws.</p><p><strong>Isolated prototype. No production integration or principal appearance approval.</strong> Close-view frame-cost failures remain. <a href="receipt.md">Review receipt</a> · <a href="summary-sources.json">Exact source/hash provenance</a>.</p><h2>Matched charted overview: baseline / organic</h2><div class="grid">`;
for (const name of ["baseline", "organic"])
	html += `<figure><a href="cost-charted-aa0/${name}-overview.png"><img src="cost-charted-aa0/${name}-overview-detail.png"></a><figcaption>${name}: directly captured detail crop, CSS [480,290,480,320]. Click for full 1440×900 DPR2 image; same camera (-110,-90,70) km.</figcaption></figure>`;
html += `</div><h2>Selected organic dense peak</h2><a href="cost-charted-aa0/organic-dense.png"><img style="max-width:1100px" src="cost-charted-aa0/organic-dense.png"></a><p>Candidate-targeted dense pose, with actual clearance and local population in the manifest. This is separate from common-camera comparisons.</p><h2>Paired views across seeds and field types</h2><ul>`;
for (const directory of [
	"cost-charted-aa0",
	"cost-charted-aa2",
	"cost-rare-aa0",
	"cost-rare-aa2",
	"seed47-charted",
	"seed47-rare",
	"seed7-charted",
	"seed7-rare",
])
	if (existsSync(join(out, directory, "manifest.json")))
		html += `<li><a href="${directory}/index.html">${directory}: full views and detail crops</a> · <a href="${directory}/manifest.json">actual source, camera, clock and samples</a></li>`;
html += `</ul><p><a href="first/index.html">Early organic/braided alternatives</a> are diagnostic working-source studies. Braided and the older geometric profiles are secondary/historical evidence.</p><h2>Retained render-cost limits</h2><p>Synchronous CPU+GPU render costs with readPixels drains, six reordered blocks per arm. Existing high/low limits remain 1.0/0.4 ms, with +12/+6 calls. Dense poses pass the sampled limits; AA2 and rare close poses fail. No speedup or production-affordability claim.</p><table><tr><th>Fixture/AA</th><th>Candidate</th><th>High / low peak Δms</th><th>Max added calls high / low</th></tr>`;
for (const kind of ["charted", "rare"])
	for (const aa of [0, 2])
		for (const name of ["baseline", "organic"]) {
			const high = world.find(
					(r) =>
						r.kind === kind &&
						r.aa === aa &&
						r.name === name &&
						r.quality === "high",
				),
				low = world.find(
					(r) =>
						r.kind === kind &&
						r.aa === aa &&
						r.name === name &&
						r.quality === "low",
				);
			html += `<tr><td>${kind}/${aa}</td><td>${name}</td><td>${fmt(high.peakDeltaMs)} / ${fmt(low.peakDeltaMs)}</td><td>${high.maxCalls} / ${low.maxCalls}</td></tr>`;
		}
html += `</table><p><a href="world-summary.json">World summary</a>. Shared close rows retain one common physical slot; largest-rock and dense stress rows target each candidate separately. Source and held starting clock are recorded per boot.</p><h2>Verified live Navigation work</h2><p>Each timed frame calls render() then updateCockpit(), matching their ownership in animate(). The actual production navRows method is counted inside timing; exactly one nonempty projection with every expected rock row is required. A missing-refresh mutant must fail. These are stationary synchronous render/cockpit-update costs; deferred browser style/layout/paint and advancing flight are outside the timer.</p><table><tr><th>Fixture/AA</th><th>Candidate / rows</th><th>Median [min,max] ms</th></tr>`;
for (const row of navigation)
	html += `<tr><td>${row.kind}/${row.aa}</td><td>${row.name} / ${row.rows}</td><td>${fmt(row.medianMs)} [${fmt(row.minMs)}, ${fmt(row.maxMs)}]</td></tr>`;
html += `</table><p><a href="navigation-summary.json">Navigation blocks</a>. No speedup or row-count penalty is inferred from overlapping or dispersed runs. Earlier cost-set Navigation entries include an extra projection; earlier nav-* sets omit the cockpit refresh and are invalid for live Navigation cost. Both remain retained, superseded diagnostics.</p><ul>`;
for (const kind of ["charted", "rare"])
	for (const aa of [0, 2])
		html += `<li><a href="nav-verified-${kind}-aa${aa}/manifest.json">Verified ${kind}/AA${aa} work counts and sources</a> · <a href="nav-verified-${kind}-aa${aa}/organic-navigation.png">actual organic cockpit</a></li>`;
html += `</ul><h2>Geometry and collision evidence</h2><p><a href="corpus.json">Three-seed count corpus</a> · <a href="query-cost.json">Arbitrary-anchor query/oracle samples</a>. Envelope thinning can bias the retained radius population; distribution and economy checks remain production gates. So do close-view budgets, shared production layout consumers, full flight/CCD, save-version migration, canonical views and principal approval.</p>`;
writeFileSync(join(out, "index.html"), html);
console.log(
	JSON.stringify({
		out,
		worldSummaryRows: world.length,
		rawWorldTimingRows,
		navigationArms: navigation.length,
		sources: sources.length,
	}),
);
