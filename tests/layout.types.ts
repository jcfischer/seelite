/**
 * A layout is an opaque type from one constructor (#381 S4).
 *
 * **Checked by `tsc --noEmit` and by nothing else**, which is why this is a
 * `.types.ts` beside `station-console-tabs.types.ts` rather than a `bun test`
 * row: the property is that a bare `Binding[]` *does not compile* where a
 * layout is wanted, and a runtime assertion cannot see a call that was never
 * written. Each `@ts-expect-error` below is red twice over — it fails if the
 * call starts compiling, and `tsc` fails it as an unused directive if the
 * error it names goes away.
 *
 * **Why the type and not the freeze.** `holdRows` keys its index on the array
 * *identity*, so a layout written into rather than rebuilt is answered out of
 * a stale index. `freezeLayout` makes that throw in strict mode, which is a
 * runtime backstop; this makes the precondition something a signature carries,
 * so a module that builds its own table cannot hand one over at all. The
 * storage slice was the obvious candidate to break it and every later producer
 * — the capture modal among them — inherits the same question.
 */
import {
	DEFAULT_BINDINGS,
	type Binding,
	isHeld,
	type Layout,
	layoutOf,
	rebind,
	resolveKey,
	resolvePad,
} from "../src/commands";

const rows: Binding[] = [...DEFAULT_BINDINGS];

// The constructor is the way in, and what it returns is a layout.
const built: Layout = layoutOf(rows);

// @ts-expect-error A bare array is not a layout: nothing froze it, so the hold
// index cannot key on its identity.
const notALayout: Layout = rows;

// @ts-expect-error `isHeld` indexes the table it is handed.
isHeld(rows, "fly.pitchUp", new Set(["w"]), "cockpit");

// @ts-expect-error `resolveKey` reads the layout in force.
resolveKey(rows, { key: "j", view: "cockpit" });

// @ts-expect-error and so does `resolvePad`.
resolvePad(rows, { button: "y", context: "flight", view: "cockpit" });

// **The triggers are hoisted so the call fits one line.** A
// `@ts-expect-error` binds to the line *after* it, and the formatter splits a
// four-argument call across five — which moved the directive off the argument
// it names and turned this row into an unused-directive error plus an
// unguarded one. Keeping the call short keeps the two together whatever
// biome does.
const offJ = { kind: "key", key: "j" } as const;
const onFive = { kind: "key", key: "5" } as const;

// @ts-expect-error `rebind` returns a layout, so it must be given one.
rebind(rows, "fly.cruise", offJ, onFive);

// And every one of those compiles against a layout.
isHeld(built, "fly.pitchUp", new Set(["w"]), "cockpit");
resolveKey(built, { key: "j", view: "cockpit" });
resolvePad(built, { button: "y", context: "flight", view: "cockpit" });
const moved: Layout = rebind(built, "fly.cruise", offJ, onFive);

export type { Layout };
export { built, moved, notALayout };
