/**
 * The galaxy finder's DOM — #86's panel, built for `galaxy-map.ts` to mount.
 *
 * Split from the chart for the reason `galaxy-finder.ts` is split from both: a
 * panel of buttons and rows has nothing to do with a Three.js scene, and
 * `mountGalaxyChart` already builds a canvas, a legend, a control row, a record
 * card and the whole scene graph. This module imports no Three.js and holds no
 * camera; what it knows about the chart is four callbacks.
 *
 * It owns **presentation state only** — the filter, the drawn rows, and which
 * of the two layouts is applied. What a filter *means* is `galaxy-finder.ts`'s
 * and is a pure function; where the camera points is the chart's.
 */

import {
	FINDER_MAX_BUDGET,
	type FinderFilter,
	type FinderResults,
	type FinderRow,
	finderIsNarrowed,
	finderSessionFilter,
	projectFinder,
	rememberFinderBudget,
} from "./galaxy-finder";
import { ECONOMY_NAMES, type SystemRecord } from "./galaxy";

/**
 * The panel's width, and the whole of what opening it costs the chart.
 *
 * Wide enough for a name, an economy and a jump count on one line at the
 * console's 11 px monospace; narrow enough that the cell it leaves is still a
 * chart rather than a strip.
 */
const FINDER_WIDTH_PX = 268;

/**
 * How many rows are built into the DOM per group.
 *
 * A one-character query at a wide budget matches most of a 256-system galaxy,
 * and every row is five elements — so an uncapped rebuild made a keystroke
 * create a thousand nodes for a scroll box that shows about fifteen. The cap is
 * on the **drawing**, never on the projection: `results` still carries every
 * matching row, and the panel prints what it left out rather than trimming
 * silently, because a list that stops at 60 and says nothing reads exactly like
 * a galaxy with 60 matches in it.
 */
const FINDER_DRAWN_ROWS = 60;

/**
 * The narrowest chart the panel will leave behind when it opens as a column.
 *
 * Below it the panel **covers** the chart instead. The column layout was
 * written against the console's desktop cell, where 1011 px less the panel is
 * 743 and still a chart; at the 390 px the console's media query drops to it
 * would leave a 122 px strip, which is not a reading surface — it is the chart
 * ruined and the finder cramped. §5.1's whole split is that the chart reads and
 * the list finds, and on a narrow console you do one at a time.
 *
 * Set from the two cells that exist rather than from taste: it has to admit the
 * desktop's 743 and refuse the narrow one's 122.
 */
const FINDER_MIN_CHART_PX = 360;

export interface FinderPanelOptions {
	/** The chart's root. The panel appends itself and is removed with it. */
	root: HTMLElement;
	systems: readonly SystemRecord[];
	/** Where the ship is — read on every render, because a jump moves it. */
	currentSystem: () => SystemRecord;
	/** The chart's selection, which the panel highlights and never owns. */
	selectedIndex: () => number | null;
	/** A row was clicked. D2: this selects, and moves no camera. */
	onSelect: (index: number) => void;
	/** A row's centre control was clicked. D2: this moves the camera, and
	 *  selects nothing — the row click already did. */
	onCentre: (index: number) => void;
	/** The open/closed layout changed, so the chart's canvas box did too. */
	onLayoutChange: () => void;
}

export interface FinderPanelState {
	expanded: boolean;
	filter: FinderFilter;
	inBudget: FinderRow[];
	beyondRange: FinderRow[];
	/** How many rows of each group are actually in the DOM, so a probe can tell
	 *  a cap from a short list. */
	drawn: { inBudget: number; beyondRange: number };
}

export interface FinderPanel {
	element: HTMLElement;
	/** Redraw against the current selection and ship position. */
	render(): void;
	setQuery(query: string): void;
	toggleEconomy(economy: number): void;
	setBudget(jumps: number): void;
	readonly state: FinderPanelState;
}

const el = <K extends keyof HTMLElementTagNameMap>(
	tag: K,
): HTMLElementTagNameMap[K] => document.createElement(tag);

