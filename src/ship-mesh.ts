/**
 * Procedural display-only ship silhouettes.
 *
 * sim.ts remains authoritative for positions and flight, and issue #26 remains
 * the owner of any future roster-to-hull selection. These meshes create no
 * actors, collision volumes, target identity, AI, or fallback roster choice.
 *
 * Local -Z is the nose and +Z the exhaust end. Dimensions are kilometres
 * because the player hull lives directly in the near scene; this geometry never
 * crosses the far/near body handoff.
 */
import * as THREE from "three";

export const HULL_IDS = ["courier", "interceptor", "freighter"] as const;
export type HullId = (typeof HULL_IDS)[number];
export const HULL_VARIANT_IDS = ["a", "b", "c"] as const;
export type HullVariantId = (typeof HULL_VARIANT_IDS)[number];
export const SHIP_DESIGN_ROUND = 3;

export interface HullVariant {
	readonly id: HullVariantId;
	readonly name: string;
	readonly thesis: string;
}

export const HULL_VARIANTS: Record<HullId, readonly HullVariant[]> = {
	courier: [
		{
			id: "a",
			name: "Bowguard",
			thesis: "broad shoulder armor feeding twin forward blades",
		},
		{
			id: "b",
			name: "Sundiver",
			thesis: "long divided prow wrapped around a recessed command keel",
		},
		{
			id: "c",
			name: "Wayfarer",
			thesis: "lean shoulder wing with paired utility prongs",
		},
	],
	interceptor: [
		{
			id: "a",
			name: "Glaive",
			thesis: "single spear suspended between swept engine rails",
		},
		{
			id: "b",
			name: "Trident",
			thesis: "three longitudinal spines tied by a low ventral deck",
		},
		{
			id: "c",
			name: "Shrike",
			thesis: "close-coupled twin boom around a buried command spine",
		},
	],
	freighter: [
		{
			id: "a",
			name: "Porter",
			thesis: "dominant cargo outrigger beside a compact command keel",
		},
		{
			id: "b",
			name: "Gantry",
			thesis: "staggered load rails around an offset bridge module",
		},
		{
			id: "c",
			name: "Lifter",
			thesis: "one deep cargo bank balanced by an exposed service rail",
		},
	],
};

export interface HullVisual {
	readonly role: "player-baseline" | "fast" | "cargo";
	readonly lengthKm: number;
	readonly beamKm: number;
	readonly heightKm: number;
	readonly reachKm: number;
}

export const HULL_VISUALS: Record<HullId, HullVisual> = {
	courier: {
		role: "player-baseline",
		lengthKm: 0.06,
		beamKm: 0.05,
		heightKm: 0.014,
		reachKm: 0.036,
	},
	interceptor: {
		role: "fast",
		lengthKm: 0.066,
		beamKm: 0.048,
		heightKm: 0.016,
		reachKm: 0.036,
	},
	freighter: {
		role: "cargo",
		lengthKm: 0.064,
		beamKm: 0.046,
		heightKm: 0.024,
		reachKm: 0.04,
	},
};

export interface ShipMesh {
	root: THREE.Group;
}

type Palette = Record<
	"hull" | "panel" | "trim" | "accent" | "canopy" | "engine" | "exhaust",
	THREE.MeshStandardMaterial
>;
type Section = { z: number; width: number; top: number; bottom: number };

const liveries: Record<
	HullId,
	{ hull: number; panel: number; accent: number }
> = {
	courier: { hull: 0x78929c, panel: 0x496873, accent: 0xd27b42 },
	interceptor: { hull: 0x7d8196, panel: 0x4f536a, accent: 0xc8564b },
	freighter: { hull: 0x8c846f, panel: 0x5d5748, accent: 0xd0a04f },
};

function makePalette(id: HullId): Palette {
	const colors = liveries[id];
	const painted = (color: number, roughness: number, metalness: number) =>
		new THREE.MeshStandardMaterial({ color, roughness, metalness });
	return {
		hull: painted(colors.hull, 0.55, 0.26),
		panel: painted(colors.panel, 0.62, 0.3),
		trim: painted(0x304249, 0.54, 0.5),
		accent: painted(colors.accent, 0.58, 0.2),
		canopy: new THREE.MeshStandardMaterial({
			color: 0x173743,
			emissive: 0x061820,
			emissiveIntensity: 0.12,
			roughness: 0.28,
			metalness: 0.08,
		}),
		engine: painted(0x293b42, 0.45, 0.52),
		exhaust: new THREE.MeshStandardMaterial({
			color: 0x7fc4df,
			emissive: 0x4a9fca,
			emissiveIntensity: 0.55,
			roughness: 0.36,
			metalness: 0.08,
		}),
	};
}

function add(
	root: THREE.Group,
	name: string,
	geometry: THREE.BufferGeometry,
	material: THREE.Material,
	position: [number, number, number] = [0, 0, 0],
	rotation: [number, number, number] = [0, 0, 0],
) {
	const mesh = new THREE.Mesh(geometry, material);
	mesh.name = name;
	mesh.position.set(...position);
	mesh.rotation.set(...rotation);
	root.add(mesh);
	return mesh;
}

function planform(
	points: ReadonlyArray<readonly [number, number]>,
	thickness: number,
	bevel = Math.min(thickness * 0.2, 0.0009),
) {
	const shape = new THREE.Shape();
	shape.moveTo(points[0][0], points[0][1]);
	for (const [x, z] of points.slice(1)) shape.lineTo(x, z);
	shape.closePath();
	const geometry = new THREE.ExtrudeGeometry(shape, {
		depth: thickness,
		steps: 1,
		curveSegments: 1,
		bevelEnabled: bevel > 0,
		bevelSegments: 1,
		bevelSize: bevel,
		bevelThickness: bevel,
	});
	geometry.rotateX(Math.PI / 2);
	geometry.translate(0, thickness / 2, 0);
	return geometry;
}

