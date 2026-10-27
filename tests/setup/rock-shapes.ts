import { readFileSync } from "node:fs";
import { setRockShapeSource } from "../../src/field-collision";
import { decodeRockHeightfields } from "../../src/rock-heightfields";

let decoded: ReturnType<typeof decodeRockHeightfields> | undefined;
setRockShapeSource(() => {
	decoded ??= decodeRockHeightfields(
		new Uint8Array(readFileSync("src/models/rock-heightfields.bin")),
	);
	return decoded;
});
