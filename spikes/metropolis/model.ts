import * as T from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { hullLoft } from "../../src/loft";
import { wheelRimGeometry } from "../../src/station-rim";
import { Pools, truss } from "../../src/station-fixtures";
import { createGrowthPlan, modulesAt, type GrowthModule } from "./growth";

const v = (x = 0, y = 0, z = 0) => new T.Vector3(x, y, z);
const box = new T.BoxGeometry(1, 1, 1);
type Materials = Record<string, T.MeshStandardMaterial>;
/** Batch detail by material within each independently attachable module. */
class Parts {
	pieces = new Map<string, T.BufferGeometry[]>();
	constructor(public mats: Materials) {}
	add(
		g: T.BufferGeometry,
		mat: string,
		p: T.Vector3 = v(),
		s: T.Vector3 = v(1, 1, 1),
		q = new T.Quaternion(),
	) {
		const geo = g.clone().applyMatrix4(new T.Matrix4().compose(p, q, s));
		// Lofts carry shader attributes for the game's procedural surface. This
		// study uses a texture material; merge only attributes that material reads.
		for (const name of Object.keys(geo.attributes))
			if (!["position", "normal", "uv"].includes(name))
				geo.deleteAttribute(name);
		const list = this.pieces.get(mat) ?? [];
		list.push(geo);
		this.pieces.set(mat, list);
	}
	box(
		mat: string,
		x: number,
		y: number,
		z: number,
		w: number,
		h: number,
		d: number,
		q?: T.Quaternion,
	) {
		this.add(box, mat, v(x, y, z), v(w, h, d), q);
	}
	bar(mat: string, a: T.Vector3, b: T.Vector3, w: number, d = w) {
		this.add(
			box,
			mat,
			a.clone().add(b).multiplyScalar(0.5),
			v(w, d, a.distanceTo(b)),
			new T.Quaternion().setFromUnitVectors(
				v(0, 0, 1),
				b.clone().sub(a).normalize(),
			),
		);
	}
	ring(mat: string, r: number, width: number, depth: number, z = 0) {
		const g = wheelRimGeometry(r - width, r, z, depth);
		const uv = g.getAttribute("uv");
		for (let i = 0; i < uv.count; i++)
			uv.setXY(i, uv.getX(i) / 200, uv.getY(i) / 200);
		this.add(g, mat);
		g.dispose();
	}
	finish(group: T.Group) {
		for (const [mat, gs] of this.pieces) {
			const merged = mergeGeometries(gs);
			if (!merged)
				throw Error(
					`Cannot merge ${mat}: ${JSON.stringify(gs.slice(0, 6).map((g) => Object.keys(g.attributes)))}`,
				);
			const mesh = new T.Mesh(merged, this.mats[mat]);
			mesh.castShadow = true;
			mesh.receiveShadow = true;
			group.add(mesh);
			gs.forEach((g) => g.dispose());
		}
	}
}