function sidePlanform(
	points: ReadonlyArray<readonly [number, number]>,
	sign: -1 | 1,
	thickness: number,
	bevel?: number,
) {
	const mirrored = points.map(([x, z]) => [x * sign, z] as const);
	if (sign < 0) mirrored.reverse();
	return planform(mirrored, thickness, bevel);
}

function loft(sections: ReadonlyArray<Section>) {
	const vertices: number[] = [];
	const indices: number[] = [];
	const ringSize = 8;
	for (const { z, width: w, top, bottom } of sections) {
		for (const [x, y] of [
			[0, top],
			[w * 0.62, top * 0.78],
			[w, top * 0.12],
			[w * 0.8, -bottom * 0.72],
			[0, -bottom],
			[-w * 0.8, -bottom * 0.72],
			[-w, top * 0.12],
			[-w * 0.62, top * 0.78],
		] as const)
			vertices.push(x, y, z);
	}
	for (let section = 0; section < sections.length - 1; section += 1) {
		for (let point = 0; point < ringSize; point += 1) {
			const next = (point + 1) % ringSize;
			const a = section * ringSize + point;
			const b = section * ringSize + next;
			const c = (section + 1) * ringSize + next;
			const d = (section + 1) * ringSize + point;
			indices.push(a, d, b, b, d, c);
		}
	}
	const front = vertices.length / 3;
	vertices.push(0, 0, sections[0].z);
	const rear = vertices.length / 3;
	vertices.push(0, 0, sections.at(-1)?.z ?? 0);
	const rearOffset = (sections.length - 1) * ringSize;
	for (let point = 0; point < ringSize; point += 1) {
		const next = (point + 1) % ringSize;
		indices.push(front, point, next);
		indices.push(rear, rearOffset + next, rearOffset + point);
	}
	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute(
		"position",
		new THREE.Float32BufferAttribute(vertices, 3),
	);
	geometry.setIndex(indices);
	geometry.computeVertexNormals();
	return geometry;
}

function enginePod(
	root: THREE.Group,
	name: string,
	position: [number, number, number],
	sections: ReadonlyArray<Section>,
	radius: number,
	p: Palette,
) {
	add(root, name + "-nacelle", loft(sections), p.panel, position);
	const rear = position[2] + (sections.at(-1)?.z ?? 0);
	const exit: [number, number, number] = [
		position[0],
		position[1],
		rear + 0.0003,
	];
	add(
		root,
		name + "-engine-ring",
		new THREE.CylinderGeometry(radius, radius, 0.0007, 14),
		p.engine,
		exit,
		[Math.PI / 2, 0, 0],
	);
	add(
		root,
		name + "-exhaust",
		new THREE.CircleGeometry(radius * 0.66, 14),
		p.exhaust,
		[exit[0], exit[1], exit[2] + 0.00037],
	);
}

function buildCourierA(root: THREE.Group, p: Palette) {
	add(
		root,
		"courier-fuselage",
		planform(
			[
				[0, -0.022],
				[0.01, -0.019],
				[0.015, -0.011],
				[0.025, 0.004],
				[0.023, 0.019],
				[0.015, 0.027],
				[0.006, 0.024],
				[0, 0.02],
				[-0.006, 0.024],
				[-0.015, 0.027],
				[-0.023, 0.019],
				[-0.025, 0.004],
				[-0.015, -0.011],
				[-0.007, -0.022],
			],
			0.0048,
		),
		p.hull,
	);
	for (const [side, sign] of [
		["port", -1],
		["starboard", 1],
	] as const)
		add(
			root,
			"courier-bow-blade-" + side,
			sidePlanform(
				[
					[0.003, -0.034],
					[0.008, -0.032],
					[0.013, -0.013],
					[0.008, -0.006],
					[0.004, -0.016],
				],
				sign,
				0.0036,
			),
			p.panel,
			[0, 0.0007, 0],
		);
	add(
		root,
		"courier-dorsal-hull",
		loft([
			{ z: -0.029, width: 0.0005, top: 0.0005, bottom: 0.0004 },
			{ z: -0.019, width: 0.0048, top: 0.003, bottom: 0.0017 },
			{ z: -0.005, width: 0.009, top: 0.0046, bottom: 0.0022 },
			{ z: 0.011, width: 0.0095, top: 0.0038, bottom: 0.002 },
			{ z: 0.021, width: 0.0065, top: 0.0022, bottom: 0.0015 },
		]),
		p.panel,
		[0, 0.0016, 0],
	);
	add(
		root,
		"courier-cockpit-fairing",
		loft([
			{ z: -0.018, width: 0.002, top: 0.001, bottom: 0.0007 },
			{ z: -0.013, width: 0.0048, top: 0.0027, bottom: 0.0013 },
			{ z: -0.005, width: 0.0058, top: 0.0032, bottom: 0.0014 },
			{ z: 0.003, width: 0.0042, top: 0.0018, bottom: 0.001 },
		]),
		p.hull,
		[0, 0.004, 0],
	);
	add(
		root,
		"courier-cockpit",
		loft([
			{ z: -0.014, width: 0.0014, top: 0.0008, bottom: 0.0006 },
			{ z: -0.011, width: 0.0035, top: 0.0018, bottom: 0.0013 },
			{ z: -0.006, width: 0.0043, top: 0.002, bottom: 0.0014 },
			{ z: -0.001, width: 0.003, top: 0.0007, bottom: 0.0008 },
		]),
		p.canopy,
		[0, 0.0056, 0],
	);
	add(
		root,
		"courier-canopy-frame",
		planform(
			[
				[-0.00035, -0.019],
				[0.00035, -0.019],
				[0.00055, -0.002],
				[-0.00055, -0.002],
			],
			0.00035,
			0.00005,
		),
		p.trim,
		[0, 0.0075, 0],
	);
	for (const [side, sign] of [
		["port", -1],
		["starboard", 1],
	] as const) {
		add(
			root,
			"courier-shoulder-armor-" + side,
			sidePlanform(
				[
					[0.01, -0.005],
					[0.021, -0.001],
					[0.021, 0.015],
					[0.012, 0.019],
				],
				sign,
				0.0012,
				0.00015,
			),
			p.panel,
			[0, 0.0044, 0],
		);
		add(
			root,
			"courier-nacelle-mount-" + side,
			sidePlanform(
				[
					[0.007, 0.001],
					[0.016, 0.001],
					[0.02, 0.01],
					[0.019, 0.023],
					[0.011, 0.024],
					[0.008, 0.014],
				],
				sign,
				0.0038,
			),
			p.hull,
			[0, 0.0012, 0],
		);
		const x = 0.0155 * sign;
		enginePod(
			root,
			"courier-" + side,
			[x, 0.0015, 0],
			[
				{ z: 0.002, width: 0.0024, top: 0.0023, bottom: 0.0021 },
				{ z: 0.008, width: 0.0037, top: 0.0032, bottom: 0.0028 },
				{ z: 0.021, width: 0.004, top: 0.0033, bottom: 0.0029 },
				{ z: 0.03, width: 0.0037, top: 0.003, bottom: 0.0027 },
			],
			0.00245,
			p,
		);
		for (let vent = 0; vent < 3; vent += 1) {
			const front = 0.009 + vent * 0.0034;
			add(
				root,
				"courier-engine-vent-" + side + "-" + vent,
				sidePlanform(
					[
						[0.0135, front],
						[0.0172, front],
						[0.0174, front + 0.0015],
						[0.0137, front + 0.0015],
					],
					sign,
					0.00025,
					0.00004,
				),
				p.engine,
				[0, 0.0051, 0],
			);
		}
	}
	add(
		root,
		"courier-keel-accent",
		planform(
			[
				[-0.002, 0.003],
				[0.002, 0.003],
				[0.004, 0.018],
				[0, 0.021],
				[-0.004, 0.018],
			],
			0.00025,
			0,
		),
		p.accent,
		[0, 0.00415, 0],
	);
}

