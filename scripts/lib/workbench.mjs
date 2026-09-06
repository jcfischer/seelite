/**
 * The workbench's stage, filled for a capture or a measurement.
 *
 * Three scripts hid the side panel, widened the grid and pinned the stage by
 * hand — `shot-ships.mjs`, `shot-finishes.mjs`, `measure-fixture-cost.mjs` —
 * and the three copies had started to differ (one pinned the stage square,
 * one to the viewport). One home, for `lib/players-renderer.mjs`'s reason.
 *
 * With the panel gone the stage stretches to the page, and a tall stage
 * silently reframes every shot. It is pinned square by default, or to the
 * viewport for a cost figure at the player's size; then the renderer is told,
 * because it only refits on a window resize and hiding a panel is not one.
 */
export async function fillStage(
	page,
	{ height = "square", keepMeter = false } = {},
) {
	await page.evaluate(
		({ mode, keepMeter }) => {
			document.querySelector(".mv-panel")?.setAttribute("hidden", "");
			const wrap = document.querySelector(".mv-wrap");
			if (wrap instanceof HTMLElement) wrap.style.gridTemplateColumns = "1fr";
			const stage = document.querySelector(".mv-stage");
			if (stage instanceof HTMLElement) {
				stage.style.minHeight = "0";
				stage.style.height =
					mode === "viewport"
						? `${window.innerHeight - 40}px`
						: `${stage.clientWidth}px`;
			}
			// The fps meter is a readout for a person and a smear on a sheet; a
			// cost script is the one caller that wants it kept.
			if (!keepMeter) document.querySelector("[data-fps-meter]")?.remove();
			window.dispatchEvent(new Event("resize"));
		},
		{ mode: height, keepMeter },
	);
}
