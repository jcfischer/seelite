// Fixture faces for the miner cockpit study's screen-* quads (#1143). The game
// mounts its live HUD on these quads; the study renders fixed values instead.
// Usage: node spikes/miner-cockpit/screens.mjs
import { mkdir } from "node:fs/promises";
import sharp from "sharp";

const out = "spikes/miner-cockpit/screens";
await mkdir(out, { recursive: true });

const CYAN = "#5fe3ff";
const AMBER = "#ffb347";
const GREEN = "#6dff9a";
const PALE = "#d8f6ff";
const font = "Menlo, monospace";

const frame = (
	w,
	h,
	colour,
	body,
) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
<rect width="${w}" height="${h}" fill="#02080b"/>
<rect x="10" y="10" width="${w - 20}" height="${h - 20}" fill="none" stroke="${colour}" stroke-width="4" opacity="0.9"/>
${body}</svg>`;
const text = (x, y, s, colour, size, anchor = "start", extra = "") =>
	`<text x="${x}" y="${y}" fill="${colour}" font-family="${font}" font-size="${size}" text-anchor="${anchor}" ${extra}>${s}</text>`;
const title = (w, s, colour) =>
	text(w / 2, 62, s, colour, 40, "middle") +
	`<line x1="40" y1="80" x2="${w - 40}" y2="80" stroke="${colour}" stroke-width="3" opacity="0.7"/>`;

const W = 560;
const H = 380;
const big = (x, y, s, c, size = 50, anchor = "start") =>
	text(x, y, s, c, size, anchor);
const head = (s) => text(W / 2, 70, s, PALE, 38, "middle");
const faces = {
	survey: frame(
		W,
		H,
		CYAN,
		head("SURVEY") +
			big(70, 190, "GRADE", PALE) +
			big(400, 195, "A", GREEN, 60) +
			big(70, 290, "DEPOSIT", PALE) +
			big(380, 295, "LRG", GREEN, 56),
	),
	ore: frame(
		W,
		H,
		PALE,
		head("ORE / HOLD") +
			big(110, 190, "ORE", PALE) +
			big(310, 190, "12T", AMBER, 56) +
			big(110, 290, "HOLD", PALE) +
			big(310, 290, "60T", AMBER, 56),
	),
	drill: frame(
		W,
		H,
		PALE,
		head("DRILL CONTACT") +
			big(W / 2, 195, "NO", "#ff4a3a", 60, "middle") +
			big(W / 2, 295, "GAP 0.3 M", PALE, 50, "middle"),
	),
	anchor: frame(
		W,
		H,
		PALE,
		head("ANCHOR") + big(W / 2, 230, "FOUR GRIPPED", AMBER, 54, "middle"),
	),
	lasers: frame(
		W,
		H,
		CYAN,
		head("LASERS PORT / STBD") +
			big(40, 160, "HEAT 20%", AMBER, 40) +
			big(60, 230, "ENERGY", PALE, 38) +
			big(110, 295, "80%", GREEN, 44) +
			`<line x1="${W / 2}" y1="115" x2="${W / 2}" y2="330" stroke="${PALE}" stroke-width="3"/>` +
			big(300, 160, "HEAT 22%", AMBER, 40) +
			big(320, 230, "ENERGY", PALE, 38) +
			big(370, 295, "78%", GREEN, 44),
	),
	flight: frame(
		660,
		360,
		CYAN,
		text(50, 80, "REL. VELOCITY", PALE, 30, "start", 'font-style="italic"') +
			text(50, 190, "0.005 km/s", PALE, 72, "start", 'font-style="italic"') +
			text(
				50,
				290,
				"FIELD FRAME · INERTIAL 11 km/s",
				PALE,
				26,
				"start",
				'font-style="italic"',
			),
	),
	target: frame(
		680,
		480,
		AMBER,
		text(50, 80, "TARGET", "#fff2d8", 34) +
			text(50, 130, "STATION · TRADE", "#fff2d8", 34) +
			text(
				50,
				230,
				"XEUSVE  2.736 AU",
				"#ffffff",
				64,
				"start",
				'xml:space="preserve"',
			) +
			text(
				50,
				340,
				"ETA 2369d  REL 37.70 km/s",
				"#fff2d8",
				32,
				"start",
				'xml:space="preserve"',
			),
	),
	status: `<svg xmlns="http://www.w3.org/2000/svg" width="1400" height="90"><rect width="1400" height="90" fill="#02080b"/>
${["MODE|NORMAL|40", "THR|0%|430", "ASSIST|ON|670", "CHARGE|10.0/10 AU|960"]
	.map((s) => {
		const [k, v, x] = s.split("|");
		return text(
			x,
			60,
			`<tspan font-size="28" fill="#9fb7c0">${k}</tspan><tspan dx="14">${v}</tspan>`,
			"#e8f6ff",
			38,
		);
	})
	.join("")}</svg>`,
};
const label = (
	s,
) => `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="64"><rect width="1200" height="64" fill="#0b1114"/>
${text(600, 46, s, "#c9d3d6", 40, "middle", 'letter-spacing="10" font-weight="bold"')}</svg>`;
const leg = (x1, y1, x2, y2) =>
	`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${CYAN}" stroke-width="5"/><circle cx="${x2}" cy="${y2}" r="12" fill="${GREEN}"/>`;
faces.stance = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="540"><rect width="400" height="540" fill="#02080b"/>
<rect x="10" y="10" width="380" height="520" fill="none" stroke="${CYAN}" stroke-width="4"/>
${text(200, 58, "SHIP STANCE", PALE, 34, "middle")}
<rect x="170" y="110" width="60" height="330" rx="10" fill="none" stroke="${CYAN}" stroke-width="5"/>
<rect x="150" y="150" width="100" height="60" fill="none" stroke="${CYAN}" stroke-width="3"/>
<rect x="150" y="240" width="100" height="60" fill="none" stroke="${CYAN}" stroke-width="3"/>
<rect x="150" y="330" width="100" height="60" fill="none" stroke="${CYAN}" stroke-width="3"/>
<circle cx="200" cy="96" r="22" fill="none" stroke="${AMBER}" stroke-width="5"/>
${leg(175, 140, 70, 90)}${leg(225, 140, 330, 90)}${leg(175, 190, 60, 230)}${leg(225, 190, 340, 230)}
${text(200, 500, "4/4 FEET GRIPPED", GREEN, 28, "middle")}</svg>`;
faces["label-flight"] = label("FLIGHT / RELATIVE");
faces["label-radar"] = label("SCOPE / RANGE SELECT");
faces["label-target"] = label("NAVIGATION COMPUTER");

const rings = [50, 100, 150, 200, 250]
	.map(
		(r) =>
			`<ellipse cx="500" cy="380" rx="${r * 1.45}" ry="${r}" fill="none" stroke="${AMBER}" stroke-width="2" opacity="0.85"/>`,
	)
	.join("");
faces.radar = `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="720"><rect width="1000" height="720" fill="#020607"/>
${rings}<line x1="500" y1="40" x2="500" y2="700" stroke="${AMBER}" stroke-width="2" opacity="0.8"/>
<line x1="40" y1="380" x2="960" y2="380" stroke="${AMBER}" stroke-width="1.5" opacity="0.35"/>
<path d="M490 380 H510 M500 370 V390" stroke="${PALE}" stroke-width="3"/></svg>`;

for (const [name, svg] of Object.entries(faces))
	await sharp(Buffer.from(svg)).png().toFile(`${out}/${name}.png`);
console.log(Object.keys(faces).join(" "));