function buildCourierB(root: THREE.Group, p: Palette) {
	add(
		root,
		"courier-fuselage",
		planform(
			[
				[0, -0.016],
				[0.011, -0.014],
				[0.019, -0.002],
				[0.02, 0.023],
				[0.012, 0.031],
				[-0.012, 0.031],
				[-0.02, 0.023],
				[-0.019, -0.002],
				[-0.011, -0.014],
			],
			0.006,
		),
		p.hull,
	);
	for (const [side, sign] of [
		["port", -1],
		["starboard", 1],
	] as const) {
		add(
			root,
			"courier-prong-" + side,
			sidePlanform(
				[
					[0.0025, -0.035],
					[0.0075, -0.033],
					[0.014, -0.004],
					[0.01, 0.011],
					[0.0045, -0.007],
				],
				sign,
				0.004,
			),
			p.panel,
			[0, 0.0008, 0],
		);
		add(
			root,
			"courier-prong-accent-" + side,
			sidePlanform(
				[
					[0.006, -0.029],
					[0.008, -0.028],
					[0.01, -0.011],
					[0.008, -0.008],
				],
				sign,
				0.00025,
				0,
			),
			p.accent,
			[0, 0.0035, 0],
		);
		add(
			root,
			"courier-nacelle-mount-" + side,
			sidePlanform(
				[
					[0.008, 0.002],
					[0.018, 0.001],
					[0.021, 0.029],
					[0.01, 0.03],
				],
				sign,
				0.0048,
			),
			p.trim,
		);
		const x = 0.015 * sign;
		enginePod(
			root,
			"courier-" + side,
			[x, 0.0006, 0],
			[
				{ z: -0.001, width: 0.0025, top: 0.0025, bottom: 0.0022 },
				{ z: 0.006, width: 0.0042, top: 0.0035, bottom: 0.003 },
				{ z: 0.025, width: 0.0043, top: 0.0036, bottom: 0.0031 },
				{ z: 0.032, width: 0.0038, top: 0.0032, bottom: 0.0029 },
			],
			0.00255,
			p,
		);
	}
	add(
		root,
		"courier-ventral-keel",
		loft([
			{ z: -0.026, width: 0.001, top: 0.0005, bottom: 0.0007 },
			{ z: -0.012, width: 0.0038, top: 0.0015, bottom: 0.0028 },
			{ z: 0.013, width: 0.0045, top: 0.0017, bottom: 0.0032 },
			{ z: 0.027, width: 0.0028, top: 0.001, bottom: 0.002 },
		]),
		p.trim,
		[0, -0.0024, 0],
	);
	add(
		root,
		"courier-cockpit-fairing",
		loft([
			{ z: -0.02, width: 0.001, top: 0.0008, bottom: 0.0005 },
			{ z: -0.011, width: 0.0052, top: 0.0033, bottom: 0.0015 },
			{ z: 0.004, width: 0.0065, top: 0.004, bottom: 0.0018 },
			{ z: 0.014, width: 0.0048, top: 0.0022, bottom: 0.0012 },
		]),
		p.panel,
		[0, 0.0034, 0],
	);
	add(
		root,
		"courier-cockpit",
		loft([
			{ z: -0.017, width: 0.0005, top: 0.0004, bottom: 0.0003 },
			{ z: -0.009, width: 0.0038, top: 0.002, bottom: 0.0014 },
			{ z: 0.002, width: 0.0047, top: 0.0023, bottom: 0.0015 },
			{ z: 0.009, width: 0.003, top: 0.0008, bottom: 0.0008 },
		]),
		p.canopy,
		[0, 0.0061, 0],
	);
	add(
		root,
		"courier-aft-deck",
		planform(
			[
				[-0.007, 0.014],
				[0.007, 0.014],
				[0.009, 0.027],
				[-0.009, 0.027],
			],
			0.001,
			0.00015,
		),
		p.accent,
		[0, 0.0041, 0],
	);
}

