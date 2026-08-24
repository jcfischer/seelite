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
		lengthKm: 0.058,
		beamKm: 0.046,
		heightKm: 0.014,
		reachKm: 0.036,
	},
	interceptor: {
		role: "fast",
		lengthKm: 0.06,
		beamKm: 0.052,
		heightKm: 0.014,
		reachKm: 0.034,
	},
	freighter: {
		role: "cargo",
		lengthKm: 0.06,
		beamKm: 0.048,
		heightKm: 0.028,
		reachKm: 0.036,
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
	courier: { hull: 0x789099, panel: 0x435d66, accent: 0xc87842 },
	interceptor: { hull: 0x77778a, panel: 0x474759, accent: 0xc85445 },
	freighter: { hull: 0x8b816c, panel: 0x544d40, accent: 0xd09a4e },
};

function makePalette(id: HullId): Palette {
	const colors = liveries[id];
	const painted = (color: number, roughness: number, metalness: number) =>
		new THREE.MeshStandardMaterial({ color, roughness, metalness });
	return {
		hull: painted(colors.hull, 0.5, 0.34),
		panel: painted(colors.panel, 0.6, 0.28),
		trim: painted(0x1b292e, 0.5, 0.62),
		accent: painted(colors.accent, 0.56, 0.24),
		canopy: new THREE.MeshStandardMaterial({
			color: 0x07171e,
			emissive: 0x09232e,
			emissiveIntensity: 0.25,
			roughness: 0.16,
			metalness: 0.18,
		}),
		engine: painted(0x17252b, 0.38, 0.72),
		exhaust: new THREE.MeshStandardMaterial({
			color: 0x9ddcff,
			emissive: 0x58b9ff,
			emissiveIntensity: 0.8,
			roughness: 0.3,
			metalness: 0.12,
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

/** One beveled slab establishes an unmistakable top-down silhouette. */
function planform(
	points: ReadonlyArray<readonly [number, number]>,
	thickness: number,
	bevel = Math.min(thickness * 0.22, 0.001),
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

/** Eight-sided longitudinal sections form one coherent, light-catching mass. */
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
			indices.push(a, b, d, b, c, d);
		}
	}
	const front = vertices.length / 3;
	vertices.push(0, 0, sections[0].z);
	const rear = vertices.length / 3;
	vertices.push(0, 0, sections.at(-1)?.z ?? 0);
	const rearOffset = (sections.length - 1) * ringSize;
	for (let point = 0; point < ringSize; point += 1) {
		const next = (point + 1) % ringSize;
		indices.push(front, next, point);
		indices.push(rear, rearOffset + point, rearOffset + next);
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

function engineExit(
	root: THREE.Group,
	name: string,
	position: [number, number, number],
	radius: number,
	palette: Palette,
) {
	add(
		root,
		name + "-engine-ring",
		new THREE.TorusGeometry(radius, radius * 0.28, 5, 12),
		palette.engine,
		position,
	);
	add(
		root,
		name + "-exhaust",
		new THREE.CircleGeometry(radius * 0.68, 12),
		palette.exhaust,
		[position[0], position[1], position[2] + 0.0002],
	);
}

function buildCourier(root: THREE.Group, p: Palette) {
	add(
		root,
		"courier-fuselage",
		planform(
			[
				[0, -0.029],
				[0.006, -0.02],
				[0.014, -0.009],
				[0.023, 0.008],
				[0.021, 0.021],
				[0.011, 0.026],
				[0, 0.022],
				[-0.011, 0.026],
				[-0.021, 0.021],
				[-0.023, 0.008],
				[-0.014, -0.009],
				[-0.006, -0.02],
			],
			0.006,
		),
		p.hull,
	);
	add(
		root,
		"courier-dorsal-hull",
		loft([
			{ z: -0.027, width: 0.0005, top: 0.0005, bottom: 0.0004 },
			{ z: -0.017, width: 0.0048, top: 0.0032, bottom: 0.0015 },
			{ z: -0.003, width: 0.0092, top: 0.0054, bottom: 0.002 },
			{ z: 0.013, width: 0.0098, top: 0.0048, bottom: 0.002 },
			{ z: 0.023, width: 0.0064, top: 0.0028, bottom: 0.0016 },
		]),
		p.panel,
		[0, 0.0032, 0],
	);
	add(
		root,
		"courier-cockpit",
		loft([
			{ z: -0.019, width: 0.0005, top: 0.0004, bottom: 0.0002 },
			{ z: -0.012, width: 0.0036, top: 0.0024, bottom: 0.0004 },
			{ z: -0.003, width: 0.0045, top: 0.0022, bottom: 0.0004 },
			{ z: 0.002, width: 0.0028, top: 0.0007, bottom: 0.0003 },
		]),
		p.canopy,
		[0, 0.0074, 0],
	);
	for (const [side, sign] of [
		["port", -1],
		["starboard", 1],
	] as const) {
		add(
			root,
			"courier-wing-panel-" + side,
			planform(
				[
					[0.006 * sign, -0.01],
					[0.012 * sign, -0.006],
					[0.019 * sign, 0.009],
					[0.017 * sign, 0.017],
					[0.009 * sign, 0.012],
				],
				0.00045,
				0.0001,
			),
			p.panel,
			[0, 0.00425, 0],
		);
		add(
			root,
			"courier-accent-" + side,
			planform(
				[
					[0.008 * sign, -0.004],
					[0.0095 * sign, -0.001],
					[0.016 * sign, 0.011],
					[0.014 * sign, 0.012],
				],
				0.0003,
				0,
			),
			p.accent,
			[0, 0.00455, 0],
		);
		const x = 0.0125 * sign;
		add(
			root,
			"courier-nacelle-" + side,
			loft([
				{ z: -0.002, width: 0.0018, top: 0.0018, bottom: 0.0015 },
				{ z: 0.007, width: 0.0032, top: 0.0027, bottom: 0.0023 },
				{ z: 0.021, width: 0.0035, top: 0.0028, bottom: 0.0025 },
				{ z: 0.026, width: 0.0032, top: 0.0024, bottom: 0.0022 },
			]),
			p.engine,
			[x, 0.003, 0],
		);
		engineExit(root, "courier-" + side, [x, 0.003, 0.027], 0.0022, p);
	}
}

function buildInterceptor(root: THREE.Group, p: Palette) {
	add(
		root,
		"interceptor-fuselage",
		planform(
			[
				[0, -0.031],
				[0.005, -0.019],
				[0.011, -0.011],
				[0.026, 0.006],
				[0.024, 0.013],
				[0.008, 0.009],
				[0.006, 0.025],
				[-0.006, 0.025],
				[-0.008, 0.009],
				[-0.024, 0.013],
				[-0.026, 0.006],
				[-0.011, -0.011],
				[-0.005, -0.019],
			],
			0.0044,
		),
		p.hull,
	);
	add(
		root,
		"interceptor-dorsal-hull",
		loft([
			{ z: -0.031, width: 0.0003, top: 0.0003, bottom: 0.0002 },
			{ z: -0.018, width: 0.0038, top: 0.0026, bottom: 0.001 },
			{ z: -0.004, width: 0.0062, top: 0.0044, bottom: 0.0014 },
			{ z: 0.014, width: 0.0052, top: 0.0037, bottom: 0.0015 },
			{ z: 0.025, width: 0.0038, top: 0.0022, bottom: 0.0012 },
		]),
		p.panel,
		[0, 0.0023, 0],
	);
	add(
		root,
		"interceptor-cockpit",
		loft([
			{ z: -0.019, width: 0.0004, top: 0.0003, bottom: 0.0002 },
			{ z: -0.012, width: 0.0027, top: 0.0021, bottom: 0.0003 },
			{ z: -0.004, width: 0.0032, top: 0.0018, bottom: 0.0003 },
			{ z: 0.001, width: 0.0018, top: 0.0005, bottom: 0.0002 },
		]),
		p.canopy,
		[0, 0.0062, 0],
	);
	for (const [side, sign] of [
		["port", -1],
		["starboard", 1],
	] as const) {
		add(
			root,
			"interceptor-wing-panel-" + side,
			planform(
				[
					[0.006 * sign, -0.009],
					[0.011 * sign, -0.005],
					[0.0225 * sign, 0.006],
					[0.019 * sign, 0.009],
					[0.008 * sign, 0.005],
				],
				0.0004,
				0.00008,
			),
			p.accent,
			[0, 0.0034, 0],
		);
		const x = 0.0088 * sign;
		add(
			root,
			"interceptor-nacelle-" + side,
			loft([
				{ z: 0.001, width: 0.0015, top: 0.0015, bottom: 0.0012 },
				{ z: 0.009, width: 0.0027, top: 0.0021, bottom: 0.0018 },
				{ z: 0.026, width: 0.0028, top: 0.0022, bottom: 0.0019 },
			]),
			p.engine,
			[x, 0.0022, 0],
		);
		engineExit(root, "interceptor-" + side, [x, 0.0022, 0.027], 0.0018, p);
	}
	add(
		root,
		"interceptor-tail",
		planform(
			[
				[0, 0.008],
				[0.0075, 0.014],
				[0.004, 0.023],
				[0, 0.023],
			],
			0.0014,
			0.00015,
		).rotateZ(Math.PI / 2),
		p.trim,
		[0, 0.0038, 0],
	);
}

function buildFreighter(root: THREE.Group, p: Palette) {
	add(
		root,
		"freighter-fuselage",
		planform(
			[
				[0, -0.03],
				[0.008, -0.024],
				[0.014, -0.012],
				[0.015, 0.02],
				[0.009, 0.03],
				[-0.01, 0.03],
				[-0.015, 0.02],
				[-0.015, -0.012],
				[-0.008, -0.024],
			],
			0.011,
			0.0013,
		),
		p.hull,
	);
	add(
		root,
		"freighter-dorsal-hull",
		loft([
			{ z: -0.027, width: 0.003, top: 0.0015, bottom: 0.001 },
			{ z: -0.015, width: 0.007, top: 0.005, bottom: 0.002 },
			{ z: 0.006, width: 0.0085, top: 0.006, bottom: 0.0025 },
			{ z: 0.026, width: 0.007, top: 0.004, bottom: 0.002 },
		]),
		p.panel,
		[-0.002, 0.006, 0],
	);
	add(
		root,
		"freighter-bridge",
		loft([
			{ z: -0.022, width: 0.001, top: 0.001, bottom: 0.0005 },
			{ z: -0.015, width: 0.0042, top: 0.003, bottom: 0.001 },
			{ z: -0.005, width: 0.0045, top: 0.0032, bottom: 0.001 },
			{ z: 0.002, width: 0.0033, top: 0.0018, bottom: 0.0008 },
		]),
		p.canopy,
		[0.008, 0.0105, 0],
	);
	for (const [side, sign] of [
		["port", -1],
		["starboard", 1],
	] as const) {
		const x = 0.018 * sign;
		add(
			root,
			"freighter-pod-" + side,
			loft([
				{ z: -0.015, width: 0.0036, top: 0.0036, bottom: 0.0033 },
				{ z: -0.009, width: 0.0045, top: 0.0043, bottom: 0.004 },
				{ z: 0.016, width: 0.0045, top: 0.0043, bottom: 0.004 },
				{ z: 0.023, width: 0.0037, top: 0.0035, bottom: 0.0033 },
			]),
			p.panel,
			[x, 0.0045, 0],
		);
		add(
			root,
			"freighter-nacelle-" + side,
			loft([
				{ z: 0.012, width: 0.0027, top: 0.0027, bottom: 0.0024 },
				{ z: 0.029, width: 0.0035, top: 0.0032, bottom: 0.003 },
			]),
			p.engine,
			[x, 0.0045, 0],
		);
		engineExit(root, "freighter-" + side, [x, 0.0045, 0.0302], 0.0022, p);
	}
	add(
		root,
		"freighter-keel-accent",
		planform(
			[
				[-0.004, -0.024],
				[0.001, -0.027],
				[0.003, 0.021],
				[-0.004, 0.023],
			],
			0.0005,
			0,
		),
		p.accent,
		[-0.003, 0.0072, 0],
	);
}

/** Build a fresh deterministic mesh for one explicitly selected visual role. */
export function buildShipMesh(id: HullId): ShipMesh {
	const root = new THREE.Group();
	root.name = "hull-" + id;
	root.userData.hullId = id;
	root.userData.role = HULL_VISUALS[id].role;
	const palette = makePalette(id);
	if (id === "courier") buildCourier(root, palette);
	else if (id === "interceptor") buildInterceptor(root, palette);
	else buildFreighter(root, palette);
	return { root };
}
