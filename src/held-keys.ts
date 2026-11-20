/**
 * https://github.com/jcfischer/seelite/issues/390
 * A press enters the held set under the name `keyDispatch` gave it, and its
 * physical key remembers that name.
 */
export function pressHeldKey(
	held: Set<string>,
	codes: Map<string, string>,
	key: string,
	code: string,
): void {
	held.add(key);
	if (code) codes.set(code, key);
}

/**
 * https://github.com/jcfischer/seelite/issues/390
 * A release takes out the key it names and the name its physical key was
 * pressed as: on macOS D let go under Option reports `∂`, and `d` stayed held.
 */
export function releaseHeldKey(
	held: Set<string>,
	codes: Map<string, string>,
	key: string,
	code: string,
): void {
	held.delete(key);
	held.delete(codes.get(code) ?? key);
	codes.delete(code);
}
