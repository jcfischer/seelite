/**
 * The capture modal's own state, headless (#381 S4, #369 D9).
 *
 * The drawn shell is `mountCaptureModal`'s and a browser probe measures it.
 * What is here is the part that decides: what the modal is showing, what it
 * will commit, and what it refuses to commit — because a modal that reports
 * success and moves nothing is exactly the defect `rebind`'s doc was written
 * against, and no amount of looking at a frame catches it.
 */
import { describe, expect, test } from "bun:test";
import { shippedTrigger } from "./lib/shipped-trigger";
import {
	captureModalMarkup,
	committable,
	offered,
	openCapture,
} from "../src/capture-modal";
import { controlsCatalogue } from "../src/controls-catalogue";
import { DEFAULT_BINDINGS, isHeld, type Trigger } from "../src/commands";

const CRUISE = shippedTrigger("fly.cruise");
const open = () => openCapture("fly.cruise", CRUISE);

describe("a session listens, catches, and commits once", () => {
	test("it opens listening, with nothing caught and nothing to commit", () => {
		const session = open();
		expect(session.stage.kind).toBe("listening");
		expect(session.command).toBe("fly.cruise");
	});

	test("a free trigger is caught with no warning", () => {
		const session = offered(open(), DEFAULT_BINDINGS, {
			kind: "key",
			key: "5",
		});
		expect(session.stage.kind).toBe("caught");
		if (session.stage.kind !== "caught") return;
		expect(session.stage.warnings).toEqual([]);
		expect(session.stage.layout.length).toBe(DEFAULT_BINDINGS.length);
	});

	test("a taken trigger is caught anyway, with the warning beside it", () => {
		// D5 is warn **and allow**. The layout is there to commit; the sentence
		// is there to read first.
		const session = offered(open(), DEFAULT_BINDINGS, {
			kind: "key",
			key: "k",
		});
		if (session.stage.kind !== "caught") throw new Error(session.stage.kind);
		expect(session.stage.warnings.length).toBe(1);
		expect(session.stage.layout.length).toBe(DEFAULT_BINDINGS.length);
	});

	test("a refusal carries the sentence and no layout at all", () => {
		// There is nothing to commit, so there is nothing to commit *with* —
		// the stage has no `layout` field to reach for.
		const session = offered(open(), DEFAULT_BINDINGS, {
			kind: "pad-stick",
			stick: "right",
			axis: "x",
			half: "+",
			contexts: ["capture"],
		});
		expect(session.stage.kind).toBe("refused");
		if (session.stage.kind !== "refused") return;
		expect(session.stage.refusal).toBe("no-reader-axes");
		expect(session.stage.why).toMatch(/padFlightAxes/);
		expect("layout" in session.stage).toBe(false);
	});

	test("a second offer replaces the first — a player may press again", () => {
		// The modal listens until it is dismissed, so the *last* thing pressed
		// is what would be committed. A version that latched the first press
		// would make a mistyped capture unrecoverable without cancelling.
		const first = offered(open(), DEFAULT_BINDINGS, { kind: "key", key: "k" });
		const second = offered(first, DEFAULT_BINDINGS, { kind: "key", key: "5" });
		if (second.stage.kind !== "caught") throw new Error(second.stage.kind);
		expect(second.stage.warnings).toEqual([]);
	});

	test("a refusal after a catch replaces it, and leaves nothing committable", () => {
		// The dangerous ordering: catch something legal, then press a stick.
		// A modal that kept the earlier candidate would commit a trigger the
		// player had already moved on from.
		const caught = offered(open(), DEFAULT_BINDINGS, { kind: "key", key: "5" });
		const then = offered(caught, DEFAULT_BINDINGS, {
			kind: "pad-trigger",
			trigger: "r2",
			contexts: ["capture"],
		});
		expect(then.stage.kind).toBe("refused");
		// **The row's own title, asserted** (sage round 1): it said "leaves
		// nothing committable" and checked only the stage, so a regression
		// where `committable` kept the earlier candidate passed it.
		expect(committable(then)).toBeNull();
	});

	test("the session never mutates the layout it was given", () => {
		const before = DEFAULT_BINDINGS.map((b) => b.command).join("|");
		offered(open(), DEFAULT_BINDINGS, { kind: "key", key: "k" });
		expect(DEFAULT_BINDINGS.map((b) => b.command).join("|")).toBe(before);
	});
});

