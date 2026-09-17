/**
 * Node #362's browser tier: firing on ordinary traffic in the running game
 * (`docs/specs/civilian-combat.md`, the first change).
 *
 * The headless rows own the arithmetic — `tests/traffic-engagement.test.ts`
 * (the condition model, the reaction per role, the destroy and who flies),
 * `tests/legal.test.ts` (heat), `tests/carrier-standing.test.ts` (standing and
 * the hold) and `tests/raider-wreck.test.ts` (the manifest drop and the partial
 * scoop). What only the page can answer is the wiring:
 *
 * - a civilian near the player is a contact, and selecting it pulls the
 *   gimballed beam onto it — #43's third combat target;
 * - the first shot that lands hands it from its projection to flight, and it
 *   runs rather than fights;
 * - the kill is a world-state destroy, the contact goes, the canisters are the
 *   manifest line for line, and the offence is written against its true
 *   standing and read on the cockpit;
 * - Traffic authority is ready again after the kill, so the system's lanes
 *   still admit the player;
 * - the replacement flies at the next instance ordinal;
 * - an armed hull, struck, fires back.
 *
 * **The pilot is tethered**: it holds a fixed offset behind the target and its
 * nose on it. That proves the wiring reaches a kill, not that a pilot can make
 * one — the principal flying it is that evidence.
 */
import { gameUrl } from "./lib/game-url.mjs";
import {
	bootedGame,
	guardedOrigin,
	launchChromium,
	tally,
} from "./probe-guard.mjs";

const ORIGIN =
	process.env.PROBE_ORIGIN ?? process.argv[2] ?? "http://localhost:5173";
const origin = await guardedOrigin(ORIGIN);
const browser = await launchChromium();
const { check, watch, exit } = tally();

