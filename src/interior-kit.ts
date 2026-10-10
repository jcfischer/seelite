/** Accepted study assembly in metre-local coordinates. The single root conversion
 * carries ALL full/reduced fittings into the station's kilometre aperture frame.
 * Ships, reservations, names and traversal remain owned by the game. Node #843.
 */
import * as THREE from "three";
import { InteriorLods, type LodRecord } from "./interior-lod";
import {
	planInterior,
	worldPoint,
	FACE_ROLL,
	THEMES,
	type Theme,
	type V3,
} from "./interior-layout";
import type { InteriorFace, StationInterior } from "./station-interior";
import { shared } from "./gpu-teardown";
import { EMISSIVE_CEILING } from "./light-rig";
const materials = new Map<string, THREE.Material>();
export function interiorMaterial(
	source: THREE.Material,
	theme: Theme,
	unitsPerMetre = 0.001,
) {
	const key = theme + "/" + source.name + "/" + unitsPerMetre;
	if (materials.has(key))
		return materials.get(key)! as THREE.MeshStandardMaterial;
	const m = source.clone() as THREE.MeshStandardMaterial;
	m.name = m.name.replace(/\.\d+$/, "");
	const t = THEMES.find((t) => t.id === theme)!;
	if (m.name.includes("paint-") || m.name.includes("pale-steel")) {
		const tint =
			theme === "works"
				? 0x9c9480
				: theme === "frontier"
					? 0xb0a58a
					: theme === "survey"
						? 0xe2e3db
						: 0xe5d9bd;
		m.color.set(tint);
		m.roughness = theme === "frontier" ? 0.76 : 0.52;
		m.metalness = 0.22;
	}
	if (m.name === "theme-accent") {
		m.color.set(t.accent);
		m.map = null;
	}
	if (m.name === "neutral-light" || m.name === "amber-lamp") {
		m.emissive.set(t.light);
		m.emissiveIntensity = EMISSIVE_CEILING;
	}
	if (m.map) {
		// The shipping GLB embeds the shared lossless paint.
		m.map.anisotropy = 8;
		m.bumpMap = m.map;
		m.bumpScale = 0.09;
	}
	if (m.name.includes("paint-") || m.name.includes("pale-steel")) {
		const wear = theme === "frontier" ? 0.72 : theme === "works" ? 0.45 : 0.22;
		m.onBeforeCompile = (shader) => {
			shader.fragmentShader = shader.fragmentShader.replace(
				"#include <map_fragment>",
				`
          #ifdef USE_MAP
          vec4 sampledDiffuseColor = texture2D(map, vMapUv);
          sampledDiffuseColor.rgb = mix(vec3(1.0), sampledDiffuseColor.rgb, ${wear});
          diffuseColor *= sampledDiffuseColor;
          #endif
        `,
			);
		};
		m.customProgramCacheKey = () => `interior-paint-${wear}`;
		m.metalness = 0.12;
		m.bumpScale = 0.025;
	}
	if (
		[
			"dark-structure",
			"machined-alloy",
			"hose-rubber",
			"recess-black",
		].includes(m.name)
	) {
		m.map = null;
		m.bumpScale = 0.018;
	}
	if (m.name === "canopy-glass") {
		m.opacity = 0.35;
		m.transparent = true;
		m.depthWrite = false;
	}
	m.bumpScale *= unitsPerMetre;
	shared(m);
	materials.set(key, m);
	return m;
}

