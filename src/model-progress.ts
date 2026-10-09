/** `GLTFLoader`'s `onProgress`: bytes received of a model, and its total (0
 *  when the response has no length). */
export type ModelProgressListener = (event: ProgressEvent) => void;

/** One required model's download, memoised by its module
 *  (`prepareCoriolisModel`, `prepareCockpitModel`). */
export type ModelLoader = (onProgress?: ModelProgressListener) => Promise<void>;

/**
 * The boot's model download as one share (#833): received bytes over total
 * bytes across every model the boot needs, from `GLTFLoader`'s `onProgress`.
 *
 * **`null` until every model still downloading has a total.** Totals arrive
 * one model at a time, so a sum over the models heard from so far grows its
 * denominator as each one starts, and the bar would run backwards. A response
 * with no length (`lengthComputable` false, which three reports as a total of
 * 0) leaves the share unknown for the whole attempt, and the bar is drawn
 * without a value.
 *
 * **A model that resolved counts as received, with or without an event.** A
 * cached response can complete with no progress event at all; such a model has
 * no byte count to add, so it leaves the sum rather than holding it at null.
 *
 * **Below 100% until every model has resolved**, and never lower than it has
 * read within one attempt. A body larger than its `Content-Length` counts as
 * its total: three reads the total from that header and counts the body as
 * the browser hands it over, so a content-encoded response would read high
 * and stall at the clamp. Neither production model was sent encoded when
 * #840 was reviewed (the headers are quoted in its round 2 response), so the
 * clamp is a guard there; a host that compresses `model/gltf-binary` would
 * make it the case. A retry starts a new instance.
 */
export class ModelProgress {
	private readonly parts = new Map<
		string,
		{ loaded: number; total: number; done: boolean }
	>();
	private shown = 0;

	constructor(ids: readonly string[]) {
		for (const id of ids)
			this.parts.set(id, { loaded: 0, total: 0, done: false });
	}

	report(id: string, loaded: number, total: number): void {
		const part = this.part(id);
		part.loaded = loaded;
		part.total = total;
	}

	complete(id: string): void {
		const part = this.part(id);
		part.done = true;
		if (part.total > 0) part.loaded = part.total;
	}

	/** The share received, 0–1, or `null` while it cannot be known. */
	fraction(): number | null {
		const parts = [...this.parts.values()];
		if (parts.every((p) => p.done)) return (this.shown = 1);
		if (parts.some((p) => !p.done && p.total <= 0)) return null;
		let loaded = 0;
		let total = 0;
		for (const p of parts) {
			if (p.total <= 0) continue;
			loaded += Math.min(p.loaded, p.total);
			total += p.total;
		}
		const share = Math.min(loaded / total, BELOW_DONE);
		this.shown = Math.max(this.shown, share);
		return this.shown;
	}

	private part(id: string) {
		const part = this.parts.get(id);
		if (!part) throw new Error(`ModelProgress: no model "${id}"`);
		return part;
	}
}

/** The most a download still in flight reads: the last bytes are not the
 *  parse, and 100% is the promise that the game is about to start. */
const BELOW_DONE = 0.99;
