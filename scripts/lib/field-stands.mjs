/** https://github.com/jcfischer/seelite/issues/1209 — what the instruments and canonical views call the densest rock and a clear stand beside it. Page and node alike. */
const within = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

/** The rock with most anchors within 8 km, the lower slot on a tie. */
export function densestRock(rocks) {
	return rocks
		.map((rock) => ({
			rock,
			n: rocks.filter((o) => within(rock.anchor, o.anchor) < 8).length,
		}))
		.sort((a, b) => b.n - a.n || a.rock.slot - b.rock.slot)[0];
}

/** The nearest stand down the field's -x from `target` that `isClear` accepts. */
export const clearStandBeside = (target, isClear) =>
	[2.5, 4, 6, 8].map((d) => ({ ...target, x: target.x - d })).find(isClear);
