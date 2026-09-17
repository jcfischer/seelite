/**
 * Node #364's browser tier: the Target panel before a scan, during one, and
 * after one (`carrier-identity.md` §6, §9's last three rows).
 *
 * `tests/carrier-scan.test.ts` owns the verb and `tests/target-designation.test.ts`
 * owns the cell's wording. What only the page can answer is the wiring §9 asks
 * for: that the cockpit instrument really paints `UNKNOWN` for a carrier nobody
 * has scanned, the charge while it runs, and the standing with its age once the
 * row exists — that the row a scan writes is the row the glass reads — and that
 * every one of those strings fits the instrument it is painted on.
 *
 * **The strings are read off `fillText`, not off a field.** An instrument keeps
 * a key so it can skip repainting; a field holding "what we meant to draw" is a
 * claim, and this probe is about whether the pilot was shown it. Same reason the
 * age is read twice with the world clock moved between: the row's stamp must be
 * what ages, not the number the panel last happened to compute.
 *
 * **What this cannot check** is that the hold *feels* like a cost, or that the
 * panel is worth reading at a glance in a cockpit. §9 gives both to the
 * principal, and `scripts/measure-carrier-scan.ts` prints the figures they tune.
 */
import {
	bootedGame,
	guardedOrigin,
	launchChromium,
	tally,
} from "./probe-guard.mjs";
import { gameUrl } from "./lib/game-url.mjs";

const ORIGIN =
	process.env.PROBE_ORIGIN ?? process.argv[2] ?? "http://localhost:5173";
await guardedOrigin(ORIGIN);
const browser = await launchChromium();
const { check, watch, exit } = tally();