/** Profiled cylinder along Y, keeping the game's loft primitive. */
function drum(
	parts: Parts,
	mat: string,
	r: number,
	h: number,
	x = 0,
	y = 0,
	z = 0,
) {
	const g = hullLoft(
		[
			{ z: -h / 2, w: r * 0.87, h: r * 0.87, e: 2, hard: true },
			{ z: -h / 2 + Math.min(h * 0.12, 18), w: r, h: r, e: 2, hard: true },
			{ z: h / 2 - Math.min(h * 0.12, 18), w: r, h: r, e: 2, hard: true },
			{ z: h / 2, w: r * 0.87, h: r * 0.87, e: 2, hard: true },
		],
		{ segments: 48, subdivisions: 1 },
	);
	const uv = g.getAttribute("uv");
	for (let i = 0; i < uv.count; i++)
		uv.setXY(i, uv.getX(i) / 240, uv.getY(i) / 240);
	parts.add(
		g,
		mat,
		v(x, y, z),
		v(1, 1, 1),
		new T.Quaternion().setFromAxisAngle(v(1, 0, 0), Math.PI / 2),
	);
	g.dispose();
}
function windows(parts: Parts, r: number, y: number, n = 70, x = 0, z = 0) {
	for (let i = 0; i < n; i++) {
		const a = (i / n) * Math.PI * 2;
		const q = new T.Quaternion().setFromAxisAngle(v(0, 1, 0), Math.PI / 2 - a);
		parts.box(
			i % 7 === 0 ? "dark" : "light",
			x + Math.cos(a) * r,
			y,
			z + Math.sin(a) * r,
			5.2,
			4.5,
			1.3,
			q,
		);
	}
}
function tower(m: GrowthModule, mats: Materials) {
	const group = new T.Group();
	group.name = m.id;
	group.position.set(m.x, m.y, m.z);
	group.rotation.x = m.angle;
	const p = new Parts(mats),
		r = m.radius * [1, 0.83, 1.08, 0.91][m.tier % 4],
		h = m.height;
	drum(p, m.tier % 3 === 0 ? "skin" : "alloy", r, h - 6);
	// Mating neck spans the small visual separation between consecutive modules.
	drum(p, "alloy", 48, h + 2);
	for (let yy = -82; yy <= 82; yy += 82) {
		drum(p, "dark", r + 1.5, 10, 0, yy);
		windows(p, r + 2.3, yy, 52);
		drum(p, "bronze", r + 4, 2, 0, yy + 7);
	}
	for (let i = 0; i < 8; i++) {
		const a = (i * Math.PI) / 4;
		p.box(
			"bronze",
			Math.cos(a) * (r + 2),
			0,
			Math.sin(a) * (r + 2),
			2,
			h - 18,
			3,
			new T.Quaternion().setFromAxisAngle(v(0, 1, 0), -a),
		);
	}
	if (m.kind === "terrace") {
		for (const yy of [-88, 88]) {
			drum(p, "skin", r + 6, 27, 0, yy);
			drum(p, "dark", r + 7, 9, 0, yy - 2);
			windows(p, r + 8, yy, 120);
		}
	} else if (m.kind === "utilities") {
		for (const side of [-1, 1]) {
			p.box("dark", side * (r + 32), 0, 0, 48, 230, 75);
			for (let k = 0; k < 12; k++)
				p.box("bronze", side * (r + 57), -104 + k * 18, 0, 2, 5, 78);
		}
	} else if (m.kind === "exchange") {
		drum(p, "skin", r + 25, 35, 0, -h * 0.27);
		windows(p, r + 26, -h * 0.27, 100);
	}
	if (m.kind === "habitat" || m.kind === "exchange") {
		const flank = m.tier % 2 === 0 ? 1 : -1;
		p.box("skin", flank * r * 0.64, 12, r * 0.7, r * 0.7, 130, 78);
		for (const yy of [-36, -12, 12, 36, 60])
			for (let k = -2; k <= 2; k++)
				p.box("light", flank * r * 0.64 + k * 12, yy, r * 0.7 + 40, 5, 4, 2);
	}
	if (m.terminal) {
		p.bar(
			"dark",
			v(0, m.side * (h / 2 - 5), 0),
			v(0, m.side * (h / 2 + 120), 0),
			4,
		);
		for (const x of [-25, 25])
			p.bar(
				"bronze",
				v(x, m.side * (h / 2 - 5), 0),
				v(x, m.side * (h / 2 + 75), 0),
				2,
			);
	}
	p.finish(group);
	// Attached neighborhoods stand upright across front/back radial districts.
	if (m.kind !== "utilities" && (m.tier % 2 === 0 || m.terminal)) {
		const annex = new T.Group(),
			a = new Parts(mats);
		const flank = m.tier % 2 === 0 ? 1 : -1;
		const ax = flank * r * 0.6;
		drum(a, "skin", 78, 25, ax, 0, 45);
		drum(a, "dark", 80, 8, ax, -8, 45);
		windows(a, 81, 0, 44, ax, 45);
		drum(a, "alloy", 43, 160, ax, 85, 45);
		for (const yy of [35, 70, 105, 140]) windows(a, 44, yy, 28, ax, 45);
		drum(a, "skin", 52, 16, ax, 160, 45);
		a.bar("bronze", v(ax, 160, 45), v(ax, 225, 45), 3);
		a.finish(annex);
		annex.rotation.x = -m.angle;
		group.add(annex);
	}
	return group;
}
function lattice(into: T.Group, a: T.Vector3, b: T.Vector3, width: number) {
	const pools = new Pools();
	truss(pools, a, b, width, v(0, 1, 0));
	pools.emit(into, "lattice");
}

