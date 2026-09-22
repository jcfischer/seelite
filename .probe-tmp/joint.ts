import { faintField, FAINT_COUNT, FAINT_SIZE_MIN, FAINT_SIZE_SPAN, BRIGHT_SIZE_MIN } from "../src/backdrop";
import { rec709Luma, PHOTOSPHERE_LUMA } from "../src/star-colour";

const dimmestReal = BRIGHT_SIZE_MIN ** 2 * PHOTOSPHERE_LUMA;
let n = 0, joint = 0, marginalLuma = 0, marginalSize = 0;
const thrLuma = PHOTOSPHERE_LUMA / (FAINT_SIZE_MIN + FAINT_SIZE_SPAN) ** 2 * 0 + PHOTOSPHERE_LUMA / ((FAINT_SIZE_MIN + FAINT_SIZE_SPAN) / BRIGHT_SIZE_MIN) ** 2;
for (let seed = 0; seed < 8; seed++) {
	const f = faintField(seed * 104729 + 5, FAINT_COUNT);
	for (let i = 0; i < f.count; i++) {
		const L = rec709Luma(f.colors[i*3], f.colors[i*3+1], f.colors[i*3+2]);
		const light = f.sizes[i] ** 2 * L;
		n++;
		if (light > dimmestReal) joint++;
		if (L > thrLuma) marginalLuma++;
		if (f.sizes[i] >= FAINT_SIZE_MIN + FAINT_SIZE_SPAN - 1e-9) marginalSize++;
	}
}
console.log(`dimmest real light ${dimmestReal.toExponential(3)}`);
console.log(`JOINT share outshining: ${(100*joint/n).toFixed(2)}%  (${joint}/${n})`);
console.log(`marginal luma share (the wrong one, printed as 35.08): ${(100*marginalLuma/n).toFixed(2)}%`);
console.log(`share at max size: ${(100*marginalSize/n).toFixed(4)}%`);
// size distribution tail
let above = 0;
for (let u = 0; u < 1; u += 1e-5) { const s = FAINT_SIZE_MIN + FAINT_SIZE_SPAN*u**6; if (s > Math.sqrt(dimmestReal)) above++; }
console.log(`analytic: fraction of u needing max-luma to outshine: ${(above/1e5).toFixed(4)}`);
