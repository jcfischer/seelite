import sharp from "sharp";

const W = 1536;
const H = 1024;
const F = 512 / Math.tan(Math.PI / 6);
const rows = [
	[16.2, 2.2, 6.5],
	[19.2, 2.2, 6.5],
	[22, 2.0, 6.2],
	[24.2, 1.8, 4.8],
];
const ring = (z, w, top) =>
	[
		[-w * 0.85, top],
		[-w, top - 0.35],
		[-w, 3.9],
		[-w * 0.85, 3.65],
		[w * 0.85, 3.65],
		[w, 3.9],
		[w, top - 0.35],
		[w * 0.85, top],
	].map(([x, y]) => [x, y, z]);
const R = rows.map((r) => ring(...r));
const quad = (seg, j, inset) => {
	const k = (j + 1) % 8;
	const q = [R[seg][j], R[seg][k], R[seg + 1][k], R[seg + 1][j]];
	const c = [0, 1, 2].map((i) => q.reduce((s, p) => s + p[i], 0) / 4);
	return q.map((p) => p.map((v, i) => c[i] + (v - c[i]) * inset));
};
const project = (eye) => (p) => {
	const X = -p[0] + eye[0];
	const Y = p[1] - eye[1];
	const D = p[2] - eye[2];
	return [W / 2 + (X / D) * F, H / 2 - (Y / D) * F];
};
const path = (pts, eye) =>
	`M${pts
		.map(project(eye))
		.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`)
		.join(" L")} Z`;
const outlines = (eye, sets) =>
	sets
		.map(({ quads, colour, dash }) =>
			quads
				.map(
					(q) =>
						`<path d="${path(q, eye)}" fill="none" stroke="${colour}" stroke-width="5" ${dash ? 'stroke-dasharray="18 10"' : ""}/>`,
				)
				.join(""),
		)
		.join("");
const label = (x, y, s, c) =>
	`<text x="${x}" y="${y}" fill="${c}" font-family="Menlo" font-size="30" stroke="#000" stroke-width="5" paint-order="stroke">${s}</text>`;
const right = [-0.6, 5.21, 20.2];
const left = [0.6, 5.21, 20.2];
const glazed = (inset) => [quad(2, 7, inset)];
const glazedAll = (inset) => [
	quad(2, 7, inset),
	...[0, 1, 2].flatMap((s) => [quad(s, 1, inset), quad(s, 5, inset)]),
];
const chin = [
	R[3][0],
	R[3][1],
	R[3][2],
	R[3][3],
	R[3][4],
	R[3][5],
	R[3][6],
	R[3][7],
];

const overlay = async (base, out, eye, sets, notes) => {
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${outlines(eye, sets)}${notes}</svg>`;
	const img = base
		? sharp(base).resize(W, H)
		: sharp({
				create: { width: W, height: H, channels: 3, background: "#0c1418" },
			});
	await img
		.composite([{ input: Buffer.from(svg) }])
		.png()
		.toFile(out);
};

const base = ".dream-loop/round-4b.png";
await overlay(
	base,
	".dream-loop/variants/v1-exterior-unchanged.png",
	right,
	[{ quads: glazed(0.74), colour: "#ff5a3c" }],
	label(
		30,
		980,
		"V1: approved glass (red). Interior gives back its top 3 deg and the side windows.",
		"#ffd0c0",
	),
);
await overlay(
	base,
	".dream-loop/variants/v2-reglazed.png",
	right,
	[
		{ quads: glazed(0.74), colour: "#ff5a3c" },
		{ quads: glazed(0.9), colour: "#5fe3ff", dash: true },
		{ quads: [chin], colour: "#6dff9a", dash: true },
	],
	label(
		30,
		940,
		"V2: red approved pane; cyan pane at 90% of facet;",
		"#e0f7ff",
	) +
		label(
			30,
			980,
			"green glazed front cap (chin window). Needs an exterior change.",
			"#e0f7ff",
		),
);
await overlay(
	null,
	".dream-loop/variants/v3-two-seat-left-eye.png",
	left,
	[
		{ quads: glazed(0.74), colour: "#ff5a3c" },
		{ quads: glazed(0.9), colour: "#5fe3ff", dash: true },
	],
	label(
		30,
		980,
		"V3 left seat: the same glass, mirrored (red approved, cyan 90%).",
		"#e0f7ff",
	),
);

const s = 90;
const ox = 760;
const oz = 60;
const pt = (x, z) => [ox - x * s, oz + (24.6 - z) * s];
const plan = [];
const outline = rows
	.map(([z, w]) => pt(w, z))
	.concat(
		rows
			.slice()
			.reverse()
			.map(([z, w]) => pt(-w, z)),
	);
plan.push(
	`<path d="M${outline.map((p) => p.join(",")).join(" L")} Z" fill="#1b262c" stroke="#9fb7c0" stroke-width="4"/>`,
);
const ws0 = pt(-1.7 * 0.74, 22.6);
const ws1 = pt(1.7 * 0.74, 22.6);
plan.push(
	`<line x1="${ws0[0]}" y1="${ws0[1]}" x2="${ws1[0]}" y2="${ws1[1]}" stroke="#5fe3ff" stroke-width="10"/>`,
);
const mull = pt(0, 22.6);
plan.push(`<circle cx="${mull[0]}" cy="${mull[1]}" r="9" fill="#ff5a3c"/>`);
for (const [x, name] of [
	[-0.6, "PILOT"],
	[0.6, "MINING OP"],
]) {
	const [sx, sz] = pt(x < 0 ? -0.68 : 0.68, 19.4);
	plan.push(
		`<rect x="${sx - 28}" y="${sz - 32}" width="56" height="64" fill="#3a4a55" stroke="#c9d3d6"/>`,
	);
	const e = pt(x, 20.2);
	plan.push(`<circle cx="${e[0]}" cy="${e[1]}" r="10" fill="#ffd27a"/>`);
	for (const t of [ws0, ws1])
		plan.push(
			`<line x1="${e[0]}" y1="${e[1]}" x2="${t[0]}" y2="${t[1]}" stroke="#ffd27a" stroke-width="2" stroke-dasharray="8 6"/>`,
		);
	plan.push(label(x < 0 ? e[0] + 40 : e[0] - 230, e[1] + 120, name, "#ffd27a"));
}
const bank = [pt(1.0, 21.9), pt(-1.0, 21.9)];
plan.push(
	`<line x1="${bank[0][0]}" y1="${bank[0][1]}" x2="${bank[1][0]}" y2="${bank[1][1]}" stroke="#6dff9a" stroke-width="14" opacity="0.7"/>`,
);
plan.push(
	label(
		40,
		60,
		"Plan, bridge from above. Nose up. Grid: real Longwall B bridge.",
		"#e0f7ff",
	),
);
plan.push(
	label(
		40,
		100,
		"Cyan: approved windscreen pane. Red dot: centre bar.",
		"#e0f7ff",
	),
);
plan.push(
	label(
		40,
		140,
		"Green: overhead mining bank, centred on the bridge.",
		"#e0f7ff",
	),
);
plan.push(
	label(
		40,
		980,
		"Inner width at the seats: 4.18 m. Seats 0.62 m, 1.36 m apart.",
		"#e0f7ff",
	),
);
await sharp({
	create: { width: W, height: H, channels: 3, background: "#0c1418" },
})
	.composite([
		{
			input: Buffer.from(
				`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${plan.join("")}</svg>`,
			),
		},
	])
	.png()
	.toFile(".dream-loop/variants/v3-two-seat-plan.png");
console.log("ok");