describe("what the modal says", () => {
	const catalogue = controlsCatalogue();

	test("listening names the control and asks for an input", () => {
		const html = captureModalMarkup(open(), catalogue);
		// The registry's authored name, as a literal: the modal must print what
		// the tab behind it prints, and deriving the expectation from the same
		// catalogue would agree with itself whatever either says.
		expect(html).toContain("Engage or drop cruise");
		expect(html).toContain("Press a key, or a button, stick or trigger");
		expect(html).toMatch(/data-capture-cancel/);
		// Nothing to confirm yet, so no confirm control is drawn — a disabled
		// one is a button a player tries.
		expect(html).not.toMatch(/data-capture-confirm/);
	});

	test("a catch shows the trigger in the player's words, and offers it", () => {
		const html = captureModalMarkup(
			offered(open(), DEFAULT_BINDINGS, { kind: "key", key: "5" }),
			catalogue,
		);
		expect(html).toContain("5");
		expect(html).toMatch(/data-capture-confirm/);
	});

	test("a warning is printed as the sentence the band prints", () => {
		// #369 D11: one phrasing for every printed name, and for a notice
		// `noticeText` is it.
		// A modal with its own phrasing is the second copy that ruling refuses.
		const html = captureModalMarkup(
			offered(open(), DEFAULT_BINDINGS, { kind: "key", key: "k" }),
			catalogue,
		);
		expect(html).toContain("Both run; move one to separate them.");
		// And it still offers the bind, because D5 allows it.
		expect(html).toMatch(/data-capture-confirm/);
	});

	test("a refusal prints its reason and offers nothing to confirm", () => {
		const html = captureModalMarkup(
			offered(open(), DEFAULT_BINDINGS, {
				kind: "pad-stick",
				stick: "right",
				axis: "x",
				half: "+",
				contexts: ["capture"],
			}),
			catalogue,
		);
		expect(html).not.toMatch(/data-capture-confirm/);
		expect(html).toMatch(/data-capture-cancel/);
		// **The player's sentence, and not the thrown one.** This row read
		// `toContain("padFlightAxes")` until a frame was looked at: the modal
		// was printing `movedTrigger`'s message, which names the reader a
		// developer has to change and means nothing to anyone flying.
		expect(html).toContain("A stick or a trigger cannot be bound yet");
		expect(html).not.toContain("padFlightAxes");
	});

	test("the cancel is always there, in every stage", () => {
		// **The modal's whole bootstrap.** The pad reserves no button and the
		// keyboard is being recorded, so the click is the only way out — and
		// #370's premise that a screen is always clickable is what makes that
		// a guarantee rather than a hope.
		for (const session of [
			open(),
			offered(open(), DEFAULT_BINDINGS, { kind: "key", key: "5" }),
			offered(open(), DEFAULT_BINDINGS, {
				kind: "pad-trigger",
				trigger: "r2",
				contexts: ["capture"],
			}),
		])
			expect(captureModalMarkup(session, catalogue)).toMatch(
				/data-capture-cancel/,
			);
	});

	test("the control's name is escaped, not interpolated", () => {
		const html = captureModalMarkup(open(), catalogue);
		expect(html).not.toContain("<script");
	});
});

