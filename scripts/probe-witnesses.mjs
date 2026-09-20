/**
 * The browser tier for the station an offence happened beside (#366:
 * `civilian-combat.md` H5, H6, and H7's second half).
 *
 * The headless rows own the rule — `tests/legal.test.ts` for what a witness is
 * and how long it bites, `tests/world-state.test.ts` for the list across a save,
 * `tests/docking.test.ts` for what a refusal does to the protocol. What only the
 * page can answer is whether any of it is **reachable**, which is a different
 * question and the one a node like this fails most often:
 *
 * - the reach is a station's earshot of the **victim**, and every berth in the
 *   system is asked. It used to be the frame body's — the body the flight assist
 *   was already treating as at rest — and the search below still wants a
 *   carrier near a berth, because an unreachable carrier cannot be shot at, but
 *   the berth the offence is filed against is no longer chosen by where the
 *   *pilot* happens to be standing (#396 amended this, and the row that reads it
 *   is the earshot row rather than the reach row);
 * - the offence a pilot commits there is filed against **every berth that heard
 *   it**, and against none that did not;
 * - a shipyard refuses a Wanted pilot it never saw, on standing alone, and the
 *   station that saw the offence is a different station refusing for a different
 *   reason;
 * - the witness survives a jump out and back, because H6 put it in the saved
 *   envelope rather than in session state — and the key that survives still
 *   names the system it came from, which is why it is a `CarrierKey` and not a
 *   `Station.id`;
 * - heat decaying below Wanted clears the list on the read, with nothing
 *   ticking, and every berth reopens.
 *
 * **Its own script, and not more rows on `probe-traffic-engagement.mjs`.** That
 * file's own fight scene takes the better part of `probe-all`'s per-probe
 * ceiling, and these rows bolted onto the end of it were killed at 600 s before
 * they ran. Separately, they do not want the state that scene leaves behind:
 * here the pilot boots Clean, with an empty list, which is the state H5 and H6
 * are actually specified against.
 *
 * **The pilot is tethered.** The strike is placed, not flown — the principal
 * flying an offence beside a station and being refused is this node's third
 * tier, and no probe stands in for it.
 *
 * **#396's hail rows are here, in this scene, rather than in a file of their
 * own.** A Clean carrier, tethered and under fire, is what both rulings are
 * observed on, and finding one is the expensive part of this probe: the search
 * below runs the game's own Traffic rosters forward across up to half an hour of
 * system clock, and a second probe doing it again would spend the whole
 * `probe-all` ceiling to re-derive what this one already has. What is *not*
 * shared is the assertion: the hail rows read the rail, the log and the alert,
 * which nothing above reads, and they fail under their own names.
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
		// Constants read off the page, never restated here (CLAUDE.md).
		const legalMod = await import("/src/legal.ts");
		const engagementMod = await import("/src/traffic-engagement.ts");
		const standingMod = await import("/src/carrier-standing.ts");
		const distressMod = await import("/src/distress.ts");
		const dt = g.units.MAX_DT;
		// **Spied, not stubbed:** the alert is `AudioFX.alert`, and the question is
		// whether the game's own hail path reaches it. Wrapping the shipped method
		// keeps the sound the shipped one and counts the calls the game makes.
		const shippedAlert = g.audio.alert.bind(g.audio);
		g.alertCount = 0;
		g.audio.alert = () => {
			g.alertCount++;
			return shippedAlert();
		};
		const SLOW = new Set(["local-departure", "local-approach"]);
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

		window.__witnessProbe = {
			frame,
			/** Nose on `pos`. The beam is gimballed, so this keeps it on target. */
			aimAt(pos) {
				const toward = unit(sub(pos, g.world.ship.pos));
				g.setAttitude(toward, g.shipUp());
			},
			/** The law's answer about every berth in this system, as the game gives
			 *  it — with the clock it was read at and the threshold the refusals
			 *  were read against, so no figure is restated up here in Node. */
			lawReadout() {
				const readout = g.trafficReadout();
				return {
					systemIndex: g.world.system.record.index,
					gameTime: g.world.gameTime,
					wantedHeat: legalMod.WANTED_HEAT,
					legal: readout.legal,
					stations: readout.stations,
					frameBodyId: g.frameBody?.id ?? null,
				};
			},
			/**
			 * Park the ship beside a station and hold there, co-moving with it.
			 *
			 * **The pilot flies to a station; what the station then sees is the
			 * row.** Traffic contacts exist inside a band around the player, so a
			 * search for "a carrier beside the trade station", run from wherever a
			 * jump left the ship, can only find the traffic that happened to be
			 * nearby. Holding beside the station is what a pilot does, and it is
			 * the station's own frame that makes holding there one act rather than
			 * a fight with the assist.
			 */
			/**
			 * Put the ship at `at`, at rest with it, nose on `toward`.
			 *
			 * The berth hold and the carrier tether both need it, and where the
			 * ship is *is* this file's subject — H5's witness goes to the body the
			 * flight assist says the ship is at — so it is one function rather than
			 * two spellings that could disagree about what "parked" means.
			 */
			parkShip(at, toward, vel) {
				g.world.ship.pos = at;
				g.world.ship.vel = vel;
				g.throttle = 0;
				window.__witnessProbe.aimAt(toward);
				g.setHeadLook("forward");
			},
			holdBeside(stationId, km) {
				const body = g.world.system.byId.get(stationId);
				if (!body) return { held: false, frameBodyId: null };
				window.__witnessProbe.parkShip(
					add(body.pos, { x: 0, y: 0, z: km }),
					body.pos,
					sim.bodyVelocity(g.world.system, body.id, g.world.gameTime),
				);
				frame();
				return { held: true, frameBodyId: g.frameBody?.id ?? null };
			},
			/**
			 * Run the clock until a carrier of the wanted kind is inside the frame
			 * body's reach of one particular station — the only place an offence
			 * has a witness (H5).
			 *
			 * **Waited for, not arranged.** Traffic comes to its station on a
			 * `local-approach` leg, so "a strike beside a station" is an ordinary
			 * moment in a system rather than a placement this script makes. Moving
			 * a carrier to a station would have proven the predicate and not the
			 * reach.
			 *
			 * **Searched on the routes, not the contacts.** `step` is authority and
			 * `render` is what materializes contacts, so measuring a *contact*
			 * against a station compares the two at different moments — 30 km/s
			 * against a 20,000 km reach is ten minutes of search and a distance
			 * between two clocks. (The first version of this row reported a carrier
			 * 1,545 km from its station, truly, and a frame body that was not that
			 * station, also truly, nine minutes apart.) A route's `pos` is the
			 * authority's own, so the distance is one moment; all a render still
			 * decides is whether the carrier is in the sky to be shot at, which is
			 * a membership test rather than a position, and lags harmlessly.
			 */
			/**
			 * Run the clock until a Clean carrier of the wanted armament is inside
			 * some station's reach and the tethered ship is *at* that station — the
			 * only place an offence has a witness (H5).
			 *
			 * **The berth is the game's answer, not this file's search key.** The
			 * first pass asked for "a carrier near the trade station" and compared
			 * distances here; it went red four times, and the tally below says why.
			 * A `local-approach` lane runs past the neighbouring berth, so a
			 * carrier 9,929 km from the station it belongs to was 164 km from the
			 * other one. And the two berths drift: 12.9 km apart at the boot epoch,
			 * thousands of km apart twenty minutes later, because they are bodies in
			 * orbit and not furniture. So the search tethers first and then asks
			 * `Game` which body the ship is at, and reports that station as the one
			 * the offence will be filed against.
			 *
			 * **Waited for, not arranged.** Nothing here is placed: a carrier is
			 * taken when its own leg brings it in beside a berth and the flight
			 * assist already calls that berth the frame body.
			 *
			 * **Searched on the routes, and rendered only every `REFRESH` steps.**
			 * `step` is authority and `render` is what materializes contacts, so
			 * measuring a *contact* against a station compares the two at different
			 * moments — 30 km/s against a 20,000 km reach is ten minutes of search
			 * and a distance between two clocks. A route's `pos` is the authority's
			 * own, so the distance is one moment; all a render still decides is
			 * whether the carrier is in the sky to be shot at.
			 */
			nearStationContact(want, maxSeconds) {
				const REFRESH = 100;
				const record = g.world.system.record;
				// Every gate a candidate can fail, counted across the whole search
				// and returned with a null result. This row went red four times
				// before it went green, and each time the question was which of
				// these had closed; the row as written could only say "nothing".
				const tally = {
					carriers: 0,
					armed: 0,
					leg: 0,
					standing: 0,
					untetherable: 0,
					noStation: 0,
					distance: 0,
				};
				const scan = () => {
					for (const route of g.trafficRoutes) {
						// A contact is what can be shot at: a carrier held at its
						// berth is on a route and out of the sky.
						if (!g.trafficContacts.has(route.key)) continue;
						tally.carriers++;
						const actor = g.trafficActors.find((a) => a.key === route.key);
						if (!actor) continue;
						if (
							engagementMod.ARMED_TRAFFIC_HULLS.has(actor.hullId) !== want.armed
						) {
							tally.armed++;
							continue;
						}
						// The engagement rig's predicate, kept: a carrier on a local
						// leg is slow, near its berths, and shootable. One on a
						// cruise leg is neither near a station nor reachable.
						if (!SLOW.has(route.phase)) {
							tally.leg++;
							continue;
						}
						const { instanceOrdinal } = g.carrierCondition(route.key);
						// **Clean, and that is load-bearing.** A Wanted carrier is a
						// lawful target: striking one costs no heat (F7), and the
						// rig's first pass found exactly that and reported a witness
						// filed with `heatWrite: 0` — a witness with nobody to
						// refuse, read as a failure of the law rather than of the
						// search.
						const standing = standingMod.carrierStanding(
							record.seed,
							route.key,
							instanceOrdinal,
							g.world.gameTime,
						);
						if (standing !== "clean") {
							tally.standing++;
							continue;
						}
						if (!window.__witnessProbe.tether(route.key, 1.2)) {
							tally.untetherable++;
							continue;
						}
						frame();
						const body = g.frameBody;
						if (!body || body.kind !== "station") {
							tally.noStation++;
							continue;
						}
						// Inside the reach, and clear of the volume: `radiusKm` is
						// the station's own size rather than a kilometre figure this
						// file invented, and 0.6 km is what a berth actually is.
						const km = len(sub(body.pos, route.pos));
						if (km < body.radiusKm * 4 || km > g.units.NEAR_FAR_KM * 0.5) {
							tally.distance++;
							continue;
						}
						return { key: route.key, stationId: body.id, km, standing, tally };
					}
					return null;
				};
				for (let t = 0; t < maxSeconds; t += REFRESH * dt) {
					const found = scan();
					if (found) return found;
					for (let i = 0; i < REFRESH; i++) g.step(dt);
					// Hold near the nearest berth while waiting. Contacts exist
					// inside a band around the player, so a search run from open
					// space would be looking at an empty sky — and holding beside a
					// berth is what a pilot looking for traffic does. Which berth is
					// chosen by where the ship already is, not by this row's
					// predicate: the berth the offence is filed against is whatever
					// the frame body says once the carrier is found.
					const nearest = g.world.system.bodies
						.filter((b) => b.kind === "station")
						.sort(
							(a, b) =>
								len(sub(a.pos, g.world.ship.pos)) -
								len(sub(b.pos, g.world.ship.pos)),
						)[0];
					if (nearest) window.__witnessProbe.holdBeside(nearest.id, 5e3);
					frame();
				}
				return { tally };
			},
			offset: { x: 0, y: 0, z: 0 },
			framesFired: 0,
			/**
			 * Put the ship 1.2 km behind the carrier along its own nose, co-moving.
			 *
			 * **The engagement probe's rig, not a placement of this file's.** The
			 * first pass here held the ship 1 km off the target on a fixed axis and
			 * held the trigger for ninety seconds of game time without ever landing
			 * a hit. The diagnostics say why in one field: the energy bank fell the
			 * whole way (so the pulse laser was firing) and the painted mark read
			 * `onTarget: false` on every frame — the gimbal's own statement that
			 * the pulse laser is not where the nose is. That rig has landed one on
			 * a Clean civilian before, so it is copied rather than reinvented, and
			 * the mark is reported below so the next failure says the same.
			 */
			tether(key, km) {
				const contact = g.trafficContacts.get(key);
				if (!contact) return false;
				const route = g.trafficRoutes.find((r) => r.key === key);
				const back = unit(
					route?.nose ? scale(route.nose, -1) : { x: 0, y: 0, z: 1 },
				);
				window.__witnessProbe.offset = scale(back, km);
				g.targetId = key;
				window.__witnessProbe.parkShip(
					add(contact.pos, window.__witnessProbe.offset),
					contact.pos,
					{ ...contact.velocity },
				);
				return true;
			},
			/** One tethered frame with the trigger held. */
			followFiring(key) {
				const contact = g.trafficContacts.get(key);
				if (!contact) return false;
				// The ship travels with the carrier it is shooting at, which the
				// tether's offset says it should: what is being tested is whether a
				// beam kept on target diverts a civilian, not whether a pilot can
				// keep up with one.
				window.__witnessProbe.parkShip(
					add(contact.pos, window.__witnessProbe.offset),
					contact.pos,
					{ ...contact.velocity },
				);
				g.keys.add(" ");
				window.__witnessProbe.framesFired++;
				frame();
				g.keys.delete(" ");
				return true;
			},
			/** What the game says about its own aim. Read on three frames out of
			 *  nine hundred: a held trigger that lands nothing is not a mystery,
			 *  and a row that only says "not diverted" sends the next reader back
			 *  to this file with no lead. */
			aimReport(key) {
				return {
					phase: g.dock.phase,
					energy: g.condition.energy,
					mark: g.selectedRender
						? {
								id: g.selectedRender.id,
								onTarget: g.selectedRender.onTarget,
							}
						: null,
					engaged: g.trafficEngagements.has(key),
					tracer: g.gunFeedback.tracerLeftS > 0,
				};
			},
			/** Hold the tether and the trigger until the hull gives way. */
			strikeUntilDiverted(key, maxFrames) {
				const p = window.__witnessProbe;
				if (!p.tether(key, 1.2)) return { tethered: false, seen: [] };
				const seen = [];
				// **The console before a single frame is fired**, so the hail has a
				// "before" to be read against: the rail's `NONE` is a value #396 put
				// there, and a row that only reads it afterwards cannot tell that from
				// a row that has always said nothing.
				const commsBefore = p.comms();
				const hail = {
					frame: -1,
					comms: null,
					landedFireS: null,
					callsign: null,
				};
				const charge = {
					frame: -1,
					lastExit: null,
					heat: null,
					landedFireS: null,
				};
				for (let i = 0; i < maxFrames; i++) {
					if (!p.followFiring(key))
						return {
							tethered: true,
							diverted: false,
							reason: "contact lost",
							frames: i,
							seen,
						};
					// **The hail, frame by frame, from the session's own store.** Read off
					// `trafficReadout` rather than off the console: the store is what the
					// console is rendered from, and the frame that matters is the frame the
					// line went in, not the frame this script happened to look at.
					if (hail.frame < 0 && g.trafficReadout().hails.length > 0) {
						hail.frame = i;
						hail.comms = p.comms();
						hail.landedFireS =
							g.trafficEngagements.get(key)?.landedFireS ?? null;
						hail.callsign = g.trafficReadout().hails.at(-1)?.callsign ?? null;
					}
					// **And the charge**, on the frame its clock crossed. The flight report
					// was that nothing was said at that moment, so this records what is said
					// now, in the pilot's own words, off the line the divert and the kill
					// already use.
					if (
						charge.frame < 0 &&
						g.trafficEngagements.get(key)?.assaultCharged === true
					) {
						charge.frame = i;
						charge.lastExit = g.lastExit;
						charge.landedFireS =
							g.trafficEngagements.get(key)?.landedFireS ?? null;
						charge.heat = g.trafficReadout().legal.heatNow;
					}
					if (g.carrierCondition(key).condition === "repairing")
						return {
							tethered: true,
							diverted: true,
							reason: "repairing",
							frames: i,
							// The body the ship was at on the frame the offence was
							// charged, read off the game, not off this file.
							at: g.frameBody?.id ?? null,
							seen,
							// Where the carrier stood on that frame, which is what #396's
							// earshot is measured from — not where the pilot was.
							victim: { ...(g.trafficContacts.get(key)?.pos ?? {}) },
							commsBefore,
							hail,
							charge,
							commsAfter: p.comms(),
						};
					if (i === 10 || i === 60 || i === maxFrames - 1)
						seen.push({ frames: i, ...p.aimReport(key) });
				}
				return {
					tethered: true,
					diverted: false,
					reason: "frame cap",
					frames: maxFrames,
					commsBefore,
					hail,
					charge,
					seen,
				};
			},
			/**
			 * One leg, through the shipped course and charge.
			 *
			 * The tank is topped up because a jump that fails for want of it
			 * would report as a witness that did not survive the trip — the exact
			 * false red this row must not have.
			 */
			jumpLeg(toIndex) {
				g.dropOut("probe");
				g.encounter = null;
				g.commander = { ...g.commander, fuelLy: 7 };
				const committed = g.commitCourseTo(toIndex);
				const charged = g.chargeJump();
				for (let i = 0; i < 400 && g.world.system.record.index !== toIndex; i++)
					frame();
				frame();
				return {
					committed,
					charged,
					arrived: g.world.system.record.index === toIndex,
					gameTime: g.world.gameTime,
				};
			},
			advanceTo(t) {
				g.world.gameTime = t;
				sim.advanceSystem(g.world.system, t);
				frame();
			},
			/**
			 * The Communications console, as the player would have it open, and what
			 * it is showing. The tab is a private field and this drives it the way
			 * the pad binding does, because the rail and the log are both built per
			 * tab and neither exists in the DOM until the tab is up.
			 */
			comms() {
				// The console is only built while the cockpit is the view, and the
				// rail only while this tab is up — so both are driven here rather
				// than assumed, the way `probe-carrier-scan.mjs` drives the view.
				g.view = "cockpit";
				g.leftTab = "Communications";
				// **`updateCockpit` is called by the rAF loop and not by `render`,**
				// and this probe runs the loop by hand: `cancelAnimationFrame` is in
				// the boot block, so a frame built here would leave the glass showing
				// whatever the last real frame painted. A rail read without this is a
				// read of the previous moment, which is how "the hail did not reach
				// the rail" got reported once already.
				frame();
				g.updateCockpit();
				const rail = document.querySelector("[data-live-hails]");
				const log = document.querySelector("[data-live-raider-log]");
				return {
					rail: rail ? (rail.textContent ?? "") : null,
					railPresent: rail !== null,
					logLines: log
						? [...log.querySelectorAll("li")].map((li) => li.textContent ?? "")
						: null,
					store: g.trafficReadout().hails,
					alerts: g.alertCount,
					noneRail: rail?.textContent === "NONE",
				};
			},
			/** Every berth in this system, measured from where the carrier stood. */
			earshot(from) {
				const km = (st) =>
					Math.hypot(st.pos.x - from.x, st.pos.y - from.y, st.pos.z - from.z);
				return g.trafficReadout().stations.map((st) => ({
					id: st.id,
					type: st.type,
					witnessed: st.witnessed,
					km: km(st),
					inEarshot: km(st) <= distressMod.DISTRESS_RANGE_KM,
					// The arm the amendment is for: a berth the frame body's rule
					// could never have reached, sitting inside the transmission's.
					pastFrameReach: km(st) > g.units.NEAR_FAR_KM,
				}));
			},
			distressRangeKm: distressMod.DISTRESS_RANGE_KM,
			nearFarKm: g.units.NEAR_FAR_KM,
			assaultFireS: engagementMod.ASSAULT_FIRE_S,
			heatAt: legalMod.heatAt,
			wantedHeat: legalMod.WANTED_HEAT,
			strikeOffence: legalMod.OFFENCE_HEAT.struck,
			halfLifeS: legalMod.HEAT_HALF_LIFE_S,
		};
	});

	// -------------------------------------------------------------------------
	// An offence beside a station, in the running game.
	// -------------------------------------------------------------------------
	const struck = await page.evaluate(() => {
		const p = window.__witnessProbe;
		const found = p.nearStationContact({ armed: false }, 1800);
		if (!found?.key) return { beside: null, found: null, search: found.tally };
		// The berth the flight assist called the frame body when the ship was
		// tethered to this carrier. Everything below is read against it.
		const beside = found.stationId;
		const before = p.lawReadout();
		const strike = p.strikeUntilDiverted(found.key, 900);
		const after = p.lawReadout();
		// The whole system measured from where the carrier stood, taken on the
		// frame the hull gave way. The berths drift over the ninety seconds of a
		// strike, but against a reach of `distressRangeKm` the drift is some
		// hundreds of km, and the row asks a question with that much slack in it.
		const heard = strike?.victim
			? {
					range: p.distressRangeKm,
					nearFar: p.nearFarKm,
					victim: strike.victim,
					stations: p.earshot(strike.victim),
				}
			: null;
		return {
			beside,
			found: { key: found.key, stationId: found.stationId, km: found.km },
			search: found.tally,
			strike,
			range: p.distressRangeKm,
			nearFar: p.nearFarKm,
			assaultFireS: p.assaultFireS,
			heard,
			before,
			after,
			heatWrite: after.legal.heat - p.heatAt(before.legal, before.gameTime),
			besideStation: after.stations.find((st) => st.id === beside) ?? null,
			besideBefore: before.stations.find((st) => st.id === beside) ?? null,
			// Everything that is not the berth named above. The refusal rows read
			// these to say who saw nothing.
			other: after.stations.filter((st) => st.id !== beside),
		};
	});
	check(
		"a Clean carrier is found inside a berth's reach, tethered, with that berth already the frame body (#366 H5's reach)",
		struck.found &&
			struck.beside !== null &&
			struck.found.km <= 1e4 &&
			struck.strike?.tethered === true,
		JSON.stringify({
			beside: struck.beside,
			found: struck.found,
			search: struck.search,
			strike: struck.strike,
		}),
	);
	check(
		"the berth the shot was fired at is filed, and the pilot is Wanted for it (#366 H5, H6)",
		struck.strike?.diverted === true &&
			// A fleeing carrier can be dragged out to another berth, and then the
			// hearer is that one — so the berth named is the one the game called
			// the frame body on the frame the hull gave way, not the one the
			// tether chose, and it is inside the earshot by construction.
			struck.besideStation !== null &&
			struck.strike?.at === struck.beside &&
			struck.heatWrite >= struck.after.wantedHeat &&
			struck.besideBefore?.witnessed === false &&
			struck.besideBefore?.refusedByLaw === false &&
			struck.besideStation?.witnessed === true &&
			struck.besideStation?.refusedByLaw === true,
		JSON.stringify({
			beside: struck.beside,
			at: struck.strike?.at,
			heatWrite: struck.heatWrite,
			before: struck.besideBefore,
			after: struck.besideStation,
			legal: struck.after?.legal,
			other: struck.other,
		}),
	);
	// -------------------------------------------------------------------------
	// #396 amended which berths H5 files. The rule to read in the running game
	// is not "the one the pilot was standing next to" but "every berth the
	// victim's transmission reached", so the row is a comparison over the whole
	// system rather than a name.
	// -------------------------------------------------------------------------
	const heard = struck.heard;
	check(
		"every berth within earshot of the carrier is filed and no berth outside it is (#396, amending H5)",
		heard !== null &&
			heard.stations.length >= 2 &&
			heard.stations.every((st) => st.witnessed === st.inEarshot) &&
			struck.after?.legal.witnesses.length ===
				heard.stations.filter((st) => st.inEarshot).length,
		JSON.stringify({
			heard,
			witnesses: struck.after?.legal.witnesses,
			victim: struck.strike?.victim,
		}),
	);
	check(
		"the filed set contains at least the berth the frame body's rule reached, so the amendment only widens H5 (#396)",
		// The old rule's answer has to be a subset of the new one's, or the
		// amendment would be a narrowing that reads as a widening: the frame
		// body's reach is `nearFar`, the transmission's is `range`, and `km`
		// here is measured from the victim.
		heard !== null &&
			heard.stations
				.filter((st) => st.km <= heard.nearFar)
				.every((st) => st.witnessed === true),
		JSON.stringify({ heard }),
	);
	// -------------------------------------------------------------------------
	// #396 §3: the victim's hail, and the charge that the flight report said
	// was invisible. All three channels, on the frame the first hit landed.
	// -------------------------------------------------------------------------
	check(
		"the rail's HAILS row reads NONE before a single frame is fired (#396: a label that carries a value)",
		struck.strike?.commsBefore?.railPresent === true &&
			struck.strike?.commsBefore?.rail === "NONE" &&
			struck.strike?.commsBefore?.alerts === 0 &&
			struck.strike?.commsBefore?.store.length === 0 &&
			!struck.strike?.commsBefore?.logLines?.some((l) =>
				l.includes("cease fire"),
			),
		JSON.stringify({ commsBefore: struck.strike?.commsBefore }),
	);
	check(
		"a Clean carrier hit for the first time hails: the rail names it, the log carries it, and the alert sounds (#396 §3)",
		struck.strike?.hail?.frame >= 0 &&
			struck.strike?.hail?.comms?.rail === struck.strike?.hail?.callsign &&
			struck.strike?.hail?.comms?.logLines?.some((l) =>
				l.includes("cease fire"),
			) === true &&
			struck.strike?.hail?.comms?.alerts === 1 &&
			// Before the charge. The hail is not an accusation: the clock that
			// convicts is still running on this frame, and a victim that announced
			// a charge which has not been made tells the pilot the wrong thing.
			struck.strike?.hail?.landedFireS !== null &&
			struck.strike?.hail?.landedFireS < struck.assaultFireS &&
			struck.strike?.charge?.frame > struck.strike?.hail?.frame,
		JSON.stringify({
			hail: struck.strike?.hail,
			charge: struck.strike?.charge,
			assaultFireS: struck.assaultFireS,
		}),
	);
	check(
		"the sustained-fire charge is said in the pilot's own line, and it costs Wanted (#396 §2)",
		struck.strike?.charge?.frame >= 0 &&
			typeof struck.strike?.charge?.lastExit === "string" &&
			struck.strike?.charge?.lastExit.includes("sustained fire") &&
			struck.strike?.charge?.heat >= struck.after?.wantedHeat &&
			struck.strike?.charge?.landedFireS >= struck.assaultFireS &&
			// And the whole thing happens before the divert: this is the part of
			// the flight report that was missing, the interval in which the pilot
			// could still have stopped.
			struck.strike?.charge?.frame < struck.strike?.frames,
		JSON.stringify({
			charge: struck.strike?.charge,
			frames: struck.strike?.frames,
			assaultFireS: struck.assaultFireS,
			wanted: struck.after?.wantedHeat,
		}),
	);
	check(
		"the hail is one line per carrier, not one per hit (#396: the rail says who, not how often)",
		struck.strike?.commsAfter?.store.length === 1 &&
			struck.strike?.commsAfter?.alerts === 1 &&
			struck.strike?.commsAfter?.rail === struck.strike?.hail?.callsign,
		JSON.stringify({ commsAfter: struck.strike?.commsAfter }),
	);
	check(
		"the refusal tracks the readout: at Wanted the shipyard refuses whether or not it saw the offence (#366 H7)",
		struck.after?.legal.heatNow >= struck.after?.wantedHeat &&
			// Two berths, so this is a reading of two stations and not an `every`
			// over one.
			struck.after?.stations.length >= 2 &&
			// The rule, read back over the game's own readout: a berth refuses
			// exactly when it is a shipyard or it saw the offence.
			struck.after?.stations.every(
				(st) => st.refusedByLaw === (st.type === "shipyard" || st.witnessed),
			) &&
			struck.after?.stations.some(
				(st) => st.type === "shipyard" && st.refusedByLaw === true,
			),
		// A station that saw nothing and is not a shipyard admitting a Wanted
		// pilot is the other half of this rule, and it is the next row's: this
		// system has exactly two berths, and once one of them has witnessed the
		// offence there is no unwitnessed non-shipyard berth left here to read.
		// Asking for one would make this row pass only on a seed that happens to
		// have a third, which would be a check on the galaxy rather than on the
		// law, and the away system named below has both kinds.
		JSON.stringify({
			heatNow: struck.after?.legal.heatNow,
			standing: struck.after?.legal.standing,
			beside: struck.beside,
			stations: struck.after?.stations,
		}),
	);

	// -------------------------------------------------------------------------
	// A jump is what separates H6's saved list from session state: the system
	// hand-off and §12's states clear everything the envelope does not hold.
	// -------------------------------------------------------------------------
	const trip = await page.evaluate(() => {
		const p = window.__witnessProbe;
		const g = window.__seelite;
		const here = g.world.system.record;
		const d = (a, b) =>
			Math.hypot(a.pos.x - b.pos.x, a.pos.y - b.pos.y, a.pos.z - b.pos.z);
		const near = g.world.galaxy.systems
			.filter((s) => s.index !== here.index)
			.sort((a, b) => d(a, here) - d(b, here))[0];
		const out = p.jumpLeg(near.index);
		const away = p.lawReadout();
		const back = p.jumpLeg(here.index);
		p.frame();
		const home = p.lawReadout();
		const key = home.legal.witnesses[0] ?? null;
		return {
			here: here.index,
			near: near.index,
			out,
			away,
			back,
			home,
			key,
			homeBeside: home.stations.find((s) => s.key === key) ?? null,
		};
	});
	check(
		"a jump out reaches another system, and the jump back arrives (#366 H6's trip)",
		trip.out.arrived && trip.back.arrived,
		JSON.stringify({
			here: trip.here,
			near: trip.near,
			out: trip.out,
			back: trip.back,
		}),
	);
	check(
		"a jump carries the standing, not the witness: another system's berths have seen nothing, so only its shipyards refuse (#366 H7, H6's key)",
		trip.away.systemIndex !== trip.here &&
			trip.away.stations.length >= 1 &&
			trip.away.stations.every((st) => st.witnessed === false) &&
			trip.away.stations.every(
				(st) => st.refusedByLaw === (st.type === "shipyard"),
			) &&
			// Non-vacuity, and it is a check rather than a comment: if the nearest
			// neighbour has no shipyard there is nothing here to refuse, and the
			// row above would pass on an `every` over berths that are all trade.
			trip.away.stations.some((st) => st.refusedByLaw === true) &&
			trip.away.stations.some((st) => st.type === "shipyard"),
		JSON.stringify({
			here: trip.here,
			awayIndex: trip.away.systemIndex,
			awayStations: trip.away.stations,
			awayWitnesses: trip.away.legal.witnesses,
			awayStanding: trip.away.legal.standing,
		}),
	);
	check(
		"the witness survives both legs and still refuses the berth it saw from (#366 H6)",
		trip.key !== null &&
			trip.away.legal.witnesses.includes(trip.key) &&
			// A bare `Station.id` would read as *this* system's station in every
			// system, so the key has still to name the one it came from.
			trip.key.startsWith(`${trip.here}:`) &&
			trip.away.systemIndex !== trip.here &&
			trip.homeBeside?.witnessed === true &&
			trip.homeBeside?.refusedByLaw === true,
		JSON.stringify({
			key: trip.key,
			here: trip.here,
			awayIndex: trip.away.systemIndex,
			awayWitnesses: trip.away.legal.witnesses,
			homeBeside: trip.homeBeside,
			heatNow: trip.home.legal.heatNow,
		}),
	);

	// -------------------------------------------------------------------------
	// H6's other half: nothing ticks this. The list goes when the heat that made
	// it matter decays below Wanted, and the berths reopen with it.
	// -------------------------------------------------------------------------
	const cleared = await page.evaluate(() => {
		const p = window.__witnessProbe;
		const g = window.__seelite;
		const l = g.trafficReadout().legal;
		// The first second at which this stamp's own heat is below Wanted — solved
		// from the module's half-life rather than guessed at, and stepped one past
		// so the row is about being under rather than about the boundary
		// (`tests/legal.test.ts` owns the boundary itself).
		const horizon =
			l.updatedAt + p.halfLifeS * Math.log2(l.heat / p.wantedHeat) + 1;
		// The heat as it stands *before* the advance, on the clock before it.
		// Reading the same pair afterwards measures the decay this row is about
		// and reports it as the precondition, which is a row that cannot fail for
		// the right reason.
		const before = p.heatAt(l, g.world.gameTime);
		p.advanceTo(Math.max(horizon, g.world.gameTime + 1));
		const readout = p.lawReadout();
		return {
			horizon,
			heldBefore: l.witnesses.length,
			before,
			readout,
			heatNow: p.heatAt(readout.legal, readout.gameTime),
			anyRefused: readout.stations
				.filter((s) => s.refusedByLaw)
				.map((s) => s.id),
		};
	});
	check(
		"heat decaying below Wanted clears the witness list on the read, and every berth reopens (#366 H6)",
		cleared.heldBefore > 0 &&
			cleared.before >= cleared.readout.wantedHeat &&
			cleared.readout.legal.witnesses.length === 0 &&
			cleared.heatNow < cleared.readout.wantedHeat &&
			cleared.readout.legal.standing === "clean" &&
			cleared.anyRefused.length === 0,
		JSON.stringify(cleared),
	);
} finally {
	await browser.close();
}
exit();
