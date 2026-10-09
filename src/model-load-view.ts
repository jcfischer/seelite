/**
 * The boot's model download and where it is shown (#833): the full-screen
 * loading panel, or the Commander overlay that opens during the download.
 *
 * The loader (`loadRequiredModels`) reports a state and waits on a failure's
 * `retry`; it does not know which surface draws it. A
 * player boot starts the download before it knows whether the overlay opens,
 * so the boot hands the loader a relay, which starts on the panel and moves to
 * the overlay once the boot plan says it opens.
 */

import { type ModelLoader, ModelProgress } from "./model-progress";

/** A download's state as a surface draws it. `fraction` is `null` while the
 *  share cannot be known (`model-progress.ts`). */
export type ModelLoadState =
	| { kind: "loading"; fraction: number | null }
	| { kind: "failed"; retry: () => void }
	/** The models are in and the page builds its world: the bar is full. */
	| { kind: "building" }
	| { kind: "done" };

export type ModelLoadView = (state: ModelLoadState) => void;

/** The share as the loading line prints it. */
const loadPercent = (fraction: number | null): string =>
	fraction === null ? "" : ` ${Math.floor(fraction * 100)}%`;

/** The loading line, for the panel and the overlay alike. */
export const loadingText = (label: string, fraction: number | null): string =>
	`Loading ${label}…${loadPercent(fraction)}`;

/**
 * The line while the world is built after the download (#833). Building the
 * `Game` blocks the page for seconds — 7.7 s on the dev server, measured on
 * 2026-10-09 — and a bar left at its last download frame read 99% for all of
 * it, which the principal flagged.
 */
export const BUILDING_TEXT = "Building the world…";

/**
 * Resolves after the browser has painted what is on the page now: a
 * `setTimeout` from inside a frame callback runs after that frame's paint.
 * A hidden tab runs no frames, and has nothing to paint, so a timer stands in.
 */
export const nextPaint = (): Promise<void> =>
	new Promise((resolve) => {
		requestAnimationFrame(() => setTimeout(resolve, 0));
		setTimeout(resolve, 100);
	});

/** The failure line, for the panel and the overlay alike. */
export const loadFailedText = (label: string): string =>
	`The ${label} could not be loaded. Check your connection and try again.`;

/** A bar with no `value` is drawn indeterminate, which is what `null` means. */
export function paintProgress(
	bar: HTMLProgressElement,
	fraction: number | null,
) {
	if (fraction === null) bar.removeAttribute("value");
	else bar.value = fraction;
}

/**
 * Every model a page needs before it builds its world, downloaded behind a
 * visible Retry. `view` draws the state: the loading panel, or the Commander
 * overlay that opens during the download. A failure waits on the view's Retry
 * and tries again; it never throws, so the boot cannot proceed without the
 * models.
 *
 * **An attempt that failed says nothing more.** `Promise.all` rejects on the
 * first failure while the other models go on downloading, and their progress
 * would draw `loading` over `failed` — removing the Retry the loop is waiting
 * on (sage round 1 on #840). A model still in flight at the retry is the same
 * memoised download, so the new attempt hears it only when it resolves.
 *
 * `then` is the state it ends on: `done`, or `building` for a boot that
 * builds its world next and sends `done` itself once it has (`main.ts`).
 */
export async function loadRequiredModels(
	loads: readonly ModelLoader[],
	view: ModelLoadView,
	{ then = "done" }: { then?: "done" | "building" } = {},
): Promise<void> {
	const ids = loads.map((_, i) => String(i));
	for (;;) {
		const progress = new ModelProgress(ids);
		let live = true;
		const show = () => {
			if (live) view({ kind: "loading", fraction: progress.fraction() });
		};
		show();
		try {
			await Promise.all(
				loads.map((load, i) => {
					const id = ids[i] as string;
					return load((e) => {
						progress.report(id, e.loaded, e.lengthComputable ? e.total : 0);
						show();
					}).then(() => {
						progress.complete(id);
						show();
					});
				}),
			);
			view({ kind: then });
			return;
		} catch (error) {
			live = false;
			console.warn("Model download failed", error);
			await new Promise<void>((retry) => view({ kind: "failed", retry }));
		}
	}
}

/**
 * The full-screen panel every boot showed before #833, with a progress bar in
 * place of its static text: `label` is what is loading, "game" or "station".
 * Built on the first state and removed on `done`.
 */
export function loadingPanel(label: string): ModelLoadView {
	let panel: HTMLElement | null = null;
	let status: HTMLElement | null = null;
	let bar: HTMLProgressElement | null = null;
	let retry: HTMLButtonElement | null = null;
	return (state) => {
		if (state.kind === "done") {
			panel?.remove();
			panel = null;
			return;
		}
		if (!panel) {
			panel = document.createElement("section");
			panel.setAttribute("aria-label", "Loading game");
			panel.dataset.modelLoad = "";
			panel.style.cssText =
				"position:fixed;inset:0;z-index:1000;display:grid;place-content:center;gap:1rem;background:#080c12;color:#dae1e8;font:16px system-ui;text-align:center";
			status = document.createElement("p");
			status.setAttribute("role", "status");
			bar = document.createElement("progress");
			bar.max = 1;
			bar.style.cssText = "width:min(20rem,80vw)";
			panel.append(status, bar);
			document.body.append(panel);
		}
		retry?.remove();
		retry = null;
		panel.dataset.modelLoad = state.kind;
		if (!status || !bar) return;
		if (state.kind === "failed") {
			status.textContent = loadFailedText(label);
			bar.hidden = true;
			retry = document.createElement("button");
			retry.textContent = "Retry";
			retry.addEventListener("click", () => state.retry(), { once: true });
			panel.append(retry);
			return;
		}
		bar.hidden = false;
		if (state.kind === "building") {
			status.textContent = BUILDING_TEXT;
			bar.value = 1;
			return;
		}
		status.textContent = loadingText(label, state.fraction);
		paintProgress(bar, state.fraction);
	};
}

/**
 * A view that forwards to one surface and can move to another, replaying the
 * last state there — a failure keeps its `retry`, so a download that failed
 * on the panel can be retried from the overlay. The surface it leaves gets
 * `done`.
 */
export function loadRelay(first: ModelLoadView) {
	let target = first;
	let last: ModelLoadState | null = null;
	return {
		view: ((state) => {
			last = state;
			target(state);
		}) as ModelLoadView,
		moveTo(next: ModelLoadView) {
			target({ kind: "done" });
			target = next;
			if (last) next(last);
		},
	};
}
