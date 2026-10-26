import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
	createTradeBuilder,
	TRADE_FORMS,
	TRADE_MODEL_NAMES,
} from "../../src/trade-flight";
import {
	installAssemblyBlocks,
	installTradeBuilder,
	type AuthoredTradeForm,
} from "../../src/station-mesh";
import { decodeShippedGlb } from "./shipped-glb";
import { createAssemblyBlocks } from "../../src/assembly-flight";

export const SHIPPED_TRADE_FILES = Object.fromEntries(
	TRADE_FORMS.map((form) => [
		form,
		`src/models/trade-${TRADE_MODEL_NAMES[form]}.glb`,
	]),
) as Readonly<Record<AuthoredTradeForm, string>>;
export const tradeModelHash = (form: AuthoredTradeForm) =>
	createHash("sha256")
		.update(readFileSync(SHIPPED_TRADE_FILES[form]))
		.digest("hex");
const builders = new Map<
	AuthoredTradeForm,
	ReturnType<typeof createTradeBuilder>
>();
let assembly: ReturnType<typeof createAssemblyBlocks> | undefined;
export async function installShippedTrades(): Promise<void> {
	assembly ??= createAssemblyBlocks(
		await decodeShippedGlb("src/models/trade-assembly.glb"),
	);
	installAssemblyBlocks(assembly);
	for (const form of TRADE_FORMS) {
		let builder = builders.get(form);
		if (!builder) {
			builder = createTradeBuilder(
				form,
				await decodeShippedGlb(SHIPPED_TRADE_FILES[form]),
			);
			builders.set(form, builder);
		}
		installTradeBuilder(form, builder);
	}
}
export function uninstallTrades(): void {
	installAssemblyBlocks(null);
	for (const form of TRADE_FORMS) installTradeBuilder(form, null);
}
