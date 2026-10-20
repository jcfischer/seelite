import { expect, test } from "bun:test";
import { ModelQueue } from "../src/model-queue";

const gate = () => {
	let release!: () => void;
	const promise = new Promise<void>((resolve) => {
		release = resolve;
	});
	return { promise, release };
};

test("serial installs follow live priorities; an in-flight load is never restarted", async () => {
	const held = gate();
	const order: string[] = [];
	const queue = new ModelQueue(
		Object.fromEntries(
			["a", "b", "c", "d"].map((id) => [
				id,
				async () => {
					order.push(id);
					if (id === "a") await held.promise;
				},
			]),
		),
	);
	queue.prioritize(["a", "b"], ["c"]);
	const all = queue.wait(["a", "b", "c", "d"]);
	await Promise.resolve();
	expect(order).toEqual(["a"]);
	queue.prioritize(["d"], ["c"]);
	expect(queue.settled(["a"])).toBe(false);
	held.release();
	await all;
	expect(order).toEqual(["a", "d", "c", "b"]);
	expect(queue.settled(["a", "b", "c", "d"])).toBe(true);
});

test("failed loads warn once, keep processing, and never retry on system return", async () => {
	let attempts = 0;
	const warnings: string[] = [];
	const installs: string[] = [];
	const queue = new ModelQueue(
		{
			bad: async () => {
				attempts++;
				throw Error("offline");
			},
			good: async () => {},
		},
		async (id) => {
			installs.push(id);
		},
		(id) => {
			warnings.push(id);
		},
	);
	await queue.wait(["bad", "good"]);
	queue.prioritize(["bad", "good"]);
	await queue.wait(["bad", "good"]);
	expect(attempts).toBe(1);
	expect(warnings).toEqual(["bad"]);
	expect(installs).toEqual(["good"]);
	expect(queue.state("bad")).toBe("failed");
	expect(queue.settled(["bad", "good"])).toBe(true);
});

test("settlement includes the mesh refresh; boot-adopted models are not rebuilt", async () => {
	const held = gate();
	const installs: string[] = [];
	const queue = new ModelQueue(
		{
			boot: async () => {
				throw Error("must not fetch");
			},
			model: async () => {},
		},
		async (id) => {
			installs.push(id);
			await held.promise;
		},
	);
	queue.adopt(["boot"]);
	const done = queue.wait(["boot", "model"]);
	await Promise.resolve();
	await Promise.resolve();
	expect(queue.settled(["model"])).toBe(false);
	held.release();
	await done;
	expect(installs).toEqual(["model"]);
	expect(queue.settled(["boot", "model"])).toBe(true);
	expect(() => queue.wait(["unknown"])).toThrow();
});

test("current-system readiness does not wait for unrelated catalog work", async () => {
	const held = gate();
	const queue = new ModelQueue({
		current: async () => {},
		elsewhere: () => held.promise,
	});
	queue.prioritize(["current"]);
	await queue.wait(["current"]);
	expect(queue.settled(["current"])).toBe(true);
	expect(queue.settled(["current", "elsewhere"])).toBe(false);
	held.release();
	await queue.wait(["current", "elsewhere"]);
});

test("refresh failure preserves an installed template and reports its own phase", async () => {
	const held = gate();
	let downloads = 0;
	const warnings: string[] = [];
	const queue = new ModelQueue(
		{
			model: async () => {
				downloads++;
			},
			next: async () => {},
		},
		async (id) => {
			if (id !== "model") return;
			await held.promise;
			throw Error("refresh broke");
		},
		(id, _error, phase) => {
			warnings.push(`${id}:${phase}`);
		},
	);
	const done = queue.wait(["model", "next"]);
	await Promise.resolve();
	await Promise.resolve();
	expect(queue.state("model")).toBe("installed");
	expect(queue.settled(["model"])).toBe(false);
	held.release();
	await done;
	expect(queue.state("model")).toBe("installed");
	expect(queue.settled(["model", "next"])).toBe(true);
	queue.prioritize(["model"]);
	await queue.wait(["model"]);
	expect(downloads).toBe(1);
	expect(warnings).toEqual(["model:refresh"]);
});

test("a failed load runs the stand-in hook, and the model is not settled until it ends", async () => {
	const held = gate();
	const events: string[] = [];
	const queue = new ModelQueue(
		{
			bad: async () => {
				throw Error("offline");
			},
		},
		async () => {
			events.push("installed");
		},
		() => {},
		async (id) => {
			events.push(`failed:${id}`);
			await held.promise;
			events.push("stand-in built");
		},
	);
	const done = queue.wait(["bad"]);
	await new Promise((r) => setTimeout(r, 0));
	expect(queue.state("bad")).toBe("failed");
	expect(queue.settled(["bad"])).toBe(false);
	held.release();
	await done;
	expect(queue.settled(["bad"])).toBe(true);
	expect(events).toEqual(["failed:bad", "stand-in built"]);
});
