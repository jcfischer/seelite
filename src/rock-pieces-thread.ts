import type { RockHeightfield } from "./rock-heightfields";
import type { RockPieces } from "./rock-pieces";

/** A module Worker that builds rock pieces off the main thread, for `prebuildRockPieces`; `close` lets it go and refuses what is still waiting. */
export function rockPiecesThread(): {
	build: (archetype: number, field: RockHeightfield) => Promise<RockPieces>;
	close: () => void;
} {
	const worker = new Worker(
		new URL("./rock-pieces.worker.ts", import.meta.url),
		{ type: "module" },
	);
	const waiting = new Map<
		number,
		{ resolve: (p: RockPieces) => void; reject: (e: unknown) => void }
	>();
	const refuseAll = (reason: unknown) => {
		for (const w of waiting.values()) w.reject(reason);
		waiting.clear();
	};
	worker.onmessage = (
		e: MessageEvent<{ archetype: number; pieces: RockPieces }>,
	) => {
		waiting.get(e.data.archetype)?.resolve(e.data.pieces);
		waiting.delete(e.data.archetype);
	};
	worker.onerror = (e) =>
		refuseAll(new Error(`rock pieces worker: ${e.message}`));
	return {
		build: (archetype, field) =>
			new Promise((resolve, reject) => {
				waiting.set(archetype, { resolve, reject });
				worker.postMessage({ archetype, field });
			}),
		close: () => {
			worker.terminate();
			refuseAll(new Error("rock pieces worker closed"));
		},
	};
}
