/** Body names derived from generated body order. No function in this file
 * takes an RNG, seed, or stream. */

const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII"] as const;

export function starName(systemName: string): string {
	return systemName;
}

export function planetName(systemName: string, ordinal: number): string {
	if (ordinal < 0 || ordinal >= ROMAN.length)
		throw new Error(`planet ordinal ${ordinal} is outside the v1 ladder`);
	const numeral = ROMAN[ordinal];
	return `${systemName} ${numeral}`;
}

export function moonName(parentName: string, ordinal: number): string {
	if (ordinal < 0 || ordinal >= 26)
		throw new Error(`moon ordinal ${ordinal} is outside the display alphabet`);
	return `${parentName} ${String.fromCharCode(97 + ordinal)}`;
}
