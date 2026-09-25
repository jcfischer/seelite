/**
 * Postcards from The Far Between (#406), read off running pages.
 *
 * `tests/postcard.test.ts` holds the recipe's arithmetic. What only a browser
 * can say is here:
 *
 * - the Postcard screen opens on its key, holds the clock and gives it back,
 *   and draws a non-empty card at the canonical size in all three compositions;
 * - **Save image** downloads where the page cannot share a file and shares
 *   where it can, and **Copy postcard link** puts the link on the clipboard;
 * - the link carries its recipe in the fragment and no query, and a page
 *   opened on it rebuilds the same seed, system, moment and view;
 * - that page is read-only: it runs no loop, takes no key, and leaves every
 *   byte of IndexedDB and `localStorage` as it found them — measured against
 *   a store that holds a Commander and a setting, because a probe with nothing
 *   to protect passes by default;
 * - a refused link boots no game and touches nothing either;
 * - no page makes a request anywhere but the origin it was served from, none
 *   carries the recipe, and none is anything but a GET.
 *
 * A default-layout probe (#381 D11): it presses `6`, the shipped Postcard key,
 * because a real press is what "the key opens the screen" is about — and, in
 * the viewer, `z`, `9`, `6` and `w`, the shipped keys a viewer must ignore.
 */
import { mkdirSync, readFileSync } from "node:fs";
import {
	bootedGame,
	guardedOrigin,
	installViewPlacement,
	launchChromium,
	tally,
} from "./probe-guard.mjs";
import { gameUrl, postcardUrl, publicUrl } from "./lib/game-url.mjs";
import {
	PANEL_CARD,
	VIEWER_CARD,
	keepCard,
	setPostcardMode,
	waitViewerCard,
} from "./lib/postcard-shots.mjs";

const ORIGIN =
	process.env.PROBE_ORIGIN ?? process.argv[2] ?? "http://localhost:5173";
const SEED = 47;
const VIEWPORT = { width: 1440, height: 900 };

await guardedOrigin(ORIGIN);
const browser = await launchChromium();
const { check, watch, exit } = tally();
const context = await browser.newContext({
	viewport: VIEWPORT,
	acceptDownloads: true,
});
await context.grantPermissions(["clipboard-read", "clipboard-write"], {
	origin: new URL(ORIGIN).origin,
});

/** Every request any page in the context makes, tagged with the phase. */
const requests = [];
let phase = "boot";
context.on("request", (request) =>
	requests.push({ url: request.url(), method: request.method(), phase }),
);

/** Every byte this origin keeps: `localStorage`, and every IndexedDB store. */
async function storageBytes() {
	const page = await context.newPage();
	watch(page, "storage");
	await page.goto(publicUrl(ORIGIN, "trust"), { waitUntil: "load" });
	const bytes = await page.evaluate(async () => {
		const local = {};
		for (let i = 0; i < localStorage.length; i++) {
			const key = localStorage.key(i);
			local[key] = localStorage.getItem(key);
		}
		const idb = {};
		for (const { name } of await indexedDB.databases()) {
			const db = await new Promise((resolve, reject) => {
				const open = indexedDB.open(name);
				open.onsuccess = () => resolve(open.result);
				open.onerror = () => reject(open.error);
			});
			const stores = {};
			for (const store of db.objectStoreNames)
				stores[store] = await new Promise((resolve, reject) => {
					const tx = db.transaction(store, "readonly");
					const keys = tx.objectStore(store).getAllKeys();
					const values = tx.objectStore(store).getAll();
					tx.oncomplete = () =>
						resolve(keys.result.map((key, i) => [key, values.result[i]]));
					tx.onerror = () => reject(tx.error);
				});
			idb[name] = { version: db.version, stores };
			db.close();
		}
		return JSON.stringify({ local, idb });
	});
	await page.close();
	return bytes;
}

/**
 * Luma statistics of a card `<img>`: the lit share above the band, and a grid
 * over the **whole** card — band included, so a rebuilt card that captions
 * another place differs where the caption is (sage round 1).
 */