function buildCourierC(root: THREE.Group, p: Palette) {
	add(
		root,
		"courier-fuselage",
		planform(
			[
				[0, -0.022],
				[0.01, -0.019],
				[0.021, -0.008],
				[0.023, 0.016],
				[0.013, 0.03],
				[-0.011, 0.029],
				[-0.024, 0.018],
				[-0.022, -0.009],
				[-0.008, -0.025],
			],
			0.0046,
		),
		p.hull,
	);
	for (const [side, sign] of [
		["port", -1],
		["starboard", 1],
	] as const)
		add(
			root,
			"courier-utility-prong-" + side,
			sidePlanform(
				[
					[0.003, -0.033],
					[0.007, -0.032],
					[0.012, -0.01],
					[0.008, -0.002],
					[0.004, -0.013],
				],
				sign,
				0.0032,
			),
			p.panel,
			[0, 0.0008, 0],
		);
	add(
		root,
		"courier-dorsal-hull",
		loft([
			{ z: -0.027, width: 0.001, top: 0.0007, bottom: 0.0005 },
			{ z: -0.013, width: 0.006, top: 0.0036, bottom: 0.0018 },
			{ z: 0.004, width: 0.009, top: 0.0045, bottom: 0.002 },
			{ z: 0.021, width: 0.0055, top: 0.0026, bottom: 0.0014 },
		]),
		p.panel,
		[0, 0.0018, 0],
	);
	add(
		root,
		"courier-cockpit-fairing",
		loft([
			{ z: -0.021, width: 0.0005, top: 0.0005, bottom: 0.0003 },
			{ z: -0.013, width: 0.0045, top: 0.0028, bottom: 0.0013 },
			{ z: -0.002, width: 0.0052, top: 0.0032, bottom: 0.0014 },
			{ z: 0.006, width: 0.0034, top: 0.0014, bottom: 0.0008 },
		]),
		p.hull,
		[0, 0.0037, 0],
	);
	add(
		root,
		"courier-cockpit",
		loft([
			{ z: -0.018, width: 0.0004, top: 0.0003, bottom: 0.0003 },
			{ z: -0.011, width: 0.0032, top: 0.0018, bottom: 0.0013 },
			{ z: -0.003, width: 0.0038, top: 0.0019, bottom: 0.0013 },
			{ z: 0.002, width: 0.0024, top: 0.0006, bottom: 0.0007 },
		]),
		p.canopy,
		[0, 0.0057, 0],
	);
	for (const [side, sign] of [
		["port", -1],
		["starboard", 1],
	] as const) {
		add(
			root,
			"courier-nacelle-mount-" + side,
			sidePlanform(
				[
					[0.007, 0.002],
					[0.018, 0.002],
					[0.019, 0.025],
					[0.008, 0.023],
				],
				sign,
				0.0035,
			),
			p.trim,
			[0, 0.0007, 0],
		);
		const x = 0.0155 * sign;
		enginePod(
			root,
			"courier-" + side,
			[x, 0.001, 0],
			[
				{ z: 0.003, width: 0.0022, top: 0.0022, bottom: 0.002 },
				{ z: 0.01, width: 0.0037, top: 0.0031, bottom: 0.0027 },
				{ z: 0.024, width: 0.0039, top: 0.0032, bottom: 0.0028 },
				{ z: 0.029, width: 0.0034, top: 0.0028, bottom: 0.0025 },
			],
			0.00225,
			p,
		);
	}
	for (const [side, sign] of [
		["port", -1],
		["starboard", 1],
	] as const)
		add(
			root,
			"courier-utility-shoulder-" + side,
			sidePlanform(
				[
					[0.011, -0.006],
					[0.019, -0.003],
					[0.019, 0.015],
					[0.011, 0.018],
				],
				sign,
				0.0014,
				0.0002,
			),
			p.panel,
			[0, 0.0036, 0],
		);
	add(
		root,
		"courier-sensor-housing",
		new THREE.CylinderGeometry(0.0027, 0.003, 0.0014, 12),
		p.trim,
		[-0.011, 0.004, 0.008],
	);
	add(
		root,
		"courier-sensor-cap",
		new THREE.CylinderGeometry(0.0013, 0.0013, 0.0015, 12),
		p.accent,
		[-0.011, 0.0048, 0.008],
	);
}

