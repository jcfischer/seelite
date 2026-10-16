/** Serial, session-long installation state. No renderer, timers or eviction.
 * Reprioritisation affects pending work; an active download is never cancelled.
 * A settled model includes its consumer's mesh refresh, or a terminal failure.
 */
export type ModelState = "pending" | "loading" | "installed" | "failed";
export class ModelQueue {
	private readonly states = new Map<string, ModelState>();
	private order: string[];
	private running?: Promise<void>;
	private readonly waiters = new Set<() => void>();
	constructor(
		private readonly loaders: Readonly<Record<string, () => Promise<void>>>,
		private readonly installed: (id: string) => Promise<void> = async () => {},
		private readonly warn: (id: string, error: unknown) => void = (id, error) =>
			console.warn(
				`${id}: background load failed; keeping the procedural stand-in`,
				error,
			),
	) {
		this.order = Object.keys(loaders);
		for (const id of this.order) this.states.set(id, "pending");
	}
	state(id: string): ModelState {
		const state = this.states.get(id);
		if (!state) throw new Error(`Unknown model: ${id}`);
		return state;
	}
	settled(ids: readonly string[]): boolean {
		return ids.every((id) => ["installed", "failed"].includes(this.state(id)));
	}
	/** Required boot loads use the Retry panel, then adopt their success here. */
	adopt(ids: readonly string[]): void {
		for (const id of ids) {
			this.state(id);
			this.states.set(id, "installed");
		}
		this.notify();
	}
	prioritize(current: readonly string[], next: readonly string[] = []): void {
		this.order = [
			...new Set([...current, ...next, ...Object.keys(this.loaders)]),
		];
		for (const id of this.order) this.state(id);
		this.start();
	}
	wait(ids: readonly string[]): Promise<void> {
		if (this.settled(ids)) return Promise.resolve();
		const done = new Promise<void>((resolve) => {
			const check = () => {
				if (this.settled(ids)) {
					this.waiters.delete(check);
					resolve();
				}
			};
			this.waiters.add(check);
		});
		this.start();
		return done;
	}
	private notify(): void {
		for (const check of this.waiters) check();
	}
	private start(): void {
		this.running ??= Promise.resolve().then(async () => {
			for (;;) {
				const id = this.order.find((id) => this.state(id) === "pending");
				if (!id) break;
				this.states.set(id, "loading");
				try {
					await this.loaders[id]();
					await this.installed(id);
					this.states.set(id, "installed");
				} catch (error) {
					this.states.set(id, "failed");
					this.warn(id, error);
				}
				this.notify();
			}
			this.running = undefined;
		});
	}
}
