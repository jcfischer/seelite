import "./public-site.css";
import { mountPublicSite } from "./public-site";
import { countVisit } from "./visit-count";

const page = document.body.dataset.publicPage;
if (page === undefined)
	throw new Error("A public entry must declare data-public-page on body");
mountPublicSite(page);
countVisit("page");
