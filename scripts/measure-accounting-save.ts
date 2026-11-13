import { accountingSaveCases } from "./lib/accounting-save-cases";
import { serializeSave, parseSave } from "../src/save-envelope";
import { fnv1a } from "../src/rng";
for (const { name, save } of accountingSaveCases()) {
	const start = performance.now(),
		raw = serializeSave(save),
		hashed = performance.now();
	const text = JSON.stringify(raw),
		stringified = performance.now();
	const { integrity, ...body } = raw;
	const hashStart = performance.now();
	fnv1a(JSON.stringify(body));
	const hashEnd = performance.now();
	const parseStart = performance.now();
	parseSave(JSON.parse(text));
	const end = performance.now();
	console.log(
		JSON.stringify({
			name,
			envelopeUtf8: new TextEncoder().encode(text).length,
			liveAndCheckpointUtf8: 2 * new TextEncoder().encode(text).length,
			serializeAndHashMs: hashed - start,
			jsonStringifyMs: stringified - hashed,
			hashMs: hashEnd - hashStart,
			parseAndValidationMs: end - parseStart,
		}),
	);
}