function buildInterceptorA(root: THREE.Group, p: Palette) {
	add(
		root,
		"interceptor-fuselage",
		loft([
			{ z: -0.034, width: 0.0004, top: 0.0004, bottom: 0.0003 },
			{ z: -0.022, width: 0.0038, top: 0.0026, bottom: 0.0018 },
			{ z: -0.008, width: 0.0062, top: 0.0047, bottom: 0.0027 },
			{ z: 0.013, width: 0.0068, top: 0.0042, bottom: 0.0028 },
			{ z: 0.029, width: 0.0042, top: 0.0025, bottom: 0.0022 },
		]),
		p.hull,
	);
	for (const [side, sign] of [
		["port", -1],
		["starboard", 1],
	] as const) {
		add(
			root,
			"interceptor-wing-" + side,
			sidePlanform(
				[
					[0.0035, -0.01],
					[0.009, -0.006],
					[0.019, 0.007],
					[0.018, 0.017],
					[0.007, 0.012],
				],
				sign,
				0.0032,
			),
			p.panel,
			[0, -0.0002, 0],
		);
		add(
			root,
			"interceptor-wing-inset-" + side,
			sidePlanform(
				[
					[0.008, -0.003],
					[0.011, -0.001],
					[0.021, 0.008],
					[0.018, 0.012],
					[0.009, 0.008],
				],
				sign,
				0.0003,
				0.00005,
			),
			p.accent,
			[0, 0.00215, 0],
		);
		add(
			root,
			"interceptor-nacelle-mount-" + side,
			sidePlanform(
				[
					[0.004, 0.002],
					[0.011, 0.003],
					[0.012, 0.027],
					[0.005, 0.026],
				],
				sign,
				0.0036,
			),
			p.hull,
			[0, 0.0004, 0],
		);
		const x = 0.0085 * sign;
		enginePod(
			root,
			"interceptor-" + side,
			[x, 0.0008, 0],
			[
				{ z: 0.001, width: 0.002, top: 0.002, bottom: 0.0018 },
				{ z: 0.008, width: 0.003, top: 0.0028, bottom: 0.0025 },
				{ z: 0.024, width: 0.0031, top: 0.0029, bottom: 0.0026 },
				{ z: 0.03, width: 0.0028, top: 0.0026, bottom: 0.0024 },
			],
			0.00195,
			p,
		);
		add(
			root,
			"interceptor-hardpoint-" + side,
			new THREE.CylinderGeometry(0.00055, 0.0007, 0.008, 8),
			p.engine,
			[0.0215 * sign, -0.0012, 0.002],
			[Math.PI / 2, 0, 0],
		);
		add(
			root,
			"interceptor-tail-" + side,
			planform(
				[
					[0, 0.013],
					[0.0038, 0.017],
					[0.0025, 0.026],
					[0, 0.026],
				],
				0.0012,
				0.00012,
			).rotateZ(Math.PI / 2),
			p.trim,
			[0.0042 * sign, 0.0028, 0],
		);
	}
	add(
		root,
		"interceptor-aft-frame",
		planform(
			[
				[-0.014, 0.013],
				[0.014, 0.013],
				[0.015, 0.019],
				[-0.015, 0.019],
			],
			0.0024,
			0.0003,
		),
		p.trim,
		[0, -0.0012, 0],
	);
	add(
		root,
		"interceptor-ventral-keel",
		planform(
			[
				[-0.011, -0.006],
				[0.011, -0.006],
				[0.013, 0.024],
				[-0.013, 0.024],
			],
			0.0014,
			0.00015,
		),
		p.panel,
		[0, -0.0032, 0],
	);
	add(
		root,
		"interceptor-cockpit-fairing",
		loft([
			{ z: -0.018, width: 0.0022, top: 0.0012, bottom: 0.0008 },
			{ z: -0.013, width: 0.0038, top: 0.0025, bottom: 0.0013 },
			{ z: -0.006, width: 0.0045, top: 0.0031, bottom: 0.0015 },
			{ z: 0.002, width: 0.0032, top: 0.0015, bottom: 0.001 },
		]),
		p.panel,
		[0, 0.0027, 0],
	);
	add(
		root,
		"interceptor-cockpit",
		loft([
			{ z: -0.0145, width: 0.0015, top: 0.0008, bottom: 0.0006 },
			{ z: -0.011, width: 0.0027, top: 0.0017, bottom: 0.0012 },
			{ z: -0.007, width: 0.0032, top: 0.0018, bottom: 0.0012 },
			{ z: -0.002, width: 0.0022, top: 0.0006, bottom: 0.0007 },
		]),
		p.canopy,
		[0, 0.0049, 0],
	);
}

function buildInterceptorB(root: THREE.Group, p: Palette) {
	add(
		root,
		"interceptor-fuselage",
		loft([
			{ z: -0.034, width: 0.0004, top: 0.0004, bottom: 0.0003 },
			{ z: -0.02, width: 0.005, top: 0.0032, bottom: 0.002 },
			{ z: -0.004, width: 0.007, top: 0.0048, bottom: 0.0028 },
			{ z: 0.016, width: 0.008, top: 0.004, bottom: 0.003 },
			{ z: 0.028, width: 0.005, top: 0.0025, bottom: 0.0023 },
		]),
		p.hull,
	);
	add(
		root,
		"interceptor-engine-deck",
		planform(
			[
				[-0.015, 0.002],
				[0.015, 0.002],
				[0.017, 0.024],
				[-0.017, 0.024],
			],
			0.0014,
			0.00015,
		),
		p.trim,
		[0, -0.0028, 0],
	);
	for (const [side, sign] of [
		["port", -1],
		["starboard", 1],
	] as const) {
		add(
			root,
			"interceptor-wing-" + side,
			sidePlanform(
				[
					[0.006, -0.009],
					[0.01, -0.007],
					[0.017, -0.002],
					[0.019, 0.022],
					[0.011, 0.028],
					[0.007, 0.012],
				],
				sign,
				0.003,
			),
			p.panel,
		);
		add(
			root,
			"interceptor-nacelle-mount-" + side,
			sidePlanform(
				[
					[0.004, 0.004],
					[0.013, 0.004],
					[0.014, 0.027],
					[0.005, 0.026],
				],
				sign,
				0.004,
			),
			p.hull,
		);
		const x = 0.01 * sign;
		enginePod(
			root,
			"interceptor-" + side,
			[x, 0.0005, 0],
			[
				{ z: 0.004, width: 0.0025, top: 0.0024, bottom: 0.0022 },
				{ z: 0.011, width: 0.0034, top: 0.003, bottom: 0.0027 },
				{ z: 0.026, width: 0.0035, top: 0.0031, bottom: 0.0028 },
				{ z: 0.031, width: 0.0031, top: 0.0028, bottom: 0.0025 },
			],
			0.0021,
			p,
		);
		add(
			root,
			"interceptor-edge-" + side,
			sidePlanform(
				[
					[0.016, 0],
					[0.021, 0.003],
					[0.021, 0.011],
					[0.018, 0.012],
				],
				sign,
				0.0003,
				0,
			),
			p.accent,
			[0, 0.0022, 0],
		);
	}
	add(
		root,
		"interceptor-cockpit-fairing",
		loft([
			{ z: -0.0185, width: 0.0025, top: 0.0013, bottom: 0.0009 },
			{ z: -0.013, width: 0.0043, top: 0.0028, bottom: 0.0014 },
			{ z: -0.004, width: 0.005, top: 0.0032, bottom: 0.0015 },
			{ z: 0.004, width: 0.0032, top: 0.0013, bottom: 0.0008 },
		]),
		p.panel,
		[0, 0.003, 0],
	);
	add(
		root,
		"interceptor-cockpit",
		loft([
			{ z: -0.015, width: 0.0017, top: 0.0009, bottom: 0.0007 },
			{ z: -0.011, width: 0.003, top: 0.0018, bottom: 0.0013 },
			{ z: -0.005, width: 0.0036, top: 0.0019, bottom: 0.0013 },
			{ z: 0, width: 0.0022, top: 0.0006, bottom: 0.0007 },
		]),
		p.canopy,
		[0, 0.0051, 0],
	);
	add(
		root,
		"interceptor-ventral-blade",
		planform(
			[
				[0, 0.008],
				[0.005, 0.015],
				[0.002, 0.027],
				[0, 0.027],
			],
			0.0012,
			0.0001,
		).rotateZ(Math.PI / 2),
		p.trim,
		[0, -0.003, 0],
	);
}