const cardPixels = (selector) =>
	async function read(page) {
		return page.evaluate(async (sel) => {
			const img = document.querySelector(sel);
			await img.decode();
			const canvas = document.createElement("canvas");
			canvas.width = img.naturalWidth;
			canvas.height = img.naturalHeight;
			const ctx = canvas.getContext("2d");
			ctx.drawImage(img, 0, 0);
			const h = canvas.height;
			const above = Math.round(h * 0.8);
			const { data } = ctx.getImageData(0, 0, canvas.width, h);
			const cols = 24;
			const rows = 16;
			const grid = new Array(cols * rows).fill(0);
			let lit = 0;
			for (let y = 0; y < h; y++)
				for (let x = 0; x < canvas.width; x++) {
					const i = (y * canvas.width + x) * 4;
					const luma =
						0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
					if (y < above && luma > 24) lit++;
					grid[
						Math.floor((y / h) * rows) * cols +
							Math.floor((x / canvas.width) * cols)
					] += luma;
				}
			const cell = (canvas.width / cols) * (h / rows);
			return {
				width: img.naturalWidth,
				height: img.naturalHeight,
				lit: lit / (canvas.width * above),
				grid: grid.map((v) => v / cell),
			};
		}, selector);
	};
/**
 * Every card and page this probe judges is written under `probe-shots/postcard/`,
 * so a green run can be looked at: a rendered card passing its numbers is not a
 * card anyone has seen.
 */
const SHOTS = "probe-shots/postcard";
mkdirSync(SHOTS, { recursive: true });
const panelCard = cardPixels(PANEL_CARD);
const viewerCard = cardPixels(VIEWER_CARD);
/**
 * The share of grid cells whose mean luma moved by more than ten codes.
 * A share rather than a mean, because a subject that covers a few cells — the
 * hull, in the exterior — is diluted to nothing by a mean over all of them.
 */
const changedCells = (a, b) =>
	a.grid.filter((v, i) => Math.abs(v - b.grid[i]) > 10).length / a.grid.length;

/** A PNG's own width and height, off its IHDR. */
function pngSize(path) {
	const bytes = readFileSync(path);
	const signature = bytes.subarray(0, 8).toString("hex");
	return {
		png: signature === "89504e470d0a1a0a",
		width: bytes.readUInt32BE(16),
		height: bytes.readUInt32BE(20),
		bytes: bytes.length,
	};
}

// ---------------------------------------------------------------------------
// A Commander to protect, and the Postcard screen in a running game.
// ---------------------------------------------------------------------------

const game = await context.newPage();
watch(game, "game");
await installViewPlacement(game);
const gameAt = gameUrl(ORIGIN, { seed: SEED, raider: "off" });
await game.goto(gameAt, { waitUntil: "load" });
await bootedGame(game, 60000);
await game.waitForFunction(
	() =>
		window.__seelite.commanderBoot?.attached() &&
		window.__seelite.postcardPanel &&
		window.__seelite.settings,
	null,
	{ timeout: 30000 },
);
check(
	"a boot with no postcard fragment is the ordinary game",
	await game.evaluate(
		() =>
			window.__seelite.postcardViewer === false &&
			!window.__seelite.postcardViewState,
	),
);
// A setting in `localStorage` and a Commander in IndexedDB: what the viewer
// must not touch.
await game.evaluate(async () => {
	const g = window.__seelite;
	g.settings.set("vignette", g.settings.value.vignette === "on" ? "off" : "on");
	await g.saveFlush("quit");
});
// Stand the ship off the trade station, so the card has a subject.
const framing = await game.evaluate(async () => {
	const g = window.__seelite;
	const station = g.world.system.bodies.find((b) => b.kind === "station");
	return window.__viewAlongAxis(station.id, 2.5);
});
check(
	"the ship is placed off a station for the card",
	framing.actualKm > 1 && framing.actualKm < 5,
	JSON.stringify(framing),
);

phase = "postcard";
const heldBefore = await game.evaluate(() => window.__seelite.clockHeld);
await game.keyboard.press("6");
await game.waitForFunction(
	() => window.__seelite.postcardPanel.state.fragment !== null,
	null,
	{ timeout: 30000 },
);
const opened = await game.evaluate(() => {
	const g = window.__seelite;
	return {
		open: g.postcardPanel.isOpen(),
		held: g.clockHeld,
		mode: g.postcardPanel.state.mode,
		time: g.world.gameTime,
	};
});
check(
	"the Postcard key opens the screen on the view's composition",
	opened.open && opened.mode === "cockpit",
	JSON.stringify(opened),
);
check(
	"the screen holds the clock while it is up",
	heldBefore === false && opened.held === true,
	`before ${heldBefore}, open ${opened.held}`,
);
await game.waitForTimeout(500);
check(
	"a held clock does not move",
	(await game.evaluate(() => window.__seelite.world.gameTime)) === opened.time,
);

