/**
 * What `tsc` refuses in the derived names, and `bun test` cannot see (#381 S5).
 *
 * `tsc --noEmit` checks this file; each directive below fails the typecheck
 * the moment the line under it compiles, which is what holds the claim in
 * `dialKeys`'s doc that a dial the registry has no pair for does not compile.
 */
import { DEFAULT_BINDINGS } from "../src/commands";
import { dialKeys } from "../src/controls-reference";

dialKeys(DEFAULT_BINDINGS, "vMax");
// @ts-expect-error — no `tune.vMaxxDown` row, so no such dial.
dialKeys(DEFAULT_BINDINGS, "vMaxx");
// @ts-expect-error — `reset` has no Down/Up pair; it is one command.
dialKeys(DEFAULT_BINDINGS, "reset");