try {
	const page = await browser.newPage({
		viewport: { width: 1440, height: 900 },
	});
	watch(page);
	await page.goto(gameUrl(ORIGIN, { seed: 54 }), { waitUntil: "load" });
	await bootedGame(page);

	const scan = await page.evaluate(async () => {
		const g = window.__seelite;
		// Driven by hand from here: the hold is a function of frames flown, and a
		// loop running in the background would make "how long was the nose on it"
		// a race with the browser.
		cancelAnimationFrame(g.animationFrame);
		const verb = await import("/src/carrier-scan.ts");
		const naming = await import("/src/carrier-name.ts");
		const market = await import("/src/market.ts");
		const hull = await import("/src/hull.ts");
		const world = await import("/src/world-state.ts");

		/** The designation and the name slot **as painted**, by hooking the
		 *  instrument's own canvas. `y === 78` is the designation slot and
		 *  `y === 128` the primary one, both fixed in `updateInstruments`. */
		const paint = (target) => {
			const instrument = g.cockpit.targetInstrument;
			const ctx = instrument.ctx;
			const fillText = ctx.fillText.bind(ctx);
			let designation = null;
			let primary = null;
			let fits = false;
			ctx.fillText = (text, x, y, ...rest) => {
				if (y === 78) {
					designation = String(text);
					fits =
						x + ctx.measureText(String(text)).width <= ctx.canvas.width - 28;
				}
				if (y === 128) primary = String(text);
				return fillText(text, x, y, ...rest);
			};
			g.cockpit.instrumentKey = "";
			g.updateInstruments(target, 120, g.velocityReadout());
			ctx.fillText = fillText;
			return { designation, primary, fits };
		};
		/** **Fly the frame, then read the glass.** A contact's standing is written
		 *  by the traffic pass that materializes it, so painting without it would
		 *  read the instrument against a stale contact — the same false red as a
		 *  probe measuring its own assignment. */
		const paintNow = () => {
			place();
			return paint(g.targetBody());
		};

		// Traffic authority on, then the first *flying* carrier by key — first by
		// key, not first found, so two runs cannot pick different subjects and
		// disagree with each other. A parked one has no position to aim at.
		for (
			let attempt = 0;
			attempt < 2_000 && !g.trafficAuthorityReady();
			attempt++
		)
			g.updateTrafficAuthority();
		const flying = [...g.trafficRoutes].sort((a, b) =>
			a.key < b.key ? -1 : 1,
		);
		const route = flying[0];
		const actor = g.trafficActors.find(
			(candidate) => candidate.key === route?.key,
		);
		if (!route?.pos || !actor)
			return { error: "no flying carrier in this system" };
		const key = actor.key;
		// **Sit 100 km dead astern of the carrier and look down its line**: inside
		// the cone at any figure it is tuned to, inside the range ceiling at any
		// figure above 100 km. Contacts are materialized by
		// `updateTrafficPresentation`, not by the authority's pass, and a contact
		// that is not materialized is not selectable.
		const place = () => {
			const at = g.trafficRouteByKey(actor.key)?.pos ?? null;
			if (!at) return null;
			Object.assign(g.world.ship.pos, { x: at.x, y: at.y, z: at.z + 100 });
			g.setAttitude({ x: 0, y: 0, z: -1 }, g.shipUp());
			g.updateTrafficPresentation(g.world.ship.pos);
			g.targetId = actor.key;
			return g.targetBody();
		};
		const target = place();
		if (!target) return { error: "the chosen carrier could not be selected" };

		const galaxy = g.world.system.record.galaxy;
		const rowOf = () =>
			world.readKnowledge(g.commerceWorld.galaxies[galaxy], key);
		const fitted = (own) => {
			g.commander.ownedEquipment = own ? [market.SCAN_MODULE] : [];
		};

		// 1. Unequipped, on a carrier the verb would otherwise accept.
		fitted(false);
		g.scanHold = { chargeS: 0 };
		const gate = paintNow();

		// 2. Equipped, never scanned.
		fitted(true);
		g.scanHold = { chargeS: 0 };
		const before = paintNow();

		// 3. A charge part-way through, read as the glass shows it.
		g.scanHold = { chargeS: verb.SCAN_CHARGE_S * 0.62 };
		const charging = paintNow();

		// 4. Flown for real: the nose on it until the charge completes, through
		//    the game's own `stepScan`, with nothing written by hand.
		g.scanHold = { chargeS: 0 };
		let frames = 0;
		while (!rowOf()?.scan && frames < 4_000) {
			place();
			g.stepScan(g.units.MAX_DT);
			frames++;
		}
		const afterRow = rowOf()?.scan ?? null;
		const after = paintNow();

		// 5. The world moves on. The row's stamp must not move with it, and the
		//    age on the glass must.
		g.world.gameTime += 40 * 60;
		const aged = paintNow();
		const stampAfterJump = rowOf()?.scan?.observedAt ?? null;

		// 6. A pirate's line is not this line.
		const raider = g.scannerContacts.find(
			(c) => c.kind === "ship" && c.scannerClass === "hostile",
		);
		let hostile = null;
		if (raider) {
			g.targetId = raider.id;
			hostile = paint(g.targetBody()).designation;
		}
		g.targetId = key;

		// 7. The widest reading the cell can be asked to print, measured at the
		//    font it is painted with. Built from the roster and the three words,
		//    not from a string the probe invented.
		const instrument = g.cockpit.targetInstrument;
		const ctx = instrument.ctx;
		const hullWidths = Object.keys(hull.HULL_SPECS).map(
			(id) => ctx.measureText(`SHIP · ${id.toUpperCase()} · `).width,
		);
		const widest = Math.max(...hullWidths);
		const tail = ctx.measureText("FUGITIVE · 365d").width;
		const widestFits = 28 + widest + tail <= ctx.canvas.width - 28;

		// 8. The console's reading block, with both of the name strings.
		g.headLook = "right";
		g.view = "cockpit";
		g.updateCockpit();
		const block = document.querySelector("[data-live-scan]");
		const read = (selector) =>
			document.querySelector(selector)?.textContent?.trim() ?? "";
		const console_ = {
			displayed: block ? block.style.display !== "none" : false,
			name: read("[data-live-scan-name]"),
			registry: read("[data-live-scan-registry]"),
			standing: read("[data-live-scan-standing]"),
			hold: read("[data-live-scan-hold]"),
			age: read("[data-live-scan-age]"),
		};
		const row = rowOf();
		const record = row
			? {
					source: row.source,
					observedAt: row.scan?.observedAt ?? null,
					hasCondition: row.observedCondition !== undefined,
				}
			: null;

		return {
			key,
			hullId: actor.hullId,
			callsign: actor.callsign,
			drawnName: naming.carrierName(
				g.world.system.record.seed,
				key,
				g.carrierCondition(key).instanceOrdinal,
			),
			figures: verb.CARRIER_SCAN_FIGURES,
			gate,
			before,
			charging,
			after,
			aged,
			afterRow,
			hostile,
			stampAfterJump,
			widestFits,
			console: console_,
			record,
			gameTime: g.world.gameTime,
			frames,
		};
	});

	if (scan.error) {
		check("a scannable carrier is present to read", false, scan.error);
	} else {
		const standing = "(CLEAN|WANTED|FUGITIVE)";
		check(
			"an unequipped pilot is refused, in a word that names an absence",
			scan.gate.designation?.endsWith("· NO SCANNER") === true,
			JSON.stringify(scan.gate),
		);
		check(
			"an unscanned carrier reads UNKNOWN on the Target panel",
			scan.before.designation ===
				`SHIP · ${scan.hullId.toUpperCase()} · UNKNOWN`,
			JSON.stringify(scan.before),
		);
		check(
			"a charge in progress prints its own percentage",
			scan.charging.designation ===
				`SHIP · ${scan.hullId.toUpperCase()} · SCANNING 62%`,
			JSON.stringify(scan.charging),
		);
		check(
			"a completed scan replaces UNKNOWN with the standing and its age",
			new RegExp(
				`^SHIP · ${scan.hullId.toUpperCase()} · ${standing} · \\d+s$`,
			).test(scan.after.designation ?? ""),
			JSON.stringify(scan.after),
		);
		check(
			"the record the glass reads is the record the verb wrote, and only that",
			scan.record?.source === "scan" &&
				scan.record?.hasCondition === false &&
				scan.afterRow?.observedAt === scan.record?.observedAt,
			JSON.stringify({ record: scan.record, row: scan.afterRow }),
		);
		check(
			"the reading ages while the world moves, and its stamp does not",
			new RegExp(` ${standing} · \\d+m$`).test(scan.aged.designation ?? "") &&
				scan.stampAfterJump === scan.afterRow?.observedAt,
			JSON.stringify({
				after: scan.after,
				aged: scan.aged,
				stamp: scan.stampAfterJump,
				written: scan.afterRow,
			}),
		);
		check(
			"a pirate still reads HOSTILE, whichever way standing turns out",
			scan.hostile === null || /· HOSTILE$/.test(scan.hostile),
			JSON.stringify(scan.hostile),
		);
		check(
			"every designation the panel painted fits the instrument",
			[scan.gate, scan.before, scan.charging, scan.after, scan.aged].every(
				(p) => p.fits,
			) && scan.widestFits,
			JSON.stringify({ widestFits: scan.widestFits }),
		);
		check(
			"the glass carries the drawn name, not the registration number",
			(scan.after.primary ?? "").startsWith(scan.drawnName) &&
				!(scan.after.primary ?? "").includes(scan.callsign),
			JSON.stringify({
				primary: scan.after.primary,
				drawnName: scan.drawnName,
				registry: scan.callsign,
			}),
		);
		check(
			"the Flight console carries the whole reading, both name strings and the hold",
			scan.console.displayed &&
				scan.console.name === scan.drawnName &&
				scan.console.registry === scan.callsign &&
				new RegExp(`^${standing}$`).test(scan.console.standing) &&
				scan.console.hold.length > 0 &&
				/^\d+[smhd]$/.test(scan.console.age),
			JSON.stringify({ console: scan.console, drawn: scan.drawnName }),
		);
		check(
			"the scan's figures are the module's, read off the page",
			scan.figures.chargeS > 0 &&
				scan.figures.coneDeg > 0 &&
				scan.figures.rangeKm < 10_000,
			JSON.stringify(scan.figures),
		);
	}
} finally {
	await browser.close();
}
await exit();