const cards = {};
for (const mode of ["clear", "cockpit", "exterior"]) {
	await setPostcardMode(game, mode);
	cards[mode] = {
		...(await panelCard(game)),
		state: await game.evaluate(() =>
			structuredClone(window.__seelite.postcardPanel.state),
		),
	};
	await keepCard(game, PANEL_CARD, `${SHOTS}/card-${mode}.png`);
	if (mode === "cockpit")
		await game.screenshot({ path: `${SHOTS}/screen-in-game.png` });
	check(
		`${mode}: the card is drawn at the canonical size`,
		cards[mode].width === 1800 && cards[mode].height === 1200,
		`${cards[mode].width}x${cards[mode].height}`,
	);
	check(
		`${mode}: the card is not empty`,
		cards[mode].lit > 0.01,
		`${(cards[mode].lit * 100).toFixed(2)}% lit above the band`,
	);
}
const clearVsCockpit = changedCells(cards.clear, cards.cockpit);
const clearVsExterior = changedCells(cards.clear, cards.exterior);
check(
	"the cockpit composition draws the cabin the clear one leaves out",
	clearVsCockpit > 0.1,
	`${(clearVsCockpit * 100).toFixed(1)}% of cells changed`,
);
check(
	"the exterior composition is a different camera",
	clearVsExterior > 0.02,
	`${(clearVsExterior * 100).toFixed(1)}% of cells changed`,
);

// The link, as the screen offers it.
const offered = cards.clear.state;
const link = new URL(offered.link);
check(
	"the recipe rides the fragment, and the link has no query",
	link.search === "" && link.hash === `#${offered.fragment}`,
	offered.link,
);
check(
	"the link is the one a postcard URL is built as",
	offered.link === postcardUrl(ORIGIN, offered.fragment),
);
const names = offered.fragment.split("&").map((pair) => pair.split("=")[0]);
check(
	"the link names the recipe's fields and nothing else",
	JSON.stringify(names) ===
		JSON.stringify([
			"postcard",
			"gen",
			"seed",
			"galaxy",
			"system",
			"t",
			"pos",
			"q",
			"mode",
			"head",
		]),
	names.join(","),
);

// Copy postcard link.
await game.click('#seelite-postcard [data-action="copy"]');
await game.waitForFunction(
	() => window.__seelite.postcardPanel.state.lastCopy !== null,
);
const copied = await game.evaluate(async () => ({
	text: await navigator.clipboard.readText(),
	showing: window.__seelite.postcardPanel.state.link,
}));
check(
	"Copy postcard link puts the link on the clipboard",
	copied.text === copied.showing &&
		copied.text.startsWith(postcardUrl(ORIGIN, "postcard=").slice(0, -1)),
	copied.text.slice(0, 80),
);

// Save image, where the page cannot share a file: a download.
await game.evaluate(() => {
	navigator.canShare = () => false;
});
const [download] = await Promise.all([
	game.waitForEvent("download", { timeout: 20000 }),
	game.click('#seelite-postcard [data-action="save"]'),
]);
const downloaded = pngSize(await download.path());
check(
	"Save image downloads a PNG at the canonical size where sharing is absent",
	downloaded.png && downloaded.width === 1800 && downloaded.height === 1200,
	JSON.stringify(downloaded),
);
check(
	"the file is named for the place and the seed",
	/^the-far-between-[a-z0-9-]+-47\.png$/.test(download.suggestedFilename()),
	download.suggestedFilename(),
);

// Save image, where it can: the share sheet, handed the same PNG.
const shared = await game.evaluate(async () => {
	let got = null;
	const panel = window.__seelite.postcardPanel;
	panel.state.lastSave = null;
	navigator.canShare = (data) => Array.isArray(data?.files);
	navigator.share = async (data) => {
		const file = data.files[0];
		got = { name: file.name, type: file.type, size: file.size };
	};
	document.querySelector('#seelite-postcard [data-action="save"]').click();
	for (let i = 0; i < 100 && panel.state.lastSave === null; i++)
		await new Promise((r) => setTimeout(r, 50));
	return { got, outcome: panel.state.lastSave };
});
check(
	"Save image offers the share sheet where the page can share a file",
	shared.outcome === "shared" &&
		shared.got?.type === "image/png" &&
		shared.got.size > 0,
	JSON.stringify(shared),
);

