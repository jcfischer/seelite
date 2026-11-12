import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import * as THREE from "three";
import { withoutTextures } from "./lib/shipped-glb";
import { HULL_SPECS, type HullId } from "../src/hull";
import { berthFits, stationInterior } from "../src/station-interior";
import { STATION_GEOMETRY, type StationType } from "../src/station";

export const SIX: readonly { role: HullId; name: string }[] = [
	{ role: "patrol", name: "Warden" },
	{ role: "explorer", name: "Pilgrim" },
	{ role: "raider", name: "Shiv" },
	{ role: "carrier", name: "Bastion" },
	{ role: "prospector", name: "Sluice" },
	{ role: "dreadnought", name: "Rampart" },
];

const finite = (v: number, what: string): number => {
	if (!Number.isFinite(v)) throw new Error(`non-finite ${what}: ${v}`);
	return v;
};

export const roundUp01 = (km: number): number =>
	Math.ceil(km * 10_000 - 1e-9) / 10_000;

export interface Measured {
	role: HullId;
	name: string;
	sourceSha256: string;
	staticBoxM: { x: number; y: number; z: number };
	rotor: boolean;
	sweptRadiusM: number | null;
	sweptBoxM: { x: number; y: number; z: number };
	envKm: { lengthKm: number; beamKm: number; heightKm: number };
	triangles: number;
}

function lfsPath(sha: string): string {
	const common = execFileSync("git", ["rev-parse", "--git-common-dir"])
		.toString()
		.trim();
	return `${common}/lfs/objects/${sha.slice(0, 2)}/${sha.slice(2, 4)}/${sha}`;
}

export async function measure(role: HullId, name: string): Promise<Measured> {
	const pointer = execFileSync("git", [
		"show",
		`HEAD:spikes/seven-ships/${role}/model.glb`,
	]).toString();
	const sha = /oid sha256:([0-9a-f]{64})/.exec(pointer)?.[1];
	if (!sha) throw new Error(`${role}: not an LFS pointer`);
	const path = lfsPath(sha);
	if (!existsSync(path)) throw new Error(`${role}: LFS object ${sha} missing`);
	const { scene } = await new GLTFLoader()
		.setMeshoptDecoder(MeshoptDecoder)
		.parseAsync(withoutTextures(readFileSync(path)), "");
	scene.updateMatrixWorld(true);
	const box = new THREE.Box3();
	const rotorBox = new THREE.Box3();
	let maxRotorR = 0;
	let rotor = false;
	let triangles = 0;
	const v = new THREE.Vector3();
	scene.traverse((o) => {
		const m = o as THREE.Mesh;
		if (!m.isMesh) return;
		const g = m.geometry;
		triangles += (g.index ? g.index.count : g.attributes.position.count) / 3;
		let underRotor = false;
		for (let p: THREE.Object3D | null = m; p; p = p.parent)
			if (p.name === "habitat-rotor" || p.name.startsWith("rotor:"))
				underRotor = true;
		rotor ||= underRotor;
		const pos = g.attributes.position;
		for (let i = 0; i < pos.count; i++) {
			v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
			finite(v.x + v.y + v.z, `${role} vertex`);
			box.expandByPoint(v);
			if (underRotor) {
				rotorBox.expandByPoint(v);
				maxRotorR = Math.max(maxRotorR, Math.hypot(v.x, v.y));
			}
		}
	});
	if (box.isEmpty()) throw new Error(`${role}: empty scene`);
	const s = box.getSize(new THREE.Vector3());
	const static_ = { x: s.x, y: s.y, z: s.z };
	const sweptBox = rotor
		? {
				x: Math.max(s.x, 2 * maxRotorR),
				y: Math.max(s.y, 2 * maxRotorR),
				z: s.z,
			}
		: static_;
	for (const k of ["x", "y", "z"] as const) {
		finite(static_[k], `${role} static ${k}`);
		finite(sweptBox[k], `${role} swept ${k}`);
	}
	return {
		role,
		name,
		sourceSha256: sha,
		staticBoxM: static_,
		rotor,
		sweptRadiusM: rotor ? maxRotorR : null,
		sweptBoxM: sweptBox,
		envKm: {
			lengthKm: roundUp01(sweptBox.z / 1000),
			beamKm: roundUp01(sweptBox.x / 1000),
			heightKm: roundUp01(sweptBox.y / 1000),
		},
		triangles,
	};
}

if (import.meta.main) {
	const outArg = process.argv.indexOf("--out");
	const rows: Measured[] = [];
	for (const { role, name } of SIX) rows.push(await measure(role, name));
	const types: StationType[] = ["trade", "shipyard", "refinery", "outpost"];
	console.log(
		"base",
		execFileSync("git", ["rev-parse", "HEAD"]).toString().trim(),
	);
	const ROLL = (50 * Math.PI) / 180;
	for (const t of types) {
		const interior = stationInterior(t, STATION_GEOMETRY[t].aperturePlaneKm, 0);
		const lens = interior.berths.map((b) => b.clearLengthKm);
		const beams = interior.berths.map((b) => b.clearBeamKm);
		const hs = interior.berths.map((b) => b.clearHeightKm);
		const a = STATION_GEOMETRY[t].aperture;
		console.log(
			`${t}: ${interior.berths.length} berths clear L ${Math.min(...lens)}-${Math.max(...lens)} B ${Math.min(...beams)}-${Math.max(...beams)} H ${Math.min(...hs)}-${Math.max(...hs)} km; aperture ${a.kind} ${a.widthKm} x ${a.heightKm} km`,
		);
	}
	for (const r of rows) {
		const cur = HULL_SPECS[r.role].env;
		const e = r.envKm;
		const cells = types.map((t) => {
			const interior = stationInterior(
				t,
				STATION_GEOMETRY[t].aperturePlaneKm,
				0,
			);
			return `${t}:${interior.berths.some((b) => berthFits(b, e)) ? "fit" : "NO"}`;
		});
		const c = Math.cos(ROLL);
		const sn = Math.sin(ROLL);
		const rolledW = e.beamKm * c + e.heightKm * sn;
		const rolledH = e.beamKm * sn + e.heightKm * c;
		const ap = types.map((t) => {
			const a = STATION_GEOMETRY[t].aperture;
			const flat = e.beamKm <= a.widthKm && e.heightKm <= a.heightKm;
			const rolled = rolledW <= a.widthKm && rolledH <= a.heightKm;
			return `${t}:${flat ? "level-ok" : "level-NO"}/${rolled ? "roll50-ok" : "roll50-NO"}`;
		});
		console.log(
			`${r.role} (${r.name}) tris=${r.triangles} rotor=${r.rotor}` +
				(r.sweptRadiusM !== null
					? ` sweptR=${r.sweptRadiusM.toFixed(3)}m`
					: "") +
				`\n  static m  ${r.staticBoxM.x.toFixed(3)} x ${r.staticBoxM.y.toFixed(3)} x ${r.staticBoxM.z.toFixed(3)} (beam x height x length)` +
				`\n  swept env km len ${e.lengthKm} beam ${e.beamKm} h ${e.heightKm}; bounding-sphere radius ${(Math.hypot(e.lengthKm, e.beamKm, e.heightKm) / 2).toFixed(4)} km` +
				`\n  current env km len ${cur.lengthKm} beam ${cur.beamKm} h ${cur.heightKm}` +
				`\n  internal berth: ${cells.join(" ")}\n  aperture (beam along long side): ${ap.join(" ")}`,
		);
	}
	if (outArg >= 0)
		writeFileSync(process.argv[outArg + 1], JSON.stringify(rows, null, 1));
}
