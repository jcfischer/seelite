import { decodePostcard, isPostcardFragment } from "./postcard";

const query = new URLSearchParams(window.location.search);

// A postcard link carries its recipe in the fragment (#406), and a fragment
// that claims to be one outranks everything else on the URL: the viewer is the
// read-only page, so it is the safe one to land on. **The recipe is parsed
// here, before the game is imported** — a refused capsule must boot no game and
// touch no storage, and building a `Game` already reads `localStorage`.
if (isPostcardFragment(window.location.hash)) {
	const parsed = decodePostcard(window.location.hash);
	if (parsed.ok) await import("./main");
	else (await import("./postcard-refused")).mountPostcardRefusal(parsed.reason);
}
// A bare root is the public threshold. Existing probes and game links carry a
// boot mode; `seed` preserves the overlay probe's deliberate `boot: null` arm.
else if (query.has("boot") || query.has("seed")) await import("./main");
else await import("./public-entry");

export {};
