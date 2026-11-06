import assert from "node:assert/strict";
import { test } from "node:test";
import {
	createAnchor,
	durationFor,
	Harness,
	project,
	query,
	rates,
	validateAnchor,
} from "./capability-outages-937.mjs";

const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-7, `${a} != ${b}`);
const fixture = (extra = {}) => ({
	...createAnchor({ seed: 0, government: 0, active: 0, total: 4 }),
	phase: "down",
	at: 0,
	left: 900,
	repaired: false,
	...extra,
});

test("odds, absent pressure and full-pressure endpoints", () => {
	near(rates(0, 0, 4).share, 0.12);
	near(rates(7, 0, 4).share, 0.03);
	near(rates(0, 4, 4).share, 3 / 14);
	near(rates(7, 4, 4).share, 6 / 103);
	near(rates(0, 0, 0).multiplier, 1);
	assert.throws(() => rates(0, 5, 4));
	assert.throws(() => rates(0, 1, 0));
	assert.throws(() => rates(0, 0, Number.MAX_SAFE_INTEGER + 1));
});

test("one outage excludes precisely its disabled seconds and uses half-open boundaries", () => {
	const a = fixture();
	near(query(a, 0, 900), 0);
	near(query(a, 0, 1200), 300);
	near(query(a, 900, 1200), 300);
	assert.equal(project(a, 900).state.phase, "up");
	assert.equal(project(a, 0).state.phase, "down");
});

test("pressure change never changes an outage already underway", () => {
	const h = new Harness(fixture(), [1200]);
	h.changePressure(300, 4);
	assert.equal(h.anchor.at + h.anchor.left, 900);
	h.changePressure(600, 0);
	assert.equal(h.anchor.at + h.anchor.left, 900);
	h.settle(1200);
	near(h.queue[0], 900);
});

test("higher pressure consumes only remaining operational budget faster", () => {
	const h = new Harness(fixture({ phase: "up", left: 1200 }), [2000]);
	h.changePressure(400, 4);
	assert.equal(h.anchor.left, 800);
	assert.equal(project(h.anchor, 799).state.phase, "up");
	assert.equal(project(h.anchor, 800).state.phase, "down");
	near(h.accountedThrough, 400);
	near(h.queue[0], 1600);
});

test("repair is immediately serviceable but cannot advance or resurrect its baseline episode", () => {
	const h = new Harness(fixture(), [2000]);
	h.repair(200);
	h.changePressure(400, 4);
	h.compact(500);
	assert.equal(h.anchor.phase, "down");
	assert.equal(h.anchor.repaired, true);
	assert.equal(h.anchor.at + h.anchor.left, 900);
	h.settle(1000);
	near(h.queue[0], 1200);
	const state = project(h.anchor, 900).state;
	assert.equal(state.phase, "up");
	assert.equal(state.repaired, false);
	near(
		state.left,
		durationFor(state.seed, state.episode) / rates(0, 0, 4).odds,
	);
});

test("whole and partitioned queries agree over seeded cycles", () => {
	for (let seed = 1; seed <= 64; seed++) {
		const a = createAnchor({
			seed,
			government: seed % 8,
			active: seed % 5,
			total: 4,
		});
		const whole = query(a, 0, 100000);
		let pieces = 0;
		for (let t = 0; t < 100000; t += 137)
			pieces += query(a, t, Math.min(t + 137, 100000));
		near(whole, pieces);
	}
});

test("remote recoveries, visits and reloads produce equal FIFO completion", () => {
	const run = (visits) => {
		const h = new Harness(fixture(), [200, 1000, 3000]);
		for (const [at, active] of [
			[300, 4],
			[1500, 2],
			[1800, 3],
			[2300, 4],
		]) {
			if (visits)
				for (let t = h.accountedThrough + 31; t < at; t += 31) h.settle(t);
			h.changePressure(at, active);
			h.anchor = validateAnchor(JSON.parse(JSON.stringify(h.anchor)));
		}
		h.settle(10000);
		return h;
	};
	const a = run(false);
	const b = run(true);
	near(a.totalWork, b.totalWork);
	assert.equal(a.completed, b.completed);
	a.queue.forEach((left, i) => near(left, b.queue[i]));
	assert.deepEqual(a.anchor, b.anchor);
});

test("FIFO splitting changes no total work, and late submission earns no old time", () => {
	const a = new Harness(fixture(), [1000]);
	const b = new Harness(fixture(), [100, 200, 300, 400]);
	a.settle(1500);
	b.settle(1500);
	near(
		a.queue.reduce((x, y) => x + y, 0),
		b.queue.reduce((x, y) => x + y, 0),
	);
	near(a.totalWork, b.totalWork);
	const late = new Harness(fixture(), []);
	late.submit(1500, 1000);
	near(late.queue[0], 1000);
	late.settle(1600);
	near(late.queue[0], 900);
});

test("discarded history and malformed causal anchors refuse explicitly", () => {
	const h = new Harness(fixture(), [1000]);
	h.changePressure(300, 4);
	assert.throws(() => query(h.anchor, 0, 900), /retained/);
	assert.throws(() => query(h.anchor, 900, 300));
	for (const extra of [
		{ left: 1000000 },
		{ phase: "up", left: 1e100 },
		{ left: -1 },
		{ at: NaN },
		{ phase: "maybe" },
		{ episode: 1.5 },
		{ active: 5 },
		{ repaired: true, phase: "up" },
	]) {
		assert.throws(() => validateAnchor(fixture(extra)));
	}
});

test("bounded anchors replace causal history, regardless of event count", () => {
	const h = new Harness(fixture(), []);
	const fields = Object.keys(h.anchor).sort();
	for (let t = 1; t <= 10000; t++) {
		h.changePressure(t, t % 5);
		if (t % 113 === 0) h.repair(t);
		if (t % 197 === 0) h.compact(t);
	}
	assert.deepEqual(Object.keys(h.anchor).sort(), fields);
	assert.ok(Buffer.byteLength(JSON.stringify(h.anchor)) < 256);
});

test("natural outage durations remain in range and complete cycles match target shares", () => {
	for (let seed = 0; seed < 64; seed++) {
		for (let episode = 0; episode < 64; episode++) {
			const d = durationFor(seed, episode);
			assert.ok(d >= 600 && d <= 1200);
			for (let gov = 0; gov < 8; gov++) {
				for (let active = 0; active <= 4; active++) {
					const r = rates(gov, active, 4);
					near(d / (d + d / r.odds / r.multiplier), r.share);
				}
			}
		}
	}
});
