/**
 * The domain tags: the second-level stream split, per `galaxy-generation.md` §1.
 *
 * **A leaf, and that is the point.** These are eleven integers, and every module
 * that draws a seeded number needs them — including `market.ts`, which has no
 * other business with the galaxy generator. Living in `galaxy.ts` they dragged
 * the whole of system generation into anything that wanted one constant, which
 * is the dependency shape `CLAUDE.md`'s leaf discipline exists to prevent. This
 * file imports nothing.
 */

/**
 * The second-level stream split, per spec §1.
 *
 * Safe to extend, unsafe to renumber. Every existing seed's output is a
 * function of these values.
 */
export const DOMAIN = {
	POS: 1,
	NAME: 2,
	POLITY: 3,
	BODIES: 4,
	STATIONS: 5,
	DESC: 6,
	/** The new-game arrival bearing (`system.ts`). Not in the spec's list of
	 *  six: it was added because reusing `POS` for it silently correlated the
	 *  bearing with the system's own position — the first draw of a replayed
	 *  stream is the same number both times. Adding a tag is the safe operation
	 *  this table was designed for; reusing one is the unsafe one. */
	ARRIVAL: 7,
	/** The per-station flags — today just `blackMarket` (`station-types.md`
	 *  §5.3). Its own tag rather than a draw inside `STATIONS`, because that
	 *  stream is consumed in station order and an inserted draw re-places every
	 *  station after it. */
	STATION_FLAGS: 8,
	/** Station spin (`station-types.md` §8.2). Separate from `STATION_FLAGS`
	 *  rather than sharing it: `spinRpm` is kept conditionally on type, so a
	 *  third flag added later would shift it — reproducing inside one tag
	 *  exactly the coupling the tags exist to escape. */
	STATION_SPIN: 9,
	/** The station market (`economy-trade.md` §5.1): the fluctuation byte and
	 *  the phase that staggers one system's stations. Its own tag for the reason
	 *  the two above have theirs — the market is drawn per station and per
	 *  epoch, and folding it into `STATION_FLAGS` would make a market a function
	 *  of how many flags a station happens to carry. */
	MARKET: 10,
	/** Proper station names. One sub-stream per fixed station-type slot, so an
	 *  absent refinery cannot hand its name to the shipyard and a collision
	 *  redraw cannot advance a sibling's stream. */
	STATION_NAME: 11,
	/** The per-station berth draw (`docking.md` §13.2): today only which side an
	 *  outpost's second berth is on. Its own tag rather than a draw inside
	 *  `STATION_FLAGS` for that table's own reason — a flag added later would
	 *  shift it, reproducing inside one tag exactly the coupling the tags exist
	 *  to escape. */
	STATION_BERTHS: 12,
	/** The per-station assembly draw: the plan a wave-function-collapse form
	 *  solves its modules onto (`station-types.md` §7.1). Its own tag rather
	 *  than a read of `STATION_BERTHS`, which is what #255 shipped for the
	 *  trade Assembly and what sage asked to split there: a form whose shape
	 *  and whose berth side come from one number cannot vary one without the
	 *  other. */
	STATION_ASSEMBLY: 13,
	/** A cruise leg's raider encounter (`raider-slots.ts`, #324): whether one
	 *  comes, which slot, where and when. Split again by the leg, so a leg's
	 *  draw moves nothing else in the system and no two legs share one. */
	ENCOUNTER: 14,
	/** A destroyed raider's cargo drop (`raider-wreck.ts`, #324 part d): how
	 *  many canisters and of what. Split again by the carrier and the second
	 *  of the kill, so no two kills share a draw. */
	CARGO_DROP: 15,
	/** The pirate sensor relay's placement (`pirate-relay.ts`, #43): which way
	 *  along the watched station's orbit it stands, how far, and how far off
	 *  the plane. Its own tag, so a relay draw moves no station or berth. */
	RELAY: 16,
	/** An ordinary carrier's standing (`carrier-identity.md` §2, #362): its
	 *  rotation phase and the draw per rotation. Split by the carrier key and
	 *  the instance, so a replacement draws its own timeline (H1). */
	CARRIER_STANDING: 17,
	/** An ordinary carrier's hold (`carrier-identity.md` §3, #362): what it
	 *  carries on one voyage. Split by the key, the instance and the voyage. */
	CARRIER_MANIFEST: 18,
	/** An engaged carrier's flight (#362): the draws its combat controller makes
	 *  for manoeuvre durations and pull axes. Split by the key and the instance,
	 *  so a replacement does not fly its predecessor's evasion. */
	TRAFFIC_ENGAGEMENT: 19,
} as const;

export type DomainName = keyof typeof DOMAIN;
