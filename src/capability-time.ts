import { DOMAIN } from "./domains";
import { fnv1a, mix } from "./rng";

export interface CapabilityTimeContext {
	seed: number;
	government: number;
	active: number;
	total: number;
}

export interface CapabilityTimeAnchor {
	at: number;
	cycle: number;
	phase: "up" | "down";
	left: number;
	endsAt?: number;
	repaired: boolean;
}

const fail = (): never => {
	throw new Error(
		"capability-time: invalid identity, budget, counts or retained interval",
	);
};
const time = (t: number): number =>
	Number.isFinite(t) && t >= 0 && t <= Number.MAX_SAFE_INTEGER ? t : fail();
const seedValue = (seed: number): number =>
	Number.isInteger(seed) && seed >= 0 && seed <= 0xffffffff ? seed : fail();
const unit = (seed: number, cycle: number, channel: string): number =>
	mix(fnv1a(JSON.stringify([seed, cycle, channel])), DOMAIN.CAPABILITY_TIME) /
	0x100000000;

/** Approved service-time odds: https://github.com/jcfischer/seelite/issues/937 */
export function capabilityRates(c: CapabilityTimeContext) {
	seedValue(c.seed);
	if (
		!Number.isInteger(c.government) ||
		c.government < 0 ||
		c.government > 7 ||
		!Number.isSafeInteger(c.total) ||
		c.total < 0 ||
		!Number.isSafeInteger(c.active) ||
		c.active < 0 ||
		c.active > c.total
	)
		return fail();
	const base = 0.12 - (0.09 * c.government) / 7;
	const odds = base / (1 - base);
	const multiplier = 1 + (c.total === 0 ? 0 : c.active / c.total);
	return {
		base,
		odds,
		multiplier,
		share: (odds * multiplier) / (1 + odds * multiplier),
	};
}

/** Initial cycle is length-biased; later cycles have uniform natural durations. */
export function capabilityDuration(seed: number, cycle: number): number {
	seedValue(seed);
	if (!Number.isSafeInteger(cycle) || cycle < 0) return fail();
	const u = unit(seed, cycle, "duration");
	return cycle === 0
		? Math.sqrt(600 ** 2 + u * (1200 ** 2 - 600 ** 2))
		: 600 + 600 * u;
}

/** Each capability owns independent phase, remaining-position and duration draws. */
export function initialCapabilityTime(
	c: CapabilityTimeContext,
	at: number,
): CapabilityTimeAnchor {
	const r = capabilityRates(c);
	time(at);
	const down = unit(c.seed, 0, "phase") < r.share;
	const left =
		(capabilityDuration(c.seed, 0) * (1 - unit(c.seed, 0, "remaining"))) /
		(down ? 1 : r.odds);
	const endsAt = down ? time(at + left) : undefined;
	return {
		at,
		cycle: 0,
		phase: down ? "down" : "up",
		left: down ? endsAt! - at : left,
		...(down ? { endsAt } : {}),
		repaired: false,
	};
}

/** Validate persisted causal state against generated context, without a saved pressure copy. */
export function validateCapabilityTime(
	c: CapabilityTimeContext,
	value: unknown,
): CapabilityTimeAnchor {
	const r = capabilityRates(c);
	if (!value || typeof value !== "object" || Array.isArray(value))
		return fail();
	const a = value as CapabilityTimeAnchor;
	if (
		Object.keys(a).some(
			(k) =>
				!["at", "cycle", "phase", "left", "endsAt", "repaired"].includes(k),
		) ||
		!Number.isSafeInteger(a.cycle) ||
		a.cycle < 0 ||
		!Number.isFinite(a.left) ||
		a.left <= 0 ||
		!["up", "down"].includes(a.phase) ||
		typeof a.repaired !== "boolean" ||
		(a.phase === "up" && (a.repaired || a.endsAt !== undefined))
	)
		return fail();
	time(a.at);
	const duration = capabilityDuration(c.seed, a.cycle);
	if (a.phase === "down") {
		if (
			time(a.endsAt!) <= a.at ||
			a.endsAt! > a.at + duration ||
			a.left !== a.endsAt! - a.at
		)
			return fail();
	} else if (a.left > duration / r.odds) return fail();
	return { ...a };
}

/** Project a retained constant-pressure interval; no visits or frame state enter the result. */
export function projectCapabilityTime(
	c: CapabilityTimeContext,
	anchor: CapabilityTimeAnchor,
	to: number,
): { state: CapabilityTimeAnchor; operational: number } {
	const a = validateCapabilityTime(c, anchor);
	time(to);
	if (to < a.at) return fail();
	const { odds, multiplier } = capabilityRates(c);
	let operational = 0;
	while (a.at < to) {
		const speed = a.phase === "up" ? multiplier : 1;
		const span = a.left / speed;
		const end = a.phase === "down" ? a.endsAt! : a.at + span;
		const completed = to >= end;
		const next = Math.min(end, to);
		const take = next - a.at;
		if (a.phase === "up" || a.repaired) operational += take;
		if (next === a.at) return fail();
		a.at = next;
		if (!completed)
			a.left = a.phase === "down" ? end - a.at : a.left - take * speed;
		else if (a.phase === "up") {
			a.phase = "down";
			a.endsAt = time(a.at + capabilityDuration(c.seed, a.cycle));
			a.left = a.endsAt - a.at;
		} else {
			a.phase = "up";
			a.cycle++;
			a.left = capabilityDuration(c.seed, a.cycle) / odds;
			a.repaired = false;
			delete a.endsAt;
		}
	}
	return { state: a, operational };
}

/** Half-open service seconds, refusing a request before the retained causal anchor. */
export function queryCapabilityTime(
	c: CapabilityTimeContext,
	anchor: CapabilityTimeAnchor,
	from: number,
	to: number,
): number {
	time(from);
	time(to);
	if (from < anchor.at || to < from) return fail();
	return projectCapabilityTime(
		c,
		projectCapabilityTime(c, anchor, from).state,
		to,
	).operational;
}
