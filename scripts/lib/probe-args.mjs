/**
 * How `probe-all` reads its arguments: the target to probe, and the filter that
 * decides whether a run is the whole suite or one probe of it.
 *
 * Separate from the runner because the runner starts a server when imported and
 * these are pure — so they can be tested, which `tests/probe-args.test.ts` does.
 * The failure that matters here is always the same shape: a filtered run that
 * looks like a full one.
 */

/** Flags that consume the token after them; everything else stands alone. */
const TAKES_VALUE = new Set(["--only"]);

/** Missing, or a flag — either way not a pattern. @param {string | undefined} v */
const isMissingOrFlag = (v) => v === undefined || v.startsWith("-");

/**
 * @typedef {object} ProbeArgs
 * @property {string | null} target   the server to probe, or null to start one
 * @property {string | null} only     the filter pattern, if one was given
 * @property {boolean} onlySeen       whether `--only` appeared at all
 * @property {string | null} extra    a second bare token, which is an error
 */

/**
 * Either a refusal or a selection, never a mixture — modelled as a union so a
 * caller cannot reach for `probes` on a run that is not going to happen.
 *
 * @typedef {{refusal: string}} Refusal
 * @typedef {{refusal?: undefined, only: string | null, probes: string[], source?: string}} Selected
 * @typedef {Refusal | Selected} Selection
 */

/**
 * The target and the filter, read once.
 *
 * `onlySeen` is distinct from `only` because "given without a pattern" and "not
 * given" must not both arrive as `null` — that collision let a bare `--only`
 * run the whole suite. Both `--only x` and `--only=x` are accepted; a value
 * starting with `-` is a flag, not a pattern; and any dash-led token is a flag
 * rather than an address.
 *
 * A second bare token is kept in `extra` rather than dropped; `resolveOnly`
 * refuses it, and refuses a first one that does not look like a URL.
 *
 * @param {string[]} argv
 * @returns {ProbeArgs}
 */
export function parseArgs(argv) {
	/** @type {ProbeArgs} */
	const out = { target: null, only: null, onlySeen: false, extra: null };
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a.startsWith("--only=")) {
			out.onlySeen = true;
			out.only = a.slice("--only=".length);
			continue;
		}
		if (TAKES_VALUE.has(a)) {
			out.onlySeen = true;
			if (!isMissingOrFlag(argv[i + 1])) {
				out.only = argv[i + 1];
				i++;
			}
			continue;
		}
		if (a.startsWith("-")) continue;
		if (out.target === null) out.target = a;
		else out.extra ??= a;
	}
	return out;
}

const refuseIfUngated = (probes, gating, label) =>
	probes.some(gating)
		? null
		: {
				refusal:
					`${label} selected ${probes.length} probe(s), all report-only or quarantined. ` +
					"Their exit codes are not verdicts, so the run would assert nothing and still exit 0.",
			};

/**
 * Resolve the selector's exact-name handoff, or return null when it is absent.
 *
 * @param {ProbeArgs} args
 * @param {Record<string, string | undefined>} env
 * @param {string[]} available
 * @param {(file: string) => boolean} gating
 * @param {boolean} inCI
 * @returns {Selection | null}
 */
function resolveExactProbeFiles(args, env, available, gating, inCI) {
	if (env.PROBE_SELECTION !== "1") return null;
	if (env.PROBE_FILES === undefined)
		return { refusal: "PROBE_SELECTION=1 requires PROBE_FILES." };
	if (args.onlySeen || env.PROBE_ONLY)
		return {
			refusal: "PROBE_FILES cannot be combined with --only or PROBE_ONLY.",
		};
	if (inCI)
		return {
			refusal:
				"refusing filtered PROBE_FILES in CI — CI must run the whole suite",
		};

	const requested = [
		...new Set(
			env.PROBE_FILES.split(",")
				.map((file) => file.trim())
				.filter(Boolean),
		),
	];
	if (!requested.length)
		return { refusal: "PROBE_FILES contained no probe names." };
	const unknown = requested.filter((file) => !available.includes(file));
	if (unknown.length)
		return {
			refusal:
				`PROBE_FILES named probe(s) that are not available: ${unknown.join(", ")}. ` +
				`Available: ${available.join(", ")}`,
		};
	const probes = available.filter((file) => requested.includes(file));
	const ungated = refuseIfUngated(probes, gating, "PROBE_FILES");
	if (ungated) return ungated;
	return {
		only: probes.join(","),
		probes,
		source: "PROBE_FILES",
	};
}

