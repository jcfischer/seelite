import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { parse } from "@typescript-eslint/parser";

const source = readFileSync("scripts/probe-binding-store.mjs", "utf8");
const callbacks: string[] = [];
function visit(node: any) {
	if (!node || typeof node !== "object") return;
	if (
		node.type === "CallExpression" &&
		node.callee.type === "MemberExpression" &&
		node.callee.object.name === "page" &&
		node.callee.property.name === "evaluate" &&
		node.arguments[0]?.type === "ArrowFunctionExpression"
	) {
		const [start, end] = node.arguments[0].range;
		callbacks.push(source.slice(start, end));
	}
	for (const value of Object.values(node)) {
		if (Array.isArray(value)) value.forEach(visit);
		else if (value && typeof value === "object") visit(value);
	}
}
visit(parse(source, { range: true, sourceType: "module" }));
const refuse = callbacks.find((s) => s.includes('throw new Error("quota")'))!;
const restore = callbacks.find((s) =>
	s.includes("Storage.prototype.setItem = window.__bindingStoreSetItem"),
)!;

function environment() {
	class Storage {
		values = new Map<string, string>();
		setItem(key: string, value: string) {
			this.values.set(key, value);
		}
		getItem(key: string) {
			return this.values.get(key) ?? null;
		}
		clear() {
			this.values.clear();
		}
		removeItem(key: string) {
			this.values.delete(key);
		}
	}
	return {
		Storage,
		localStorage: new Storage(),
		window: { __seelite: { selectLayout() {} } },
	};
}

test("refusing storage twice still restores a working native writer", () => {
	const context = environment();
	const native = context.Storage.prototype.setItem;
	for (let i = 0; i < 2; i++) {
		runInNewContext(`(${refuse})()`, context);
		expect(() => context.localStorage.setItem("key", "value")).toThrow("quota");
	}
	runInNewContext(`(${restore})()`, context);
	expect(context.Storage.prototype.setItem).toBe(native);
	context.localStorage.setItem("key", "value");
	expect(context.localStorage.getItem("key")).toBe("value");
});

test("restoring storage without saving a writer refuses before changing the prototype", () => {
	const context = environment();
	const native = context.Storage.prototype.setItem;
	expect(() => runInNewContext(`(${restore})()`, context)).toThrow(
		"no native storage writer was saved",
	);
	expect(context.Storage.prototype.setItem).toBe(native);
});
