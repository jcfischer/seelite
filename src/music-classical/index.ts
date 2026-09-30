/**
 * #589's classical set-pieces, by the id the sound set loads each under, with
 * its length in seconds. A listening pass for the grilling: nothing in the
 * game plays these yet, and where each one plays is what #589 decides.
 */
import type { Song } from "../music-score";
import { BACH_AIR, BACH_AIR_SECONDS } from "./bach-air";
import { JESU_JOY, JESU_JOY_SECONDS } from "./bach-jesu-joy";
import { WACHET_AUF, WACHET_AUF_SECONDS } from "./bach-wachet-auf";
import { BRUCKNER_ADAGIO, BRUCKNER_ADAGIO_SECONDS } from "./bruckner-7-adagio";
import { CATHEDRALE, CATHEDRALE_SECONDS } from "./debussy-cathedrale";
import { CLAIR_DE_LUNE, CLAIR_DE_LUNE_SECONDS } from "./debussy-clair-de-lune";
import { NUAGES, NUAGES_SECONDS } from "./debussy-nuages";
import { DVORAK_LARGO, DVORAK_LARGO_SECONDS } from "./dvorak-largo";
import { MOUNTAIN_KING, MOUNTAIN_KING_SECONDS } from "./grieg-mountain-king";
import { MARS, MARS_SECONDS } from "./holst-mars";
import { NEPTUNE, NEPTUNE_SECONDS } from "./holst-neptune";
import { SATURN, SATURN_SECONDS } from "./holst-saturn";
import { GNOSSIENNE, GNOSSIENNE_SECONDS } from "./satie-gnossienne-1";
import { GYMNOPEDIE, GYMNOPEDIE_SECONDS } from "./satie-gymnopedie-1";
import { ZARATHUSTRA, ZARATHUSTRA_SECONDS } from "./strauss-zarathustra";

/** Every work: its song and how long its excerpt runs. */
export const CLASSICAL_WORKS: Readonly<
	Record<string, { readonly song: Song; readonly seconds: number }>
> = {
	"holst-mars": { song: MARS, seconds: MARS_SECONDS },
	"holst-saturn": { song: SATURN, seconds: SATURN_SECONDS },
	"holst-neptune": { song: NEPTUNE, seconds: NEPTUNE_SECONDS },
	"strauss-zarathustra": { song: ZARATHUSTRA, seconds: ZARATHUSTRA_SECONDS },
	"bruckner-7-adagio": {
		song: BRUCKNER_ADAGIO,
		seconds: BRUCKNER_ADAGIO_SECONDS,
	},
	"dvorak-largo": { song: DVORAK_LARGO, seconds: DVORAK_LARGO_SECONDS },
	"satie-gymnopedie-1": { song: GYMNOPEDIE, seconds: GYMNOPEDIE_SECONDS },
	"satie-gnossienne-1": { song: GNOSSIENNE, seconds: GNOSSIENNE_SECONDS },
	"bach-air": { song: BACH_AIR, seconds: BACH_AIR_SECONDS },
	"bach-wachet-auf": { song: WACHET_AUF, seconds: WACHET_AUF_SECONDS },
	"bach-jesu-joy": { song: JESU_JOY, seconds: JESU_JOY_SECONDS },
	"debussy-nuages": { song: NUAGES, seconds: NUAGES_SECONDS },
	"debussy-cathedrale": { song: CATHEDRALE, seconds: CATHEDRALE_SECONDS },
	"debussy-clair-de-lune": {
		song: CLAIR_DE_LUNE,
		seconds: CLAIR_DE_LUNE_SECONDS,
	},
	"grieg-mountain-king": {
		song: MOUNTAIN_KING,
		seconds: MOUNTAIN_KING_SECONDS,
	},
};

/** Every work's song by its id, as `renderInPage` loads them. */
export const CLASSICAL_SONGS: Readonly<Record<string, Song>> =
	Object.fromEntries(
		Object.entries(CLASSICAL_WORKS).map(([id, w]) => [id, w.song]),
	);
