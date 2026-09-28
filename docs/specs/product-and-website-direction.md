# The Far Between: product and website direction

Author: Codex / Ivy · 2026-09-19  
Status: principal-approved direction  
Decision node: [The Far Between as a game and a place: product direction and the quiet website](https://github.com/jcfischer/seelite/issues/407).

## Product promise

> You find yourself at the helm of a spacecraft in a galaxy unlike our own.
> There's work to be done, missions to be flown, trade and exploration to be
> done and there are people out there that don't like you. And maybe, there's
> more...

The Far Between is for people who want the texture and systems of a classic
open space game without a grind, a wiki, or an obligation to complete a
campaign. It starts immediately in a browser. Its surface is readable; its
world has enough depth to reward attention.

### Design principles

1. **A life in motion, not engagement maintenance.** The world remembers work,
   damage, requests, relationships and discoveries. It has no streaks, daily
   rewards, or checklist pressure.
2. **Useful work teaches the game.** The first session offers an optional,
   diegetic first useful day: launch, fly a small job, dock, and meet trade or
   trouble. Thereafter, guidance is available on demand and never becomes a
   compulsory tutorial track.
3. **Depth comes from consequences.** Prefer completing or deepening a loop a
   pilot can fly and live through over adding an unconnected feature category.
4. **The mystery is a current, not homework.** The Rama expedition is optional.
   Its clues emerge through ordinary frontier work and it never gates trade,
   combat, exploration, or progression.
5. **Private and immediate are product qualities.** Browser play, local and
   portable saves, no login, and nothing tracked beyond Counterscale pageviews
   (#569) are strengths, not omissions.

## Player journey

| Moment | What the player experiences | What it must not require |
| --- | --- | --- |
| First visit | A short atmospheric threshold with an unmistakable **Play now** action | Registration, consent funnels, a launcher, or a marketing maze |
| First useful day | Optional in-world guidance through launch, a useful flight, docking, and trade or trouble | A mandatory tutorial or prior lore study |
| First hour | A legible cockpit, concise manual, ordinary work, trade, travel, exploration and danger that may be chosen or avoided | An encyclopedia, a prescribed build, or one mandatory activity |
| Returning play | A frontier where past work has left marks and new work follows from state | Daily attendance, streaks, chores, or reset-driven progression |
| Deeper play | An optional trail from ordinary work toward the Rama expedition | Giving up sandbox play or completing story content to progress |

A satisfying first public release lets a new pilot start immediately, complete
useful frontier work, see a consequence persist, choose to follow the optional
mystery, and leave with a postcard. It does not need feature breadth to pretend
to be complete.

## The quiet public place

The home page is a brief atmospheric threshold, not a marketing funnel and not
an unannounced redirect into the game. **Play now** is its primary action.

| Page | Its one job |
| --- | --- |
| Play | Start the game immediately and describe no more than is needed to begin. |
| About the Far Between | State the promise, the solo browser form, and the game's human scale. |
| Field Notes | Publish occasional postcards, selected screenshots, release notes, or worthwhile development observations. |
| Manual | Offer concise, searchable help for flying and systems without replacing discovery. |
| Trust | State the privacy and local-data promise in plain language. |
| Credits | Name the people, influences, licenses and acknowledgements that deserve attribution. |

There is no news feed, lore encyclopedia, press room, community hub, or content
cadence. Field Notes appears when there is meaningful work to show; it is not a
second content treadmill. [Postcards from The Far Between](https://github.com/jcfischer/seelite/issues/406)
supplies local image export and scene-recipe links, not a hosted gallery.

### Voice and canon boundary

The voice is quiet frontier: vast distance, human-scale instruments, restrained
prose, and inherited classic-spaceflight DNA without clone claims. Public
flavour may evoke distance, ordinary work, instruments, unease, and the sense
that there may be more. Named story facts, discoveries, and resolutions remain
for play. Field Notes may discuss development and show scenes, but it is not a
canonical spoiler channel.

## Trust, feedback and sustainability

The Trust page promises:

- no accounts, cookies, or advertising;
- Counterscale pageview analytics on each public page load and each game
  launch — the request arrives with the IP address and browser headers, and
  Counterscale records the path, the referrer, browser, device type and
  country but not the IP — and nothing the game does after launch leaves the
  machine;
- saves are local and portable; and
- feedback leaves a player's machine only through a deliberately chosen
  external channel.

The project learns through direct feedback, opt-in reports where justified, and
conversations—not behavioural telemetry. It is non-commercial by default.
Voluntary support may later be considered only outside the play loop. Ads,
subscriptions, pay-to-progress, and account-gated access are excluded unless
the principal explicitly redraws this product promise.

**The principal redrew one line of it on 2026-09-28 (#569):** *"I just want
to see how many people are playing, so counterscale on public pages and launch
is enough."* This promise said no tracking, analytics or runtime network calls
at all. Now a production build loads the principal's self-hosted Counterscale
counter once per public page and once per game launch, under two site ids so
the two are told apart. Each request arrives with the IP address and
browser headers; upstream Counterscale records path, referrer, user agent,
browser, device type and country, and not the IP. It sets no cookie and
stores nothing in the browser. `src/visit-count.ts`
owns the mechanism.

## Development horizons

### Now — make one returnable frontier life real

- The branded front door and the minimal public site.
- The optional first useful day.
- Ordinary work with visible, persistent consequences.
- The first optional expedition episode, where ordinary work can begin to lead
  toward Rama, without making it a gate.
- Local postcards and the small sharing surface already bounded by #406.

### Next — deepen the loops already alive

Add variation, relationships, consequence, authored situations, and discovery
only where each makes the existing flight, work, trade, combat, exploration, or
story loops more meaningful. A new system needs a lived consequence before it
earns priority.

### Later — consciously deferred breadth

Broad campaigns, social infrastructure, hosted user content, public profiles,
expansive lore, large-scale faction simulation, and other wide systems remain
later questions. They are not prerequisites for the release above.

## Follow-on work

The following becomes sharp after this direction:

1. **Give a new pilot their first useful day** — a bounded, optional,
   diegetic onboarding slice that uses real flight and work rather than a
   separate tutorial mode.
2. **Build the quiet public threshold** — the Play, About, Field Notes,
   Manual, Trust and Credits structure with a direct route into the static
   game; no CMS, account system, or feed, and no analytics beyond #569's
   Counterscale pageviews.
3. **Publish the first expedition story contract** — the separate, optional
   story decision in [An expedition story: ordinary frontier work leads to Rama](https://github.com/jcfischer/seelite/issues/338).
4. **Build postcards** — the already bounded local export and scene-recipe
   work in #406.

These are distinct: the website is not a story-delivery system, postcards do
not create hosted social state, and onboarding does not replace free play.

## Non-goals

This direction does not introduce accounts, cloud saves, multiplayer, public
profiles, hosted galleries, behavioural analytics, advertising, subscriptions,
pay-to-progress, account-gated play, daily content obligations, a lore wiki, or
a compulsory campaign.
