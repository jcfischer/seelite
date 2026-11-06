import { pathToFileURL } from "node:url";

export function rates(government, active, total) {
	if (
		!Number.isInteger(government) ||
		government < 0 ||
		government > 7 ||
		!Number.isSafeInteger(total) ||
		total < 0 ||
		!Number.isSafeInteger(active) ||
		active < 0 ||
		active > total
	) {
		throw Error("invalid government or raider count");
	}
	const base = 0.12 - (0.09 * government) / 7;
	const odds = base / (1 - base);
	const multiplier = 1 + (total === 0 ? 0 : active / total);
	return {
		base,
		odds,
		multiplier,
		share: (odds * multiplier) / (1 + odds * multiplier),
	};
}

function unit(seed, episode, domain) {
	let h = 2166136261;
	for (const c of JSON.stringify([seed, episode, domain]))
		h = Math.imul(h ^ c.charCodeAt(0), 16777619);
	h ^= h >>> 16;
	h = Math.imul(h, 0x7feb352d);
	h ^= h >>> 15;
	h = Math.imul(h, 0x846ca68b);
	h ^= h >>> 16;
	return (h >>> 0) / 0x100000000;
}

export function durationFor(seed, episode) {
	const u = unit(seed, episode, "duration");
	return episode === 0
		? Math.sqrt(600 ** 2 + u * (1200 ** 2 - 600 ** 2))
		: 600 + 600 * u;
}

export function createAnchor({
	seed,
	government,
	active,
	total,
	initial = "stationary",
}) {
	if (!["stationary", "cycle"].includes(initial))
		throw Error("invalid initial mode");
	const r = rates(government, active, total);
	const down = initial === "stationary" && unit(seed, 0, "phase") < r.share;
	const remaining = initial === "cycle" ? 1 : 1 - unit(seed, 0, "remaining");
	return validateAnchor({
		seed,
		government,
		active,
		total,
		at: 0,
		episode: 0,
		phase: down ? "down" : "up",
		left: (durationFor(seed, 0) * remaining) / (down ? 1 : r.odds),
		repaired: false,
	});
}

export function validateAnchor(a) {
	const { odds } = rates(a.government, a.active, a.total);
	if (
		!Number.isInteger(a.seed) ||
		a.seed < 0 ||
		a.seed > 0xffffffff ||
		!Number.isSafeInteger(a.episode) ||
		a.episode < 0 ||
		!Number.isFinite(a.at) ||
		a.at < 0 ||
		a.at > Number.MAX_SAFE_INTEGER ||
		!Number.isFinite(a.left) ||
		a.left <= 0 ||
		!["up", "down"].includes(a.phase) ||
		typeof a.repaired !== "boolean" ||
		(a.phase === "up" && a.repaired)
	)
		throw Error("invalid causal anchor");
	const limit = durationFor(a.seed, a.episode) / (a.phase === "up" ? odds : 1);
	if (a.left > limit) throw Error("invalid episode budget");
	return { ...a };
}

export function project(anchor, to) {
	const a = validateAnchor(anchor);
	if (!Number.isFinite(to) || to < a.at || to > Number.MAX_SAFE_INTEGER)
		throw Error("invalid time or query before retained anchor");
	const { odds, multiplier } = rates(a.government, a.active, a.total);
	let operational = 0;
	while (a.at < to) {
		const speed = a.phase === "up" ? multiplier : 1;
		const span = a.left / speed;
		const take = Math.min(span, to - a.at);
		if (a.phase === "up" || a.repaired) operational += take;
		a.at += take;
		if (take < span) {
			a.left -= take * speed;
		} else if (a.phase === "up") {
			a.phase = "down";
			a.left = durationFor(a.seed, a.episode);
		} else {
			a.phase = "up";
			a.episode++;
			if (!Number.isSafeInteger(a.episode)) throw Error("episode overflow");
			a.left = durationFor(a.seed, a.episode) / odds;
			a.repaired = false;
		}
	}
	return { state: a, operational };
}

export function query(anchor, from, to) {
	if (from < anchor.at) throw Error("query before retained anchor");
	return project(project(anchor, from).state, to).operational;
}

export class Harness {
	constructor(anchor, work) {
		this.anchor = validateAnchor(anchor);
		this.accountedThrough = anchor.at;
		this.queue = [...work];
		this.completed = 0;
		this.totalWork = 0;
	}
	settle(to) {
		let work = query(this.anchor, this.accountedThrough, to);
		for (let i = 0; i < this.queue.length && work > 0; i++) {
			if (this.queue[i] === 0) continue;
			const used = Math.min(work, this.queue[i]);
			this.queue[i] -= used;
			work -= used;
			this.totalWork += used;
			if (this.queue[i] === 0) this.completed++;
		}
		this.accountedThrough = to;
	}
	boundary(to) {
		this.settle(to);
		this.anchor = project(this.anchor, to).state;
	}
	changePressure(to, active) {
		rates(this.anchor.government, active, this.anchor.total);
		this.boundary(to);
		this.anchor.active = active;
	}
	repair(to) {
		this.boundary(to);
		if (this.anchor.phase === "down") this.anchor.repaired = true;
	}
	compact(to) {
		this.boundary(to);
	}
	submit(to, work) {
		if (!Number.isFinite(work) || work <= 0) throw Error("invalid work");
		this.settle(to);
		this.queue.push(work);
	}
}

export function distributionReport(samples = 32768) {
	const rows = [];
	for (let government = 0; government <= 7; government++) {
		for (const active of [0, 4]) {
			let disabled = 0;
			let maxLongRunError = 0;
			for (let seed = 0; seed < samples; seed++) {
				if (
					createAnchor({ seed, government, active, total: 4 }).phase === "down"
				)
					disabled++;
				if (seed < 64) {
					const a = createAnchor({
						seed,
						government,
						active,
						total: 4,
						initial: "cycle",
					});
					const r = rates(government, active, 4);
					let down = 0;
					for (let episode = 0; episode < 128; episode++)
						down += durationFor(seed, episode);
					const end = down * (1 + 1 / (r.odds * r.multiplier));
					const observed = 1 - query(a, 0, end) / end;
					maxLongRunError = Math.max(
						maxLongRunError,
						Math.abs(observed - r.share),
					);
				}
			}
			const target = rates(government, active, 4).share;
			rows.push({
				government,
				active,
				samples,
				target,
				initialObserved: disabled / samples,
				maxLongRunError,
			});
		}
	}
	return rows;
}

if (
	process.argv[1] &&
	import.meta.url === pathToFileURL(process.argv[1]).href
) {
	const rows = distributionReport();
	for (const row of rows) {
		if (
			Math.abs(row.initialObserved - row.target) > 0.008 ||
			row.maxLongRunError > 1e-10
		)
			throw Error(JSON.stringify(row));
	}
	console.log(
		JSON.stringify({ instrument: "capability-outages-937", rows }, null, 2),
	);
}
