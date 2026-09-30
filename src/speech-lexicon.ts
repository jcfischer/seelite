/**
 * The words the game's voices say, as ARPAbet (stress 1 primary, 2
 * secondary, 0 none), and text into `speech.ts`'s tokens. Written here word
 * by word for the radio and the music; there is no letter-to-sound rule, so
 * a word not listed is reported rather than guessed at. Each word is
 * numbered, which the duration rules read; a question mark ends a phrase
 * that rises. `[K AA1 B R AH0]` in
 * a text is phonemes, for a word the lexicon lacks.
 */
import { parsePhonemes, type Token } from "./speech";

export const LEXICON: Readonly<Record<string, string>> = {
	A: "AH0",
	ABOARD: "AH0 B AO1 R D",
	ALERT: "AH0 L ER1 T",
	APPROACH: "AH0 P R OW1 CH",
	AND: "AH0 N D",
	ARE: "AA1 R",
	BAY: "B EY1",
	BERTH: "B ER1 TH",
	BOARD: "B AO1 R D",
	BY: "B AY1",
	CARGO: "K AA1 R G OW2",
	CEASE: "S IY1 S",
	CHARGING: "CH AA1 R JH IH0 NG",
	CLEAR: "K L IH1 R",
	CLEARANCE: "K L IH1 R AH0 N S",
	CLEARED: "K L IH1 R D",
	COBRA: "K OW1 B R AH0",
	COMMANDER: "K AH0 M AE1 N D ER0",
	CONTACT: "K AA1 N T AE2 K T",
	CONTRABAND: "K AA1 N T R AH0 B AE2 N D",
	CONTROL: "K AH0 N T R OW1 L",
	DENIED: "D IH0 N AY1 D",
	DIE: "D AY1",
	DOCKING: "D AA1 K IH0 NG",
	DOWN: "D AW1 N",
	DRIVE: "D R AY1 V",
	DROP: "D R AA1 P",
	EIGHT: "EY1 T",
	ENGAGE: "EH0 N G EY1 JH",
	FIRE: "F AY1 ER0",
	FIVE: "F AY1 V",
	FOR: "F AO1 R",
	FOUR: "F AO1 R",
	FREE: "F R IY1",
	FUEL: "F Y UW1 L",
	GOOD: "G UH1 D",
	GRANTED: "G R AE1 N T IH0 D",
	HAVE: "HH AE1 V",
	HELLO: "HH AH0 L OW1",
	HOLD: "HH OW1 L D",
	HOSTILE: "HH AA1 S T AH0 L",
	IN: "IH1 N",
	INCOMING: "IH1 N K AH2 M IH0 NG",
	IS: "IH1 Z",
	JUMP: "JH AH1 M P",
	LANE: "L EY1 N",
	LAUNCH: "L AO1 N CH",
	LOCKED: "L AA1 K T",
	LOW: "L OW1",
	LUCK: "L AH1 K",
	MAYDAY: "M EY1 D EY2",
	MISSILE: "M IH1 S AH0 L",
	NINE: "N AY1 N",
	NO: "N OW1",
	NUMBER: "N AH1 M B ER0",
	ON: "AA1 N",
	ONE: "W AH1 N",
	OR: "AO1 R",
	OUT: "AW1 T",
	OVER: "OW1 V ER0",
	PAD: "P AE1 D",
	PILOT: "P AY1 L AH0 T",
	PIRATE: "P AY1 R AH0 T",
	POLICE: "P AH0 L IY1 S",
	POSITION: "P AH0 Z IH1 SH AH0 N",
	PROCEED: "P R AH0 S IY1 D",
	QUEUED: "K Y UW1 D",
	RANGE: "R EY1 N JH",
	REQUEST: "R IH0 K W EH1 S T",
	ROGER: "R AA1 JH ER0",
	SECTOR: "S EH1 K T ER0",
	SEVEN: "S EH1 V AH0 N",
	SHIELDS: "SH IY1 L D Z",
	SHIP: "SH IH1 P",
	SIX: "S IH1 K S",
	SLOW: "S L OW1",
	SPACE: "S P EY1 S",
	STAND: "S T AE1 N D",
	STATION: "S T EY1 SH AH0 N",
	SYSTEM: "S IH1 S T AH0 M",
	TARGET: "T AA1 R G AH0 T",
	THE: "DH AH0",
	THIS: "DH IH1 S",
	THREE: "TH R IY1",
	TO: "T UW1",
	TRADER: "T R EY1 D ER0",
	TWO: "T UW1",
	UP: "AH1 P",
	VIPER: "V AY1 P ER0",
	WARNING: "W AO1 R N IH0 NG",
	WE: "W IY1",
	WEAPONS: "W EH1 P AH0 N Z",
	WELCOME: "W EH1 L K AH0 M",
	YOU: "Y UW1",
	YOUR: "Y AO1 R",
	ZERO: "Z IH1 R OW0",
};

const DIGITS = [
	"ZERO",
	"ONE",
	"TWO",
	"THREE",
	"FOUR",
	"FIVE",
	"SIX",
	"SEVEN",
	"EIGHT",
	"NINE",
];

/** Text as tokens, and the words the lexicon lacks. Digits are read one by
 *  one, as a radio reads them. */
export function textToTokens(text: string): {
	tokens: Token[];
	unknown: string[];
} {
	const tokens: Token[] = [];
	const unknown: string[] = [];
	const parts = text.match(/\[[^\]]*\]|[A-Za-z']+|\d|[.,!?;:]/g) ?? [];
	let w = 0;
	for (const p of parts) {
		if (p.startsWith("[")) tokens.push(...parsePhonemes(p.slice(1, -1), w++));
		else if (p === "?") tokens.push({ pause: 320, q: true });
		else if (/^[.!]$/.test(p)) tokens.push({ pause: 320 });
		else if (/^[,;:]$/.test(p)) tokens.push({ pause: 140 });
		else {
			const word = /^\d$/.test(p) ? DIGITS[Number(p)] : p.toUpperCase();
			const ph = LEXICON[word];
			if (ph) tokens.push(...parsePhonemes(ph, w++));
			else unknown.push(p);
		}
	}
	return { tokens, unknown };
}
