# Stack, assets and network requests

`CLAUDE.md` holds the short version. This file holds the rulings and exceptions.

## Runtime network requests

A browser-playable classic-Elite (1984) trade–fight–explore loop. TypeScript +
Vite + Three.js, static bundle, no backend, no runtime network requests beyond
Counterscale pageview analytics on each public page load, game launch (#569)
and opened postcard link (#714, `src/visit-count.ts`) — and the natural voice's files from this site's own
origin (#604, `src/bundle-fetch.ts`): its manifest when the question is asked
and on each start with the voice on, and its model when the player
chooses it — once per version where the browser keeps it, at every start in
a private window — and YouTube's player for the home trailer, loaded only when
the player presses its poster (click-to-play, 2026-10-03, `src/public-site.ts`)
— and the music's instrument samples, from this site's own origin: a set's
manifest and only the recordings a loaded song plays, each once a session
(2026-10-06, `src/music-samples.ts`). The voice is
the one trained model the game runs and the samples the one recorded asset; the
map's Constraints carry the rulings.

## Stack and asset exceptions

TypeScript, bun for tests, npm-compatible lockfile, biome for formatting,
Playwright for probes. No Python. Procedural everything — no downloaded assets;
audio synthesised via WebAudio, procedural surfaces generated at load. The first
exception is the natural voice (#604), by the principal's ruling in the map's
Constraints: `node scripts/fetch-voice-model.mjs` puts it in
`public/voice-model/` (git-ignored), and `scripts/measure-neural-voice.mjs`
— manual, by the principal's ruling — needs it there; `probe-neural-voice`
gates without it. `public/social-preview.jpg` (#714) is the one tracked image:
a frame of the Docking Waltz film, which the game's own code drew, served only
for the link previews a crawler fetches. No page and no game loads it, and
`src/social-preview.ts` says where it came from. The music's instrument
samples are the other exception, by the principal's ruling of 2026-10-06 in
the map's Constraints — open-licensed (CC0 or CC BY) recordings, chosen by
ear in blind auditions: `scripts/fetch-music-samples.mjs` prepares them into
`public/music-samples/` and records each file's source and checksum, and the
chosen sets are **tracked in Git LFS** (`.gitattributes`). The deploy pulls
them only when it publishes.

**Imagegen textures may ship inside authored GLBs** (principal, 2026-11-08, in
the map's Rulings). Each study's `assets.md` records where its textures came
from, and visual work still closes on the principal's yes.

**Study binaries under `spikes/` are in Git LFS too** (principal,
2026-10-19): every `.blend`, `.glb`, `.png`, `.jpg`, `.webp` and `.bin`
there, because review files are not production assets and a plain blob is in
every clone for good. The exceptions are the study models a headless test
reads, listed in `.gitattributes`; CI pulls no spike objects.
`tests/spike-binaries-lfs.test.ts` fails on a plain study binary and on an
exemption without a reader. Shipped models under `src/models/` stay plain.

**Spike evidence is not committed** (principal, 2026-11-06): any `spikes/`
directory with `evidence` in its name is ignored. Keep captures, sheets and logs
outside the repository, and put the figures and the file names in the receipt.

**LFS objects reach GitHub only through the `pre-push` hook.** This
repository installs no hooks of its own (`core.hooksPath` is global), and a
push that skips hooks (`git push --no-verify`) sends the pointers without
their objects. Ranger's supervisor runs git with hooks off, so it uploads a
branch's LFS objects itself before the branch (the-metafactory/ranger#349,
2026-10-19). By hand, **run
`git lfs push origin <branch>` before `git push`** on a branch that adds or
changes a sample or a study binary. CI checks it:
`scripts/check-lfs-objects.mjs` fails a change whose LFS objects are not on
GitHub, and names each file.
