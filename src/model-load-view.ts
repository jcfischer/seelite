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

import { ModelProgress } from "./model-progress";

/** `GLTFLoader`'s `onProgress`: bytes received of a model, and its total (0
 *  when the response has no length). */
export type ModelProgressListener = (event: ProgressEvent) => void;

/** One required model's download, memoised by its module
 *  (`prepareCoriolisModel`, `prepareCockpitModel`). */
export type ModelLoader = (onProgress?: ModelProgressListener) => Promise<void>;

/** A download's state as a surface draws it. `fraction` is `null` while the
 *  share cannot be known (`model-progress.ts`). */
export type ModelLoadState =
	| { kind: "loading"; fraction: number | null }
	| { kind: "failed"; retry: () => void }
	| { kind: "done" };

export type ModelLoadView = (state: ModelLoadState) => void;

/** The share as the loading line prints it. */
export const loadPercent = (fraction: number | null): string =>
	fraction === null ? "" : ` ${Math.floor(fraction * 100)}%`;

/** The loading line, for the panel and the overlay alike. */
export const loadingText = (label: string, fraction: number | null): string =>
	`Loading ${label}…${loadPercent(fraction)}`;

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
 */
export async function loadRequiredModels(
	loads: readonly ModelLoader[],
	view: ModelLoadView,
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
			view({ kind: "done" });
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
		status.textContent = loadingText(label, state.fraction);
		bar.hidden = false;
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
