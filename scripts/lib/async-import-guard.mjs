/**
 * A dynamic import waits for its target's top-level evaluation. A startup
 * chunk must therefore never be dynamically imported by itself or a static
 * dependency, including through a facade that statically imports it: awaiting
 * that loader can leave both promises pending forever.
 * Check emitted chunks, not source imports: Rollup can create the back edge
 * when it folds a statically imported model into the awaiting entry (#1021).
 *
 * This is a conservative build boundary, not general promise analysis. Even
 * a callback intended to run after startup must not import back into an async
 * ancestor; put the shared implementation in a separate module instead.
 */

/** @param {any} node */
function hasTopLevelAwait(node) {
	if (!node || typeof node !== "object") return false;
	if (
		node.type === "FunctionDeclaration" ||
		node.type === "FunctionExpression" ||
		node.type === "ArrowFunctionExpression"
	)
		return false;
	if (
		node.type === "AwaitExpression" ||
		(node.type === "ForOfStatement" && node.await)
	)
		return true;
	return Object.values(node).some((value) =>
		Array.isArray(value)
			? value.some(hasTopLevelAwait)
			: hasTopLevelAwait(value),
	);
}

/** @returns {import('vite').Plugin} */
export function asyncImportGuard() {
	return {
		name: "seelite-async-import-guard",
		apply: "build",
		generateBundle(_, bundle) {
			const chunks = new Map(
				Object.values(bundle)
					.filter((item) => item.type === "chunk")
					.map((chunk) => [chunk.fileName, chunk]),
			);
			const closures = new Map();
			const staticClosure = (root) => {
				if (closures.has(root)) return closures.get(root);
				const seen = new Set();
				const visit = (name) => {
					if (seen.has(name)) return;
					seen.add(name);
					for (const dependency of chunks.get(name)?.imports ?? [])
						visit(dependency);
				};
				visit(root);
				closures.set(root, seen);
				return seen;
			};
			for (const target of chunks.values()) {
				if (
					!target.code.includes("await") ||
					!hasTopLevelAwait(this.parse(target.code))
				)
					continue;
				for (const name of staticClosure(target.fileName))
					for (const lazy of chunks.get(name)?.dynamicImports ?? [])
						if (staticClosure(lazy).has(target.fileName))
							this.error(
								`async startup import cycle: ${name} dynamically imports ${lazy}, which reaches unfinished ${target.fileName} through static imports. Move the loader out of the async startup chunk or import it directly.`,
							);
			}
		},
	};
}