await game.keyboard.press("Escape");
const closed = await game.evaluate(() => ({
	open: window.__seelite.postcardPanel.isOpen(),
	held: window.__seelite.clockHeld,
}));
check(
	"closing the screen gives the clock back as it found it",
	!closed.open && closed.held === heldBefore,
	JSON.stringify(closed),
);
check(
	"the Postcard screen made no request of its own",
	requests.filter((r) => r.phase === "postcard" && /^https?:/.test(r.url))
		.length === 0,
	requests
		.filter((r) => r.phase === "postcard")
		.map((r) => r.url)
		.slice(0, 3)
		.join(" "),
);
phase = "between";
await game.close({ runBeforeUnload: true });
await new Promise((r) => setTimeout(r, 1500));

// ---------------------------------------------------------------------------
// The viewer, against a store that has something in it.
// ---------------------------------------------------------------------------

const before = await storageBytes();
const protectedBytes = JSON.parse(before);
check(
	"there is a Commander and a setting to protect",
	Object.keys(protectedBytes.local).length > 0 &&
		Object.values(protectedBytes.idb).some((db) =>
			Object.values(db.stores).some((rows) => rows.length > 0),
		),
	`${Object.keys(protectedBytes.local).length} local keys, ${Object.keys(protectedBytes.idb).length} databases`,
);

phase = "viewer";
const recipe = offered.fragment;
const viewer = await context.newPage();
watch(viewer, "viewer");
const viewerAt = postcardUrl(ORIGIN, recipe);
await viewer.goto(viewerAt, { waitUntil: "load" });
await viewer.waitForFunction(
	() =>
		window.__seelite?.postcardViewState?.card &&
		window.__seelite.postcardViewState.rebuiltFragment,
	null,
	{ timeout: 60000 },
);
await waitViewerCard(viewer);
const rebuilt = await viewer.evaluate(() => {
	const g = window.__seelite;
	return {
		viewer: g.postcardViewer,
		rebuilt: g.postcardViewState.rebuiltFragment,
		caption: g.postcardViewState.caption,
		seed: g.world.seed,
		galaxy: g.world.system.record.galaxy,
		system: g.world.system.record.index,
		time: g.world.gameTime,
		pos: [g.world.ship.pos.x, g.world.ship.pos.y, g.world.ship.pos.z],
		frames: g.frames,
		visit: document.querySelector('[data-action="visit"]').href,
		canvasShown: getComputedStyle(g.renderer.domElement).display !== "none",
	};
});
const asked = Object.fromEntries(recipe.split("&").map((p) => p.split("=")));
check(
	"the link opens the read-only viewer",
	rebuilt.viewer === true && !rebuilt.canvasShown,
);
check(
	"the viewer rebuilds the recipe the link carries, byte for byte",
	rebuilt.rebuilt === recipe,
	rebuilt.rebuilt,
);
check(
	"it stands in the named seed, galaxy and system at the named moment",
	rebuilt.seed === SEED &&
		String(rebuilt.galaxy) === asked.galaxy &&
		String(rebuilt.system) === asked.system &&
		Math.abs(rebuilt.time - Number(asked.t)) < 1e-9,
	JSON.stringify({
		seed: rebuilt.seed,
		system: rebuilt.system,
		t: rebuilt.time,
	}),
);
check(
	"and at the named viewpoint",
	asked.pos
		.split(",")
		.every((c, i) => Math.abs(Number(c) - rebuilt.pos[i]) < 1e-6),
	rebuilt.pos.join(","),
);
await keepCard(viewer, VIEWER_CARD, `${SHOTS}/card-rebuilt.png`);
await viewer.screenshot({ path: `${SHOTS}/screen-viewer.png` });
const viewed = await viewerCard(viewer);
// The same instrument on the same scene: the control the two thresholds above
// are read against.
const againstPanel = changedCells(viewed, cards.clear);
check(
	"the rebuilt card is the card that was sent",
	viewed.width === 1800 && viewed.height === 1200 && againstPanel < 0.01,
	`${(againstPanel * 100).toFixed(1)}% of cells changed against the sender's`,
);
check(
	"the rebuilt card carries the sender's caption",
	JSON.stringify(rebuilt.caption) === JSON.stringify(offered.caption),
	JSON.stringify(rebuilt.caption),
);
// **A link, and only a link.** That a New game started from it cannot land on
// the Commander this probe seeded is `beginNewGame`'s refusal of a taken name,
// which `tests/save-store.test.ts` holds ("new game, import and rename each
// refuse a name already taken"); this row claims the address and nothing more.
check(
	"Visit this universe links the overlay's New game for the seed",
	new URL(rebuilt.visit).search === `?seed=${SEED}` &&
		new URL(rebuilt.visit).hash === "",
	rebuilt.visit,
);
// Keys that open a screen, rebind, or fly in the game: none reaches a viewer.
for (const key of ["z", "9", "6", "w", "Escape"])
	await viewer.keyboard.press(key);
