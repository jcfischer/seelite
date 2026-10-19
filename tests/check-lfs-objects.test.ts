/**
 * `scripts/check-lfs-objects.mjs`: the CI gate that fails a change whose LFS
 * objects never reached GitHub. The server is stubbed here; the live batch
 * request runs in CI, where the run's token can make it.
 */
import { describe, expect, test } from "bun:test";
import { missingObjects, parsePointer } from "../scripts/check-lfs-objects.mjs";

const OID_A = "a".repeat(64);
const OID_B = "b".repeat(64);
const pointerText = (oid: string, size: number) =>
	`version https://git-lfs.github.com/spec/v1\noid sha256:${oid}\nsize ${size}\n`;

/** A server that holds `present` and answers every object it is asked for. */
const server =
	(present: Set<string>, answerAll = true) =>
	async (body: { objects: { oid: string; size: number }[] }) => ({
		objects: body.objects
			.filter((_, i) => answerAll || i === 0)
			.map((o) =>
				present.has(o.oid)
					? { ...o, actions: { download: { href: "https://example" } } }
					: { ...o, error: { code: 404, message: "Object does not exist" } },
			),
	});

describe("check-lfs-objects", () => {
	test("reads a pointer, and nothing else", () => {
		expect(parsePointer(pointerText(OID_A, 42))).toEqual({
			oid: OID_A,
			size: 42,
		});
		expect(parsePointer("glTF\u0002binary")).toBeNull();
		expect(
			parsePointer("version https://git-lfs.github.com/spec/v1\n"),
		).toBeNull();
	});

	test("names the pointers whose objects are not on the server", async () => {
		const pointers = [
			{ path: "spikes/x/a.glb", oid: OID_A, size: 1 },
			{ path: "spikes/x/b.png", oid: OID_B, size: 2 },
		];
		expect(await missingObjects(pointers, server(new Set([OID_A])))).toEqual([
			pointers[1],
		]);
		expect(
			await missingObjects(pointers, server(new Set([OID_A, OID_B]))),
		).toEqual([]);
	});

	test("an object the server leaves out of its answer counts as missing", async () => {
		const pointers = [
			{ path: "a", oid: OID_A, size: 1 },
			{ path: "b", oid: OID_B, size: 2 },
		];
		expect(
			await missingObjects(pointers, server(new Set([OID_A, OID_B]), false)),
		).toEqual([pointers[1]]);
	});

	test("asks once per object, and not at all for a change with none", async () => {
		let asked = 0;
		const counting = async (body: { objects: unknown[] }) => {
			asked += body.objects.length;
			return server(new Set([OID_A]))(body as never);
		};
		const same = [
			{ path: "a", oid: OID_A, size: 1 },
			{ path: "copy-of-a", oid: OID_A, size: 1 },
		];
		expect(await missingObjects(same, counting)).toEqual([]);
		expect(asked).toBe(1);
		expect(await missingObjects([], counting)).toEqual([]);
		expect(asked).toBe(1);
	});
});
