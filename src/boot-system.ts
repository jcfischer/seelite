/**
 * `?system=<index>`: which system a new game boots in.
 *
 * [#432](https://github.com/jcfischer/seelite/issues/432) asked for the way to
 * *stand* somewhere other than the start system. `sky-only` stands where the game
 * boots, and `startSystem` is specified as the most **central** well-stocked and
 * orderly system, so a canonical frame could be taken from nowhere else. `?seed`
 * pins a world; it cannot pin a place inside one. A scripted jump was the
 * alternative on the table and it is worse: it spends the Hyperspace tank — the
 * canonical compound of `CONTEXT.md` §Language, the fuel store rather than a
 * place, so this is not the _Avoid_ alias for **Witchspace** — it needs an
 * in-range route, and it would make a canonical frame a function of whichever
 * systems the jump happened to route through.
 *
 * **The node built this for a row, and the row did not survive being measured.**
 * It was aimed along the **Core bearing** at a rim system, captured, judged on the
 * sheet, and removed in the same PR: the cone of cluster light sits below the
 * density the invented layer already lays down in every direction, which
 * `scripts/measure-sky-density.ts`'s core mode prints. So what this file is for is
 * the standing and not the aiming — how a script, or a person at a URL, gets a
 * game to any system at all. [#478](https://github.com/jcfischer/seelite/issues/478)
 * holds what to do with the bearing now.
 *
 * ## The rule: it is a new game, elsewhere
 *
 * Everything else about the boot is what a new game is — galaxy 0, clock 0, the
 * ship on the arrival point, the `visit` recorded — and only the system is
 * named. See `makeWorldAtSystem` in `sim.ts`, and §11.6 of
 * `persistent-world-state.md` for why such a boot writes nothing.
 *
 * ## A refused index is said, not swallowed
 *
 * The shape mirrors `querySeed` in `main.ts`, including the trap its docstring
 * names: `Number("")` is `0`, so an empty parameter has to be refused on its own
 * terms rather than falling through to system 0. Only a run of decimal digits is
 * an index, which also refuses `0x4` and `1e2` — `Number()` reads all three, and
 * a URL that silently pins a *different* system than the one typed is the worst
 * thing this affordance could do, because the frame it produces is captioned
 * with the system it was asked for.
 *
 * So a refusal warns, and the capture reads the booted index back and throws.
 * The warning is for a person at a console; the readback is the gate.
 *
 * ## Why the parse is here
 *
 * `main.ts` builds a renderer at module scope and cannot be imported under bun,
 * so a decision written there is a decision nothing runs — `commander-flow.ts`
 * exists for that reason, and this file for the same one. The script that *builds*
 * the parameter, `scripts/capture-views.mjs`, runs under node through
 * `scripts/lib/game-url.mjs` and can import neither, so
 * `tests/boot-system.test.ts` pins the two spellings against each other the way
 * `tests/game-url.test.ts` pins `?boot`.
 */

import { SYSTEMS_PER_GALAXY } from "./galaxy";

/** The query parameter a booted system is read from. */
export const SYSTEM_QUERY = "system";

/** An index is a run of decimal digits, and nothing else. See the header. */
const INDEX = /^[0-9]+$/;

/**
 * The system a boot was asked for, or `null` for the start system.
 *
 * `null` covers three cases — absent, unusable, out of range — and they are one
 * boot, which is the reason they are not returned apart. A boot that named no
 * usable system **named no place**: it stands where the generator stands the
 * ship, which is where its own save expects to be, so it is an ordinary boot and
 * §11.6's writes-nothing does not reach it. `?system=999` continues a Commander
 * rather than being quarantined like a boot that named a system it *used* — that
 * one is `pinnedSystem !== null` in `commander-flow.ts`, and the difference is
 * whether the world moved. What the two refusals share is that neither is
 * silence: each is said here, where the string that failed is still in hand.
 */
export function querySystem(query: URLSearchParams): number | null {
	const raw = query.get(SYSTEM_QUERY);
	if (raw === null) return null;
	if (!INDEX.test(raw)) {
		console.warn(`[seelite] ignoring unusable ?system=${JSON.stringify(raw)}`);
		return null;
	}
	const index = Number(raw);
	if (!Number.isSafeInteger(index) || index >= SYSTEMS_PER_GALAXY) {
		console.warn(
			`[seelite] ?system=${raw} is not a system of a ${SYSTEMS_PER_GALAXY}-system galaxy, so the start system is booted instead`,
		);
		return null;
	}
	return index;
}
