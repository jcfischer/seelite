import { shared } from "./gpu-teardown";
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

export const fittingFamilies = [
	"pulse-laser",
	"beam-laser",
	"military-laser",
	"mining-laser",
	"missile-rack",
	"autocannon",
	"railgun",
	"scattergun",
	"plasma-projector",
] as const;
export type FittingFamily = (typeof fittingFamilies)[number];
export function isFittingFamily(name: string): name is FittingFamily {
	return fittingFamilies.some((family) => family === name);
}

type XYZ = [number, number, number];
type Section = [z: number, width: number, height: number, centreY: number];
const shell = 0x737a7c;
const bevel = 0x545957;
const graphite = 0x353a3b;
const trim = 0x555755;
const ochre = 0x927445;
const dark = 0x18191a;

function plateFinish() {
	const size = 256;
	const pixels = new Uint8Array(size * size * 4);
	let seed = 1345;
	function noise() {
		seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
		return seed / 4294967296;
	}
	for (let y = 0; y < size; y++)
		for (let x = 0; x < size; x++) {
			const px = x % 128,
				py = y % 96;
			const brushed = 4 * Math.sin(y * 1.7) + 6 * Math.sin((x + y) / 28);
			let value = 213 + brushed + noise() * 28;
			if (px < 2 || py < 2) value = 87 + noise() * 20;
			else if (px === 2 || py === 2) value = 250;
			const bolt = Math.hypot(
				Math.min(px, 128 - px) - 8,
				Math.min(py, 96 - py) - 8,
			);
			if (bolt < 3) value = bolt < 1.7 ? 80 : 165;
			if ((px < 8 || py < 5) && noise() < 0.19) value = 125;
			const i = (y * size + x) * 4;
			pixels.set([value, value, value, 255], i);
		}
	for (let n = 0; n < 380; n++) {
		const x = Math.floor(noise() * size),
			y = Math.floor(noise() * size),
			length = 2 + noise() * 12;
		for (let k = 0; k < length && x + k < size; k++) {
			const i =
				(Math.min(size - 1, y + Math.floor(k * 0.22)) * size + x + k) * 4;
			pixels.fill(148 + noise() * 42, i, i + 3);
		}
	}
	pixels.fill(255, (250 * size + 250) * 4, (250 * size + 250) * 4 + 4);
	const texture = new THREE.DataTexture(pixels, size, size);
	texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
	texture.magFilter = THREE.LinearFilter;
	texture.minFilter = THREE.LinearMipmapLinearFilter;
	texture.generateMipmaps = true;
	texture.needsUpdate = true;
	return texture;
}

