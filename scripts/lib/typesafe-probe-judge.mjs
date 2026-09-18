const ENDPOINT = "https://api.typesafe.ai/v1/systemone";

/**
 * Create the one server-side TypeSafe call used by the selector.
 * The key stays in the Authorization header and is never returned or logged.
 *
 * @param {{apiKey: string, fetchImpl?: (input: string | URL | Request, init?: RequestInit) => Promise<Response>}} options
 */
export function createTypeSafeProbeJudge({ apiKey, fetchImpl = fetch }) {
	if (!apiKey) throw new Error("TYPESAFE_API_KEY is not set");
	return async ({ state, questions }) => {
		const response = await fetchImpl(ENDPOINT, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${apiKey}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ state, questions, model: "jev-latest" }),
			signal: AbortSignal.timeout(30_000),
		});
		if (!response.ok) {
			throw new Error(`HTTP ${response.status}`);
		}
		return response.json();
	};
}