function buildInterceptorC(root: THREE.Group, p: Palette) {
	add(
		root,
		"interceptor-fuselage",
		loft([
			{ z: -0.035, width: 0.0004, top: 0.0004, bottom: 0.0003 },
			{ z: -0.021, width: 0.004, top: 0.003, bottom: 0.0018 },
			{ z: -0.006, width: 0.0055, top: 0.0044, bottom: 0.0025 },
			{ z: 0.013, width: 0.0048, top: 0.0034, bottom: 0.0023 },
			{ z: 0.02, width: 0.0025, top: 0.0018, bottom: 0.0015 },
		]),
		p.hull,
	);
	add(
		root,
		"interceptor-forward-frame",
		planform(
			[
				[-0.015, -0.008],
				[0.015, -0.008],
				[0.017, 0.001],
				[-0.017, 0.001],
			],
			0.0032,
		),
		p.panel,
	);
	add(
		root,
		"interceptor-aft-frame",
		planform(
			[
				[-0.018, 0.012],
				[0.018, 0.012],
				[0.018, 0.02],
				[-0.018, 0.02],
			],
			0.0035,
		),
		p.trim,
	);
	add(
		root,
		"interceptor-ventral-keel",
		planform(
			[
				[-0.0165, -0.005],
				[0.0165, -0.005],
				[0.0175, 0.021],
				[-0.0175, 0.021],
			],
			0.0016,
			0.0002,
		),
		p.panel,
		[0, -0.0025, 0],
	);
	for (const [side, sign] of [
		["port", -1],
		["starboard", 1],
	] as const) {
		add(
			root,
			"interceptor-wing-" + side,
			sidePlanform(
				[
					[0.004, -0.01],
					[0.014, -0.004],
					[0.019, 0.008],
					[0.015, 0.018],
					[0.006, 0.01],
				],
				sign,
				0.0027,
			),
			p.panel,
			[0, -0.0004, 0],
		);
		add(
			root,
			"interceptor-nacelle-mount-" + side,
			sidePlanform(
				[
					[0.009, -0.005],
					[0.015, -0.005],
					[0.016, 0.03],
					[0.009, 0.03],
				],
				sign,
				0.0042,
			),
			p.hull,
		);
		const x = 0.012 * sign;
		enginePod(
			root,
			"interceptor-" + side,
			[x, 0.0005, 0],
			[
				{ z: -0.007, width: 0.0022, top: 0.0022, bottom: 0.002 },
				{ z: 0, width: 0.0035, top: 0.003, bottom: 0.0027 },
				{ z: 0.026, width: 0.0036, top: 0.0031, bottom: 0.0028 },
				{ z: 0.033, width: 0.0032, top: 0.0028, bottom: 0.0025 },
			],
			0.00215,
			p,
		);
		add(
			root,
			"interceptor-boom-stripe-" + side,
			sidePlanform(
				[
					[0.012, 0.002],
					[0.014, 0.002],
					[0.014, 0.024],
					[0.012, 0.024],
				],
				sign,
				0.00025,
				0,
			),
			p.accent,
			[0, 0.0038, 0],
		);
	}
	add(
		root,
		"interceptor-cockpit-fairing",
		loft([
			{ z: -0.019, width: 0.0022, top: 0.0012, bottom: 0.0008 },
			{ z: -0.0135, width: 0.0036, top: 0.0025, bottom: 0.0012 },
			{ z: -0.006, width: 0.0042, top: 0.003, bottom: 0.0014 },
			{ z: 0.002, width: 0.0028, top: 0.0012, bottom: 0.0008 },
		]),
		p.panel,
		[0, 0.0027, 0],
	);
	add(
		root,
		"interceptor-cockpit",
		loft([
			{ z: -0.0155, width: 0.0015, top: 0.0008, bottom: 0.0006 },
			{ z: -0.011, width: 0.0027, top: 0.0017, bottom: 0.0011 },
			{ z: -0.007, width: 0.0031, top: 0.0018, bottom: 0.0012 },
			{ z: -0.002, width: 0.002, top: 0.0006, bottom: 0.0007 },
		]),
		p.canopy,
		[0, 0.0048, 0],
	);
}

