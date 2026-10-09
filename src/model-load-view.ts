/**
 * Where the boot's model download is shown (#833): the full-screen loading
 * panel, or the Commander overlay that opens during the download.
 *
 * The loader (`coriolis-flight.ts`, `loadRequiredModels`) reports a state and
 * waits on a failure's `retry`; it does not know which surface draws it. A
 * player boot starts the download before it knows whether the overlay opens,
 * so the boot hands the loader a relay, which starts on the panel and moves to
 * the overlay once the boot plan says it opens.
 */

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
			status.textContent = `The ${label} could not be loaded. Check your connection and try again.`;
			bar.hidden = true;
			retry = document.createElement("button");
			retry.textContent = "Retry";
			retry.addEventListener("click", () => state.retry(), { once: true });
			panel.append(retry);
			return;
		}
		status.textContent = `Loading ${label}…${loadPercent(state.fraction)}`;
		bar.hidden = false;
		if (state.fraction === null) bar.removeAttribute("value");
		else bar.value = state.fraction;
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
