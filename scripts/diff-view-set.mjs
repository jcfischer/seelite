/**
 * How much of each canonical frame actually changed between two runs.
 *
 *   npm run views -- --label before      # at the base ref
 *   npm run views -- --label after       # with the change
 *   npm run views -- --label after2      # again, same build — the control
 *   npm run views:diff                   # before → after
 *   npm run views:diff view-set after after2   # the noise floor
 *
 * **Not a gate, and it cannot become one.** #98 settled that a visual node
 * closes on the principal's yes to a contact sheet, and no number replaces that.
 * What this answers is the narrower question a `covers` claim rests on: *did
 * this frame move at all?* A view that is named as evidence for a lever and
 * comes back at 0.00% is not evidence for it, whatever is technically in the
 * frustum.
 *
 * That is exactly how #129 found that `station-approach` could not show lever
 * 102: it is on the aperture axis, and the aperture face is the one face a
 * station's clutter and ports are kept off. The figures in
 * `scripts/lib/view-set.mjs` come from here, and this file exists so a later
 * reader can re-run them instead of taking them.
 *
 * **The threshold is not enough on its own, and a run without the control is
 * worth very little.** 24/255 on the summed RGB difference removes dither and
 * the low bits, but it does not remove the largest term: the clock runs during
 * capture, so two runs of the *same build* frame a spinning station at different
 * phases. Measured on #129 — before→after against after→after2 of one build:
 *
 * | view | before → after | same build twice |
 * |---|---|---|
 * | `station-flank` | 2.09% | 1.05% |
 * | `cockpit-backlit` | 0.41% | 0.14% |
 * | `station-approach` | 0.55% | **0.55%** |
 * | `station-outline` | 0.05% | **0.05%** |
 * | `cockpit-arrival` | 0.02% | 0.02% |
 * | `hull-chase` | 0.01% | 0.01% |
 * | `sky-only` | 0.00% | 0.00% |
 *
 * A view whose before→after equals its same-build figure did not move. Reading
 * the first column alone would have called `station-approach`'s 0.55% a signal
 * a quarter the size of `station-flank`'s — and an earlier, quieter pair of
 * captures happened to read it as 0.01%, which would have been the right answer
 * for the wrong reason. **Always capture the third run.**
 *
 * `sky-only` is the other control, from the other side: no station, no hull, and
 * it reads 0.00% in both columns, so a figure of zero is reachable and the
 * instrument is not simply reporting noise everywhere.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PNG } from "pngjs";

const ROOT = process.argv[2] ?? "view-set";
const [A, B] = [process.argv[3] ?? "before", process.argv[4] ?? "after"];

/** Visible-difference threshold, summed across R, G and B. */
const VISIBLE = 24;

const views = readdirSync(join(ROOT, A))
	.filter((name) => name.endsWith(".png"))
	.map((name) => name.replace(/\.png$/, ""))
	.sort();

if (views.length === 0) {
	console.error(`no frames in ${join(ROOT, A)} — run \`npm run views\` first`);
	process.exit(1);
}

console.log(`${A} → ${B}, ${views.length} views, threshold ${VISIBLE}/255\n`);
for (const view of views) {
	const a = PNG.sync.read(readFileSync(join(ROOT, A, `${view}.png`)));
	const b = PNG.sync.read(readFileSync(join(ROOT, B, `${view}.png`)));
	if (a.width !== b.width || a.height !== b.height) {
		console.log(`${view.padEnd(20)} sizes differ — captured at two viewports`);
		continue;
	}
	let visible = 0;
	let any = 0;
	for (let i = 0; i < a.data.length; i += 4) {
		const d =
			Math.abs(a.data[i] - b.data[i]) +
			Math.abs(a.data[i + 1] - b.data[i + 1]) +
			Math.abs(a.data[i + 2] - b.data[i + 2]);
		if (d > 0) any++;
		if (d > VISIBLE) visible++;
	}
	const n = a.data.length / 4;
	console.log(
		`${view.padEnd(20)} moved >${VISIBLE}/255: ${((100 * visible) / n)
			.toFixed(2)
			.padStart(
				6,
			)}%   any change: ${((100 * any) / n).toFixed(2).padStart(6)}%`,
	);
}