function buildFreighterA(root: THREE.Group, p: Palette) {
	add(
		root,
		"freighter-fuselage",
		loft([
			{ z: -0.032, width: 0.001, top: 0.001, bottom: 0.0008 },
			{ z: -0.021, width: 0.005, top: 0.004, bottom: 0.003 },
			{ z: 0.006, width: 0.0065, top: 0.005, bottom: 0.004 },
			{ z: 0.029, width: 0.0055, top: 0.0038, bottom: 0.0035 },
		]),
		p.panel,
	);
	add(
		root,
		"freighter-frame-front",
		planform(
			[
				[-0.021, -0.014],
				[0.021, -0.014],
				[0.021, -0.007],
				[-0.021, -0.007],
			],
			0.004,
		),
		p.trim,
		[0, -0.0005, 0],
	);
	add(
		root,
		"freighter-frame-rear",
		planform(
			[
				[-0.021, 0.011],
				[0.021, 0.011],
				[0.021, 0.018],
				[-0.021, 0.018],
			],
			0.004,
		),
		p.trim,
		[0, -0.0005, 0],
	);
	add(
		root,
		"freighter-pod-port",
		planform(
			[
				[-0.023, -0.024],
				[-0.011, -0.023],
				[-0.008, -0.016],
				[-0.008, 0.026],
				[-0.012, 0.031],
				[-0.023, 0.027],
			],
			0.011,
			0.0011,
		),
		p.hull,
		[0, 0.001, 0],
	);
	add(
		root,
		"freighter-pod-starboard",
		planform(
			[
				[0.009, -0.017],
				[0.013, -0.02],
				[0.021, -0.016],
				[0.021, 0.014],
				[0.017, 0.019],
				[0.009, 0.016],
			],
			0.0085,
			0.0009,
		),
		p.hull,
		[0, 0.0003, 0],
	);
	add(
		root,
		"freighter-cargo-rail-port",
		planform(
			[
				[-0.019, -0.02],
				[-0.0165, -0.02],
				[-0.0165, 0.026],
				[-0.019, 0.026],
			],
			0.0007,
			0.0001,
		),
		p.trim,
		[0, 0.0075, 0],
	);
	add(
		root,
		"freighter-bridge",
		planform(
			[
				[0.003, -0.026],
				[0.011, -0.026],
				[0.018, -0.017],
				[0.017, -0.008],
				[0.008, -0.005],
				[0.003, -0.013],
			],
			0.0055,
			0.0007,
		),
		p.panel,
		[0, 0.003, 0],
	);
	add(
		root,
		"freighter-cockpit",
		loft([
			{ z: -0.024, width: 0.0005, top: 0.0004, bottom: 0.0003 },
			{ z: -0.02, width: 0.0032, top: 0.0018, bottom: 0.0012 },
			{ z: -0.014, width: 0.0038, top: 0.002, bottom: 0.0013 },
			{ z: -0.01, width: 0.0026, top: 0.0007, bottom: 0.0008 },
		]),
		p.canopy,
		[0.011, 0.0063, 0],
	);
	for (const [side, sign] of [
		["port", -1],
		["starboard", 1],
	] as const) {
		const x = sign < 0 ? -0.0155 : 0.0155;
		add(
			root,
			"freighter-nacelle-mount-" + side,
			sidePlanform(
				[
					[0.008, 0.014],
					[0.02, 0.014],
					[0.02, 0.029],
					[0.009, 0.025],
				],
				sign,
				0.005,
			),
			p.trim,
			[0, -0.0002, 0],
		);
		enginePod(
			root,
			"freighter-" + side,
			[x, 0.001, 0],
			[
				{ z: 0.013, width: 0.0027, top: 0.0027, bottom: 0.0025 },
				{ z: 0.019, width: 0.0038, top: 0.0036, bottom: 0.0033 },
				{ z: 0.031, width: 0.0037, top: 0.0035, bottom: 0.0032 },
			],
			0.00235,
			p,
		);
	}
	add(
		root,
		"freighter-cargo-marking",
		planform(
			[
				[-0.021, -0.004],
				[-0.009, -0.004],
				[-0.009, 0.001],
				[-0.021, 0.001],
			],
			0.00025,
			0,
		),
		p.accent,
		[0, 0.00765, 0],
	);
}

function buildFreighterB(root: THREE.Group, p: Palette) {
	add(
		root,
		"freighter-fuselage",
		loft([
			{ z: -0.03, width: 0.0008, top: 0.0008, bottom: 0.0006 },
			{ z: -0.019, width: 0.004, top: 0.0035, bottom: 0.0025 },
			{ z: 0.006, width: 0.0045, top: 0.004, bottom: 0.003 },
			{ z: 0.03, width: 0.0035, top: 0.0028, bottom: 0.0026 },
		]),
		p.panel,
	);
	for (const [side, sign] of [
		["port", -1],
		["starboard", 1],
	] as const) {
		const cargoRail =
			sign < 0
				? ([
						[0.009, -0.025],
						[0.019, -0.027],
						[0.023, -0.019],
						[0.023, 0.025],
						[0.019, 0.032],
						[0.01, 0.028],
					] as const)
				: ([
						[0.009, -0.012],
						[0.017, -0.015],
						[0.021, -0.009],
						[0.021, 0.027],
						[0.017, 0.031],
						[0.01, 0.026],
					] as const);
		add(
			root,
			"freighter-pod-" + side,
			sidePlanform(cargoRail, sign, sign < 0 ? 0.011 : 0.0085, 0.001),
			p.hull,
			[0, 0.0005, 0],
		);
		add(
			root,
			"freighter-nacelle-mount-" + side,
			sidePlanform(
				[
					[0.01, 0.013],
					[0.021, 0.013],
					[0.021, 0.03],
					[0.01, 0.027],
				],
				sign,
				0.0055,
			),
			p.trim,
		);
		const x = 0.016 * sign;
		enginePod(
			root,
			"freighter-" + side,
			[x, 0.0006, 0],
			[
				{ z: 0.013, width: 0.0028, top: 0.0028, bottom: 0.0025 },
				{ z: 0.02, width: 0.0038, top: 0.0036, bottom: 0.0032 },
				{ z: 0.032, width: 0.0037, top: 0.0035, bottom: 0.0031 },
			],
			0.00235,
			p,
		);
		add(
			root,
			"freighter-cargo-stripe-" + side,
			sidePlanform(
				[
					[0.013, -0.015],
					[0.016, -0.016],
					[0.016, 0.021],
					[0.013, 0.021],
				],
				sign,
				0.0003,
				0,
			),
			p.accent,
			[0, 0.0068, 0],
		);
	}
	add(
		root,
		"freighter-frame-front",
		planform(
			[
				[-0.022, -0.018],
				[0.022, -0.018],
				[0.022, -0.01],
				[-0.022, -0.01],
			],
			0.004,
		),
		p.trim,
	);
	add(
		root,
		"freighter-frame-rear",
		planform(
			[
				[-0.021, 0.012],
				[0.021, 0.012],
				[0.021, 0.02],
				[-0.021, 0.02],
			],
			0.004,
		),
		p.trim,
	);
	add(
		root,
		"freighter-bridge",
		planform(
			[
				[-0.012, -0.029],
				[0.012, -0.029],
				[0.018, -0.019],
				[0.011, -0.011],
				[-0.011, -0.011],
				[-0.018, -0.019],
			],
			0.0055,
			0.0007,
		),
		p.panel,
		[0.0045, 0.0032, 0],
	);
	add(
		root,
		"freighter-cockpit",
		loft([
			{ z: -0.026, width: 0.0006, top: 0.0005, bottom: 0.0004 },
			{ z: -0.021, width: 0.004, top: 0.002, bottom: 0.0013 },
			{ z: -0.015, width: 0.005, top: 0.0022, bottom: 0.0014 },
			{ z: -0.012, width: 0.003, top: 0.0007, bottom: 0.0008 },
		]),
		p.canopy,
		[0.0045, 0.0065, 0],
	);
}

