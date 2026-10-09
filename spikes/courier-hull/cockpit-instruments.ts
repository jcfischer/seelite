// Copied from the authored courier cockpit viewer at d0848ad. Static inspection fixture.
import * as THREE from "three";

export function makeDisplay(kind: string) {
	const canvas = document.createElement("canvas");
	canvas.width = 1024;
	canvas.height = kind === "systems" ? 300 : 700;
	const ctx = canvas.getContext("2d")!;
	const w = canvas.width,
		h = canvas.height;
	ctx.fillStyle = "#01090b";
	ctx.fillRect(0, 0, w, h);
	const color = kind === "flight" || kind === "systems" ? "#62e5ee" : "#ffc263";
	ctx.strokeStyle = color;
	ctx.fillStyle = color;
	ctx.lineWidth = 2;
	ctx.shadowColor = color;
	ctx.shadowBlur = 5;
	ctx.font = "26px monospace";
	const text = (s: string, x: number, y: number, size = 26) => {
		ctx.font = `${Math.round(size * 1.35)}px monospace`;
		ctx.fillText(s, x, y);
	};
	const line = (x: number, y: number, x1: number, y1: number) => {
		ctx.beginPath();
		ctx.moveTo(x, y);
		ctx.lineTo(x1, y1);
		ctx.stroke();
	};
	const ship = (x: number, y: number, scale = 1) => {
		ctx.save();
		ctx.translate(x, y);
		ctx.scale(scale, scale);
		ctx.beginPath();
		ctx.moveTo(0, -100);
		ctx.lineTo(65, 70);
		ctx.lineTo(35, 90);
		ctx.lineTo(0, 65);
		ctx.lineTo(-35, 90);
		ctx.lineTo(-65, 70);
		ctx.closePath();
		ctx.stroke();
		line(0, -100, 0, 65);
		line(-50, 20, 50, 20);
		line(-65, 70, 65, 70);
		for (const s of [-1, 1]) ctx.strokeRect(s * 80 - 13, -15, 26, 95);
		ctx.restore();
	};
	if (kind === "radar") {
		text("LOCAL / 5 KM", 34, 42, 20);
		text("ASSIST ON", 780, 42, 20);
		ctx.save();
		ctx.translate(w / 2, h * 0.52);
		ctx.scale(1, 0.67);
		for (const r of [75, 150, 230, 310, 405]) {
			ctx.beginPath();
			ctx.arc(0, 0, r, 0, Math.PI * 2);
			ctx.stroke();
		}
		line(-425, 0, 425, 0);
		line(0, -425, 0, 425);
		ctx.restore();
		for (const [x, y] of [
			[270, 400],
			[630, 330],
			[720, 410],
		]) {
			ctx.fillRect(x, y, 7, 7);
			line(x + 3, y, x + 3, y - 45);
		}
		ctx.strokeStyle = "#77e8ef";
		ship(w / 2, h * 0.51, 0.33);
		ctx.strokeStyle = color;
		text("MODE NORMAL   THR 0%   CHARGE 12.0 AU", 38, h - 25, 21);
	} else if (kind === "flight") {
		text("REL. VELOCITY", 42, 65, 28);
		text("0.000", 42, 170, 66);
		text("km/s", 300, 166, 35);
		for (let i = 0; i < 13; i++) ctx.fillRect(44 + i * 26, 205, 18, 20);
		line(40, 270, 530, 270);
		text("STATION FRAME", 42, 330, 26);
		text("INERTIAL 29 km/s", 42, 388, 26);
		text("ASSIST ON", 42, 470, 23);
		text("FUEL 7.0 LY", 42, 530, 23);
		ship(760, 310, 1.75);
	} else if (kind === "systems") {
		["SYS", "ENG", "WEP"].forEach((s, i) => {
			text(s, 45, 68 + i * 76, 30);
			for (let k = 0; k < 6; k++)
				ctx.fillRect(150 + k * 28, 45 + i * 76, 19, 27);
		});
		ship(750, 145, 0.85);
	} else {
		text("TARGET", 42, 70, 26);
		text("STATION · TRADE", 42, 135, 25);
		text("ARTEQUGE", 42, 235, 44);
		text("2.2 km", 710, 235, 34);
		line(42, 305, 975, 305);
		text("REL V  0.00 km/s", 42, 374, 25);
		text("CLEARANCE  NONE", 42, 440, 25);
		text("NAV / DOCK / COMMS", 42, 535, 22);
	}
	ctx.shadowBlur = 0;
	ctx.globalAlpha = 0.09;
	ctx.fillStyle = "#000";
	for (let y = 0; y < h; y += 4) ctx.fillRect(0, y, w, 1);
	ctx.globalAlpha = 1;
	const texture = new THREE.CanvasTexture(canvas);
	texture.colorSpace = THREE.SRGBColorSpace;
	texture.anisotropy = 8;
	texture.flipY = false;
	return new THREE.MeshBasicMaterial({ map: texture, toneMapped: false });
}