const templates = new Map<FittingFamily, THREE.Group>();
let finish: THREE.DataTexture | undefined;
export function buildFitting(family: FittingFamily): THREE.Group {
	const template = templates.get(family);
	if (template) return template.clone(true);
	const pieces: THREE.BufferGeometry[] = [];
	const optics: THREE.BufferGeometry[] = [];
	function add(
		geometry: THREE.BufferGeometry,
		color: number,
		at: XYZ,
		rotation: XYZ = [0, 0, 0],
	) {
		const g = geometry.index ? geometry.toNonIndexed() : geometry;
		g.deleteAttribute("uv");
		g.rotateX(rotation[0]);
		g.rotateY(rotation[1]);
		g.rotateZ(rotation[2]);
		g.translate(...at);
		const pos = g.getAttribute("position"),
			normal = g.getAttribute("normal");
		const uv = new Float32Array(pos.count * 2);
		const painted = [shell, bevel, graphite, trim, ochre].includes(color);
		for (let i = 0; i < pos.count; i++) {
			const nx = Math.abs(normal.getX(i)),
				ny = Math.abs(normal.getY(i)),
				nz = Math.abs(normal.getZ(i));
			let u = pos.getX(i),
				v = pos.getY(i);
			if (nx > ny && nx > nz) u = pos.getZ(i);
			else if (ny > nz) v = pos.getZ(i);
			uv[2 * i] = painted ? u * 0.69 + 0.24 : 250.5 / 256;
			uv[2 * i + 1] = painted ? v * 0.69 + 0.38 : 250.5 / 256;
		}
		g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
		const rgb = new THREE.Color(color);
		const colors = new Float32Array(g.getAttribute("position").count * 3);
		for (let i = 0; i < colors.length; i += 3) rgb.toArray(colors, i);
		g.setAttribute("color", new THREE.BufferAttribute(colors, 3));
		if (
			[0xbd7434, 0x88303e, 0x715584, 0x637f42, 0x578d98, 0xaa753f].includes(
				color,
			)
		)
			optics.push(g);
		else pieces.push(g);
	}
	function box(size: XYZ, at: XYZ, color: number) {
		add(new THREE.BoxGeometry(...size), color, at);
	}
	function barrel(
		radius: number,
		length: number,
		at: XYZ,
		color: number,
		sides = 12,
	) {
		add(new THREE.CylinderGeometry(radius, radius, length, sides), color, at, [
			Math.PI / 2,
			0,
			0,
		]);
	}
	function casing(sections: Section[], color: number, x = 0) {
		const points: number[] = [];
		const rings = sections.map(([z, w, h, y]) =>
			[
				[-0.34, 0.5],
				[0.34, 0.5],
				[0.5, 0.28],
				[0.5, -0.28],
				[0.34, -0.5],
				[-0.34, -0.5],
				[-0.5, -0.28],
				[-0.5, 0.28],
			].map(([a, b]) => [x + a * w, y + b * h, z]),
		);
		function face(a: number[], b: number[], c: number[]) {
			points.push(...a, ...b, ...c);
		}
		for (let j = 1; j < rings.length; j++) {
			const fore = rings[j],
				aft = rings[j - 1];
			for (let i = 0; i < 8; i++) {
				const n = (i + 1) % 8;
				face(aft[i], aft[n], fore[i]);
				face(aft[n], fore[n], fore[i]);
			}
		}
		const back = rings[0],
			front = rings[rings.length - 1];
		for (let i = 1; i < 7; i++) {
			face(back[0], back[i + 1], back[i]);
			face(front[0], front[i], front[i + 1]);
		}
		const geometry = new THREE.BufferGeometry();
		geometry.setAttribute(
			"position",
			new THREE.Float32BufferAttribute(points, 3),
		);
		geometry.computeVertexNormals();
		add(geometry, color, [0, 0, 0]);
	}
	add(new THREE.CylinderGeometry(0.65, 0.75, 0.16, 8), graphite, [0, 0.08, 0]);
	add(new THREE.CylinderGeometry(0.48, 0.55, 0.3, 12), trim, [0, 0.28, 0]);
	box([1.25, 0.18, 1.15], [0, 0.5, 0], graphite);
	casing(
		[
			[1.0, 1.12, 0.73, 0.99],
			[0.82, 1.38, 1.05, 1.03],
			[-0.15, 1.38, 1.05, 1.03],
			[-0.32, 1.2, 0.82, 1.04],
		],
		graphite,
	);
	for (const side of [-1, 1]) {
		box([0.1, 0.65, 0.76], [side * 0.68, 1.04, 0.43], shell);
		for (const z of [0.22, 0.43, 0.64])
			box([0.12, 0.095, 0.11], [side * 0.69, 1.03, z], dark);
		box([0.11, 0.1, 0.7], [side * 0.67, 0.69, 0.42], ochre);
	}
	let exitZ = -1.1,
		exitY = 1.07;
	switch (family) {
		case "pulse-laser":
			casing(
				[
					[0.62, 1.35, 1.08, 1.05],
					[0.2, 1.6, 1.3, 1.12],
					[-0.76, 1.57, 1.26, 1.11],
					[-1, 1.18, 1, 1.08],
				],
				shell,
			);
			barrel(0.54, 0.24, [0, 1.08, -1], graphite, 8);
			barrel(0.36, 0.15, [0, 1.08, -1.1], 0x781c32);
			add(
				new THREE.SphereGeometry(0.295, 16, 10).scale(1, 1, 0.35),
				0x88303e,
				[0, 1.08, -1.18],
			);
			for (const side of [-1, 1]) {
				box([0.035, 0.45, 0.44], [side * 0.785, 1.08, -0.39], ochre);
				for (const z of [-0.62, -0.51])
					box([0.045, 0.08, 0.06], [side * 0.786, 0.96, z], dark);
			}
			exitZ = -1.28;
			break;
		case "beam-laser":
			casing(
				[
					[0.55, 1.36, 0.92, 1.03],
					[-0.1, 1.73, 0.79, 1.07],
					[-1.72, 1.86, 0.37, 1.03],
				],
				shell,
			);
			box([1.62, 0.22, 0.06], [0, 1.03, -1.74], graphite);
			box([1.39, 0.075, 0.07], [0, 1.04, -1.78], 0x578d98);
			for (const x of [-0.55, 0.55])
				box([0.2, 0.04, 0.66], [x, 1.45, -0.24], graphite);
			exitZ = -1.82;
			break;
		case "military-laser": {
			casing(
				[
					[0.95, 1.2, 0.67, 1.36],
					[0.4, 1.6, 1.02, 1.33],
					[-0.72, 1.43, 0.65, 1.27],
					[-1.48, 1.16, 0.15, 1.25],
				],
				shell,
			);
			const lens = new THREE.Shape();
			lens.moveTo(-0.51, 0.08);
			lens.lineTo(0, -0.52);
			lens.lineTo(0.51, 0.08);
			lens.closePath();
			const prism = new THREE.ExtrudeGeometry(lens, {
				depth: 1.1,
				bevelEnabled: false,
			});
			add(prism, graphite, [0, 1.13, -1.48]);
			add(
				new THREE.ShapeGeometry(lens).scale(0.92, 0.92, 1).rotateY(Math.PI),
				0x715584,
				[0, 1.1, -1.49],
			);
			casing(
				[
					[0.92, 0.56, 0.13, 1.86],
					[-0.07, 0.88, 0.12, 1.86],
					[-0.58, 0.38, 0.1, 1.6],
				],
				bevel,
			);
			exitZ = -1.52;
			break;
		}
		case "mining-laser":
			for (const y of [0.7, 1.54])
				casing(
					[
						[0.26, 1.64, 0.46, y],
						[-0.76, 1.72, 0.43, y],
						[-1.4, 1.35, 0.34, y],
					],
					ochre,
				);
			barrel(0.34, 0.35, [0, 1.12, -0.39], graphite);
			barrel(0.32, 0.42, [0, 1.12, -0.76], 0x637f42);
			exitZ = -0.97;
			break;
		case "missile-rack":
			casing(
				[
					[0.67, 1.45, 1.16, 1.18],
					[0.4, 1.82, 1.52, 1.23],
					[-1.03, 1.82, 1.52, 1.23],
				],
				shell,
			);
			for (const x of [-0.41, 0.41])
				for (const y of [0.89, 1.57]) {
					casing(
						[
							[-1.03, 0.8, 0.66, y],
							[-1.2, 0.67, 0.57, y],
						],
						graphite,
						x,
					);
					box([0.12, 0.065, 0.01], [x, y, -1.21], ochre);
				}
			for (const x of [-0.91, 0.91]) {
				box([0.025, 0.94, 0.18], [x, 1.23, -0.62], ochre);
				for (const y of [0.96, 1.09, 1.22])
					box([0.034, 0.045, 0.45], [x, y, -0.14], dark);
			}
			exitZ = -1.22;
			exitY = 1.57;
			break;
		case "autocannon":
			barrel(0.81, 1.15, [0.14, 1.25, -0.18], trim);
			for (const z of [0.22, -0.3, -0.68])
				barrel(0.85, 0.14, [0.14, 1.25, z], shell);
			barrel(0.49, 0.24, [0.14, 1.25, -0.82], ochre);
			for (let i = 0; i < 6; i++) {
				const theta = (i * Math.PI) / 3;
				const glow = new THREE.BoxGeometry(0.11, 0.25, 0.24);
				glow.rotateZ(theta);
				add(glow, 0xaa753f, [
					0.14 + Math.cos(theta) * 0.803,
					1.25 + Math.sin(theta) * 0.803,
					-0.08,
				]);
			}
			casing(
				[
					[-0.7, 0.93, 0.76, 1.25],
					[-1.18, 0.85, 0.69, 1.25],
					[-1.78, 0.59, 0.46, 1.2],
				],
				shell,
				0.14,
			);
			box([0.41, 0.27, 0.02], [0.14, 1.2, -1.79], dark);
			exitZ = -1.8;
			exitY = 1.2;
			break;
		case "railgun":
			for (const y of [0.71, 1.63])
				casing(
					[
						[0.47, 0.64, 0.37, y],
						[-0.6, 0.6, 0.37, y],
						[-2.6, 0.58, 0.31, y],
					],
					shell,
				);
			box([0.72, 0.34, 0.28], [0, 1.17, -0.22], trim);
			exitZ = -2.6;
			exitY = 1.17;
			break;
		case "scattergun":
			casing(
				[
					[0.29, 1.35, 0.82, 1.1],
					[-0.67, 1.59, 1.25, 1.14],
				],
				graphite,
			);
			for (const x of [-0.75, -0.25, 0.25, 0.75]) {
				const lip = new THREE.Shape();
				lip.moveTo(0.12, 0.46);
				lip.lineTo(-0.67, 0.66);
				lip.lineTo(-1.58, 0.64);
				lip.bezierCurveTo(-1.1, 0.47, -1.04, -0.38, -1.61, -0.55);
				lip.lineTo(-0.71, -0.54);
				lip.lineTo(0.12, -0.36);
				lip.closePath();
				const plate = new THREE.ExtrudeGeometry(lip, {
					depth: 0.085,
					bevelEnabled: true,
					bevelThickness: 0.015,
					bevelSize: 0.022,
					bevelSegments: 1,
					curveSegments: 12,
				});
				plate.rotateY(-Math.PI / 2);
				add(plate, shell, [x, 1.12, 0]);
				if (x < 0.75) {
					const inner = new THREE.Shape();
					inner.moveTo(-0.58, 0.48);
					inner.lineTo(-1.34, 0.54);
					inner.bezierCurveTo(-0.93, 0.31, -0.91, -0.26, -1.38, -0.45);
					inner.lineTo(-0.58, -0.41);
					inner.closePath();
					const recess = new THREE.ExtrudeGeometry(inner, {
						depth: 0.42,
						bevelEnabled: false,
						curveSegments: 12,
					});
					recess.rotateY(-Math.PI / 2);
					add(recess, graphite, [x + 0.42, 1.12, 0]);
				}
			}
			exitZ = -1.58;
			break;
		case "plasma-projector":
			for (const x of [-0.18, 0.18]) {
				const arc = new THREE.TorusGeometry(0.71, 0.23, 5, 17, Math.PI * 1.51);
				arc.rotateZ(Math.PI * 0.25);
				arc.rotateY(Math.PI / 2);
				add(arc, shell, [x, 1.33, -0.8]);
			}
			add(new THREE.SphereGeometry(0.48, 18, 12), 0xbd7434, [0, 1.33, -0.86]);
			exitZ = -1.35;
			exitY = 1.33;
			break;
	}
	const root = new THREE.Group();
	root.name = family;
	const geometry = shared(mergeGeometries(pieces));
	finish ??= shared(plateFinish());
	const mesh = new THREE.Mesh(
		geometry,
		shared(
			new THREE.MeshStandardMaterial({
				vertexColors: true,
				map: finish,
				metalness: 0.48,
				roughness: 0.62,
				bumpMap: finish,
				bumpScale: 0.000028,
			}),
		),
	);
	mesh.name = "housing";
	root.add(mesh);
	if (optics.length) {
		const light = new THREE.Mesh(
			shared(mergeGeometries(optics)),
			shared(
				new THREE.MeshStandardMaterial({
					vertexColors: true,
					metalness: 0.28,
					roughness: 0.23,
				}),
			),
		);
		light.name = "optic";
		root.add(light);
	}
	const shoe = new THREE.Object3D();
	shoe.name = "attachment";
	root.add(shoe);
	const exit = new THREE.Object3D();
	exit.name = family === "missile-rack" ? "launch-exit" : "muzzle";
	exit.position.set(
		family === "missile-rack" ? 0.41 : 0.14 * Number(family === "autocannon"),
		exitY,
		exitZ,
	);
	root.add(exit);
	templates.set(family, root);
	return root.clone(true);
}
