/** Locate an emitted scalar GLSL function, including its nested blocks.
 * These generated helpers contain no braces in strings or comments.
 * @param {string} source
 * @param {string} name
 * @returns {{start: number, end: number}}
 */
export function glslFunctionRange(source, name) {
	const start = source.indexOf(`float ${name}(`);
	if (start < 0) throw new Error(`missing GLSL function ${name}`);
	const open = source.indexOf("{", start);
	if (open < 0) throw new Error(`missing GLSL body ${name}`);
	let end = open + 1;
	let depth = 1;
	for (; depth > 0 && end < source.length; end++) {
		if (source[end] === "{") depth++;
		if (source[end] === "}") depth--;
	}
	if (depth !== 0) throw new Error(`unclosed GLSL body ${name}`);
	return { start, end };
}
