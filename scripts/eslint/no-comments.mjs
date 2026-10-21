const TS_SUPPRESSION = /^\s*@ts-(ignore|expect-error|nocheck)\b/;
const LICENSE = /licen[cs]e|copyright|SPDX-License-Identifier/i;
const URL = /https?:\/\//;
const TOOL_DIRECTIVE = /^\s*(biome-ignore\b|@vite-ignore\b|#__PURE__\b)/;
const EXPORTS = new Set(["ExportNamedDeclaration", "ExportDefaultDeclaration"]);

function documentsExport(source, comment) {
	const token = source.getTokenAfter(comment);
	if (!token) return false;
	let node = source.getNodeByRangeIndex(token.range[0]);
	while (node) {
		if (EXPORTS.has(node.type)) return true;
		const parent = node.parent;
		if (parent?.range?.[0] !== token.range[0]) return false;
		node = parent;
	}
	return false;
}

function isAllowed(source, comment, first) {
	const { type, value } = comment;
	if (first && LICENSE.test(value)) return true;
	if (type === "Line" && /^\/\s*<reference\b/.test(value)) return true;
	if (TOOL_DIRECTIVE.test(value)) return true;
	if (URL.test(value)) return true;
	return (
		type === "Block" &&
		value.startsWith("*") &&
		documentsExport(source, comment)
	);
}

/** @type {import("eslint").Rule.RuleModule} */
export const noComments = {
	meta: {
		type: "suggestion",
		docs: { description: "Say it in code, not in a comment" },
		messages: {
			suppression:
				"Type-check suppression. Fix the type error instead. A test that needs a wrong-typed value casts through `unknown`.",
			comment:
				"Comment. Say it in code: rename, extract, add a type or a test. Kept: a URL to the issue or vendor doc behind a constraint, a /** doc */ on an export, a biome-ignore or @vite-ignore directive, a license header.",
		},
		schema: [],
	},
	create(context) {
		const source = context.sourceCode;
		return {
			Program() {
				source
					.getAllComments()
					.filter((c) => c.type !== "Shebang")
					.forEach((comment, i) => {
						if (!comment.loc) return;
						if (TS_SUPPRESSION.test(comment.value))
							context.report({ loc: comment.loc, messageId: "suppression" });
						else if (!isAllowed(source, comment, i === 0))
							context.report({ loc: comment.loc, messageId: "comment" });
					});
			},
		};
	},
};
