import { type CarrierKey, isCarrierKey } from "./carrier-key";
import { changeCash } from "./commodity-pools";
import { type FittedShip, strength } from "./kill-credit";
import type { CommanderState } from "./station-commerce";

export const STRENGTH_PER_CREDIT = 20;

/**
 * What a commander carries between a kill and the next dock.
 *
 * `awarded` maps a raider slot to the last instance ordinal paid, so a replayed
 * event or a reload cannot pay an instance twice and a replacement in the same
 * slot (a higher ordinal) is still eligible. It is bounded by the slot count.
 */
export interface RaiderCash {
	readonly pendingCr: number;
	readonly awarded: Readonly<Record<string, number>>;
}

export const emptyRaiderCash = (): RaiderCash => ({
	pendingCr: 0,
	awarded: {},
});

export const raiderCashOf = (c: Pick<CommanderState, "raiderCash">) =>
	c.raiderCash ?? emptyRaiderCash();

export const raiderBountyCr = (fit: FittedShip): number =>
	Math.round(strength(fit) / STRENGTH_PER_CREDIT);

/** A raider slot's key. Relay defenders fill these slots too. */
export const isRaiderSlotKey = (key: CarrierKey): boolean =>
	isCarrierKey(key) && /^\d+:raider-\d+$/.test(key);

export interface RaiderAward {
	commander: CommanderState;
	earnedCr: number;
}

/** Records one destroyed instance's award, or returns it unchanged when that
 *  instance was already paid. */
export const awardRaiderKill = (
	commander: CommanderState,
	key: CarrierKey,
	instanceOrdinal: number,
	priceCr: number,
): RaiderAward => {
	const cash = raiderCashOf(commander);
	const paid = cash.awarded[key];
	if (paid !== undefined && paid >= instanceOrdinal)
		return { commander, earnedCr: 0 };
	return {
		commander: {
			...commander,
			raiderCash: {
				pendingCr: cash.pendingCr + priceCr,
				awarded: { ...cash.awarded, [key]: instanceOrdinal },
			},
		},
		earnedCr: priceCr,
	};
};

/** A dock: the pending total joins the wallet and clears together. The paid
 *  ledger stays, so a re-dock or a reload adds nothing. */
export const bankRaiderCash = (commander: CommanderState): CommanderState => {
	const cash = raiderCashOf(commander);
	if (cash.pendingCr === 0) return commander;
	return {
		...changeCash(commander, cash.pendingCr),
		raiderCash: { pendingCr: 0, awarded: cash.awarded },
	};
};
