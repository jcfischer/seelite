import {
	accountOf,
	migrateAccount,
	withAccount,
} from "../../src/commodity-pools";
import { money, signedMoney } from "../../src/exact-amount";
import { ladderFromAccount, type LadderRecord } from "../../src/ladder";
import type { CommanderState } from "../../src/station-commerce";

/** Explicit probe setup; replacement cargo has no inferred historical basis. */
export function setCommanderFixture(
	game: { commander: CommanderState; ladders: LadderRecord },
	patch: Partial<CommanderState>,
): void {
	const next = { ...game.commander, ...patch };
	let account = patch.cargo
		? migrateAccount(next.credits, game.ladders.banked.trade, patch.cargo, {})
		: {
				...accountOf(game.commander),
				bankedTrade: money.fromNumber(game.ladders.banked.trade),
			};
	if (patch.credits !== undefined)
		account = { ...account, cash: signedMoney.fromNumber(patch.credits) };
	game.commander = withAccount(next, account);
	game.ladders = ladderFromAccount(game.ladders, account);
}
