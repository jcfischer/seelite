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
