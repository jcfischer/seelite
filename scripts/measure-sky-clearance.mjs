/**
 * How clear of everything the emptiest heading actually is — node #487.
 *
 *   npm run dev                              # in one shell
 *   node scripts/measure-sky-clearance.mjs   # in another
 *
 * ## Why this exists
 *
 * `sky-only` has captioned itself since #104 as *"The backdrop with nothing in
 * front of it."* The first half of that is a fixture property; the second is a
 * claim about the picture. #480 wrote a second sky row and had its caption blocked
 * twice in review for exactly that second kind of claim — once for *"where they
 * are thinnest"*, once for *"with nothing in front of it"* — and the second block
 * named the reason this file exists: `__emptiestDirection` **maximises the minimum
 * angle** over a 512-point sampling of the sphere, which is a ranking over
 * candidates and not a clearance. It returns the emptiest heading *available*, and
 * nobody had ever printed the angle it lands on, or set it against what the
 * cockpit shows. Either the sentence is true and should be held by a number, or the
 * evidence frame for the backdrop and for #200's composed frame has had a planet in
 * it for twenty nodes.
 *
 * ## What it does, and where the arithmetic lives
 *
 * One boot per seed, framed by the shipped `deepSky` placement, and one reading per
 * boot. All of the angle arithmetic — the camera's −Z forward vector, the
 * rectangle's half-diagonal, the subtraction of each subject's apparent radius down
 * to its near limb, and why each of those is the piece it is — is
 * `scripts/lib/sky-clearance.mjs`'s, because a sweep and a gate carrying separate
 * copies of the same angle is how a gate goes false-green while the instrument
 * keeps printing a confident table. This file owns the **sweep** and the **table**;
 * `probe-sky.mjs` owns the one row of it that fails a build.
 *
 * ## Why it sweeps seeds and does not stop at one
 *
 * `SEED` is the sheet's seed and the only world `sky-only` is ever captured at, so
 * a reading there is a reading of one draw — #257's complaint about a check on a
 * solved form that runs at seed zero, pointed at a caption. Each seed below is a
 * different generator, body count and arrangement. The boot system's index is
 * printed beside every row because *which* system the player starts in is itself a
 * draw: if the heading is generous everywhere but one, that row is the finding, and
 * it needs a name rather than a mean.
 *
 * The seeds are small integers rather than random, so a later run can be stood
 * beside this one and a figure quoted from a receipt stays checkable. It is a
 * spread and not a worst case: the probe's gate samples a subset, so a placer
 * regression that survives only on unlisted worlds is caught by this file and not
 * by the row.
 *
 * ## It asserts nothing
 *
 * A diagnosis and not a gate, in the shape of `measure-bay-frame-cost.mjs`: no
 * threshold, no verdict beyond the `out`/`IN FRAME` word beside the number that
 * justifies it, nothing that fails a build. What the reading obliges is decided on
 * #487.
 */
import { gameUrl } from "./lib/game-url.mjs";
import { assertPlayersRenderer } from "./lib/players-renderer.mjs";
import { emptiestClearance } from "./lib/sky-clearance.mjs";
import { SEED } from "./lib/view-set.mjs";
import {
	bootedGame,
	guardedTree,
	installViewPlacement,
	launchChromium,
} from "./probe-guard.mjs";
import { installViewFraming } from "./lib/view-placement.mjs";

const ORIGIN = process.env.PROBE_ORIGIN ?? "http://localhost:5173";

/** The sheet's seed first, then a spread of small integers. */
const SEEDS = [SEED, 0, 1, 2, 3, 4, 5, 6, 7, 11, 23];

const { origin: SERVING } = await guardedTree(ORIGIN);
const browser = await launchChromium({ headless: false });
const page = await browser.newPage();

// Both installers, in the order `capture-views.mjs` runs them:
// `installViewPlacement` is the page-side primitive set the framings are written
// against, and `__returnToBootPosition` reaches for `__placeShipAt` out of it.
await installViewPlacement(page);
await installViewFraming(page);

let renderer = null;
const rows = [];

for (const seed of SEEDS) {
	await page.goto(gameUrl(SERVING, { seed, raider: "off" }), {
		waitUntil: "load",
	});
	await bootedGame(page);
	await page.evaluate(() => window.__rememberBootPosition());
	if (renderer === null)
		renderer = await assertPlayersRenderer(page, "sky-clearance");

	rows.push(await emptiestClearance(page, seed));
}

await browser.close();

console.log(`renderer: ${renderer}`);
console.log(
	"framing: OCCLUSION_FRAMINGS.deepSky, the shipped `sky-only` placement\n",
);
console.log(
	"seed   sys  bodies  fov   aspect   halfDiag   nearest        angle   disc    limb    verdict",
);
for (const r of rows) {
	const n = r.nearest;
	const margin = n.limbDeg - r.halfDiagonalDeg;
	console.log(
		`${String(r.askedSeed).padStart(4)}${r.worldSeed === r.askedSeed ? " " : "!"} ` +
			`${String(r.system).padStart(3)}  ` +
			`${String(r.bodies).padStart(6)}  ` +
			`${r.fovDeg.toFixed(0).padStart(4)}  ` +
			`${r.aspect.toFixed(2).padStart(6)}  ` +
			`${r.halfDiagonalDeg.toFixed(2).padStart(8)}°  ` +
			`${n.name.padEnd(14)} ` +
			`${n.angleDeg.toFixed(2).padStart(7)}°  ` +
			`${n.apparentDeg.toFixed(2).padStart(6)}°  ` +
			`${n.limbDeg.toFixed(2).padStart(7)}°  ` +
			`${margin >= 0 ? "out by" : "IN by "} ${Math.abs(margin).toFixed(2)}°` +
			(r.inFrame === 0 ? "" : `   [${r.inFrame} subject(s) in frame]`),
	);
}
console.log(
	"\n`limb` is the angle from the camera's axis to the near edge of that subject's disc, against `halfDiag`, the widest angle the frame's rectangle contains. `limb > halfDiag` is out of the picture. A `!` beside a seed means the page booted a world other than the one asked for.",
);