export function buildInteriorKit(
	interior: StationInterior,
	seed: number,
	theme: Theme,
	assets: Map<string, THREE.Group>,
	records: Record<string, LodRecord>,
	mouthRecessKm = 0,
	unitsPerMetre = 0.001,
) {
	if (interior.presentation !== "bay")
		throw Error("Kit requires an enclosed bay");
	const plan = planInterior(
		theme,
		interior.type as "trade" | "shipyard",
		seed,
		interior,
	);
	const assembly = new THREE.Group();
	assembly.name = "authored-interior";
	assembly.userData.theme = theme;
	assembly.userData.minDetail = "reduced";
	assembly.scale.setScalar(unitsPerMetre);
	assembly.position.z = interior.mouthAxialKm * (unitsPerMetre / 0.001);
	const shellGroup = new THREE.Group();
	shellGroup.name = "interior-shell";
	assembly.add(shellGroup);
	const fitGroup = new THREE.Group();
	fitGroup.name = "interior-fittings";
	assembly.add(fitGroup);
	const lods = new InteriorLods(assets, records, (m) =>
		interiorMaterial(m, theme, unitsPerMetre),
	);
	// Keep the accepted per-fitting pixel policy: nearby removed hardware must
	// retain Full. Mixed levels can add instanced batches; fewer triangles alone
	// establish no frame-time gain. Forced levels remain diagnostic controls.
	assembly.userData.interiorLods = lods;
	function place(
		name: string,
		pos: V3,
		roll = 0,
		scale: V3 = [1, 1, 1],
		parent: THREE.Group | undefined = undefined,
		extra?: THREE.Quaternion,
		instanceId?: string,
	) {
		const q = new THREE.Quaternion().setFromAxisAngle(
			new THREE.Vector3(0, 0, 1),
			roll,
		);
		parent ??= [
			"panel",
			"wall-hatch",
			"wall-vent",
			"wall-repair",
			"wall-reinforced",
		].includes(name)
			? shellGroup
			: assembly;
		if (extra) q.multiply(extra);
		if (
			pos[2] > -30 &&
			["rib", "panel", "wall-vent", "wall-hatch"].includes(name)
		)
			pos = [pos[0], pos[1], pos[2] - mouthRecessKm * 1000];
		lods.add(
			name,
			new THREE.Matrix4().compose(
				new THREE.Vector3(...pos),
				q,
				new THREE.Vector3(...scale),
			),
			parent,
			instanceId,
		);
	}
	function flush() {
		lods.flush();
	}

	function solid(c: V3, size: V3, color = 0x303b3d) {
		const mesh = new THREE.Mesh(
			new THREE.BoxGeometry(...size),
			new THREE.MeshStandardMaterial({
				color,
				roughness: 0.8,
				metalness: 0.35,
			}),
		);
		mesh.position.fromArray(c);
		if (c[2] > -30) mesh.position.z -= mouthRecessKm * 1000;
		mesh.userData.generated = true;
		assembly.add(mesh);
		return mesh;
	}

	const faces: InteriorFace[] = ["deck", "port", "overhead", "starboard"],
		{ hx, hy, depth } = plan;
	const ax = plan.lane.max[0],
		ay = plan.lane.max[1];
	const accent = THEMES.find((t) => t.id === theme)!.accent;
	const wallBox = (
		face: InteriorFace,
		s: number,
		h: number,
		z: number,
		size: V3,
		color: number,
	) => {
		const m = solid(worldPoint(face, s, h, z, hx, hy), size, color);
		m.rotation.z = FACE_ROLL[face];
		m.receiveShadow = true;
		return m;
	};
	for (const face of faces) {
		const half = face === "deck" || face === "overhead" ? hx : hy,
			roll = FACE_ROLL[face];
		const across = Math.round((half * 2) / 20),
			along = 20;
		// Broad service shoulders separate quiet panels from working machinery.
		for (const sign of [-1, 1]) {
			wallBox(
				face,
				sign * (half - 32),
				0.35,
				-depth / 2,
				[38, 0.7, depth - 4],
				theme === "survey" ? 0x344b5c : 0x222b2e,
			);
			wallBox(
				face,
				sign * (half - 52),
				0.65,
				-depth / 2,
				[2.5, 1.3, depth - 4],
				accent,
			);
			for (const z of [-65, -202, -345]) {
				wallBox(
					face,
					sign * (half - 33),
					1.2,
					z,
					[33, 1.4, 7],
					theme === "works" ? 0xbd882a : accent,
				);
				if (theme === "works")
					for (let x = -12; x <= 12; x += 6)
						wallBox(
							face,
							sign * (half - 33) + x,
							2.0,
							z,
							[2.7, 0.2, 7],
							0x15191a,
						);
			}
			if (theme === "frontier")
				for (let i = 0; i < 5; i++) {
					const z = -40 - i * 73;
					wallBox(
						face,
						sign * 43,
						0.35,
						z,
						[18, 0.7, 25],
						i % 2 ? 0x626552 : 0x99774c,
					);
				}
		}
		for (let x = 0; x < across; x += 2)
			for (let z = 0; z < along; z += 2) {
				const hash = (x * 7 + z * 3 + faces.indexOf(face)) % 5;
				const split = hash === 0 || (theme === "frontier" && hash === 2);
				for (let dx = 0; dx < (split ? 2 : 1); dx++)
					for (let dz = 0; dz < (split ? 2 : 1); dz++) {
						const span = split ? 1 : 2;
						const family =
							split && dx === 0 && dz === 0
								? theme === "frontier"
									? "wall-repair"
									: theme === "works"
										? "wall-reinforced"
										: hash === 0
											? "wall-hatch"
											: "wall-vent"
								: "panel";
						place(
							family,
							worldPoint(
								face,
								-half + ((x + dx + span / 2) * half * 2) / across,
								0,
								-((z + dz + span / 2) * depth) / along,
								hx,
								hy,
							),
							roll,
							[
								((half * 2) / across / 20) * span,
								1,
								(depth / along / 20) * span,
							],
						);
					}
			}
		for (const side of [-1, 1])
			for (let z = 0; z < 20; z++)
				place(
					"trunk",
					worldPoint(face, side * (half - 8), 0, -10 - z * 20, hx, hy),
					roll,
				);
		for (const z of [-10, -80, -202, -327, -397]) {
			const beamWidth = (half - 65) * 2,
				beamTiles = Math.round(beamWidth / 20);
			for (let x = 0; x < beamTiles; x++)
				place(
					"rib",
					worldPoint(
						face,
						-beamWidth / 2 + ((x + 0.5) * beamWidth) / beamTiles,
						0,
						z,
						hx,
						hy,
					),
					roll,
					[1.7, 4.8, beamWidth / beamTiles / 20],
					assembly,
					new THREE.Quaternion().setFromAxisAngle(
						new THREE.Vector3(0, 1, 0),
						Math.PI / 2,
					),
				);
			// Raised shoulder spans let equipment and gangways pass underneath.
			for (const sign of [-1, 1]) {
				place(
					"rib",
					worldPoint(face, sign * (half - 50), 34, z, hx, hy),
					roll,
					[1.7, 1.4, 30 / 20],
					assembly,
					new THREE.Quaternion().setFromAxisAngle(
						new THREE.Vector3(0, 1, 0),
						Math.PI / 2,
					),
				);
				const a = new THREE.Vector3(
					...worldPoint(face, sign * (half - 67), 17, z, hx, hy),
				);
				const b = new THREE.Vector3(
					...worldPoint(face, sign * (half - 48), 35, z, hx, hy),
				);
				const joint = solid(
					a.clone().add(b).multiplyScalar(0.5).toArray() as V3,
					[4, a.distanceTo(b), 13],
					0x465254,
				);
				joint.quaternion.setFromUnitVectors(
					new THREE.Vector3(0, 1, 0),
					b.sub(a).normalize(),
				);
				joint.castShadow = joint.receiveShadow = true;
			}
		}
		wallBox(face, 0, 22.5, -327, [10, 3, 7], 0x252f34);
		const lens = wallBox(face, 0, 24.2, -325, [4, 0.4, 1.5], 0xffecd1);
		(lens.material as THREE.MeshStandardMaterial).emissive.set(
			THEMES.find((t) => t.id === theme)!.light,
		);
		(lens.material as THREE.MeshStandardMaterial).emissiveIntensity =
			EMISSIVE_CEILING;
	}

	// Tiled pressure bulkheads. The aperture keeps its authoritative clear rectangle.
	const frontQ = new THREE.Quaternion().setFromAxisAngle(
		new THREE.Vector3(1, 0, 0),
		-Math.PI / 2,
	);
	const horizontalQ = new THREE.Quaternion().setFromRotationMatrix(
		new THREE.Matrix4().makeBasis(
			new THREE.Vector3(0, 1, 0),
			new THREE.Vector3(0, 0, -1),
			new THREE.Vector3(-1, 0, 0),
		),
	);
	const panelWall = (
		cx: number,
		cy: number,
		z: number,
		w: number,
		h: number,
		back = false,
	) => {
		const nx = Math.max(1, Math.round(w / 35)),
			ny = Math.max(1, Math.round(h / 35));
		for (let ix = 0; ix < nx; ix++)
			for (let iy = 0; iy < ny; iy++)
				place(
					(ix + iy * 3) % 7 === 0
						? "wall-vent"
						: (ix + iy * 3) % 7 === 4
							? "wall-hatch"
							: "panel",
					[
						cx - w / 2 + ((ix + 0.5) * w) / nx,
						cy - h / 2 + ((iy + 0.5) * h) / ny,
						z,
					],
					0,
					[w / nx / 20, 1, h / ny / 20],
					assembly,
					back
						? new THREE.Quaternion().setFromAxisAngle(
								new THREE.Vector3(1, 0, 0),
								Math.PI / 2,
							)
						: frontQ,
				);
	};
	panelWall(0, 0, -depth, hx * 2, hy * 2, true);
	for (const side of [-1, 1]) {
		panelWall((side * (hx + ax)) / 2, 0, 0, hx - ax, hy * 2);
		panelWall(0, (side * (hy + ay)) / 2, 0, ax * 2, hy - ay);
	}
	for (let layer = 0; layer < 4; layer++) {
		const x = ax + 4 + layer * 4,
			y = ay + 4 + layer * 4,
			z = -layer * 2.8;
		for (const side of [-1, 1]) {
			place("rib", [side * x, 0, z], 0, [1, 1, (y * 2) / 20], assembly, frontQ);
			place(
				"rib",
				[0, side * y, z],
				0,
				[1, 1, (x * 2) / 20],
				assembly,
				horizontalQ,
			);
		}
	}
	// A bevelled octagonal pressure collar surrounds, never narrows, the clear rectangle.
	const octagon = (x: number, y: number, c: number) =>
		[
			[-x + c, -y],
			[x - c, -y],
			[x, -y + c],
			[x, y - c],
			[x - c, y],
			[-x + c, y],
			[-x, y - c],
			[-x, -y + c],
		] as [number, number][];
	const outer = octagon(ax + 35, ay + 35, 20),
		inner = octagon(ax + 8, ay + 8, 8);
	for (let i = 0; i < 8; i++) {
		const j = (i + 1) % 8,
			points = [outer[i], outer[j], inner[j], inner[i]].map(
				([x, y]) => new THREE.Vector2(x, y),
			);
		const centre = points
			.reduce((c, p) => c.add(p), new THREE.Vector2())
			.multiplyScalar(0.25);
		const ring = new THREE.Shape(
			points.map((p) => p.sub(centre).multiplyScalar(0.96).add(centre)),
		);
		const collar = new THREE.Mesh(
			new THREE.ExtrudeGeometry(ring, {
				depth: 7,
				bevelEnabled: true,
				bevelThickness: 0.8,
				bevelSize: 0.8,
				bevelSegments: 1,
				steps: 1,
			}),
			new THREE.MeshStandardMaterial({
				color:
					theme === "works" && i % 2 ? 0xa57a32 : i % 2 ? 0x79807c : 0x4f5c60,
				metalness: 0.65,
				roughness: 0.4,
			}),
		);
		collar.position.z = -19 + (i % 2 ? 0 : 2) - mouthRecessKm * 1000;
		collar.userData.generated = true;
		collar.castShadow = collar.receiveShadow = true;
		assembly.add(collar);
	}
	// Recessed service inserts divide the collar into maintainable sections.
	for (const sign of [-1, 1])
		for (const vertical of [false, true]) {
			const cx = vertical ? sign * (ax + 22) : 0,
				cy = vertical ? 0 : sign * (ay + 22);
			const w = vertical ? 9 : 48,
				h = vertical ? 28 : 9;
			const recess = solid([cx, cy, -20], [w + 2, h + 2, 1.8], 0x20292d);
			recess.receiveShadow = true;
			for (let k = -3; k <= 3; k++) {
				const rib = solid(
					[cx + (vertical ? k : 0), cy + (vertical ? 0 : k), -21.2],
					vertical ? [0.5, h, 1] : [w, 0.5, 1],
					0x7a827e,
				);
				rib.receiveShadow = true;
			}
			for (const side of [-1, 1])
				solid(
					[
						cx + (vertical ? side * (w / 2 + 1) : 0),
						cy + (vertical ? 0 : side * (h / 2 + 1)),
						-21.2,
					],
					vertical ? [0.8, h + 4, 1.5] : [w + 4, 0.8, 1.5],
					accent,
				);
		}
	const rim = octagon(ax + 10, ay + 10, 9);
	for (let i = 0; i < rim.length; i++) {
		const a = new THREE.Vector3(...rim[i], -21),
			b = new THREE.Vector3(...rim[(i + 1) % rim.length], -21);
		const m = new THREE.Mesh(
			new THREE.CylinderGeometry(0.65, 0.65, a.distanceTo(b), 6),
			new THREE.MeshStandardMaterial({
				color: 0xffe0a4,
				emissive: theme === "survey" ? 0x93c7ff : 0xffc06c,
				emissiveIntensity: EMISSIVE_CEILING,
			}),
		);
		m.position.copy(a).add(b).multiplyScalar(0.5);
		m.position.z -= mouthRecessKm * 1000;
		m.quaternion.setFromUnitVectors(
			new THREE.Vector3(0, 1, 0),
			b.sub(a).normalize(),
		);
		m.userData.generated = true;
		m.name = "interior-lane-edge";
		assembly.add(m);
	}
	// Luminous fixtures are discrete inset lamps, located outside the opening.
	const fixtureMat = new THREE.MeshStandardMaterial({
		color: 0xffe2b2,
		emissive: 0xffbd6a,
		emissiveIntensity: EMISSIVE_CEILING,
	});
	for (const side of [-1, 1])
		for (const axis of ["x", "y"]) {
			const n = axis === "x" ? 5 : 3;
			for (let i = 0; i < n; i++) {
				const pos: V3 =
					axis === "x"
						? [(i - (n - 1) / 2) * 20, side * (ay + 8), -7]
						: [side * (ax + 8), (i - (n - 1) / 2) * 18, -7];
				const size: V3 = axis === "x" ? [8, 1.2, 0.8] : [1.2, 6, 0.8];
				const m = solid(pos, size);
				(m.material as THREE.Material).dispose();
				m.material = fixtureMat;
				m.userData.sharedMaterial = true;
			}
		}

	for (const b of plan.berths)
		place(
			"berth",
			worldPoint(b.face, 0, 0, b.centre[2], hx, hy),
			b.roll,
			[1, 1, 1],
			undefined,
			undefined,
			b.id,
		);
	for (const f of plan.fittings)
		place(f.kind, f.position, f.roll, [1, 1, 1], fitGroup);
	flush();

	// Four inset floods, physical intensities scaled by metre-to-kilometre squared.
	// These illuminate geometry rather than making the whole room emissive.
	for (const face of faces) {
		const light = new THREE.PointLight(
			THEMES.find((t) => t.id === theme)!.light,
			50000 * unitsPerMetre ** 2,
			380 * unitsPerMetre,
			2,
		);
		light.position.fromArray(worldPoint(face, 0, 24, -325, hx, hy));
		light.name = "interior-flood-light";
		assembly.add(light);
	}
	return assembly;
}
