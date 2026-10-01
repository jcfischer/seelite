/**
 * A seeded xorshift stream, -1..1: the noise inside the speech synthesiser
 * and the radio (#600), which must render the same on every run so a test
 * or a probe can read it. A leaf: imports nothing.
 */
export function xorshiftNoise(seed: number): () => number {
	let x = seed >>> 0 || 1;
	return () => {
		x ^= x << 13;
		x ^= x >>> 17;
		x ^= x << 5;
		x >>>= 0;
		return x / 2147483648 - 1;
	};
}
