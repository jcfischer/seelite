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
		const { migrateEquipment, equipmentNames } = await import(
			"/src/loadout.ts"
		);

		const g = window.__seelite;
		// Driven by hand from here: the hold is a function of frames flown, and a
		// loop running in the background would make "how long was the nose on it"
		// a race with the browser.
		cancelAnimationFrame(g.animationFrame);
		const verb = await import("/src/carrier-scan.ts");
		const naming = await import("/src/carrier-name.ts");
		const market = await import("/src/market.ts");
		const contacts = await import("/src/display-contact.ts");
		const world = await import("/src/world-state.ts");

		/** **What the instrument painted**, by hooking its own canvas and keeping
		 *  every string with where it was drawn and how wide it was at the font it
		 *  was drawn with.
		 *
		 *  **No slot coordinate is restated here.** The first version matched
		 *  `y === 78` and `y === 128`, which is a copy of a layout figure the
		 *  instrument owns — the exact thing the probe rule exists to prevent, and
		 *  it would have gone falsely red the day the paint moved. Instead the
		 *  probe asks `display-contact.ts` what the designation should say for the
		 *  state the game itself reports, and finds that string among the calls. */
		const painted = (target) => {
			const ctx = g.cockpit.targetInstrument.ctx;
			const fillText = ctx.fillText.bind(ctx);
			const calls = [];
			ctx.fillText = (text, x, y, ...rest) => {
				calls.push({
					text: String(text),
					x,
					y,
					width: ctx.measureText(String(text)).width,
					// Recorded at the call, because the instrument sets its own font per
					// slot: this is the font the designation was painted in, read
					// off the canvas rather than copied into the probe.
					font: ctx.font,
				});
				return fillText(text, x, y, ...rest);
			};
			g.cockpit.instrumentKey = "";
			g.updateInstruments(target, 120, g.velocityReadout());
			ctx.fillText = fillText;
			return calls;
		};
		/** **Fly the frame, then read the glass.** A contact's standing is written
		 *  by the traffic pass that materializes it, so painting without it would
		 *  read the instrument against a stale contact — the same false red as a
		 *  probe measuring its own assignment. */
		const paintNow = (target = g.targetBody()) => {
			place();
			const body = g.targetBody();
			const calls = painted(target ?? body);
			const want = contacts.targetDesignation(
				target ?? body,
				g.scanReadout(target ?? body).designation,
			);
			const line = calls.find((c) => c.text === want);
			const named = calls.find(
				(c) => c !== line && c.text.startsWith(glassName()),
			);
			return {
				designation: line?.text ?? null,
				named: named?.text ?? null,
				font: line?.font ?? null,
				x: line?.x ?? null,
				// The instrument's own right margin is its business; what the probe
				// asks is whether the painted string ran off the canvas at all.
				fits: line === undefined ? false : line.x + line.width <= ctxWidth(),
				paintedTexts: calls.map((c) => c.text),
			};
		};
		const ctxWidth = () => g.cockpit.targetInstrument.ctx.canvas.width - 8;
		/** The name the glass is supposed to carry for the selected carrier: the
		 *  drawn name, from the module that draws it, at the instance live now. */
		const glassName = () =>
			g.scanSubject(g.targetBody()) === undefined
				? (g.targetBody()?.name ?? "")
				: naming.carrierName(
						g.world.system.record.seed,
						key,
						g.carrierCondition(key).instanceOrdinal,
					);

		// Traffic authority on, then the first *flying* carrier by key — first by
		// key, not first found, so two runs cannot pick different subjects and
		// disagree with each other. A parked one has no position to aim at.
		for (
			let attempt = 0;
			attempt < 2_000 && !g.trafficAuthorityReady();
			attempt++
		)
			g.updateTrafficAuthority();
		// Inbound candidate rosters include ships currently outside this system;
		// their routes say so with `present: false`. This local scanner fixture
		// selects a present home carrier that is not mid-jump or abstracted.
		const flying = g.trafficRoutes
			.filter(
				(r) =>
					r.key.startsWith(`${g.world.system.record.index}:`) &&
					r.present !== false &&
					r.phase !== "hyperspace-away" &&
					r.phase !== "abstract-away",
			)
			.sort((a, b) => (a.key < b.key ? -1 : 1));
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
			g.commander.loadout = migrateEquipment(
				g.commander.hull,
				own ? [market.SCAN_MODULE] : [],
			).loadout;
		};

		// 1. Unequipped, on a carrier the verb would otherwise accept.
		fitted(false);
		g.scanHold = verb.beginScanHold();
		const gate = paintNow();

		// 2. Equipped, never scanned.
		fitted(true);
		g.scanHold = verb.beginScanHold();
		const before = paintNow();

		// Arm through the same cycle action as the player, then hold Space.
		const armScanner = () => {
			for (let i = 0; i < g.fireGroups.length; i++) {
				if (g.armedFireGroup.current(g.fireGroups)?.kind === "scanner") return;
				g.cycleFireGroup();
			}
			throw new Error("no scanner group");
		};
		armScanner();
		g.stepScan(verb.SCAN_CHARGE_S);
		const lockOnly = { charge: g.scanHold.chargeS, wrote: !!rowOf()?.scan };
		g.keys.add(" ");

		// 2b. **Why is the scan not holding?** The flight test's whole finding: a
		//    pilot shown `UNKNOWN` cannot tell too-far from off-sight from broken,
		//    and reports broken. And the axis the cone is measured on is the
		//    sightline, not the hull — which the head-look arm can show, because
		//    turning the head moves the sight and leaves the hull pointing where it
		//    was. A cone on the hull would stay satisfied here and read nothing.
		const cell = () => {
			const body = g.targetBody();
			const calls = painted(body);
			const want = contacts.targetDesignation(
				body,
				g.scanReadout(body).designation,
			);
			return calls.find((c) => c.text === want)?.text ?? calls[1]?.text ?? null;
		};
		const cue = { ahead: null, far: null, looked: null, sightMoved: false };
		place();
		cue.ahead = cell();
		// 600 km dead astern of it, still dead on: past the ceiling, inside the
		// cone. `place()` would put the ship back inside, so the offset is explicit.
		const home = g.trafficRouteByKey(actor.key)?.pos;
		Object.assign(g.world.ship.pos, {
			x: home.x,
			y: home.y,
			z: home.z + 600,
		});
		g.setAttitude({ x: 0, y: 0, z: -1 }, g.shipUp());
		g.updateTrafficPresentation(g.world.ship.pos);
		cue.far = cell();
		g.keys.delete(" ");
		cue.farReleased = cell();
		g.keys.add(" ");
		g.cycleFireGroup();
		cue.farLaser = cell();
		armScanner();
		place();
		const sightBefore = g.weaponAim().z;
		g.headLook = "left";
		g.updateTrafficPresentation(g.world.ship.pos);
		cue.looked = cell();
		g.keys.delete(" ");
		cue.lookedReleased = cell();
		g.keys.add(" ");
		g.cycleFireGroup();
		cue.lookedLaser = cell();
		armScanner();
		cue.sightMoved = Math.abs(g.weaponAim().z - sightBefore) > 0.5;
		g.headLook = "forward";
		place();

		// 3. A charge part-way through, read as the glass shows it.
		g.stepScan(verb.SCAN_CHARGE_S * 0.62);
		const charging = paintNow();
		g.keys.delete(" ");
		const releasedCell = cell(); // same clock, same charge: memo must invalidate
		g.stepScan(verb.SCAN_CHARGE_S);
		const released = {
			charge: g.scanHold.chargeS,
			wrote: !!rowOf()?.scan,
			cell: releasedCell,
		};
		g.keys.add(" ");
		g.stepScan(verb.SCAN_CHARGE_S * 0.2);
		const restarted = g.scanHold.chargeS;
		g.cycleFireGroup();
		const cycled = g.scanHold.chargeS;
		g.stepScan(verb.SCAN_CHARGE_S);
		const laserHeld = { charge: g.scanHold.chargeS, wrote: !!rowOf()?.scan };
		armScanner();
		g.stepScan(verb.SCAN_CHARGE_S * 0.2);
		const regimeBefore = g.regime;
		g.regime = "cruise";
		g.stepScan(verb.SCAN_CHARGE_S);
		const cruise = { charge: g.scanHold.chargeS, wrote: !!rowOf()?.scan };
		g.regime = regimeBefore;

		// 4. Flown for real: the nose on it until the charge completes, through
		//    the game's own `stepScan`, with nothing written by hand.
		g.scanHold = verb.beginScanHold();
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

		// 6. **A pirate's line is not this line**, and the row is worth doing on
		//    the carrier this probe already has rather than on a raider it would
		//    have to summon. Summoning one needs the frame loop this probe cancels
		//    (`forceRaider` materializes an encounter in cruise, seconds later),
		//    and `probe-display-contacts.mjs` already puts a hostile contact on the
		//    glass. What is #364's own question is whether the standing the pilot
		//    just earned takes over a pirate's cell — so flip the selected
		//    carrier's `scannerClass` on the live contact and repaint.
		const pirate = g.targetBody();
		const ownClass = pirate.scannerClass;
		pirate.scannerClass = "hostile";
		const pirateCalls = painted(pirate);
		const pirateLine = pirateCalls.find(
			(c) =>
				c.text ===
				contacts.targetDesignation(pirate, g.scanReadout(pirate).designation),
		);
		const hostile = pirateLine?.text ?? null;
		const hostileFits =
			pirateLine === undefined
				? false
				: pirateLine.x + pirateLine.width <= ctxWidth();
		pirate.scannerClass = ownClass;

		// 7. The console's reading block, with both of the name strings.
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
			manifest: read("[data-live-scan-manifest]"),
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
			trigger: { lockOnly, released, restarted, cycled, laserHeld, cruise },
			gate,
			before,
			charging,
			after,
			aged,
			afterRow,
			hostile,
			hostileFits,
			cue,
			stampAfterJump,
			console: console_,
			record,
			gameTime: g.world.gameTime,
			frames,
		};
	});

	if (scan.error) {
		check("a scannable carrier is present to read", false, scan.error);
	} else {
		const quiet = (line) =>
			typeof line === "string" && !/TOO FAR|OFF AXIS|SCANNING/.test(line);
		check(
			"lock alone, laser trigger and cruise never charge or write",
			[
				scan.trigger.lockOnly,
				scan.trigger.laserHeld,
				scan.trigger.cruise,
			].every((r) => r.charge === 0 && !r.wrote),
			JSON.stringify(scan.trigger),
		);
		check(
			"release clears the cue immediately and resets; repress starts fresh; cycle breaks immediately",
			quiet(scan.trigger.released.cell) &&
				scan.trigger.released.charge === 0 &&
				!scan.trigger.released.wrote &&
				Math.abs(scan.trigger.restarted - scan.figures.chargeS * 0.2) < 1e-9 &&
				scan.trigger.cycled === 0,
			JSON.stringify(scan.trigger),
		);
		check(
			"refusal cues stay quiet when released or lasers armed",
			[
				scan.cue.farReleased,
				scan.cue.farLaser,
				scan.cue.lookedReleased,
				scan.cue.lookedLaser,
			].every(quiet),
			JSON.stringify(scan.cue),
		);
		const standing = "(CLEAN|WANTED|FUGITIVE)";
		// Named first because every shape check below reads a string this probe
		// locates rather than restates: if the instrument painted something other
		// than what `display-contact.ts` computes for the game's own state, that
		// is the finding, and it should say so instead of failing five rows.
		check(
			"the instrument paints the designation the module computes",
			[scan.gate, scan.before, scan.charging, scan.after, scan.aged].every(
				(p) => typeof p.designation === "string",
			),
			JSON.stringify({
				after: scan.after?.designation,
				painted: scan.after?.paintedTexts,
			}),
		);
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
			"a pirate reads HOSTILE beside a carrier that reads a standing",
			typeof scan.hostile === "string" &&
				// The whole cell, with no standing and no age: F1 and F10, on the
				// instrument, after a scan has really been written on that ship.
				/^SHIP · \w+ · HOSTILE$/.test(scan.hostile) &&
				scan.hostileFits,
			JSON.stringify({
				hostile: scan.hostile,
				fits: scan.hostileFits,
			}),
		);
		check(
			"an unscanned carrier says why the scan is not holding it",
			// Dead ahead and in range reads plain `UNKNOWN` with no cue: the cue is
			// for a scan that is not happening, and this one is.
			typeof scan.cue.ahead === "string" &&
				!scan.cue.ahead.includes("TOO FAR") &&
				!scan.cue.ahead.includes("OFF AXIS") &&
				typeof scan.cue.far === "string" &&
				scan.cue.far.endsWith(" · TOO FAR") &&
				typeof scan.cue.looked === "string" &&
				scan.cue.looked.endsWith(" · OFF AXIS"),
			JSON.stringify(scan.cue),
		);
		check(
			"the cone follows the sightline the pilot aims with, not the hull",
			scan.cue.sightMoved === true,
			// If turning the head did not move `weaponAim`, this row measured
			// nothing about the axis and must not be read as passing.
			JSON.stringify(scan.cue),
		);
		check(
			"every designation the panel painted fits the instrument",
			[scan.gate, scan.before, scan.charging, scan.after, scan.aged].every(
				(p) => p.fits,
			) && scan.hostileFits,
			JSON.stringify({
				painted: [
					scan.gate,
					scan.before,
					scan.charging,
					scan.after,
					scan.aged,
				].map((p) => ({ designation: p.designation, fits: p.fits })),
				hostileFits: scan.hostileFits,
			}),
		);
		check(
			"the glass carries the drawn name, not the registration number",
			(scan.after.named ?? "").startsWith(scan.drawnName) &&
				!(scan.after.named ?? "").includes(scan.callsign),
			JSON.stringify({
				named: scan.after.named,
				painted: scan.after.paintedTexts,
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
				scan.console.manifest.length > 0 &&
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