/**
 * Resolve the filter and everything that can refuse it, in one place.
 *
 * Returns either a refusal or a selection, so the caller has one exit.
 *
 * A truthiness test on `CI` is not enough — runners and shells export the string
 * `"false"`, and refusing someone who explicitly said they are not in CI is the
 * opposite of the intent.
 *
 * `gating` decides which probes count as a verdict. It is passed in rather than
 * imported so this file stays free of the runner's tables: a filter that selects
 * only report-only or quarantined probes asserts nothing, and finding that out
 * *before* booting a browser is the difference between a refusal and a
 * post-mortem.
 *
 * @param {ProbeArgs} args
 * @param {Record<string, string | undefined>} env
 * @param {string[]} available
 * @param {(file: string) => boolean} [gating]
 * @returns {Selection}
 */
export function resolveOnly(args, env, available, gating = () => true) {
	const inCI = !!env.CI && env.CI !== "false" && env.CI !== "0";
	const exact = resolveExactProbeFiles(args, env, available, gating, inCI);
	if (exact) return exact;
	// Argv wins over the environment, and settles the question either way: a bare
	// `--only` is an error even with `PROBE_ONLY` set, because the caller asked
	// for a filter in this invocation and did not say which.
	const fromArgv = args.onlySeen;
	const raw = fromArgv ? (args.only ?? "") : (env.PROBE_ONLY ?? "");
	const only = raw.trim();
	const source = fromArgv ? "--only" : "PROBE_ONLY";

	if (args.extra)
		return {
			refusal:
				`unexpected argument "${args.extra}" — one target may be given, and ` +
				`"${args.target}" already is. A filter is \`--only <pattern>\`.`,
		};

	// The target must look like one. Catching a second bare token was not enough:
	// `--only=granary birds` has only one, so `birds` became the origin and every
	// probe was pointed at a host by that name — a stray pattern silently read as
	// an address, which is the shape of wrong answer this file keeps meeting.
	if (args.target !== null && !/^https?:\/\//.test(args.target))
		return {
			refusal:
				`"${args.target}" is not a target — a target is a URL like ` +
				`http://localhost:5173. A filter is \`--only <pattern>\`.`,
		};

	if (!only) {
		if (fromArgv)
			return {
				refusal:
					"--only needs a pattern, e.g. --only granary\n" +
					"(refusing rather than running the full suite, which is what this flag is for)",
			};
		return { only: null, probes: available };
	}
	// The env path gets argv's rejection too: `PROBE_ONLY=-5` otherwise reached
	// the matcher and reported "matched none of", blaming the probe list for a
	// malformed variable.
	if (only.startsWith("-"))
		return {
			refusal: `${source}=${only} is not a pattern — it looks like a flag.`,
		};
	if (inCI)
		return {
			refusal:
				`${source} ${only} refused: this is CI, where a filtered run's exit code ` +
				`would report a partial suite as a passing one. Run the whole suite here.`,
		};

	const probes = available.filter((f) => f.includes(only));
	if (!probes.length)
		return {
			refusal: `${source} ${only} matched none of:\n  ${available.join("\n  ")}`,
		};
	const ungated = refuseIfUngated(probes, gating, `${source} ${only}`);
	if (ungated) return ungated;
	return { only, probes, source };
}