await viewer.waitForTimeout(1000);
const still = await viewer.evaluate(() => ({
	frames: window.__seelite.frames,
	time: window.__seelite.world.gameTime,
	screens: [
		"#seelite-settings",
		"#seelite-commander",
		"#seelite-postcard",
	].filter((sel) => document.querySelector(sel)),
}));
check(
	"the viewer runs no loop and does not advance its moment",
	still.frames === rebuilt.frames && still.time === rebuilt.time,
	`frames ${rebuilt.frames} → ${still.frames}`,
);
check(
	"no key opens a screen in the viewer",
	still.screens.length === 0,
	still.screens.join(","),
);
await viewer.evaluate(() => {
	navigator.canShare = () => false;
});
const [viewerDownload] = await Promise.all([
	viewer.waitForEvent("download", { timeout: 20000 }),
	viewer.click('#seelite-postcard-viewer [data-action="save"]'),
]);
const viewerFile = pngSize(await viewerDownload.path());
check(
	"the viewer saves the card at the canonical size",
	viewerFile.png && viewerFile.width === 1800 && viewerFile.height === 1200,
	JSON.stringify(viewerFile),
);
await viewer.close();
phase = "after-viewer";
check(
	"opening a postcard leaves every stored byte unchanged",
	(await storageBytes()) === before,
);

// ---------------------------------------------------------------------------
// Refused links.
// ---------------------------------------------------------------------------

phase = "refused";
const refusals = [
	["damaged", "postcard=1&gen=7&seed=47&junk", "malformed"],
	["from another build", recipe.replace(/&gen=\d+/, "&gen=1"), "other-build"],
	["oversized", `postcard=1&${"x".repeat(600)}`, "too-long"],
];
for (const [label, fragment, reason] of refusals) {
	const page = await context.newPage();
	watch(page, `refused ${label}`);
	const refusedAt = postcardUrl(ORIGIN, fragment);
	await page.goto(refusedAt, { waitUntil: "load" });
	await page.waitForSelector("body[data-postcard-refused]", { timeout: 20000 });
	const seen = await page.evaluate(() => ({
		reason: document.body.dataset.postcardRefused,
		game: "__seelite" in window,
		heading: document.querySelector("h1")?.textContent ?? "",
		play: document.querySelector(".page-content a")?.getAttribute("href"),
	}));
	check(
		`a ${label} link is refused, and no game is booted`,
		seen.reason === reason && seen.game === false && seen.heading.length > 0,
		JSON.stringify(seen),
	);
	await page.close();
}
check(
	"a refused link leaves every stored byte unchanged",
	(await storageBytes()) === before,
);

// ---------------------------------------------------------------------------
// The network, over everything above.
// ---------------------------------------------------------------------------

const origin = new URL(ORIGIN).origin;
const foreign = requests.filter(
	(r) => /^https?:/.test(r.url) && new URL(r.url).origin !== origin,
);
check(
	"no page reached anything but its own origin",
	foreign.length === 0,
	foreign
		.map((r) => r.url)
		.slice(0, 3)
		.join(" "),
);
check(
	"no page sent anything but a GET",
	requests.every((r) => r.method === "GET"),
	requests
		.filter((r) => r.method !== "GET")
		.map((r) => `${r.method} ${r.url}`)
		.slice(0, 3)
		.join(" "),
);
check(
	"no request carried a recipe",
	requests.every((r) => !r.url.includes("postcard=")),
	requests
		.filter((r) => r.url.includes("postcard="))
		.map((r) => r.url)
		.slice(0, 2)
		.join(" "),
);

await context.close();
await browser.close();
exit();
