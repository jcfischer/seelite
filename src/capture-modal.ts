/**
 * The rebind modal: listen, show what was caught, commit or back out (#369 D9).
 *
 * **Its state is here and its shell is at the bottom**, because the part that
 * decides what will be committed is the part a frame cannot show you. A modal
 * that reports success and moves nothing is the defect `rebind`'s own doc is
 * written against, and looking at it would not catch that.
 *
 * ## The three stages, and why a refusal has no layout
 *
 * `listening` → `caught` or `refused`, and either of those back to the other
 * as the player presses again. A `caught` stage carries the **candidate
 * layout** and the warnings `proposedRebind` produced together, so there is
 * nothing to commit that has not been diagnosed — D5's warn-at-bind-time is a
 * return shape rather than a convention anyone has to remember. A `refused`
 * stage has no `layout` field at all, so a caller cannot commit one by
 * reaching for it: the trigger has no reader off a layout, and #496 is the
 * node that decides what would have to change.
 *
 * ## The way out is a click, and that is the bootstrap
 *
 * `capture` swallows all seventeen pad buttons, so the **pad** holds no exit
 * at all. The cancel is a control on the screen, by the principal's ruling —
 * and #370's standing premise that a screen is always clickable is what makes
 * that a guarantee rather than a hope. It is the same argument that gives the
 * `Controls` tab its settings door: a way in that no binding table can hold.
 *
 * **The keyboard does keep one, and it is `Escape`.** This paragraph claimed
 * neither device held an exit for two rounds (sage rounds 1 and 3 on #497;
 * the round-1 fix was lost to a `git checkout` during a red build and went
 * back in unnoticed). Every other key reaches this as a candidate and
 * `Escape` closes instead, so it is the one key a capture cannot record —
 * the same cost the pad refused to pay for Circle, paid here and now said.
 * It is a courtesy exit rather than the guarantee: `Escape` is what every
 * dialog in this game closes on, a player who wanted a control there has
 * chosen that key, and the *click* is what the bootstrap actually rests on.
 *
 * ## One owner for what it prints
 *
 * `triggerLabel` and `noticeText` are `controls-reference.ts`'s, which #369
 * D11 makes the one owner of every printed control name. A modal with its own
 * phrasing for a collision would be the second copy that ruling exists to
 * refuse — and it would drift from the band on the tab behind it, which is the
 * same sentence about the same table.
 */
import type { CommandId, Layout, RebindRefusal, Trigger } from "./commands";
import type { ControlsCatalogue } from "./controls-catalogue";
import { heldRather } from "./commands";
import {
	CAPTURE_REFUSED_WHY,
	noticeText,
	triggerLabel,
} from "./controls-reference";
import { escapeHtml } from "./escape-html";
import { type LayoutNotice, proposedRebind } from "./layout-notice";

export const CAPTURE_STYLE_ID = "seelite-capture-style";

export type CaptureStage =
	/** Nothing pressed yet. */
	| { readonly kind: "listening" }
	/** Something the registry will store, with what it would cost. */
	| {
			readonly kind: "caught";
			readonly to: Trigger;
			readonly layout: Layout;
			readonly warnings: readonly LayoutNotice[];
	  }
	/** Something it will not, and the reader that would have to change. */
	| {
			readonly kind: "refused";
			readonly to: Trigger;
			/** What a screen keys its sentence on. */
			readonly refusal: RebindRefusal;
			/** The developer's sentence, for a console and a probe. */
			readonly why: string;
	  };

export interface CaptureSession {
	readonly command: CommandId;
	/** The trigger being moved — a command may have several. */
	readonly from: Trigger;
	readonly stage: CaptureStage;
}

export const openCapture = (
	command: CommandId,
	from: Trigger,
): CaptureSession => ({ command, from, stage: { kind: "listening" } });

/**
 * What the pad or the keyboard just offered, folded into the session.
 *
 * **It replaces rather than latches.** The modal goes on listening until it is
 * dismissed, so the last thing pressed is what would be committed — a version
 * that kept the first press would make a mistyped capture unrecoverable
 * without backing out and starting again. That includes the dangerous
 * ordering: a legal catch followed by a stick leaves `refused`, and there is
 * no earlier candidate left behind to commit.
 */
export function offered(
	session: CaptureSession,
	bindings: Layout,
	raw: Trigger,
): CaptureSession {
	const to = qualifiedLike(session.from, raw);
	const out = proposedRebind(bindings, session.command, session.from, to);
	return {
		...session,
		stage:
			"refused" in out
				? { kind: "refused", to, refusal: out.refused, why: out.detail }
				: {
						kind: "caught",
						// **The row as it will be stored, not as it was offered**
						// (sage round 2 on #497). `movedTrigger` completes a
						// captured trigger — it derives a missing code, and on an
						// Alt chord it takes the character the *position* types
						// rather than the one Option sent. Showing what was
						// offered meant a captured `Alt+D` on macOS read
						// `Alt + ∂` on screen and was bound as `Alt + d`.
						//
						// Handed back by `proposedRebind` rather than inferred
						// from the candidate's slot identity, which was round 2's
						// fix and rested on an implementation detail of `rebind`
						// (round 3).
						to: out.stored,
						layout: out.layout,
						warnings: out.warnings,
					},
	};
}

