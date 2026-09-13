/**
 * Whether a key event's target is a text field, which keeps its typing.
 *
 * A leaf, shared by the two plain-DOM screens that listen on `window` in the
 * capture phase: the settings screen and the Commander overlay. Neither may act
 * on a key typed into a field, and the two copies this replaced disagreed about
 * what a field is.
 */
export const isEditable = (target: EventTarget | null): boolean =>
	target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;
