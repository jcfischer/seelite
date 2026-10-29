import type { RockHeightfield } from "./rock-heightfields";
import { buildRockPieces } from "./rock-pieces";

self.onmessage = (
	e: MessageEvent<{ archetype: number; field: RockHeightfield }>,
) => {
	const { archetype, field } = e.data;
	self.postMessage({
		archetype,
		pieces: buildRockPieces(field, { label: `archetype ${archetype}` }),
	});
};