describe("the capture says which key and the command says the rest", () => {
	/**
	 * **The row that came out of looking at a frame.** Every headless row
	 * above was green while the modal was unusable for `fly.pitchUp`, which is
	 * `s` *held*: a player pressing `k` sent a press, `movedTrigger` refused
	 * the qualifier change, and the screen printed the thrown message —
	 * `a rebind may move a trigger, not its qualifiers: key:s::hold ->
	 * key:k::press`. That is the storage slice's defect on a different screen.
	 */
	const PITCH = shippedTrigger("fly.pitchUp");
	/**
	 * `view.headPort`'s Alt row.
	 *
	 * `shippedTrigger` takes a kind and not a qualifier, and this command has
	 * three key triggers — so the lookup is here once rather than in each of
	 * the two rows that need it (sage round 3 on #497).
	 */
	const chordRow = (): Trigger => {
		const found = DEFAULT_BINDINGS.find(
			(b) =>
				b.command === "view.headPort" &&
				b.trigger.kind === "key" &&
				b.trigger.alt === true,
		);
		if (!found) throw new Error("view.headPort has no Alt row");
		return found.trigger;
	};

	test("a held control captures a held key", () => {
		const session = offered(
			openCapture("fly.pitchUp", PITCH),
			DEFAULT_BINDINGS,
			{ kind: "key", key: "5" },
		);
		if (session.stage.kind !== "caught") throw new Error(session.stage.kind);
		expect(session.stage.to).toEqual({ kind: "key", key: "5", hold: true });
	});

	test("and it flies: the new key is held, the old one is not", () => {
		// The property the qualifier is *for*. A press stored here would be a
		// binding `isHeld` never answers, which is a control that prints and
		// cannot be flown — `rebind`'s doc names exactly that.
		const session = offered(
			openCapture("fly.pitchUp", PITCH),
			DEFAULT_BINDINGS,
			{ kind: "key", key: "5" },
		);
		const layout = committable(session);
		if (!layout) throw new Error("nothing to commit");
		const held = new Set(["5"]);
		expect(isHeld(layout, "fly.pitchUp", held, "cockpit")).toBe(true);
		expect(isHeld(layout, "fly.pitchUp", new Set(["s"]), "cockpit")).toBe(
			false,
		);
	});

	test("a chord row captures a bare key as a chord", () => {
		// `alt` travels with `hold`, and the label the modal prints is the
		// completed trigger — so what will be bound is what the player reads.
		const session = offered(
			openCapture("view.headPort", chordRow()),
			DEFAULT_BINDINGS,
			{ kind: "key", key: "q" },
		);
		if (session.stage.kind !== "caught") throw new Error(session.stage.kind);
		expect(session.stage.to).toMatchObject({ key: "q", alt: true });
		expect(captureModalMarkup(session, controlsCatalogue())).toContain(
			"Alt + q",
		);
	});

	test("a shifted character keeps the character, not its unshifted position", () => {
		// **The regression round 4 shipped and round 5 caught.** Normalising
		// every coded capture through `codeKey` turned `?` into `/` — that
		// function gives the character a position types *unshifted*, and
		// `Slash` is `/`. #377 ruled `?` is the character the keyboard types,
		// so the widening silently renamed a shipped binding the moment a
		// player recaptured it.
		const session = offered(
			openCapture("view.toggle", shippedTrigger("view.toggle")),
			DEFAULT_BINDINGS,
			{ kind: "key", key: "?", code: "Slash" },
		);
		if (session.stage.kind !== "caught") throw new Error(session.stage.kind);
		expect(session.stage.to).toMatchObject({ key: "?", code: "Slash" });
	});

	test("and a key with no character of its own keeps its name", () => {
		// `codeKey` strips a `Key`/`Digit` prefix and lowercases the rest, so
		// `F2` would have become `f2` and `NumpadAdd` `numpadadd` — names no
		// keypress produces. Nothing normalises them now, and this row is the
		// one that says so.
		const session = offered(
			openCapture("view.toggle", shippedTrigger("view.toggle")),
			DEFAULT_BINDINGS,
			{ kind: "key", key: "f2", code: "F2" },
		);
		if (session.stage.kind !== "caught") throw new Error(session.stage.kind);
		expect(session.stage.to).toMatchObject({ key: "f2", code: "F2" });
	});

	test("a chord takes the character its position types, not the one Option sent", () => {
		// **#369 D7's whole point, and it reached only one producer** until
		// sage round 2 on #497. On macOS Option changes the character, so a
		// captured `Alt+D` arrives as `∂`; stored verbatim it printed as
		// `Alt + ∂` and the row named a key nobody has. `movedTrigger`
		// normalises from the code now, so every producer of an Alt trigger
		// gets the rule rather than just `chordsFor`.
		const session = offered(
			openCapture("view.headPort", chordRow()),
			DEFAULT_BINDINGS,
			{ kind: "key", key: "∂", code: "KeyD" },
		);
		if (session.stage.kind !== "caught") throw new Error(session.stage.kind);
		expect(session.stage.to).toMatchObject({ key: "d", code: "KeyD" });
		expect(captureModalMarkup(session, controlsCatalogue())).toContain(
			"Alt + d",
		);
	});

	test("a held control moved onto a pad button keeps its hold, and is refused", () => {
		// Which is the right refusal rather than a missing feature: the hold is
		// carried so the registry can say `padFireHeld` is the reader that
		// would have to change, instead of storing a press the command cannot
		// fly. #496 owns that reader.
		const session = offered(
			openCapture("fly.pitchUp", PITCH),
			DEFAULT_BINDINGS,
			{ kind: "pad-button", button: "home", contexts: ["flight"] },
		);
		expect(session.stage.kind).toBe("refused");
		expect(captureModalMarkup(session, controlsCatalogue())).toContain(
			"This control is held down to work",
		);
	});

	test("no refusal ever prints a trigger hash", () => {
		// The shape of the defect, asserted directly: `triggerKey`'s hash has a
		// `::` in it and no sentence a player reads does.
		for (const to of [
			{
				kind: "pad-stick",
				stick: "right",
				axis: "x",
				half: "+",
				contexts: ["capture"],
			},
			{ kind: "pad-trigger", trigger: "r2", contexts: ["capture"] },
			{ kind: "pad-button", button: "home", contexts: ["flight"] },
		] as Trigger[]) {
			const html = captureModalMarkup(
				offered(openCapture("fly.pitchUp", PITCH), DEFAULT_BINDINGS, to),
				controlsCatalogue(),
			);
			expect(html).not.toContain("::");
			expect(html).not.toContain("->");
		}
	});
});