/** Pressurised access inside the load-bearing truss, with visible airlock collars. */
function corridor(p: Parts, a: T.Vector3, b: T.Vector3, width = 44) {
	const delta = b.clone().sub(a),
		length = delta.length();
	const q = new T.Quaternion().setFromUnitVectors(
		v(0, 0, 1),
		delta.clone().normalize(),
	);
	p.bar("skin", a, b, width, width);
	for (let d = 0; d <= length; d += Math.min(100, length)) {
		const center = a.clone().addScaledVector(delta, d / length);
		p.box("alloy", center.x, center.y, center.z, width + 9, width + 9, 10, q);
		const lamp = center.clone().add(v(width / 2 + 5, 0, 0).applyQuaternion(q));
		p.box("light", lamp.x, lamp.y, lamp.z, 2, 8, 16, q);
	}
}

function wheel(mats: Materials, r: number) {
	const root = new T.Group(),
		rotor = new T.Group(),
		p = new Parts(mats);
	rotor.name = "rotor";
	root.add(rotor);
	// Box-section rims and plates use trade E's shared loft construction.
	p.ring("skin", r, 195, 350);
	p.ring("dark", r - 60, 45, 353);
	p.ring("skin", r, 12, 380);
	p.ring("bronze", r - 186, 9, 380);
	for (let i = 0; i < 96; i++) {
		const a = (i / 96) * Math.PI * 2,
			ca = Math.cos(a),
			sa = Math.sin(a),
			q = new T.Quaternion().setFromAxisAngle(v(0, 0, 1), a);
		p.box("skin", ca * (r - 96), sa * (r - 96), 0, 205, 9, 390, q);
		// Repeated articulated cladding, service blisters, tiny windows.
		if (i % 4 === 0)
			p.box("skin", ca * (r - 96), sa * (r - 96), 192, 160, 62, 24, q);
		if (i % 8 === 0) {
			p.box("alloy", ca * (r - 92), sa * (r - 92), 224, 115, 85, 70, q);
			p.box("skin", ca * (r - 92), sa * (r - 92), 264, 90, 60, 12, q);
		}
		// A recessed dark machinery band outside the inhabited drum.
		if (i % 3 !== 0)
			p.box("alloy", ca * (r + 1), sa * (r + 1), 0, 6, 70, 220, q);
		const next = ((i + 1) / 96) * Math.PI * 2;
		p.bar(
			"bronze",
			v(ca * (r - 197), sa * (r - 197), -165),
			v(Math.cos(next) * (r - 197), Math.sin(next) * (r - 197), 165),
			9,
		);
		for (const z of [-198, 198]) {
			const a0 = v(ca * (r - 175), sa * (r - 175), z),
				a1 = v(ca * (r - 10), sa * (r - 10), z);
			const b = v(Math.cos(next) * (r - 10), Math.sin(next) * (r - 10), z);
			p.bar("bronze", a0, b, 6);
			p.bar("alloy", a1, b, 7);
		}
		for (let k = 0; k < 6; k++) {
			const aa = a + (k / 96 / 6) * Math.PI * 2;
			for (const rr of [r - 45, r - 138])
				p.box("light", Math.cos(aa) * rr, Math.sin(aa) * rr, 193, 3, 5, 1.5, q);
		}
	}
	for (let i = 0; i < 8; i++) {
		const a = (i * Math.PI) / 4,
			dir = v(Math.cos(a), Math.sin(a), 0),
			perp = v(-Math.sin(a), Math.cos(a), 0);
		for (const side of [-1, 1]) {
			const aa = dir
				.clone()
				.multiplyScalar(210)
				.addScaledVector(perp, side * 24);
			const bb = dir
				.clone()
				.multiplyScalar(r - 185)
				.addScaledVector(perp, side * 26);
			p.bar("skin", aa, bb, 42, 70);
			p.bar(
				"bronze",
				aa.clone().add(v(0, 0, 40)),
				bb.clone().add(v(0, 0, 40)),
				4,
			);
			for (let k = 0; k < 8; k++) {
				const mid = aa.clone().lerp(bb, (k + 0.5) / 8);
				p.box(
					"dark",
					mid.x,
					mid.y,
					39,
					20,
					8,
					2,
					new T.Quaternion().setFromAxisAngle(v(0, 0, 1), a),
				);
			}
		}
	}
	p.ring("skin", 250, 60, 230);
	p.ring("dark", 225, 30, 251);
	p.ring("bronze", 238, 9, 264);
	const cap = hullLoft(
		[
			{ z: 100, w: 190, h: 190, e: 2, hard: true },
			{ z: 165, w: 160, h: 160, e: 2, hard: true },
		],
		{ segments: 48, subdivisions: 1 },
	);
	p.add(cap, "skin");
	cap.dispose();
	p.ring("dark", 105, 55, 14, 172);
	p.ring("bronze", 135, 10, 15, 175);
	p.finish(rotor);
	// Fixed axle enters on an axial face, behind the spinning hub.
	const bearing = new Parts(mats);
	bearing.ring("dark", 175, 90, 420, -155);
	bearing.ring("skin", 200, 22, 55, -190);
	bearing.finish(root);
	return { root, rotor };
}