try {
	const page = await browser.newPage({
		viewport: { width: 1440, height: 900 },
	});
	watch(page);
	await page.goto(gameUrl(origin, { seed: 42 }), { waitUntil: "load" });
	await bootedGame(page);

	await page.evaluate(async () => {
		const g = window.__seelite;
		cancelAnimationFrame(g.animationFrame);
		const sim = await import("/src/sim.ts");
		const standingMod = await import("/src/carrier-standing.ts");
		const engagementMod = await import("/src/traffic-engagement.ts");
		// Constants read off the page, never restated here (CLAUDE.md).
		const legalMod = await import("/src/legal.ts");
		const gimbalMod = await import("/src/gimbal.ts");
		const wreckMod = await import("/src/raider-wreck.ts");
		const dt = g.units.MAX_DT;
		const frame = () => {
			g.step(dt);
			g.render(dt);
		};
		const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
		const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
		const len = (a) => Math.hypot(a.x, a.y, a.z);
		const unit = (a) => {
			const l = len(a) || 1;
			return { x: a.x / l, y: a.y / l, z: a.z / l };
		};
		const scale = (a, k) => ({ x: a.x * k, y: a.y * k, z: a.z * k });
		const SLOW = new Set(["local-departure", "local-approach"]);

		/** A flying, slow route of the wanted kind at the clock as it stands. */
		const findRoute = (want) => {
			const record = g.world.system.record;
			for (const route of g.trafficRoutes) {
				if (!SLOW.has(route.phase)) continue;
				const actor = g.trafficActors.find((a) => a.key === route.key);
				if (!actor) continue;
				const armed = engagementMod.ARMED_TRAFFIC_HULLS.has(actor.hullId);
				if (armed !== want.armed) continue;
				const { instanceOrdinal } = g.carrierCondition(route.key);
				const standing = standingMod.carrierStanding(
					record.seed,
					route.key,
					instanceOrdinal,
					g.world.gameTime,
				);
				if (want.standing && standing !== want.standing) continue;
				return { key: route.key, actor, standing };
			}
			return null;
		};

		window.__engagementProbe = {
			frame,
			/** Run the clock until a route of the wanted kind is flying slowly. */
			seek(want, maxSeconds) {
				for (let t = 0; t < maxSeconds; t += dt) {
					const found = findRoute(want);
					if (found) return found;
					// Authority only: nothing is drawn while the clock runs to a route.
					g.step(dt);
				}
				return null;
			},
			/** Put the ship `km` behind the carrier, co-moving, nose on it. */
			tether(key, km, offNoseRad = 0) {
				const route = g.trafficRoutes.find((r) => r.key === key);
				const contact = g.trafficContacts.get(key);
				const pos = contact?.pos ?? route.pos;
				const vel = contact?.velocity ?? route.vel;
				const back = unit(
					route?.nose ? scale(route.nose, -1) : { x: 0, y: 0, z: 1 },
				);
				window.__engagementProbe.offset = scale(back, km);
				g.world.ship.pos = add(pos, window.__engagementProbe.offset);
				g.world.ship.vel = { ...vel };
				g.throttle = 0;
				window.__engagementProbe.aimAt(pos, offNoseRad);
				g.setHeadLook("forward");
			},
			/** One tethered frame: hold the offset, nose on the target or
			 *  `offNoseRad` beside it. */
			follow(key, firing, offNoseRad = 0) {
				const contact = g.trafficContacts.get(key);
				if (!contact) return false;
				g.world.ship.pos = add(contact.pos, window.__engagementProbe.offset);
				g.world.ship.vel = { ...contact.velocity };
				window.__engagementProbe.aimAt(contact.pos, offNoseRad);
				if (firing) g.keys.add(" ");
				else g.keys.delete(" ");
				frame();
				g.keys.delete(" ");
				return true;
			},
			/** Nose on `pos`, or `offNoseRad` beside it in the horizontal. */
			aimAt(pos, offNoseRad = 0) {
				const toward = unit(sub(pos, g.world.ship.pos));
				const aside = unit({ x: -toward.z, y: 0, z: toward.x });
				g.setAttitude(
					unit(
						add(
							scale(toward, Math.cos(offNoseRad)),
							scale(aside, Math.sin(offNoseRad)),
						),
					),
					g.shipUp(),
				);
			},
			offenceHeat: legalMod.OFFENCE_HEAT.destroyed,
			heatAt: legalMod.heatAt,
			gimbalConeRad: gimbalMod.GIMBAL_CONE_RAD,
			lifecycleS: wreckMod.RAIDER_WRECK_S + wreckMod.RAIDER_REPAIR_S,
			advanceTo(t) {
				g.world.gameTime = t;
				sim.advanceSystem(g.world.system, t);
				frame();
			},
		};
	});

	// -------------------------------------------------------------------------
	// A Clean civilian, found and selected.
	// -------------------------------------------------------------------------
	const found = await page.evaluate(async () => {
		const p = window.__engagementProbe;
		const g = window.__seelite;
		const { trafficInSights } = await import("/src/traffic-engagement.ts");
		const target = p.seek({ armed: false, standing: "clean" }, 900);
		if (!target) return { target: null };
		// Inside and outside the gimbal's cone, read off the page.
		const off = p.gimbalConeRad / 2;
		p.tether(target.key, 1.2, off);
		p.frame();
		g.targetId = target.key;
		// First twice the cone off the nose: the mark must not show.
		const outside = p.gimbalConeRad * 2;
		for (let i = 0; i < 20; i++) p.follow(target.key, false, outside);
		const markOutside = g.selectedRender && { ...g.selectedRender };
		// Then half the cone off the nose, inside it, not firing.
		for (let i = 0; i < 20; i++) p.follow(target.key, false, off);
		const mark = g.selectedRender && { ...g.selectedRender };
		const contact = g.trafficContacts.get(target.key);
		const readout = g
			.trafficReadout()
			.contacts.find((c) => c.key === target.key);
		return {
			target,
			listed: g.selectableIds().includes(target.key),
			selected: g.trafficSelected(),
			boresightHits:
				contact &&
				trafficInSights(
					g.cameraPos(),
					g.weaponAim(),
					contact.pos,
					target.actor.hullId,
				),
			beamHits:
				contact &&
				trafficInSights(
					g.cameraPos(),
					g.beamAim(),
					contact.pos,
					target.actor.hullId,
				),
			readout,
			mark,
			markOutside,
		};
	});
	check(
		"a slow Clean civilian flies near the player and is a selectable contact",
		found.target !== null && found.listed && found.selected,
		JSON.stringify(found),
	);
	check(
		"selecting it pulls the gimballed beam onto a hull the boresight misses (#43's third target)",
		found.boresightHits === false && found.beamHits === true,
		JSON.stringify({ bore: found.boresightHits, beam: found.beamHits }),
	);
	check(
		"the painted label says ON TARGET inside the gimbal's cone and not outside it",
		found.mark?.id === found.target?.key &&
			found.mark.onTarget === true &&
			found.mark.text.includes("ON TARGET") &&
			found.markOutside?.id === found.target?.key &&
			found.markOutside.onTarget === false &&
			!found.markOutside.text.includes("ON TARGET"),
		JSON.stringify({ mark: found.mark, outside: found.markOutside }),
	);
	if (!found.target) throw new Error("no target to fight");
	const key = found.target.key;
	const manifest = found.readout.manifest;

	// -------------------------------------------------------------------------
	// The first shot engages; the civilian runs.
	// -------------------------------------------------------------------------
	const engaged = await page.evaluate((key) => {
		const p = window.__engagementProbe;
		const g = window.__seelite;
		for (let i = 0; i < 10; i++) p.follow(key, true);
		return g.trafficReadout().contacts.find((c) => c.key === key);
	}, key);
	check(
		"the first shot hands it from its projection to flight, and it runs rather than fights",
		engaged?.engaged === true &&
			["flee", "evade"].includes(engaged.phase) &&
			engaged.condition === "operational",
		JSON.stringify(engaged),
	);

	// -------------------------------------------------------------------------
	// The kill.
	// -------------------------------------------------------------------------
	const killed = await page.evaluate((key) => {
		const p = window.__engagementProbe;
		const g = window.__seelite;
		const { heat, updatedAt } = g.trafficReadout().legal;
		const statusBefore = { heat, updatedAt };
		let steps = 0;
		for (; steps < 2000 && g.trafficContacts.has(key); steps++)
			p.follow(key, true);
		const now = g.world.gameTime;
		for (let i = 0; i < 3; i++) p.frame();
		g.leftTab = "Communications";
		g.setHeadLook("left");
		p.frame();
		const legalEl = document.querySelector("[data-live-legal-status]");
		const legalText = legalEl?.textContent ?? null;
		const legalVisible = legalEl ? legalEl.checkVisibility() : null;
		// H7 puts the readout on both left tabs: read the Navigation one too.
		g.leftTab = "Navigation";
		p.frame();
		const navEl = document.querySelector("[data-live-legal-status]");
		const navText = navEl?.textContent ?? null;
		const navVisible = navEl ? navEl.checkVisibility() : null;
		const readout = g.trafficReadout();
		return {
			steps,
			seconds: steps * g.units.MAX_DT,
			condition: g.carrierCondition(key).condition,
			contactGone: !g.trafficContacts.has(key),
			selectable: g.selectableIds().includes(key),
			canisters: g.canisters
				.filter((c) => c.id.startsWith(`${key}#`))
				.map((c) => ({ good: c.commodity, tonnes: c.tonnes })),
			// The write stores the earlier heat decayed to the kill plus the
			// offence, stamped then; so the offence written is the stored figure
			// less the earlier heat decayed to that stamp. Correct for any heat
			// the pilot already had, not only for zero (sage #368).
			heatBefore: p.heatAt(statusBefore, readout.legal.updatedAt),
			legal: readout.legal,
			legalText,
			legalVisible,
			navText,
			navVisible,
			authorityReady: readout.authorityReady,
			offenceHeat: p.offenceHeat,
			targetAfter: g.targetId,
			lastExit: g.lastExit,
			killedAt: now,
		};
	}, key);
	check(
		"held in the beam it dies, and the kill is a world-state destroy",
		killed.condition === "destroyed" &&
			killed.contactGone &&
			!killed.selectable &&
			// The lock goes with it: the replacement reuses the key (H1).
			killed.targetAfter !== key,
		JSON.stringify(killed),
	);
	check(
		"the canisters are the manifest, one per line, each holding its line's tonnes (H11)",
		JSON.stringify(killed.canisters) === JSON.stringify(manifest) &&
			manifest.length >= 1,
		JSON.stringify({ canisters: killed.canisters, manifest }),
	);
	check(
		"a Clean kill writes its offence heat, reads Wanted, and the cockpit says so (H4, H7)",
		Math.abs(killed.legal.heat - killed.heatBefore - killed.offenceHeat) <
			1e-6 &&
			killed.legal.standing === "wanted" &&
			killed.legalText === "WANTED" &&
			killed.legalVisible === true &&
			killed.navText === "WANTED" &&
			killed.navVisible === true,
		JSON.stringify({
			legal: killed.legal,
			before: killed.heatBefore,
			text: killed.legalText,
			visible: killed.legalVisible,
			navText: killed.navText,
			navVisible: killed.navVisible,
		}),
	);
	check(
		"Traffic authority is ready again after the kill, so the system's lanes still admit the player",
		killed.authorityReady === true,
		JSON.stringify(killed),
	);

	// -------------------------------------------------------------------------
	// The replacement.
	// -------------------------------------------------------------------------
	const replaced = await page.evaluate(
		({ key, killedAt }) => {
			const p = window.__engagementProbe;
			const g = window.__seelite;
			p.advanceTo(killedAt + p.lifecycleS + 1);
			for (let i = 0; i < 5; i++) p.frame();
			const carrier = g.carrierCondition(key);
			return {
				condition: carrier.condition,
				instanceOrdinal: carrier.instanceOrdinal,
				routed: g.trafficRoutes.some((r) => r.key === key),
				authorityReady: g.trafficReadout().authorityReady,
			};
		},
		{ key, killedAt: killed.killedAt },
	);
	check(
		"once the wreck and repair have run, the replacement flies its route at the next instance (H1)",
		replaced.condition === "operational" &&
			replaced.instanceOrdinal === 1 &&
			replaced.routed &&
			replaced.authorityReady,
		JSON.stringify(replaced),
	);

	// -------------------------------------------------------------------------
	// An armed hull fires back.
	// -------------------------------------------------------------------------
	const armed = await page.evaluate(() => {
		const p = window.__engagementProbe;
		const g = window.__seelite;
		const target = p.seek({ armed: true }, 1800);
		if (!target) return { target: null };
		p.tether(target.key, 3);
		p.frame();
		g.targetId = target.key;
		const before = { ...g.condition };
		for (let i = 0; i < 10; i++) p.follow(target.key, true);
		let returned = false;
		for (let i = 0; i < 600 && g.trafficContacts.has(target.key); i++) {
			// Hold still and cease fire: an armed hull, struck, comes to the pilot.
			p.aimAt(g.trafficContacts.get(target.key).pos);
			p.frame();
			if (
				g.condition.fore + g.condition.aft + g.condition.hull <
				before.fore + before.aft + before.hull
			) {
				returned = true;
				break;
			}
		}
		const readout = g
			.trafficReadout()
			.contacts.find((c) => c.key === target.key);
		return { target, returned, readout };
	});
	check(
		"an armed hull, struck, fires back (H3)",
		armed.target !== null && armed.returned,
		JSON.stringify(armed),
	);
} finally {
	await browser.close();
}
exit();
