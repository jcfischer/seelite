import { expect, test } from "bun:test";
import { makeWorld } from "../src/sim";
import { bootModelIds } from "../src/system-models";
import { codeOf } from "./lib/source-scan";

test("the download probe can refuse one boot model while another arrives", () => {
	const code = codeOf("scripts/probe-model-download.mjs");
	const declared = code.match(/const BOOT_SEED = (\d+);/);
	expect(declared).not.toBeNull();
	const { system } = makeWorld(Number(declared![1]));
	expect(bootModelIds(system, null)).toEqual(["cockpit", "coriolis"]);
});