function dock(mats: Materials) {
	const root = new T.Group(),
		p = new Parts(mats);
	root.name = "static-docking-district";
	// An actual 120x70 m cut opening: four walls, recessed floor, sidewalls and back.
	// Not a black decal on a solid front cap.
	const body = hullLoft(
		[
			{ z: -70, w: 360, h: 240, e: 3, hard: true },
			{ z: 180, w: 420, h: 235, e: 4, hard: true },
			{ z: 380, w: 380, h: 190, e: 5, hard: true },
			{ z: 460, w: 285, h: 145, e: 5, hard: true },
		],
		{
			segments: 24,
			subdivisions: 1,
			aperture: { halfWidth: 150, halfHeight: 70 },
		},
	);
	const uv = body.getAttribute("uv");
	for (let i = 0; i < uv.count; i++)
		uv.setXY(i, uv.getX(i) / 210, uv.getY(i) / 210);
	p.add(body, "skin");
	body.dispose();
	// Framed, chamfered vestibule around the unchanged flight slot.
	for (const sign of [-1, 1]) {
		p.box("dark", 0, sign * 90, 468, 330, 28, 20);
		p.box("bronze", 0, sign * 109, 474, 350, 7, 18);
		p.box("skin", sign * 172, 0, 454, 32, 215, 50);
		for (let x = -130; x <= 130; x += 20)
			p.box("light", x, sign * 75, 483, 7, 3, 3);
	}
	const liner = hullLoft(
		[
			{ z: 200, w: 60, h: 35, e: 16, hard: true },
			{ z: 460, w: 150, h: 70, e: 16, hard: true },
		],
		{ segments: 32, subdivisions: 1, open: true },
	);
	p.add(liner, "interior");
	liner.dispose();
	root.userData.dock = {
		planeZ: 200,
		width: 120,
		height: 70,
		vestibuleWidth: 300,
		vestibuleHeight: 140,
	};
	p.box("interior", 0, 0, 100, 120, 70, 8);
	for (const x of [-40, 0, 40]) p.box("dark", x, 0, 108, 5, 68, 2);
	for (const y of [-24, 24]) p.box("light", 0, y, 110, 108, 3, 2);
	for (const [z, w, h] of [
		[120, 420, 236],
		[300, 400, 210],
		[400, 350, 177],
	]) {
		const g = hullLoft(
			[
				{ z: z - 10, w: w - 5, h: h - 5, e: 4, hard: true },
				{ z: z - 10, w: w + 12, h: h + 12, e: 4, hard: true },
				{ z: z + 10, w: w + 12, h: h + 12, e: 4, hard: true },
				{ z: z + 10, w: w - 5, h: h - 5, e: 4, hard: true },
				{ z: z - 10, w: w - 5, h: h - 5, e: 4, hard: true },
			],
			{ segments: 24, subdivisions: 1, open: true },
		);
		p.add(g, "alloy");
		g.dispose();
	}
	for (const sign of [-1, 1]) {
		p.box("dark", sign * 63, 0, 150, 6, 70, 100);
		p.box("dark", 0, sign * 38, 150, 126, 6, 100);
		p.box("bronze", sign * 158, 0, 472, 12, 160, 12);
		p.box("bronze", 0, sign * 78, 472, 328, 12, 12);
		for (let k = 0; k < 9; k++)
			p.box("light", sign * 58, 30, 100 + k * 36, 2, 2, 14);
	}
	for (let x = -330; x <= 330; x += 30)
		for (const y of [-125, 125]) p.box("light", x, y, 452, 7, 3, 2);
	// Service decks behind the dock; the opening's approach is kept clear.
	for (const side of [-1, 1]) {
		drum(p, "skin", 290, 70, side * 410, -60, -80);
		windows(p, 291, -61, 120, side * 410, -80);
	}
	p.finish(root);
	return root;
}

