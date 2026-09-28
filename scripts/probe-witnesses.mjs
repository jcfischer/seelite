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
 * shared is the assertion: the hail rows read the rail, the log and the hail's sound,
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
		// The band a traffic fight is fought inside. The break-off row below is
		// driven by flying out of it, so its width is read off the module rather
		// than restated here — a probe with its own copy of a constant goes falsely
		// red the day the constant moves.
		const trafficMod = await import("/src/station-traffic.ts");
		const dt = g.units.MAX_DT;
		// **Spied, not stubbed:** the hail's sound is a `{ kind: "notify",
		// tone: "message" }` cue into `AudioFX.play` — an `alert` until #546,
		// which the principal ruled a message — and the question is whether the
		// game's own hail path reaches it. **A tone alone does not name a hail**:
		// station control's lines and a queued clearance are messages too (sage
		// round 1 on #568). So a cue counts only when it reaches the engine
		// inside the hail's own `consoleNotify` call, which is synchronous — a
		// hail the gap silenced plays nothing and counts nothing. Wrapping the
		// shipped methods keeps the sound the shipped one.
		const shippedPlay = g.audio.play.bind(g.audio);
		const shippedNotify = g.consoleNotify.bind(g);
		g.hailSoundCount = 0;
		let inHail = false;
		g.consoleNotify = (tone, source) => {
			inHail = source === "hail";
			try {
				return shippedNotify(tone, source);
			} finally {
				inHail = false;
			}
		};
		g.audio.play = (cue) => {
			if (inHail && cue.kind === "notify" && cue.tone === "message")
				g.hailSoundCount++;
			return shippedPlay(cue);
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
						// **Which standing the search is hunting for is the
						// caller's, not this function's.** The witness rows want a
						// Clean carrier because only a Clean one is an offence; the
						// hail's Clean-only gate (F7) needs the opposite, and a
						// predicate that only accepts Clean silently returns a Clean
						// carrier to a caller asking for a Wanted one — which this
						// file did for a round, and the row printed `standing:
						// "clean"` and went red rather than let that pass.
						const wantClean = want.standing !== "not-clean";
						if (wantClean ? standing !== "clean" : standing === "clean") {
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
				// The fight's own clock at the first frame, so the strike's duration
				// is read off the world rather than counted from this loop.
				const t0 = g.world.gameTime;
				const hail = {
					frame: -1,
					comms: null,
					landedFireS: null,
					callsign: null,
				};
				const charge = {
					frame: -1,
					lastExit: null,
					// What the glass and the console said at that frame — the two
					// surfaces #447 ruled a charge is owed, and neither of which
					// this row read before #457.
					painted: null,
					comms: null,
					heat: null,
					landedFireS: null,
					// **The frame body on the frame the offence was charged.** The rule
					// #396 retired filed the frame body — one berth, the one the flight
					// assist happened to call the ship *at* — so this is the retired
					// rule's own answer, read off the game instead of modelled here as
					// a radius around the victim.
					at: null,
					// Where the carrier stood on *its* frame. The one position read
					// at the divert is not where the assault was charged, and a set
					// filed at two instants cannot be checked against a reach measured
					// at one of them; the drift between the two is printed so the
					// reader can see how far apart those instants actually are.
					victim: null,
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
					// Gated on the engagement's own latch, and the readout is built
					// once, inside the branch: `trafficReadout()` maps every contact and
					// every station, and asking it every frame whether anything has
					// landed yet is paying for a report to read one boolean. If the
					// latch lands and no line ever appears, this row goes red with
					// `frame: -1` — which is the failure the row exists to catch.
					if (hail.frame < 0 && g.trafficEngagements.get(key)?.struckOnce) {
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
						charge.at = g.frameBody?.id ?? null;
						charge.lastExit = g.lastExit;
						// **The painted frame, and the console, at the charge frame.**
						// #447: `lastExit` goes to an element the page clips to
						// 1x1, so it is evidence a string was authored and never
						// that a pilot was told. The pixels are read first, because
						// `comms()` drives the console's tab and renders.
						charge.painted = p.chargePixels();
						charge.comms = p.comms();
						charge.landedFireS =
							g.trafficEngagements.get(key)?.landedFireS ?? null;
						charge.heat = g.trafficReadout().legal.heatNow;
						charge.victim = { ...(g.trafficContacts.get(key)?.pos ?? {}) };
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
							// **The strike's own duration, in seconds.** `ASSAULT_FIRE_S`
							// is declared as a share of this figure, so the run that
							// measures the share prints it and a retuner re-reads the
							// denominator here instead of trusting a comment.
							// **Read off the world's clock, not counted from the
							// loop.** `i * dt` is the same number while the stepper is
							// the rig's own, and a different one the moment a frame
							// steps anything else — a duration this file models rather
							// than a duration the game had.
							secondsToDivert: g.world.gameTime - t0,
							// **The same duration in the units the clock counts.** Both
							// figures are the fight's clock; this one counts only the
							// frames something landed, which is what `ASSAULT_FIRE_S`
							// is a share of. Both are printed so the share the constant
							// cites is stated in the units it was measured in.
							landedFireAtDivert:
								g.trafficEngagements.get(key)?.landedFireS ?? null,
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
			/** The game's own standing answer for a carrier, off its own clock. */
			standingFor(key) {
				const record = g.world.system.record;
				return standingMod.carrierStanding(
					record.seed,
					key,
					g.carrierCondition(key).instanceOrdinal,
					g.world.gameTime,
				);
			},
			/**
			 * Hold the tether and the trigger for a bounded number of frames, and
			 * report what the console did.
			 *
			 * **The arm the Clean scene cannot be.** #396's hail is Clean's, by F7 —
			 * a Wanted carrier is a lawful target and a lawful target does not
			 * complain — and the row that reads that has to shoot a carrier whose
			 * standing is not Clean and actually land on it. Landing is
			 * load-bearing: a fight in which nothing hit says nothing about a gate
			 * keyed on the first hit, so `landedFireS` is read off the engagement
			 * and the row is only allowed to pass on a target that carries fire.
			 */
			hitWithoutHail(key, frames) {
				const p = window.__witnessProbe;
				if (!p.tether(key, 1.2)) return { tethered: false };
				const before = p.comms();
				for (let i = 0; i < frames; i++) if (!p.followFiring(key)) break;
				const engagement = g.trafficEngagements.get(key);
				return {
					tethered: true,
					standing: p.standingFor(key),
					landedFireS: engagement?.landedFireS ?? 0,
					before,
					after: p.comms(),
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
			 * the console's own tab binding does, because the rail and the log are built per
			 * tab and neither exists in the DOM until the tab is up.
			 */
			/**
			 * **What the charge painted, read off the canvas** (#447, #457).
			 *
			 * `g.chargedRender` is written inside the draw, so it is a record of
			 * painting and not of paint — #69's mistake, and the one #447 found
			 * this probe repeating with `g.lastExit`. So the frame is differenced
			 * against a same-build control with the notice's clock zeroed: the
			 * pixels that move are the notice's, whatever else the frame is doing,
			 * and no geometry constant is restated up here to find them.
			 *
			 * The tone is read off those pixels rather than asserted as a css
			 * string, because the string is what the draw was *asked* for. And the
			 * isolation is measured rather than assumed: `jitter` is a null
			 * control, two shots with nothing changed between them.
			 */
			chargePixels() {
				const wasView = g.view;
				g.view = "cockpit";
				const overlay = document.getElementById("overlay");
				const c2d = overlay.getContext("2d", { willReadFrequently: true });
				const shot = () => {
					g.render(dt);
					return c2d.getImageData(0, 0, overlay.width, overlay.height).data;
				};
				// Any channel moving past a code is a moved pixel: the notice is
				// drawn with a fading alpha, so its faintest row is a few codes and
				// a threshold tuned to its peak would miss the event it is there
				// to see.
				const diff = (before, after) => {
					let moved = 0;
					let r = 0;
					let gr = 0;
					let b = 0;
					for (let i = 0; i < before.length; i += 4) {
						if (
							Math.abs(before[i] - after[i]) > 8 ||
							Math.abs(before[i + 1] - after[i + 1]) > 8 ||
							Math.abs(before[i + 2] - after[i + 2]) > 8
						) {
							moved++;
							r += before[i];
							gr += before[i + 1];
							b += before[i + 2];
						}
					}
					return {
						moved,
						mean: moved ? { r: r / moved, g: gr / moved, b: b / moved } : null,
					};
				};
				// **The frame has to be settled before it can be differenced.**
				// Measured here with the draw deleted: the first two renders
				// agree, the third moves 1,363 pixels, and every one after that
				// agrees again — a one-off the scene works through, not noise.
				// A control taken across that boundary reports the settle as the
				// subject, and that is what happened: with the notice drawing
				// nothing the row still read 1,363 moved pixels whose mean passed
				// the amber ratio, and went green on a build that painted nothing
				// (sage round 3).
				//
				// So shots are taken until **two** consecutive pairs agree, and
				// the row asserts that they did: the loop is capped, so a scene
				// that never quiets would otherwise hand the control the same
				// one-off with nothing saying so (sage round 4). One agreement is not
				// enough, and that is measured too: the first pair agrees and the
				// next moves the 1,363, so a settle stopping at one hands the
				// whole one-off to the control standing next to it.
				let settle = 0;
				let last = shot();
				let quiet = 0;
				for (; settle < 12 && quiet < 2; settle++) {
					const next = shot();
					quiet = diff(last, next).moved === 0 ? quiet + 1 : 0;
					last = next;
				}
				const shown = last;
				// **A null control, because the isolation is an assumption until
				// it is measured** (sage round 1 on #477). One more shot with
				// nothing changed: whatever a settled frame still moves lands
				// here, beside the reading rather than assumed away, and the row
				// asserts it is a small fraction of what the notice moves.
				const still = shot();
				const jitter = diff(shown, still).moved;
				const kept = g.charged.left;
				g.charged.left = 0;
				// **The measurement is the adjacent pair**, `still` against
				// `control`, so it spans exactly the one frame gap the null
				// control spans (sage round 2). `still` carries the notice, so
				// the colour basis is unchanged.
				const control = shot();
				g.charged.left = kept;
				const measured = diff(still, control);
				// **The record is read after the notice is back**, because the
				// last frame drawn was the control's and `chargedRender` is
				// written by the draw — reading it there returns the null the
				// control painted and says the notice does not exist.
				g.render(dt);
				const render = g.chargedRender ? { ...g.chargedRender } : null;
				g.view = wasView;
				return { ...measured, jitter, settle, settled: quiet >= 2, render };
			},
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
					hailSounds: g.hailSoundCount,
					noneRail: rail?.textContent === "NONE",
				};
			},
			/**
			 * Every berth in this system, measured from where the carrier stood.
			 *
			 * **`from` is a list, because the offence was filed at more than one
			 * instant** — the sustained-fire charge and the strike that opened the
			 * facing are two writes and the carrier moved between them. Checking a
			 * set unioned over two instants against a reach measured at one of them
			 * would go red for the wrong reason, so a berth counts as in earshot if
			 * the transmission reached it from *either* position, and `driftKm` puts
			 * the slack between those positions on the page instead of in a comment.
			 */
			earshot(from) {
				const origins = this.originsOf(from);
				return g.trafficReadout().stations.map((st) => {
					const d = Math.min(...origins.map((o) => this.apartKm(st.pos, o)));
					return {
						id: st.id,
						// The filed list holds keys, not ids, and a row that compares
						// an id against a key is red for a reason that has nothing to
						// do with the law.
						key: st.key,
						type: st.type,
						witnessed: st.witnessed,
						km: d,
						inEarshot: d <= distressMod.DISTRESS_RANGE_KM,
						// A berth the *frame body's* rule could never have filed: the
						// retired rule named one berth, the one the assist called the
						// ship at, so anything else it could not reach at all. Printed
						// for the shape of the scene — the row's own comparison uses the
						// frame body recorded on the charge frame, not this arm.
						beyondFrameBodyReach: d > g.units.NEAR_FAR_KM,
					};
				});
			},
			/**
			 * Kilometres between two world positions.
			 *
			 * Every distance in this file is this arithmetic, and it was written four
			 * times: two copies of a `hypot` differ the way two copies of a constant
			 * do — by a `.z` nobody meant to drop.
			 */
			apartKm(a, b) {
				return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
			},
			/**
			 * What counts as a position to measure from, in one place.
			 *
			 * `earshot` and `driftKm` are always handed the same argument, so the rule
			 * for accepting it has to be one rule: two copies would let the reach be
			 * computed over a set the drift figure did not see.
			 */
			originsOf(from) {
				return (Array.isArray(from) ? from : [from]).filter(
					(o) => o && Number.isFinite(o.x),
				);
			},
			/** How far the victim moved between the two instants it was filed at. */
			driftKm(from) {
				const origins = this.originsOf(from);
				if (origins.length < 2) return 0;
				const apart = (a, b) => this.apartKm(a, b);
				return Math.max(...origins.slice(1).map((o) => apart(o, origins[0])));
			},
			distressRangeKm: distressMod.DISTRESS_RANGE_KM,
			/** The shipped reach, as the build carries it — not this file's copy. */
			stationsInEarshot: distressMod.stationsInEarshot,
			nearFarKm: g.units.NEAR_FAR_KM,
			dematerializeKm: trafficMod.TRAFFIC_DEMATERIALIZE_KM,
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
		// The whole system, measured from where the carrier stood on *each* frame
		// it was filed at. The set is written twice over a strike — once by the
		// sustained-fire charge, once by the divert — and the carrier moves between
		// them, so the reach is applied from both positions and the gap between
		// them is measured rather than asserted (`driftKm` in the payload).
		const origins = [strike?.charge?.victim, strike?.victim];
		const heard = strike?.victim
			? {
					range: p.distressRangeKm,
					nearFar: p.nearFarKm,
					victim: strike.victim,
					// Both charge instants, not just the last one.
					chargeVictim: strike?.charge?.victim ?? null,
					driftKm: p.driftKm(origins),
					stations: p.earshot(origins),
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
	const charge = struck.strike?.charge;
	// The retired rule's own answer, mapped through this system's berths: it filed
	// the frame body, and it filed nobody when the ship had none.
	//
	// **`charge`, not `struck.charge` — and the row refuses a missing one.** The
	// first version of this line read a property the walk never writes, so the
	// retired arm was an empty list, every `every` over it answered true, and
	// `rulesDifferHere` reported the shape of a typo as the shape of the law. An
	// arm that can be silently absent is not an arm.
	const oldRuleFiled = (charge?.at ? [charge.at] : []).flatMap((id) => {
		const st = heard?.stations.find((s) => s.id === id);
		return st ? [st.key] : [];
	});
	check(
		"every berth within earshot of the carrier is filed and no berth outside it is, and the filed set holds whatever the frame body's rule would have filed (#396, amending H5)",
		heard !== null &&
			heard.stations.length >= 2 &&
			heard.stations.every((st) => st.witnessed === st.inEarshot) &&
			struck.after?.legal.witnesses.length ===
				heard.stations.filter((st) => st.inEarshot).length &&
			// The transmission's reach is a widening of the frame body's and not a
			// different set: whatever the retired rule filed, the filed set holds.
			charge !== undefined &&
			struck.after !== null &&
			oldRuleFiled.every((key) => struck.after.legal.witnesses.includes(key)),
		JSON.stringify({
			heard,
			witnesses: struck.after?.legal.witnesses,
			victim: struck.strike?.victim,
			// **What the retired rule would have filed, read off the game.** H5's old
			// reach was not a radius around the pilot — it named the **frame body**,
			// the one berth the flight assist happened to call the ship *at*, which
			// beside a busy station is chosen by distance alone. So the retired rule's
			// answer is that body or nobody, taken from `g.frameBody` on the frame the
			// offence was charged, and not modelled from a distance here.
			frameBodyAtCharge: charge?.at ?? null,
			oldRuleWouldFile: oldRuleFiled,
			// True where the amendment actually changed this system's answer. Printed
			// either way: a row that quietly passes on the agreement and a row that
			// proves the difference are different claims, and this file has called the
			// first one the second. The geometry where the two rules must part is
			// constructed in `tests/distress.test.ts`.
			rulesDifferHere:
				JSON.stringify([...oldRuleFiled].sort()) !==
				JSON.stringify([...(struck.after?.legal.witnesses ?? [])].sort()),
		}),
	);
	// -------------------------------------------------------------------------
	// **The amendment, measured against the rule it replaces.** The row above
	// holds the game to the module, and a berth set that happens to sit inside
	// *both* reaches satisfies it: the frame body's rule and the transmission's
	// would agree there, and a row that cannot tell them apart is not evidence
	// for the one that changed. So the shipped reach is stood up at a geometry
	// where the two disagree — a victim beyond `NEAR_FAR_KM` of the nearest berth
	// and well inside `DISTRESS_RANGE_KM` — and the claim is a strict widening,
	// which the old rule cannot produce at any geometry.
	// -------------------------------------------------------------------------
	const wider = await page.evaluate(() => {
		const p = window.__witnessProbe;
		const g = window.__seelite;
		const berths = g
			.trafficReadout()
			.stations.map((st) => ({ key: st.id, pos: st.pos }));
		if (berths.length < 2) return { enough: false, berths: berths.length };
		const apart = (a, b) => p.apartKm(a, b);
		// A stand-off that is a frame body and a half from the nearest berth: too
		// far for the rule H5 had, a third of the way into the one it has now.
		const origin = {
			x: berths[0].pos.x + p.nearFarKm * 1.5,
			y: berths[0].pos.y,
			z: berths[0].pos.z,
		};
		const heard = p.stationsInEarshot(berths, origin);
		const within = berths.filter(
			(st) => apart(st.pos, origin) <= p.distressRangeKm,
		);
		return {
			enough: true,
			berths: berths.length,
			heard: heard.length,
			// What the rule #396 retired would have filed from the same place.
			frameBody: berths.filter((st) => apart(st.pos, origin) <= p.nearFarKm)
				.length,
			withinRange: within.length,
			// The same answer as the geometry, in the same order — the function is
			// the reach and nothing else.
			matchesGeometry:
				JSON.stringify(heard) === JSON.stringify(within.map((st) => st.key)),
			nearFarKm: p.nearFarKm,
			distressRangeKm: p.distressRangeKm,
			nearestBerthKm: Math.round(apart(berths[0].pos, origin)),
		};
	});
	check(
		"the served build's reach is three frame bodies wide, at a stand-off where the two rules answer differently (evidence about the constant in the bundle — the filing path is the row above, and the discriminating geometry is constructed in tests/distress.test.ts)",
		wider.enough === true &&
			wider.heard >= 1 &&
			wider.heard > wider.frameBody &&
			wider.matchesGeometry === true &&
			wider.heard === wider.withinRange &&
			wider.nearestBerthKm > wider.nearFarKm &&
			wider.nearestBerthKm < wider.distressRangeKm,
		JSON.stringify(wider),
	);
	// -------------------------------------------------------------------------
	// #396 §3: the victim's hail, and the charge that the flight report said
	// was invisible. All three channels, on the frame the first hit landed.
	// -------------------------------------------------------------------------
	check(
		"the rail's HAILS row reads NONE before a single frame is fired (#396: a label that carries a value)",
		struck.strike?.commsBefore?.railPresent === true &&
			struck.strike?.commsBefore?.rail === "NONE" &&
			struck.strike?.commsBefore?.hailSounds === 0 &&
			struck.strike?.commsBefore?.store.length === 0 &&
			!struck.strike?.commsBefore?.logLines?.some((l) =>
				l.includes("cease fire"),
			),
		JSON.stringify({ commsBefore: struck.strike?.commsBefore }),
	);
	check(
		"a Clean carrier hit for the first time hails: the rail names it, the log carries it, and the hail sounds (#396 §3, #546)",
		struck.strike?.hail?.frame >= 0 &&
			struck.strike?.hail?.comms?.rail === struck.strike?.hail?.callsign &&
			struck.strike?.hail?.comms?.logLines?.some((l) =>
				l.includes("cease fire"),
			) === true &&
			struck.strike?.hail?.comms?.hailSounds === 1 &&
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
	// **This row was named "the sustained-fire charge is said in the pilot's own
	// line" and read `g.lastExit`** — a string bound for `#hud`, which the page
	// clips to 1x1. #447 found that false by flying it, and named the row as one
	// of the three places the claim was made. It reads the painted frame now.
	const chargeSeen = struck.strike?.charge;
	const painted = chargeSeen?.painted;
	const chargeEvidence = () =>
		JSON.stringify({
			charge: chargeSeen,
			frames: struck.strike?.frames,
			assaultFireS: struck.assaultFireS,
			wanted: struck.after?.wantedHeat,
		});
	// **Three rows where there was one** (sage round 2). Nine claims behind one
	// boolean say only "the charge row failed", and the earlier arms
	// short-circuit the later ones — which is how two red builds flown against
	// the first version never evaluated the console arm at all.
	check(
		"the charge for sustained fire paints the glass at the frame it lands, in §4's amber (#457)",
		// Pixels moved against a same-build control with the notice's clock
		// zeroed. A figure rather than a boolean, because a notice that paints
		// one pixel is the defect this row exists to catch — and it is read
		// against the null control beside it, so the figure is the notice rather
		// than the frame being restless.
		// **The frame settled**, rather than the loop running out of shots: a
		// capped settle that failed open is how the defect below would come
		// back without anything saying so.
		painted?.settled === true &&
			// The notice's pixels, floor and drift together rather than a floor
			// alone: on a settled frame `jitter` is 0 and a ratio against it says
			// nothing, so the null control is **added** to the floor instead of
			// multiplied into a comparison that degenerates (sage round 4).
			painted?.moved > 200 + painted?.jitter * 20 &&
			// **§4's amber, and not the red the law speaks refusal in.** The two
			// fills differ in how much green stands beside the red, and an
			// ordering like `g > b` is satisfied by both — `FLOOR_TONE_FILL`'s
			// refusal is `rgba(255, 110, 96)`, whose green clears its blue. So
			// the ratio is what settles it, and the bound is calibrated rather
			// than declared. Measured on the settled frame: the amber notice
			// reads g/r **0.764** (194.8 green over 254.9 red) across 2,351
			// moved pixels, and the same draw with the refusal fill spliced in
			// reads **0.427** (108.9 over 254.9) across 2,306. 0.6 sits between
			// the two, and the row was watched red on that spliced build before
			// it was believed. **Both figures are later than the settle above**
			// and were re-measured with it, because the first pair was taken on
			// the instrument that could not tell the notice from the scene
			// settling.
			painted?.mean?.g > painted?.mean?.r * 0.6 &&
			painted?.mean?.r > painted?.mean?.b,
		chargeEvidence(),
	);
	check(
		"the glass and the Communications log say the same charge, and the log keeps it (#457)",
		// The words name the act and the carrier, and carry no figure —
		// `tests/charge-notice.test.ts` holds the template; this holds that the
		// template is what reached the glass.
		/SUSTAINED FIRE ON /.test(painted?.render?.text ?? "") &&
			// Sampled at the charge frame, which this probe never did before
			// #457: it read before the first hit and at the divert.
			chargeSeen?.comms?.logLines?.some((line) =>
				/sustained fire/.test(line),
			) === true &&
			// **And the log still holds it after the notice is gone**, which is
			// the whole claim in "keeps it" and was asserted rather than
			// measured for a round: `commsAfter` is read at the divert, 126
			// frames and well past `CHARGE_NOTICE_S` after the charge, when
			// nothing is on the glass.
			struck.strike?.commsAfter?.logLines?.some((line) =>
				/sustained fire/.test(line),
			) === true,
		chargeEvidence(),
	);
	// **This row was named "the sustained-fire charge is said in the pilot's own
	// line" and read `g.lastExit`** — a string bound for `#hud`, which the page
	// clips to 1x1. #447 found that false by flying it, and named the row as one
	// of the three places the claim was made. The saying is the two rows above,
	// off the painted frame and the console; what is left here is the cost.
	check(
		"the charge for sustained fire lands before the divert and costs Wanted (#396 §2)",
		chargeSeen?.frame >= 0 &&
			typeof chargeSeen?.lastExit === "string" &&
			chargeSeen?.lastExit.includes("sustained fire") &&
			chargeSeen?.heat >= struck.after?.wantedHeat &&
			chargeSeen?.landedFireS >= struck.assaultFireS &&
			// And the whole thing happens before the divert: this is the part of
			// the flight report that was missing, the interval in which the pilot
			// could still have stopped.
			chargeSeen?.frame < struck.strike?.frames,
		chargeEvidence(),
	);
	check(
		"the hail is one line per carrier, not one per hit (#396: the rail says who, not how often)",
		struck.strike?.commsAfter?.store.length === 1 &&
			struck.strike?.commsAfter?.hailSounds === 1 &&
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
	// **The denominator `ASSAULT_FIRE_S` cites, printed on every run.** The constant
	// is declared as a share of how long this scene's tethered beam takes to open a
	// freighter's facing, and a figure a shipped constant is derived from has to be
	// re-readable without a red row to unlock it. Both durations are printed because
	// they are not the same quantity: one is every second the fight ran, the other
	// only the seconds in which something landed, and the share the spec quotes is
	// of the landed pair.
	{
		const f = (x) => (typeof x === "number" ? x.toFixed(1) : "n/a");
		const fight = struck.strike?.secondsToDivert;
		const landed = struck.strike?.landedFireAtDivert;
		console.log(
			`  the strike's beam: ${f(fight)} s of fight to open the facing, ` +
				`${f(landed)} s of it landed — ${
					struck.assaultFireS
				} s of landed fire is ${
					typeof landed === "number"
						? `${((100 * struck.assaultFireS) / landed).toFixed(0)}%`
						: "n/a"
				} of that beam; the victim drifted ${f(
					struck.heard?.driftKm,
				)} km between the two frames it was filed at`,
		);
	}

	// -------------------------------------------------------------------------
	// H7's present tense, the other way round. The rail names a carrier that is
	// being shot at, so the row that proves it is a rail and not a ledger is the
	// one where the pilot *stops*: fly out of the band the fight is fought inside
	// and read the glass back. A jump ends a fight too, and this file already
	// jumps for H6's sake — but the spec's sentence leads with breaking off, and
	// a claim about the console should be read off the console on the path a
	// player actually takes rather than inferred from the one that saves.
	// -------------------------------------------------------------------------
	const brokeOff = await page.evaluate(async () => {
		const p = window.__witnessProbe;
		const g = window.__seelite;
		const keys = [...g.trafficEngagements.keys()];
		const key = keys[0] ?? null;
		if (!key) return { engaged: false, keys };
		const during = p.comms();
		const carrier = g.trafficContacts.get(key);
		const flight = g.trafficEngagements.get(key)?.flight.ship.pos;
		const anchor = carrier?.pos ?? flight;
		// Past the band, three times over, and left there: the fight is ended by
		// range, so this is the pilot doing the leaving rather than this file
		// deleting an entry to watch the console notice.
		g.world.ship.pos = {
			x: anchor.x + p.dematerializeKm * 3,
			y: anchor.y,
			z: anchor.z,
		};
		for (let i = 0; i < 30; i++) p.frame();
		return {
			engaged: true,
			keys,
			during,
			rangeKm: p.apartKm(g.world.ship.pos, carrier?.pos ?? flight),
			dematerializeKm: p.dematerializeKm,
			after: p.comms(),
			gone: !g.trafficEngagements.has(key),
		};
	});
	check(
		"a pilot who breaks off takes the carrier off the rail, and the log keeps what it said (H7's present tense)",
		brokeOff.engaged === true &&
			brokeOff.keys.length === 1 &&
			// Named on the glass while the beam was on it…
			brokeOff.during?.rail !== "NONE" &&
			// …silent once the range ends the fight…
			brokeOff.gone === true &&
			brokeOff.rangeKm > brokeOff.dematerializeKm &&
			brokeOff.after?.rail === "NONE" &&
			brokeOff.after?.noneRail === true &&
			// …and the history is still there, which is the half that separates a
			// rail going quiet from the whole feature being switched off.
			brokeOff.after?.logLines?.some((l) => l.includes("cease fire")) ===
				true &&
			brokeOff.after?.store?.length === brokeOff.during?.store?.length,
		JSON.stringify(brokeOff),
	);

	const trip = await page.evaluate(() => {
		const p = window.__witnessProbe;
		const g = window.__seelite;
		const here = g.world.system.record;
		const d = (a, b) => p.apartKm(a.pos, b.pos);
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
			// The console, read on the same frame as the clearance. Nothing is
			// being shot at any more — the fight ended at the divert and the jump
			// that followed it — which is the other half of a present-tense rail:
			// it has to be able to go back to saying nothing.
			comms: p.comms(),
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
	check(
		"the rail says NONE again once nobody is being shot at, and the log keeps the line (#396: a rail, not a history)",
		// Reached through the shipped jump and not by deleting the engagement by
		// hand: the glass is asked what it shows when the fight is over, and the
		// answer has to come from the game's own ending of it.
		cleared.comms?.rail === "NONE" &&
			cleared.comms?.store.length === 1 &&
			cleared.comms?.logLines?.some((l) => l.includes("cease fire")) === true,
		JSON.stringify({ comms: cleared.comms }),
	);

	// -------------------------------------------------------------------------
	// Last, and for one reason: this search runs the system clock forward by up
	// to half an hour looking for a carrier whose standing is not Clean, and
	// every row above reads heat that half an hour would have decayed. The Clean
	// scene cannot answer it either — a Clean carrier is precisely the one that
	// hails — so the predicate is turned round and the shot is fired at what the
	// law calls a lawful target.
	// -------------------------------------------------------------------------
	const lawful = await page.evaluate(() => {
		const p = window.__witnessProbe;
		const found = p.nearStationContact(
			{ armed: false, standing: "not-clean" },
			1800,
		);
		// The guard answers with the tally it does have. `found.tally` on the
		// object it just refused is a TypeError, which reports a search that came
		// back empty as a failed entry in the script rather than as the empty answer
		// the
		// row is written to report.
		if (!found?.key) return { found: null, search: found?.tally ?? null };
		return {
			found: { key: found.key, km: found.km },
			search: found.tally,
			shot: p.hitWithoutHail(found.key, 30),
		};
	});
	check(
		"a carrier that is not Clean is hit for thirty frames, and none of the three channels moves (#396: the hail is Clean's, by F7)",
		lawful.found !== null &&
			lawful.shot?.tethered === true &&
			lawful.shot?.standing !== "clean" &&
			lawful.shot?.landedFireS > 0 &&
			lawful.shot?.before?.store.length === lawful.shot?.after?.store.length &&
			lawful.shot?.before?.rail === lawful.shot?.after?.rail &&
			lawful.shot?.before?.hailSounds === lawful.shot?.after?.hailSounds,
		JSON.stringify({
			found: lawful.found,
			search: lawful.search,
			shot: lawful.shot,
		}),
	);
} finally {
	await browser.close();
}
exit();
