/**
 * Which one-shot voices may sound at once (#552, after #542's D4).
 *
 * A cap per class, the oldest of a class stolen when a new voice goes over its
 * cap, and a mix cap across all classes where a lower class yields to a
 * higher one. Pure bookkeeping on times the caller passes in, so the same pool
 * runs against a realtime context, an offline render and a headless test.
 *
 * Not CPU: #541 measured the realtime ceiling at 256–512 voices on the M1 Pro.
 * The caps are for a mix that can be heard and a sum that does not clip.
 *
 * A leaf that imports nothing; the classes are whatever strings the caller
 * names, so `audio-cue.ts` owns them and this file does not know them.
 */

export interface Voice<C extends string> {
	readonly id: number;
	readonly cls: C;
	readonly endS: number;
}

export interface Admission {
	/** False when the mix is full of higher classes: the new voice yields. */
	readonly admitted: boolean;
	/** The new voice's id, or -1 when it was not admitted. */
	readonly id: number;
	/** Voices the caller must fade out now to make room. */
	readonly steal: readonly number[];
}

export class VoicePool<C extends string> {
	private voices: Voice<C>[] = [];
	private nextId = 1;

	/**
	 * @param caps     the most voices of each class at once
	 * @param priority every class, highest first
	 * @param mixCap   the most voices of all classes at once
	 */
	constructor(
		private readonly caps: Readonly<Record<C, number>>,
		private readonly priority: readonly C[],
		private readonly mixCap: number,
	) {}

	/** The voices still sounding at `nowS`, oldest first. */
	live(nowS: number): readonly Voice<C>[] {
		return this.voices.filter((v) => v.endS > nowS);
	}

	/**
	 * Ask for a voice of `cls` from `nowS` to `endS`.
	 *
	 * Over the class cap, the oldest voice **of the same class** is stolen. When
	 * the mix is full, the oldest voice of the **lowest** class below `cls`
	 * is stolen instead; with none below, the class's own oldest; with none of
	 * its own either, the new voice is refused. A stolen voice leaves the pool at
	 * once, so the caller's fade is not counted against the next admission.
	 */
	admit(cls: C, nowS: number, endS: number): Admission {
		this.voices = this.live(nowS) as Voice<C>[];
		const steal: number[] = [];
		const take = (victim: Voice<C> | undefined) => {
			if (!victim) return false;
			steal.push(victim.id);
			this.voices = this.voices.filter((v) => v !== victim);
			return true;
		};
		const oldestOf = (c: C) => this.voices.find((v) => v.cls === c);

		if (this.voices.filter((v) => v.cls === cls).length >= this.caps[cls])
			take(oldestOf(cls));
		if (this.voices.length >= this.mixCap) {
			const rank = this.priority.indexOf(cls);
			const lower = [...this.priority.slice(rank + 1)].reverse();
			const victim =
				lower.map(oldestOf).find((v) => v !== undefined) ?? oldestOf(cls);
			if (!take(victim)) return { admitted: false, id: -1, steal };
		}
		const id = this.nextId++;
		// Pushed last, so array order is age order and `oldestOf` reads it.
		this.voices.push({ id, cls, endS });
		return { admitted: true, id, steal };
	}
}
