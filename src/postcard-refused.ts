/**
 * The page a refused postcard link opens on (#406).
 *
 * `entry.ts` reaches this without importing the game: a refused capsule boots
 * nothing and touches no storage, and constructing a `Game` reads
 * `localStorage`. So the refusal is the public site's shell and its words, and
 * the only way on from it is the ordinary Play link.
 */
import "./public-site.css";
import { type PostcardRefusal, postcardRefusalText } from "./postcard";
import { PLAY_LINK, mountPublicNotice } from "./public-site";

export function mountPostcardRefusal(reason: PostcardRefusal): void {
	const text = postcardRefusalText(reason);
	mountPublicNotice({
		modifier: "postcard-refused",
		eyebrow: "A postcard",
		title: text.title,
		dek: text.dek,
		content: PLAY_LINK,
	});
	document.body.dataset.postcardRefused = reason;
}