export async function createMetropolis(seed = 47, moduleCount = 30) {
	const texture = await new T.TextureLoader().loadAsync(
		new URL("./hull-panels.png", import.meta.url).href,
	);
	texture.colorSpace = T.SRGBColorSpace;
	texture.wrapS = texture.wrapT = T.RepeatWrapping;
	texture.anisotropy = 8;
	const normal = await new T.TextureLoader().loadAsync(
		new URL("./hull-normal.png", import.meta.url).href,
	);
	normal.wrapS = normal.wrapT = T.RepeatWrapping;
	normal.anisotropy = 8;
	const mats: Materials = {
		skin: new T.MeshStandardMaterial({
			color: 0x989da6,
			map: texture,
			normalMap: normal,
			normalScale: new T.Vector2(0.45, 0.45),
			roughness: 0.45,
			metalness: 0.65,
		}),
		alloy: new T.MeshStandardMaterial({
			color: 0x4f565f,
			map: texture,
			normalMap: normal,
			normalScale: new T.Vector2(0.45, 0.45),
			roughness: 0.44,
			metalness: 0.65,
		}),
		interior: new T.MeshStandardMaterial({
			color: 0x986333,
			emissive: 0xc78742,
			emissiveIntensity: 0.22,
			roughness: 0.8,
			side: T.DoubleSide,
		}),
		dark: new T.MeshStandardMaterial({
			color: 0x25292e,
			roughness: 0.58,
			metalness: 0.68,
		}),
		bronze: new T.MeshStandardMaterial({
			color: 0x96816a,
			roughness: 0.5,
			metalness: 0.78,
		}),
		light: new T.MeshStandardMaterial({
			color: 0xffdb99,
			emissive: 0xffc470,
			emissiveIntensity: 2.8,
			roughness: 0.4,
		}),
	};
	const root = new T.Group(),
		fixed = new T.Group();
	fixed.name = "fixed-spine";
	root.add(fixed);
	// Main backbone stays behind the spinning wheels and the front-facing dock.
	lattice(fixed, v(-2370, 0, -260), v(2220, 0, -260), 200);
	lattice(fixed, v(-2370, 0, -260), v(-1250, 0, -260), 340);
	lattice(fixed, v(1250, 0, -260), v(2220, 0, -260), 340);
	lattice(fixed, v(0, -500, -170), v(0, 550, -170), 95);
	const left = wheel(mats, 1480),
		right = wheel(mats, 870);
	left.root.position.set(-2610, 0, -260);
	right.root.position.set(2460, 0, -260);
	left.root.rotation.y = -Math.PI / 2;
	right.root.rotation.y = Math.PI / 2;
	left.root.name = "outward-wheel-left";
	right.root.name = "outward-wheel-right";
	root.add(left.root, right.root);
	const fixedParts = new Parts(mats);
	// Continuous enclosed backbone reaches both fixed wheel bearings.
	corridor(fixedParts, v(-2610, 0, -260), v(2460, 0, -260), 64);
	// Fixed transfer conduit and sockets; cylinders align to the spine.
	for (const x of [-2000, -1550, 1600, 2020]) {
		const g = new T.Group(),
			p = new Parts(mats);
		drum(p, "skin", 155, 240);
		for (const y of [-100, 100]) drum(p, "dark", 162, 18, 0, y);
		p.finish(g);
		g.rotation.z = Math.PI / 2;
		g.position.set(x, 0, -260);
		fixed.add(g);
	}
	for (let col = -3; col <= 3; col++) {
		const socket = new T.Group(),
			p = new Parts(mats);
		drum(p, "alloy", 145, 570);
		for (const y of [-265, 265]) {
			drum(p, "skin", 158, 38, 0, y);
			windows(p, 159, y, 80);
		}
		p.finish(socket);
		socket.position.set(col * 365, 0, -170);
		socket.rotation.x = col % 2 === 0 ? 0 : Math.PI / 2;
		fixed.add(socket);
	}
	const barrel = new T.Group(),
		bp = new Parts(mats);
	drum(bp, "alloy", 120, 2720);
	for (const y of [-1000, -500, 0, 500, 1000]) {
		drum(bp, "skin", 245, 290, 0, y);
		drum(bp, "dark", 251, 30, 0, y + 110);
		drum(bp, "bronze", 257, 6, 0, y + 130);
	}
	bp.finish(barrel);
	barrel.rotation.z = Math.PI / 2;
	barrel.position.z = -170;
	fixed.add(barrel);
	// Terraced civic decks and crossing galleries anchor the city silhouette.
	for (const side of [-1, 1])
		for (const x of [-620, 0, 620]) {
			const yy = side * (x === 0 ? 360 : 610),
				rr = x === 0 ? 380 : x * side > 0 ? 305 : 230;
			const deck = new T.Group(),
				deckParts = new Parts(mats);
			drum(deckParts, "skin", rr, 42, 0, yy);
			drum(deckParts, "dark", rr + 2, 14, 0, yy - 8);
			windows(deckParts, rr + 3, yy - 7, 180);
			for (let k = 0; k < 24; k++) {
				const a = (k / 24) * Math.PI * 2;
				deckParts.box(
					"skin",
					Math.cos(a) * (rr - 10),
					yy + 25,
					Math.sin(a) * (rr - 10),
					14,
					13,
					18,
				);
			}
			if (x !== 0) lattice(deck, v(0, 0, 0), v(0, yy, 0), 70);
			corridor(deckParts, v(0, 0, 0), v(0, yy, 0));
			if (x !== 0) {
				for (const [dx, dz, height, radius] of [
					[-95, 25, 330, 72],
					[65, -80, 210, 92],
					[95, 100, 140, 58],
				]) {
					const center = yy + side * (height / 2 + 24);
					drum(deckParts, "alloy", radius, height, dx, center, dz);
					for (let h = 35; h < height; h += 35)
						windows(deckParts, radius + 2, yy + side * (h + 24), 48, dx, dz);
					drum(
						deckParts,
						"skin",
						radius + 18,
						18,
						dx,
						yy + side * (height + 24),
						dz,
					);
				}
			}
			deckParts.finish(deck);
			const depth = x === 0 ? -170 : -170 + (x < 0 ? 650 : -650);
			deck.position.set(x, 0, depth);
			if (x !== 0) lattice(fixed, v(x, 0, -170), v(x, 0, depth), 85);
			if (x !== 0 && side === 1)
				corridor(fixedParts, v(x, 0, -170), v(x, 0, depth));
			fixed.add(deck);
		}
	// Paired engineering radiator crosses, behind the central district.
	for (const x of [-1520, 1500])
		for (const side of [-1, 1]) {
			const y = side * 640;
			fixedParts.bar("bronze", v(x, 0, -260), v(x, side * 1190, -260), 16);
			for (const dx of [-105, 105]) {
				fixedParts.box("dark", x + dx, y, -265, 166, 700, 14);
				for (let k = 0; k < 30; k++)
					fixedParts.box("bronze", x + dx, y - 340 + k * 23, -254, 161, 3, 3);
				for (const dd of [-82, 82])
					fixedParts.box("skin", x + dx + dd, y, -254, 5, 706, 8);
			}
		}
	fixedParts.finish(fixed);
	fixed.add(dock(mats));
	// Small freighters for scale, outside the dock corridor. Decorative viewer fixtures.
	const fleet = new T.Group();
	fleet.name = "scale-reference-traffic";
	for (const [x, y, z] of [
		[-1600, -1350, 1800],
		[1900, -960, 750],
		[720, 420, 1800],
		[-4100, -350, 0],
	]) {
		const p = new Parts(mats),
			ship = new T.Group();
		p.box("dark", 0, 0, 0, 50, 32, 170);
		p.box("skin", 0, 4, -72, 54, 35, 45);
		for (const side of [-1, 1])
			for (let k = 0; k < 4; k++)
				p.box("skin", side * 32, 3, -45 + k * 34, 23, 26, 29);
		p.box("light", -16, 0, 88, 10, 8, 4);
		p.box("light", 16, 0, 88, 10, 8, 4);
		p.finish(ship);
		ship.position.set(x, y, z);
		ship.rotation.y = -0.7;
		fleet.add(ship);
	}
	root.add(fleet);
	root.traverse((o) => {
		if (o instanceof T.InstancedMesh) o.material = mats.alloy;
	});
	const plan = createGrowthPlan(seed),
		attached = new Map<string, T.Group>();
	let count = 0;
	const setCount = (next: number) => {
		const wanted = modulesAt(plan, next);
		// Expansion adds only missing groups. Shrinking is a workbench inspection tool.
		for (const m of wanted)
			if (!attached.has(m.id)) {
				const g = tower(m, mats);
				root.add(g);
				attached.set(m.id, g);
			}
		const ids = new Set(wanted.map((m) => m.id));
		for (const [id, g] of attached)
			if (!ids.has(id)) {
				root.remove(g);
				g.traverse((o) => {
					if (o instanceof T.Mesh) o.geometry.dispose();
				});
				attached.delete(id);
			}
		count = next;
		root.updateMatrixWorld(true);
	};
	setCount(moduleCount);
	return {
		root,
		plan,
		attached,
		rotors: [left.rotor, right.rotor],
		setCount,
		get count() {
			return count;
		},
		dispose() {
			root.traverse((o) => {
				if (o instanceof T.Mesh) {
					if (o instanceof T.InstancedMesh) o.dispose();
					else o.geometry.dispose();
				}
			});
			Object.values(mats).forEach((m) => m.dispose());
			texture.dispose();
			normal.dispose();
		},
	};
}