/**
 * The captured input, wearing the qualifiers the command owns.
 *
 * **The capture says which key; the command says the rest** — #369 D4's "the
 * player edits the trigger; the context set is the command's", applied to the
 * half of a trigger that is not the key. `movedTrigger` *enforces* that rule
 * and this is the side that supplies it, so the two are not a duplicate: one
 * refuses a mismatch and the other makes one impossible to produce.
 *
 * **Without it the modal was unusable for every held control**, which is most
 * of the flight set. `fly.pitchUp` is `s` *held*; a player pressing `k` sent a
 * press, `movedTrigger` refused the qualifier change, and the screen printed
 * the thrown message. Now `k` arrives held, exactly as `s` was.
 *
 * `alt` and `surface` travel the same way, and the consequence is worth
 * naming: a chord row captures `q` as `Alt + Q`, and an ordinary row captures
 * `Alt + Q` as `q`. The label the modal prints is the completed trigger, so
 * what will be bound is what the player is looking at.
 *
 * Nothing is carried across a device: a pad button has no `alt` and no
 * `surface`, and a held key moved onto a button keeps its `hold` so the
 * registry can refuse it for the reader that is missing rather than store a
 * press the command cannot fly.
 */
function qualifiedLike(from: Trigger, to: Trigger): Trigger {
	const hold = heldRather(from);
	if (to.kind === "key") {
		const alt = from.kind === "key" ? from.alt : undefined;
		const surface = from.kind === "key" ? from.surface : undefined;
		return {
			kind: "key",
			key: to.key,
			...(to.code === undefined ? {} : { code: to.code }),
			...(alt === undefined ? {} : { alt }),
			...(hold === undefined ? {} : { hold }),
			...(surface === undefined ? {} : { surface }),
		};
	}
	if (to.kind === "pad-button")
		return {
			kind: "pad-button",
			button: to.button,
			...(hold === undefined ? {} : { hold }),
			contexts: to.contexts,
		};
	return to;
}

/** The candidate a session would commit, or `null` while it has none. */
export const committable = (session: CaptureSession): Layout | null =>
	session.stage.kind === "caught" ? session.stage.layout : null;

// ---------------------------------------------------------------------------
// Printing
// ---------------------------------------------------------------------------

const commandName = (catalogue: ControlsCatalogue, id: CommandId): string =>
	catalogue.commands.find((c) => c.id === id)?.name ?? (id as string);

/**
 * The modal's body.
 *
 * **A confirm control exists only when there is something to confirm.** A
 * disabled one is a button a player tries, waits on and learns nothing from;
 * its absence is the same information with no dead end in it.
 */
export function captureModalMarkup(
	session: CaptureSession,
	catalogue: ControlsCatalogue,
): string {
	const name = escapeHtml(commandName(catalogue, session.command));
	const was = escapeHtml(triggerLabel(session.from));
	const body = stageMarkup(session.stage);
	const confirm =
		session.stage.kind === "caught"
			? `<button class="capture-confirm" type="button" data-capture-confirm>Bind it</button>`
			: "";
	return `<div class="capture-box" role="dialog" aria-label="Rebind a control">
  <h2>${name}</h2>
  <p class="capture-was">Now on <kbd>${was}</kbd></p>
  ${body}
  <div class="capture-actions">${confirm}<button class="capture-cancel" type="button" data-capture-cancel>Cancel</button></div>
</div>`;
}

function stageMarkup(stage: CaptureStage): string {
	switch (stage.kind) {
		case "listening":
			return `<p class="capture-ask">Press a key, or a button, stick or trigger on the pad.</p>`;
		case "caught": {
			const caught = escapeHtml(triggerLabel(stage.to));
			const warnings = stage.warnings
				.map((n) => `<p class="capture-warn">${escapeHtml(noticeText(n))}</p>`)
				.join("");
			return `<p class="capture-caught"><kbd>${caught}</kbd></p>${warnings}`;
		}
		case "refused": {
			const caught = escapeHtml(triggerLabel(stage.to));
			// **The player's sentence, never the thrown one.** The first pass
			// put `movedTrigger`'s message on the screen and it read
			// `a rebind may move a trigger, not its qualifiers: key:s::hold ->
			// key:k::press` — which is the defect the storage slice shipped,
			// caught the same way, on a different screen. `stage.why` is still
			// carried, for a console and for a probe.
			// **Keyed on the refusal, not on the kind** (sage round 1 on #497):
			// two refusals land on `pad-button` and a `key` is refused when the
			// trigger being *moved* is not offered, so a kind-keyed table
			// printed the hold sentence for both buttons and nothing at all for
			// the key.
			const why = escapeHtml(CAPTURE_REFUSED_WHY[stage.refusal]);
			return `<p class="capture-caught"><kbd>${caught}</kbd></p><p class="capture-refused">${why}</p>`;
		}
	}
}

// ---------------------------------------------------------------------------
// The shell
// ---------------------------------------------------------------------------

