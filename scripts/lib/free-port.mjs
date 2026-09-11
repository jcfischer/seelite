/**
 * A port nobody is already serving on, from the OS.
 *
 * **Vite's own `port: 0` is not honoured — it falls back to 5173**, which is
 * exactly the wrong port to land on: it is the developer's `npm run dev`
 * default and the fallback baked into every probe that reads neither knob.
 * Serving there makes two failures invisible at once — a probe ignoring
 * `PROBE_ORIGIN` would quietly probe the runner's own server and pass, and a
 * suite run beside a dev server would quietly probe that one instead. Three
 * probes were misdiagnosed that way while `probe-all` was being written.
 *
 * So the port is taken from the OS and the caller pins it with `strictPort`,
 * and a probe reaching for 5173 fails loudly instead of being right by
 * accident.
 *
 * **Its own module because it has two callers and no home.** `probe-all.mjs`
 * had it, `tests/probe-guard.test.ts` copied it with a comment saying it was a
 * copy, and the vite workaround above is the thing a future fix would have to
 * find in both (#296 review). It is a plain function — importing it does not
 * boot a runner, which is why the test could not simply import the runner's.
 */
export async function freePort() {
	const net = await import("node:net");
	return new Promise((resolve, reject) => {
		const probe = net.createServer();
		probe.on("error", reject);
		probe.listen(0, "127.0.0.1", () => {
			const { port } = probe.address();
			probe.close(() => resolve(port));
		});
	});
}
