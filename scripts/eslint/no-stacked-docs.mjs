const DECLARES = /@(typedef|callback|import)\b/;
const TAGS_ONLY = /^[\s*]*@/;

function isDoc(comment) {
	return comment.type === "Block" && comment.value.startsWith("*");
}

function documentsSomething(source, comment) {
	const before = source.getTokenBefore(comment, { includeComments: true });
	if (!before || before.type === "Shebang" || DECLARES.test(comment.value))
		return true;
	const next = source.getTokenAfter(comment, { includeComments: true });
	return !(
		next &&
		isDoc(next) &&
		!DECLARES.test(next.value) &&
		!TAGS_ONLY.test(next.value)
	);
}

/** @type {import("eslint").Rule.RuleModule} */
export const noStackedDocs = {
	meta: {
		type: "problem",
		docs: { description: "A doc comment sits directly on what it documents" },
		messages: {
			stacked:
				"Doc comment stacked on another doc comment, so it documents nothing: a declaration was inserted between it and the code it describes. Move it back onto that declaration, merge the two, or delete the stale one.",
		},
		schema: [],
	},
	create(context) {
		const source = context.sourceCode;
		return {
			Program() {
				for (const comment of source.getAllComments()) {
					if (!isDoc(comment) || !comment.loc) continue;
					if (!documentsSomething(source, comment))
						context.report({ loc: comment.loc, messageId: "stacked" });
				}
			},
		};
	},
};
