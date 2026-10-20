import { readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

export async function kitBinary() {
	return new Uint8Array(await readFile(new URL("blocks.glb", import.meta.url)));
}

if (import.meta.main) {
	const blender =
		process.env.BLENDER ?? "/Applications/Blender.app/Contents/MacOS/Blender";
	const result = spawnSync(
		blender,
		[
			"--background",
			"--python-exit-code",
			"1",
			"--python",
			new URL("build_kit.py", import.meta.url).pathname,
		],
		{ stdio: "inherit" },
	);
	if (result.error) throw result.error;
	if (result.status !== 0) throw Error("Blender exited " + result.status);
	const bytes = await kitBinary();
	const buffer = Buffer.from(bytes);
	const doc = JSON.parse(
		buffer.subarray(20, 20 + buffer.readUInt32LE(12)).toString(),
	);
	const asset = {
		batches: doc.meshes.reduce(
			(n: number, mesh: { primitives: unknown[] }) =>
				n + mesh.primitives.length,
			0,
		),
		bytes: bytes.byteLength,
		sha256: createHash("sha256").update(bytes).digest("hex"),
		units: "km",
		blocks: ["HUB", "HUB_STATIC", "NODE", "TUBE"],
		authoring:
			"Blender build_kit.py via stations/build_model.py and geometry.py",
		source: "blocks.blend",
		sourceSha256: createHash("sha256")
			.update(await readFile(new URL("blocks.blend", import.meta.url)))
			.digest("hex"),
		texture: "../industrial-surface.png",
	};
	if (bytes.byteLength >= 25_000_000)
		throw Error("Study GLB exceeds node size limit");
	await writeFile(
		new URL("asset.json", import.meta.url),
		JSON.stringify(asset, null, 2) + "\n",
	);
	console.log(
		"Prepared Blender Assembly spike: " + bytes.byteLength + " bytes",
	);
}