function buildFreighterC(root: THREE.Group, p: Palette) {
	add(
		root,
		"freighter-fuselage",
		loft([
			{ z: -0.029, width: 0.0008, top: 0.0008, bottom: 0.0006 },
			{ z: -0.019, width: 0.0042, top: 0.0033, bottom: 0.0028 },
			{ z: -0.004, width: 0.0055, top: 0.0042, bottom: 0.0034 },
			{ z: 0.014, width: 0.0052, top: 0.0038, bottom: 0.0034 },
			{ z: 0.026, width: 0.004, top: 0.0025, bottom: 0.0025 },
		]),
		p.hull,
	);
	add(
		root,
		"freighter-aft-deck",
		planform(
			[
				[-0.025, -0.003],
				[0.015, 0.001],
				[0.02, 0.025],
				[0.012, 0.03],
				[-0.021, 0.033],
				[-0.026, 0.026],
			],
			0.006,
		),
		p.trim,
		[0, -0.001, 0],
	);
	for (const [side, sign] of [
		["port", -1],
		["starboard", 1],
	] as const) {
		const servicePod =
			sign < 0
				? ([
						[0.009, -0.005],
						[0.022, -0.003],
						[0.024, 0.025],
						[0.019, 0.03],
						[0.009, 0.026],
					] as const)
				: ([
						[0.009, 0.006],
						[0.016, 0.005],
						[0.018, 0.026],
						[0.014, 0.029],
						[0.009, 0.025],
					] as const);
		add(
			root,
			"freighter-pod-" + side,
			sidePlanform(servicePod, sign, sign < 0 ? 0.0105 : 0.006, 0.0009),
			p.panel,
			[0, 0.001, 0],
		);
		add(
			root,
			"freighter-nacelle-mount-" + side,
			sidePlanform(
				[
					[0.009, 0.013],
					[0.02, 0.013],
					[0.02, 0.031],
					[0.009, 0.028],
				],
				sign,
				0.005,
			),
			p.hull,
		);
		const x = (sign < 0 ? 0.017 : 0.013) * sign;
		enginePod(
			root,
			"freighter-" + side,
			[x, 0.0005, 0],
			[
				{ z: 0.012, width: 0.0027, top: 0.0027, bottom: 0.0025 },
				{ z: 0.02, width: 0.0037, top: 0.0035, bottom: 0.0032 },
				{ z: 0.033, width: 0.0036, top: 0.0034, bottom: 0.0031 },
			],
			0.0023,
			p,
		);
	}
	add(
		root,
		"freighter-bridge",
		loft([
			{ z: -0.029, width: 0.001, top: 0.0008, bottom: 0.0005 },
			{ z: -0.019, width: 0.006, top: 0.0035, bottom: 0.0018 },
			{ z: -0.007, width: 0.007, top: 0.004, bottom: 0.002 },
			{ z: 0.002, width: 0.0045, top: 0.002, bottom: 0.0012 },
		]),
		p.panel,
		[0.006, 0.004, 0],
	);
	add(
		root,
		"freighter-cockpit",
		loft([
			{ z: -0.026, width: 0.0005, top: 0.0004, bottom: 0.0003 },
			{ z: -0.018, width: 0.004, top: 0.0021, bottom: 0.0014 },
			{ z: -0.01, width: 0.0048, top: 0.0023, bottom: 0.0015 },
			{ z: -0.004, width: 0.003, top: 0.0007, bottom: 0.0008 },
		]),
		p.canopy,
		[0.006, 0.0066, 0],
	);
	for (const [index, x] of [-0.018, -0.007, 0.011].entries()) {
		add(
			root,
			"freighter-cargo-crate-" + index,
			planform(
				[
					[x - 0.005, 0.004],
					[x + 0.005, 0.004],
					[x + 0.005, 0.015],
					[x - 0.005, 0.015],
				],
				0.004,
				0.0005,
			),
			index === 1 ? p.accent : p.hull,
			[0, 0.005, 0],
		);
	}
}

/** Build a fresh deterministic mesh for one explicitly selected design. */
export function buildShipMesh(
	id: HullId,
	variant: HullVariantId = "a",
): ShipMesh {
	const root = new THREE.Group();
	root.name = "hull-" + id;
	root.userData.hullId = id;
	root.userData.role = HULL_VISUALS[id].role;
	root.userData.variant = variant;
	root.userData.designRound = SHIP_DESIGN_ROUND;
	const palette = makePalette(id);
	if (id === "courier") {
		if (variant === "a") buildCourierA(root, palette);
		else if (variant === "b") buildCourierB(root, palette);
		else buildCourierC(root, palette);
	} else if (id === "interceptor") {
		if (variant === "a") buildInterceptorA(root, palette);
		else if (variant === "b") buildInterceptorB(root, palette);
		else buildInterceptorC(root, palette);
	} else if (variant === "a") buildFreighterA(root, palette);
	else if (variant === "b") buildFreighterB(root, palette);
	else buildFreighterC(root, palette);
	return { root };
}
