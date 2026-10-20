import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { hullLoft } from "../../../src/loft";
import { STATION_GEOMETRY } from "../../../src/station";
import { EMISSIVE_CEILING } from "../../../src/light-rig";

export const CELL_KM = 0.2;
export const SPIKE_SEEDS = [0, 1, 47, 1234];

export function authorKit() {
	const root = new THREE.Group();
	const materials = {
		ivory: new THREE.MeshStandardMaterial({
			color: 0xb5b4a8,
			roughness: 0.74,
			metalness: 0.28,
		}),
		panel: new THREE.MeshStandardMaterial({
			color: 0x858c8d,
			roughness: 0.79,
			metalness: 0.35,
		}),
		steel: new THREE.MeshStandardMaterial({
			color: 0x303b43,
			roughness: 0.7,
			metalness: 0.6,
		}),
		alloy: new THREE.MeshStandardMaterial({
			color: 0x737c7c,
			roughness: 0.55,
			metalness: 0.65,
		}),
		orange: new THREE.MeshStandardMaterial({
			color: 0x9d652d,
			roughness: 0.79,
			metalness: 0.18,
		}),
		lamp: new THREE.MeshStandardMaterial({
			color: 0xbca780,
			emissive: 0xffc579,
			emissiveIntensity: EMISSIVE_CEILING * 0.38,
		}),
	};
	for (const [name, material] of Object.entries(materials))
		material.name = name;
	type Finish = keyof typeof materials;
	let batch = new Map<Finish, THREE.BufferGeometry[]>();
	const add = (
		g: THREE.BufferGeometry,
		finish: Finish,
		matrix = new THREE.Matrix4(),
	) => {
		g.applyMatrix4(matrix);
		const plain = g.index ? g.toNonIndexed() : g;
		for (const key of Object.keys(plain.attributes))
			if (!["position", "normal", "uv"].includes(key))
				plain.deleteAttribute(key);
		if (!plain.getAttribute("uv"))
			plain.setAttribute(
				"uv",
				new THREE.Float32BufferAttribute(
					new Float32Array(plain.getAttribute("position").count * 2),
					2,
				),
			);
		if (!batch.has(finish)) batch.set(finish, []);
		batch.get(finish)!.push(plain);
	};
	const box = (
		position: number[],
		size: number[],
		finish: Finish,
		rotation = new THREE.Quaternion(),
	) => {
		add(
			new THREE.BoxGeometry(...(size as [number, number, number])),
			finish,
			new THREE.Matrix4().compose(
				new THREE.Vector3(...(position as [number, number, number])),
				rotation,
				new THREE.Vector3(1, 1, 1),
			),
		);
	};
	const cylinder = (
		a: THREE.Vector3,
		b: THREE.Vector3,
		radius: number,
		finish: Finish,
		r2 = radius,
		segments = 12,
	) => {
		add(
			new THREE.CylinderGeometry(
				r2,
				radius,
				a.distanceTo(b),
				segments,
				1,
				false,
			),
			finish,
			new THREE.Matrix4().compose(
				a.clone().add(b).multiplyScalar(0.5),
				new THREE.Quaternion().setFromUnitVectors(
					new THREE.Vector3(0, 1, 0),
					b.clone().sub(a).normalize(),
				),
				new THREE.Vector3(1, 1, 1),
			),
		);
	};
	const ring = (
		axis: THREE.Vector3,
		t: number,
		radius: number,
		minor: number,
		finish: Finish,
	) => {
		add(
			new THREE.TorusGeometry(radius, minor, 4, 24),
			finish,
			new THREE.Matrix4().compose(
				axis.clone().multiplyScalar(t),
				new THREE.Quaternion().setFromUnitVectors(
					new THREE.Vector3(0, 0, 1),
					axis,
				),
				new THREE.Vector3(1, 1, 1),
			),
		);
	};
	const finishBlock = (name: string) => {
		const block = new THREE.Group();
		block.name = name;
		for (const [finish, geometries] of batch) {
			const geometry = mergeGeometries(geometries)!;
			geometry.scale(0.001, 0.001, 0.001);
			const mesh = new THREE.Mesh(geometry, materials[finish]);
			mesh.name = `${name}-${finish}`;
			block.add(mesh);
		}
		root.add(block);
		batch = new Map();
	};
	const X = new THREE.Vector3(1, 0, 0),
		Y = new THREE.Vector3(0, 1, 0),
		Z = new THREE.Vector3(0, 0, 1);
	const socket = (
		axis: THREE.Vector3,
		start: number,
		end: number,
		radius: number,
	) => {
		cylinder(
			axis.clone().multiplyScalar(start),
			axis.clone().multiplyScalar(end),
			radius,
			"steel",
		);
		for (const t of [end - 7, end - 2]) ring(axis, t, radius + 2, 2, "alloy");
		for (let k = 0; k < 8; k++) {
			const turn = new THREE.Quaternion().setFromUnitVectors(Z, axis);
			const p = new THREE.Vector3(
				Math.cos((k * Math.PI) / 4) * (radius + 1),
				Math.sin((k * Math.PI) / 4) * (radius + 1),
				end - 6,
			).applyQuaternion(turn);
			box(p.toArray(), [3, 3, 5], "orange", turn);
		}
	};

	cylinder(
		X.clone().multiplyScalar(-84),
		X.clone().multiplyScalar(84),
		48,
		"ivory",
	);
	for (const sign of [-1, 1]) {
		cylinder(
			X.clone().multiplyScalar(sign * 84),
			X.clone().multiplyScalar(sign * 91),
			48,
			"panel",
			38.4,
		);
		socket(X.clone().multiplyScalar(sign), 91, 100, 38.4);
	}
	for (let k = 0; k < 12; k++) {
		const angle = ((k + 0.5) * Math.PI) / 6;
		const rotation = new THREE.Quaternion().setFromAxisAngle(
			X,
			angle - Math.PI / 2,
		);
		const n = new THREE.Vector3(0, Math.cos(angle), Math.sin(angle));
		for (const x of [-65, -32, 1, 34, 67]) {
			box(
				n.clone().multiplyScalar(46.6).addScaledVector(X, x).toArray(),
				[30, 22, 1.7],
				k % 4 === 0 ? "panel" : "ivory",
				rotation,
			);
			box(
				n
					.clone()
					.multiplyScalar(47.7)
					.addScaledVector(X, x + 10)
					.toArray(),
				[1.2, 15, 1],
				"steel",
				rotation,
			);
			for (const offset of [-7, 7])
				box(
					n
						.clone()
						.multiplyScalar(48.4)
						.addScaledVector(X, x + offset)
						.toArray(),
					[1.5, 2, 1.2],
					"alloy",
					rotation,
				);
		}
		if (k % 3 === 0) {
			cylinder(
				n.clone().multiplyScalar(50).addScaledVector(X, -78),
				n.clone().multiplyScalar(50).addScaledVector(X, 78),
				1.5,
				"alloy",
				1.5,
				6,
			);
			for (const x of [-48, 0, 48])
				box(
					n.clone().multiplyScalar(49.7).addScaledVector(X, x).toArray(),
					[12, 3, 2],
					"lamp",
					rotation,
				);
		}
	}
	for (const x of [-82, -76, 76, 82]) ring(X, x, 48, 2.1, "steel");
	finishBlock("TUBE");

	cylinder(
		Z.clone().multiplyScalar(-56),
		Z.clone().multiplyScalar(56),
		60,
		"ivory",
	);
	for (const axis of [X, Y, X.clone().negate(), Y.clone().negate()])
		socket(axis, 44, 100, 38.4);
	for (const z of [-52, 51]) ring(Z, z, 59, 3, "steel");
	for (const sign of [-1, 1]) {
		box([0, 0, sign * 57], [57, 57, 2], "steel");
		box([0, 0, sign * 59], [49, 49, 2], "panel");
		for (const x of [-17, 17]) box([x, 0, sign * 61], [5, 28, 2], "orange");
		for (const y of [-18, 18]) box([0, y, sign * 61], [18, 2, 2], "lamp");
	}
	finishBlock("NODE");

	const r = STATION_GEOMETRY.trade.coreRadiusKm * 1000,
		hubR = r * 0.34;
	const plane = STATION_GEOMETRY.trade.aperturePlaneKm * 1000;
	const aperture = STATION_GEOMETRY.trade.aperture;
	add(
		hullLoft(
			[
				{ z: -r * 0.3, w: hubR * 0.78, h: hubR * 0.78, e: 2 },
				{ z: -r * 0.2, w: hubR, h: hubR, e: 2, hard: true },
				{ z: r * 0.6, w: hubR, h: hubR, e: 2, hard: true },
				{ z: plane, w: hubR * 0.92, h: hubR * 0.92, e: 2 },
			],
			{
				segments: 12,
				aperture: {
					halfWidth: aperture.widthKm * 500,
					halfHeight: aperture.heightKm * 500,
					ends: "last",
				},
			},
		),
		"ivory",
	);
	for (const z of [-115, -104, 335, 348]) ring(Z, z, hubR * 0.988, 3, "steel");
	for (let k = 0; k < 12; k++) {
		const a = ((k + 0.5) * Math.PI) / 6,
			n = new THREE.Vector3(Math.cos(a), Math.sin(a), 0);
		const rotation = new THREE.Quaternion().setFromAxisAngle(
			Z,
			a - Math.PI / 2,
		);
		for (const z of [-65, 20, 105, 190, 275]) {
			box(
				n.clone().multiplyScalar(198).addScaledVector(Z, z).toArray(),
				[96, 3, 80],
				(k + Math.round(z)) % 3 === 0 ? "panel" : "ivory",
				rotation,
			);
			box(
				n
					.clone()
					.multiplyScalar(201)
					.addScaledVector(Z, z + 34)
					.toArray(),
				[91, 3, 2],
				"steel",
				rotation,
			);
			for (const t of [-35, 35]) {
				const p = n
					.clone()
					.multiplyScalar(202)
					.add(
						new THREE.Vector3(-Math.sin(a), Math.cos(a), 0).multiplyScalar(t),
					)
					.addScaledVector(Z, z + 26);
				box(p.toArray(), [3, 2, 5], "alloy", rotation);
			}
		}
		cylinder(
			n.clone().multiplyScalar(206).addScaledVector(Z, 35),
			n.clone().multiplyScalar(206).addScaledVector(Z, 318),
			2,
			"alloy",
			2,
			6,
		);
		for (const z of [60, 210, 310])
			box(
				n.clone().multiplyScalar(207).addScaledVector(Z, z).toArray(),
				[14, 4, 3],
				"lamp",
				rotation,
			);
	}
	for (const sign of [-1, 1]) {
		box([sign * 77, 0, plane + 1], [20, 117, 2], "steel");
		box([0, sign * 52, plane + 1], [174, 18, 2], "steel");
		box([sign * 80, 0, plane + 3], [7, 85, 2], "orange");
		box([0, sign * 53, plane + 3], [133, 4, 2], "alloy");
	}
	ring(Z, plane + 2, 176, 2.5, "steel");
	for (let k = 0; k < 12; k++) {
		const a = ((k + 0.5) * Math.PI) / 6;
		const n = new THREE.Vector3(Math.cos(a), Math.sin(a), 0);
		const rotation = new THREE.Quaternion().setFromAxisAngle(
			Z,
			a - Math.PI / 2,
		);
		box(
			n
				.clone()
				.multiplyScalar(138)
				.setZ(plane + 2)
				.toArray(),
			[45, 28, 3],
			k % 3 === 0 ? "steel" : "panel",
			rotation,
		);
		for (const offset of [-7, 0, 7]) {
			const p = n
				.clone()
				.multiplyScalar(138 + offset)
				.setZ(plane + 4);
			box(p.toArray(), [34, 1.7, 2], k % 3 === 0 ? "alloy" : "steel", rotation);
		}
	}
	finishBlock("HUB");
	for (const axis of [X, X.clone().negate()]) {
		ring(axis, 205, 49, 4, "steel");
		ring(axis, 210, 49, 2, "alloy");
	}
	for (const axis of [Y, Y.clone().negate()]) {
		ring(axis, 205, 18, 4, "steel");
		ring(axis, 210, 18, 2, "alloy");
	}
	finishBlock("HUB_STATIC");
	return root;
}