/**
 * Deliberately plain DOM, and `settings-panel.ts`'s reasons verbatim: this is
 * not part of the fiction, so drawing it into the cockpit would make it one.
 *
 * The amber is `hud-and-scanner.md` §4's — the same colour the `Controls`
 * tab's notice band uses, because a collision warned about here and a
 * collision printed there are the same fact about the same table. Red is that
 * spec's *refusal* and is kept for the stage that is one.
 *
 * No backticks in this comment, deliberately - the block is a template
 * literal and one ends it twenty lines early.
 */
const STYLE = `
#seelite-capture {
  position: fixed; inset: 0; z-index: 70; display: flex;
  align-items: safe center; justify-content: center;
  overflow-y: auto; overscroll-behavior: contain; padding: 16px 0;
  background: rgba(2, 6, 12, 0.78);
  font: 13px/1.6 ui-monospace, SFMono-Regular, Menlo, monospace;
  color: #cfe3ff;
}
#seelite-capture .capture-box {
  min-width: 380px; max-width: 520px; padding: 20px 24px;
  background: rgba(6, 12, 22, 0.97);
  border: 1px solid rgba(120, 160, 220, 0.4); border-radius: 6px;
}
#seelite-capture h2 {
  margin: 0 0 6px; font-size: 13px; letter-spacing: .18em;
  text-transform: uppercase; color: #ffd479; font-weight: 600;
}
#seelite-capture .capture-was { margin: 0 0 16px; color: #7f97b8; }
#seelite-capture kbd {
  display: inline-block; padding: 1px 7px; border-radius: 3px;
  border: 1px solid rgba(120, 160, 220, 0.45);
  background: rgba(120, 160, 220, 0.12); color: #cfe3ff;
  font: inherit;
}
#seelite-capture .capture-ask { margin: 0 0 16px; }
#seelite-capture .capture-caught {
  margin: 0 0 12px; font-size: 20px; line-height: 1.4;
}
#seelite-capture .capture-caught kbd { font-size: 20px; padding: 2px 12px; }
#seelite-capture .capture-warn {
  margin: 0 0 12px; padding-left: 10px; color: #ffd479;
  border-left: 2px solid rgba(255, 212, 121, .55);
}
#seelite-capture .capture-refused {
  margin: 0 0 12px; padding-left: 10px; color: #ff9a8c;
  border-left: 2px solid rgba(255, 154, 140, .55);
}
#seelite-capture .capture-actions {
  display: flex; gap: 10px; margin-top: 18px;
}
#seelite-capture button {
  padding: 6px 14px; border-radius: 4px; font: inherit; cursor: pointer;
  border: 1px solid rgba(120, 160, 220, 0.45);
  background: rgba(120, 160, 220, 0.12); color: #cfe3ff;
}
#seelite-capture .capture-confirm {
  border-color: rgba(255, 212, 121, .55); color: #ffd479;
  background: rgba(255, 212, 121, .1);
}
`;

export interface CaptureModalHandle {
	readonly isOpen: () => boolean;
	/** Start a session on one of a command's triggers. */
	readonly open: (command: CommandId, from: Trigger) => void;
	readonly close: () => void;
	/**
	 * Fold an input into the session and redraw. A no-op while closed, which
	 * is what lets `main.ts` feed it every frame without asking first.
	 */
	readonly offer: (to: Trigger) => void;
}

/**
 * Mount the modal.
 *
 * `bindings` is a function rather than a value: the layout in force changes
 * under this screen — a bind commits one — and a captured value would diagnose
 * the table as it stood when the modal opened.
 */
export function mountCaptureModal(
	bindings: () => Layout,
	catalogue: () => ControlsCatalogue,
	commit: (layout: Layout) => void,
): CaptureModalHandle {
	if (!document.getElementById(CAPTURE_STYLE_ID)) {
		const style = document.createElement("style");
		style.id = CAPTURE_STYLE_ID;
		style.textContent = STYLE;
		document.head.append(style);
	}

	let root: HTMLElement | null = null;
	let session: CaptureSession | null = null;

	const close = () => {
		root?.remove();
		root = null;
		session = null;
	};

	const draw = () => {
		if (!root || !session) return;
		root.innerHTML = captureModalMarkup(session, catalogue());
		root
			.querySelector("[data-capture-cancel]")
			?.addEventListener("click", close);
		root
			.querySelector("[data-capture-confirm]")
			?.addEventListener("click", () => {
				const layout = session && committable(session);
				// Closed first, so a commit that rebuilds the surfaces behind this
				// one does not redraw a modal that is on its way out.
				close();
				if (layout) commit(layout);
			});
	};

	return {
		isOpen: () => root !== null,
		open: (command, from) => {
			session = openCapture(command, from);
			if (!root) {
				root = document.createElement("section");
				root.id = "seelite-capture";
				root.dataset.captureModal = "";
				document.body.append(root);
			}
			draw();
		},
		close,
		offer: (to) => {
			if (!session || !root) return;
			session = offered(session, bindings(), to);
			draw();
		},
	};
}