export function mountFinderPanel({
	root,
	systems,
	currentSystem,
	selectedIndex,
	onSelect,
	onCentre,
	onLayoutChange,
}: FinderPanelOptions): FinderPanel {
	let filter: FinderFilter = finderSessionFilter();
	let results: FinderResults = { inBudget: [], beyondRange: [] };
	/** Which of the three layouts is on the element — a cache of what was
	 *  applied, not a second answer to "is it open"; `finderIsNarrowed` remains
	 *  the only one of those. */
	let appliedMode: "closed" | "column" | "cover" | null = null;
	/** The drawn row buttons by system index, so a selection restyles rather
	 *  than rebuilds. Cleared whenever the list is rebuilt. */
	const rowElements = new Map<number, HTMLElement>();
	/** Which index is currently painted as selected, so a repaint touches the
	 *  two rows that changed rather than all of them. */
	let paintedIndex: number | null = null;
	/** What the DOM currently holds, as a short string. */
	let listKey = "";
	/** The filter and origin the held `results` were projected from. `selected`
	 *  is deliberately absent: it changes the highlight, not the rows. */
	let projectionKey = "";
	let drawn = { inBudget: 0, beyondRange: 0 };

	// ---- Furniture ---------------------------------------------------------

	const element = el("aside");
	element.setAttribute("data-map-finder", "");
	Object.assign(element.style, {
		display: "flex",
		flexDirection: "column",
		gap: "8px",
		padding: "10px",
		background: "rgba(6,12,20,0.88)",
		border: "1px solid #1d3247",
		borderRadius: "3px",
		fontSize: "11px",
		zIndex: "3",
	});
	root.appendChild(element);

	const controls = el("div");
	Object.assign(controls.style, {
		display: "flex",
		flexDirection: "column",
		gap: "7px",
	});
	element.appendChild(controls);

	/**
	 * D4: the collapsed form is this field, on the tab, always.
	 *
	 * Not a chevron. #86 took default-closed against a recommendation of a fixed
	 * panel, and the visible field is the half of that bargain that keeps a
	 * load-bearing surface from being one the player never finds.
	 */
	const query = el("input");
	query.type = "search";
	query.placeholder = "FIND SYSTEM";
	query.setAttribute("aria-label", "find a system by name");
	query.setAttribute("data-map-finder-query", "");
	Object.assign(query.style, {
		font: "inherit",
		color: "#cfe6f5",
		background: "rgba(4,8,14,0.9)",
		border: "1px solid #26506e",
		borderRadius: "3px",
		padding: "5px 7px",
		width: "100%",
	});
	controls.appendChild(query);

	const chipRow = el("div");
	Object.assign(chipRow.style, {
		display: "flex",
		flexWrap: "wrap",
		gap: "4px",
	});
	controls.appendChild(chipRow);

	/** The economy chips — the console's own grammar, one chip set and one
	 *  substring query across both of its lists. */
	const chips = ECONOMY_NAMES.map((label, economy) => {
		const chip = el("button");
		chip.type = "button";
		chip.textContent = label.toUpperCase();
		chip.setAttribute("data-map-finder-economy", String(economy));
		Object.assign(chip.style, {
			font: "inherit",
			fontSize: "9px",
			letterSpacing: "0.06em",
			color: "#8fb2c9",
			background: "transparent",
			border: "1px solid #26506e",
			borderRadius: "3px",
			padding: "3px 6px",
			cursor: "pointer",
		});
		chip.addEventListener("click", () => toggleEconomy(economy));
		chipRow.appendChild(chip);
		return chip;
	});

	const budgetRow = el("div");
	Object.assign(budgetRow.style, {
		display: "flex",
		alignItems: "center",
		gap: "6px",
		color: "#8fb2c9",
	});
	controls.appendChild(budgetRow);

	const stepButton = (label: string, attr: string): HTMLButtonElement => {
		const b = el("button");
		b.type = "button";
		b.textContent = label;
		b.setAttribute(attr, "");
		Object.assign(b.style, {
			font: "inherit",
			color: "#cfe6f5",
			background: "rgba(10,20,32,0.9)",
			border: "1px solid #26506e",
			borderRadius: "3px",
			padding: "2px 8px",
			cursor: "pointer",
		});
		budgetRow.appendChild(b);
		return b;
	};
	const budgetLabel = el("span");
	budgetLabel.textContent = "JUMPS";
	budgetRow.appendChild(budgetLabel);
	const budgetDown = stepButton("−", "data-map-finder-budget-down");
	const budgetValue = el("b");
	budgetValue.setAttribute("data-map-finder-budget", "");
	Object.assign(budgetValue.style, { color: "#cfe6f5", minWidth: "12px" });
	budgetRow.appendChild(budgetValue);
	const budgetUp = stepButton("+", "data-map-finder-budget-up");

	const resultsEl = el("div");
	resultsEl.setAttribute("data-map-finder-results", "");
	Object.assign(resultsEl.style, {
		display: "none",
		flex: "1 1 auto",
		minHeight: "0",
		overflow: "auto",
	});
	element.appendChild(resultsEl);

	// ---- Layout ------------------------------------------------------------

	/**
	 * Apply the open/closed layout, and only when it changed.
	 *
	 * Derived from the filter rather than held as its own flag (D4): a second
	 * owner of "is it open" is how a chip click comes to narrow the results
	 * without showing them, which is the shape of the defect `live-cockpit.ts`
	 * records having shipped once already. `appliedMode` is a *cache of what
	 * was applied*, not a second answer — it exists so a keystroke does not
	 * reallocate the chart's drawing buffer. Unconditional, every render made
	 * the next frame read the stage's width and call `renderer.setSize` for a
	 * box that had not moved.
	 */
	const applyLayout = (expanded: boolean): void => {
		// **The mode is part of what was applied, not only the open/closed
		// flag.** A console that resized across the threshold while the panel
		// was open would otherwise keep whichever layout it opened with.
		const mode = !expanded
			? "closed"
			: root.clientWidth - FINDER_WIDTH_PX >= FINDER_MIN_CHART_PX
				? "column"
				: "cover";
		if (mode === appliedMode) return;
		appliedMode = mode;
		element.setAttribute("data-map-finder-expanded", String(expanded));
		element.setAttribute("data-map-finder-layout", mode);
		resultsEl.style.display = expanded ? "block" : "none";
		if (mode === "cover") {
			// Over the chart, not beside it. The canvas box does not change, so
			// §5.1's crowding figure is untouched here — the trade is that the
			// chart is not readable while the finder is open, which on a 390 px
			// console it would not have been either way.
			Object.assign(element.style, {
				position: "absolute",
				right: "12px",
				top: "12px",
				bottom: "12px",
				left: "12px",
				flex: "0 0 auto",
				width: "auto",
				maxHeight: "none",
			});
		} else if (mode === "column") {
			Object.assign(element.style, {
				position: "relative",
				right: "auto",
				top: "auto",
				bottom: "auto",
				left: "auto",
				flex: `0 1 ${FINDER_WIDTH_PX}px`,
				width: "auto",
				maxHeight: "100%",
			});
		} else {
			// Absolute, so a closed finder takes no column and the chart keeps
			// the cell #86's D3 preserved along with its crowding band. The
			// clamp is not a design choice about narrow viewports — at the
			// console's 390 px media query the panel is still its full 268 px
			// and covers most of that chart — it only guarantees the panel never
			// overflows the box it floats over.
			Object.assign(element.style, {
				position: "absolute",
				right: "12px",
				top: "12px",
				bottom: "auto",
				left: "auto",
				flex: "0 0 auto",
				width: `min(${FINDER_WIDTH_PX}px, calc(100% - 24px))`,
				maxHeight: "none",
			});
		}
		onLayoutChange();
	};

	// ---- Rows --------------------------------------------------------------

	/** Paint one row for its selected state — the whole of what a selection
	 *  changes, so a row click does not have to rebuild the list. */
	const paintRow = (button: HTMLElement, on: boolean): void => {
		button.setAttribute("aria-current", String(on));
		button.style.background = on ? "rgba(255,179,71,.22)" : "transparent";
		button.style.color = on ? "#ffd9a2" : "#cfe6f5";
	};

	/**
	 * One row, built as DOM.
	 *
	 * Not an HTML string. The first version concatenated one with a bespoke
	 * `escape` applied per interpolation — three calls, one of them inside an
	 * `aria-label` — and a missed call there is invisible in review and in every
	 * green run. `textContent` cannot be missed.
	 *
	 * The centre control is a **separate button**, because D2 says the row click
	 * already selected.
	 */
	const buildRow = (row: FinderRow, dim: boolean): HTMLLIElement => {
		const item = el("li");
		Object.assign(item.style, {
			display: "flex",
			gap: "4px",
			alignItems: "stretch",
			opacity: dim ? "0.55" : "1",
		});

		const pick = el("button");
		pick.type = "button";
		pick.setAttribute("data-map-finder-row", String(row.index));
		Object.assign(pick.style, {
			flex: "1 1 auto",
			display: "grid",
			gridTemplateColumns: "1fr auto",
			gap: "6px",
			textAlign: "left",
			font: "inherit",
			fontSize: "11px",
			padding: "4px 5px",
			cursor: "pointer",
			border: "0",
			borderBottom: "1px solid rgba(38,80,110,.5)",
		});
		paintRow(pick, row.index === selectedIndex());

		const name = el("span");
		name.textContent = row.name;
		const reach = el("em");
		Object.assign(reach.style, { fontStyle: "normal", color: "#8fb2c9" });
		reach.textContent =
			row.jumps === null
				? "—"
				: row.jumps === 0
					? "here"
					: `${row.jumps}j · ${row.routeLy?.toFixed(1)} LY`;
		const detail = el("span");
		Object.assign(detail.style, {
			gridColumn: "1/3",
			color: "#7fa8c4",
			fontSize: "9px",
			letterSpacing: ".05em",
		});
		detail.textContent = `${row.economy.toUpperCase()} · ${row.government.toUpperCase()} · TL ${row.displayTL}`;
		pick.append(name, reach, detail);

		const centre = el("button");
		centre.type = "button";
		centre.setAttribute("data-map-finder-centre", String(row.index));
		centre.setAttribute("aria-label", `centre the chart on ${row.name}`);
		centre.title = "centre";
		centre.textContent = "⊙";
		Object.assign(centre.style, {
			flex: "0 0 auto",
			font: "inherit",
			fontSize: "11px",
			color: "#8fb2c9",
			background: "transparent",
			border: "0",
			borderBottom: "1px solid rgba(38,80,110,.5)",
			padding: "0 6px",
			cursor: "pointer",
		});

		item.append(pick, centre);
		rowElements.set(row.index, pick);
		return item;
	};

	/** One group, capped, plus the line that says what the cap left out. */
	const buildGroup = (rows: FinderRow[], dim: boolean): HTMLElement[] => {
		const list = el("ul");
		Object.assign(list.style, { listStyle: "none", margin: "0", padding: "0" });
		const shown = rows.slice(0, FINDER_DRAWN_ROWS);
		for (const row of shown) list.append(buildRow(row, dim));
		if (rows.length <= shown.length) return [list];
		const more = el("p");
		more.setAttribute(
			"data-map-finder-more",
			String(rows.length - shown.length),
		);
		Object.assign(more.style, {
			margin: "5px 2px",
			color: "#7fa8c4",
			fontSize: "9px",
			letterSpacing: ".1em",
		});
		more.textContent = `+${rows.length - shown.length} MORE — NARROW THE SEARCH`;
		return [list, more];
	};

	// ---- Render ------------------------------------------------------------

	const render = (): void => {
		budgetValue.textContent = String(filter.budgetJumps);
		budgetDown.disabled = filter.budgetJumps <= 1;
		budgetUp.disabled = filter.budgetJumps >= FINDER_MAX_BUDGET;
		chips.forEach((chip, economy) => {
			const on = filter.economies.includes(economy);
			chip.setAttribute("aria-pressed", String(on));
			chip.style.color = on ? "#ffe1a9" : "#8fb2c9";
			chip.style.borderColor = on ? "#ffb347" : "#26506e";
			chip.style.background = on ? "rgba(255,179,71,.18)" : "transparent";
		});

		const expanded = finderIsNarrowed(filter);
		applyLayout(expanded);
		if (!expanded) {
			// **The projection is skipped while the panel is closed**, so a chart
			// click does not pay a whole-pool relaxation for a list showing
			// nothing.
			results = { inBudget: [], beyondRange: [] };
			resultsEl.replaceChildren();
			rowElements.clear();
			paintedIndex = null;
			listKey = "";
			projectionKey = "";
			drawn = { inBudget: 0, beyondRange: 0 };
			return;
		}

		// **The projection depends on the filter and the ship, not the
		// selection** — and `recompute` runs on every canvas click, so a
		// re-projection there allocates a row per match, takes a square root for
		// each, sorts both groups, and is then thrown away by the key comparison
		// below. Skipped unless one of its two inputs actually moved.
		const here = currentSystem();
		const inputKey = `${here.index}|${filter.budgetJumps}|${filter.query.trim().toLowerCase()}|${[...filter.economies].sort((a, b) => a - b).join(",")}`;
		if (inputKey !== projectionKey) {
			projectionKey = inputKey;
			results = projectFinder(systems, here, filter);
		}
		const { inBudget, beyondRange } = results;
		// **Keyed on what the rows actually print.** Two filters can yield the
		// same rows, and the ship moving under a fixed filter yields different
		// chains under the same indices — so the key carries the identity, the
		// jump count *and the chain length*, plus both group sizes so a change
		// past the cap still rewrites the "+N more" line. The length was missing
		// at first, which would leave a row whose hop count survived a jump
		// printing the chain length of the system the ship had left. **No red
		// build for that one**: it needs a jump that preserves group membership
		// and every jump count while changing a chain length, and none was found
		// at this seed. The fix is by construction — the key carries what the
		// row prints — and saying so is better than implying a run behind it.
		const key = [inBudget, beyondRange]
			.map(
				(rows) =>
					`${rows.length}#${rows
						.slice(0, FINDER_DRAWN_ROWS)
						.map((r) => `${r.index}:${r.jumps}:${r.routeLy?.toFixed(1)}`)
						.join(",")}`,
			)
			.join("|");
		if (key !== listKey) {
			listKey = key;
			rowElements.clear();
			paintedIndex = null;
			const parts: HTMLElement[] = [];
			if (inBudget.length === 0) {
				const empty = el("p");
				Object.assign(empty.style, { margin: "6px 2px", color: "#7fa8c4" });
				empty.textContent = "NOTHING WITHIN BUDGET";
				parts.push(empty);
			} else {
				parts.push(...buildGroup(inBudget, false));
			}
			// D7: the dimmed group is a *group*, headed, so a beyond-range row
			// can never be mistaken for one the budget admitted.
			if (beyondRange.length > 0) {
				const heading = el("h3");
				heading.setAttribute("data-map-finder-beyond", "");
				Object.assign(heading.style, {
					margin: "9px 2px 3px",
					fontSize: "9px",
					letterSpacing: ".12em",
					color: "#7fa8c4",
				});
				heading.textContent = "BEYOND RANGE";
				parts.push(heading, ...buildGroup(beyondRange, true));
			}
			resultsEl.replaceChildren(...parts);
			drawn = {
				inBudget: Math.min(inBudget.length, FINDER_DRAWN_ROWS),
				beyondRange: Math.min(beyondRange.length, FINDER_DRAWN_ROWS),
			};
		}

		// Two rows, not all of them: `recompute` runs on every chart click, and
		// repainting a wide list to move one highlight is hundreds of writes for
		// a change to two of them.
		// **The selection is the chart's, and it is read here rather than
		// carried on the rows.** It used to be a `selected` field the projection
		// filled in and this loop rewrote — two owners of one fact, and the
		// projection's copy went stale the moment a render skipped it.
		const next = selectedIndex();
		if (next !== paintedIndex) {
			const before =
				paintedIndex === null ? null : rowElements.get(paintedIndex);
			if (before) paintRow(before, false);
			const after = next === null ? null : rowElements.get(next);
			if (after) paintRow(after, true);
			paintedIndex = next;
		}
	};

	// ---- Controls ----------------------------------------------------------

	const setFilter = (next: FinderFilter): void => {
		// **A non-finite budget has to be refused here.** `Math.max`/`Math.min`
		// pass `NaN` straight through, and a `NaN` budget makes
		// `finderIsNarrowed` permanently true, disables neither step button
		// while leaving both no-ops, and drops every row out of budget — a panel
		// wedged open with nothing in it and no control that closes it.
		filter = rememberFinderBudget(next);
		if (query.value !== filter.query) query.value = filter.query;
		render();
	};
	const patch = (over: Partial<FinderFilter>): void =>
		setFilter({ ...filter, ...over });

	function toggleEconomy(economy: number): void {
		patch({
			economies: filter.economies.includes(economy)
				? filter.economies.filter((e) => e !== economy)
				: [...filter.economies, economy],
		});
	}

	query.addEventListener("input", () => patch({ query: query.value }));
	// A search field's clear affordance fires `search`, not `input`, in Safari.
	query.addEventListener("search", () => patch({ query: query.value }));
	budgetDown.addEventListener("click", () =>
		patch({ budgetJumps: filter.budgetJumps - 1 }),
	);
	budgetUp.addEventListener("click", () =>
		patch({ budgetJumps: filter.budgetJumps + 1 }),
	);

	/**
	 * One click, dispatched centre-first.
	 *
	 * Order is load-bearing: the centre control sits *inside* the row's list
	 * item, so a row-first branch would swallow it and the control would select
	 * — the exact collapse of two acts into one that D2 and D8 both refuse.
	 * Delegated because the list's markup is replaced whenever its rows change.
	 */
	resultsEl.addEventListener("click", (event) => {
		const target = event.target as HTMLElement;
		const centre = target.closest<HTMLElement>("[data-map-finder-centre]");
		if (centre) {
			onCentre(Number(centre.dataset.mapFinderCentre));
			return;
		}
		const row = target.closest<HTMLElement>("[data-map-finder-row]");
		if (row) onSelect(Number(row.dataset.mapFinderRow));
	});

	return {
		element,
		render,
		setQuery: (value: string) => patch({ query: value }),
		toggleEconomy,
		setBudget: (jumps: number) => patch({ budgetJumps: jumps }),
		get state(): FinderPanelState {
			return {
				expanded: finderIsNarrowed(filter),
				filter,
				inBudget: results.inBudget,
				beyondRange: results.beyondRange,
				drawn,
			};
		},
	};
}
