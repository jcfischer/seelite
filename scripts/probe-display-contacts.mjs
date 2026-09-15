/** #198: both producers feed live selection, Navigation and the scanner. */
import {
	bootedGame,
	guardedOrigin,
	launchChromium,
	tally,
} from "./probe-guard.mjs";
import { gameUrl } from "./lib/game-url.mjs";

const ORIGIN =
	process.env.PROBE_ORIGIN ?? process.argv[2] ?? "http://localhost:5173";
await guardedOrigin(ORIGIN);
const browser = await launchChromium();
const { check, watch, exit } = tally();
try {
	for (const extra of [
		{},
		{ fleet: true },
		{ combat: 1 },
		{ fleet: true, combat: 1 },
	]) {
		// Named by the parameters' keys, not by a query string: the URL is
		// `gameUrl`'s, and a label that spelled one would copy its rules.
		const label = Object.keys(extra).join("+") || "default";
		const fleet = "fleet" in extra;
		const combat = "combat" in extra;
		const page = await browser.newPage({
			viewport: { width: 1440, height: 900 },
		});
		watch(page);
		await page.goto(gameUrl(ORIGIN, { seed: 42, ...extra }), {
			waitUntil: "load",
		});
		await bootedGame(page);
		const initial = await page.evaluate(() => {
			const g = window.__seelite;
			return {
				contacts: g.contacts.map((c) => ({
					id: c.id,
					name: c.name,
					kind: c.kind,
					velocity: c.velocity,
					legalStatus: c.legalStatus,
					scannerClass: c.scannerClass,
				})),
				bodyIds: g.world.system.bodies.map((b) => b.id),
				selectedIds: g.selectableIds(),
				scannerIds: g.scannerContacts.map((c) => c.id),
				fleetCount: g.fleet.length,
			};
		});
		// Twelve hulls × three variants since #331's voyager. A literal rather
		// than `fleetCount`: that is the producer's own length, and a count read
		// off the producer cannot fail when the producer drops a hull.
		const expected = (fleet ? 36 : 0) + (combat ? 1 : 0);
		check(
			`${label}: producer count and neutral metadata`,
			initial.contacts.length === expected &&
				initial.contacts.every(
					(c) =>
						c.kind === "ship" &&
						c.name &&
						c.legalStatus === null &&
						c.scannerClass === "unknown" &&
						Object.values(c.velocity).every(Number.isFinite),
				),
		);
		check(
			`${label}: contacts selectable and scannable, never generated bodies`,
			initial.contacts.every(
				(c) =>
					initial.selectedIds.includes(c.id) &&
					initial.scannerIds.includes(c.id) &&
					!initial.bodyIds.includes(c.id),
			),
		);
		if (!fleet && !combat) {
			for (const d of await page.evaluate(designationFrames)) {
				check(
					`Target panel paints ${d.expected} within its bounds`,
					d.seen && d.fits && d.changed > 50,
					JSON.stringify(d),
				);
			}
		}
		if (expected) {
			if (fleet) {
				const labels = await page.evaluate(() => {
					const g = window.__seelite;
					const ctx = g.overlayCtx;
					const original = ctx.fillText;
					const names = g.contacts.map((c) => c.name);
					const read = () =>
						ctx.getImageData(0, 0, g.overlay.width, g.overlay.height).data;
					const seen = new Set();
					g.drawMarkers(g.cameraPos());
					const withLabels = read();
					try {
						ctx.fillText = function (text, ...args) {
							if (names.some((name) => text.startsWith(`${name}  `))) {
								seen.add(text);
								return;
							}
							return original.call(this, text, ...args);
						};
						g.drawMarkers(g.cameraPos());
						const without = read();
						let changed = 0;
						for (let i = 0; i < without.length; i += 4)
							if (
								without[i] !== withLabels[i] ||
								without[i + 1] !== withLabels[i + 1] ||
								without[i + 2] !== withLabels[i + 2] ||
								without[i + 3] !== withLabels[i + 3]
							)
								changed++;
						return { namesDrawn: seen.size, changedPixels: changed };
					} finally {
						ctx.fillText = original;
						g.drawMarkers(g.cameraPos());
					}
				});
				check(
					`${label}: unselected ship names paint visible pixels`,
					labels.namesDrawn > 0 && labels.changedPixels > 50,
					JSON.stringify(labels),
				);
			}
			const id = fleet ? initial.contacts[32].id : initial.contacts[0].id;
			// Exercise real key events in both directions at the body's/contact's seam.
			const predecessor =
				initial.selectedIds[
					(initial.selectedIds.indexOf(id) + initial.selectedIds.length - 1) %
						initial.selectedIds.length
				];
			await page.evaluate((id) => {
				window.__seelite.targetId = id;
			}, predecessor);
			await page.keyboard.press("t");
			check(
				`${label}: T selects the contact`,
				await page.evaluate(
					(id) => window.__seelite.targetBody()?.id === id,
					id,
				),
			);
			await page.keyboard.press("g");
			check(
				`${label}: G cycles back`,
				await page.evaluate(
					(id) => window.__seelite.targetId === id,
					predecessor,
				),
			);
			await page.keyboard.press("t");
			await page.waitForFunction(
				(id) =>
					window.__seelite.scannerContacts.some(
						(c) => c.id === id && c.selected,
					),
				id,
			);
			check(
				`${label}: selected contact has a visible scanner glyph`,
				await page.evaluate(
					(id) =>
						Boolean(
							window.__seelite.nearScene.getObjectByName(
								`scanner-contact-diamond-${id}`,
							)?.visible,
						),
					id,
				),
			);
			await page.evaluate(() => {
				const g = window.__seelite;
				g.leftTab = "Navigation";
				g.setHeadLook("left");
			});
			await page.waitForSelector(`[data-live-nav-target="${id}"]`);
			const eta = await page.evaluate((id) => {
				const g = window.__seelite;
				const c = g.contacts.find((c) => c.id === id);
				const row = g.navRows().find((r) => r.id === id);
				return {
					value: row?.etaSeconds,
					actual: g.timeToBody(c),
					text: document.querySelector(`[data-live-nav-target="${id}"]`)
						?.textContent,
					name: c.name,
					speed: g.targetVelocity(),
					velocity: c.velocity,
				};
			}, id);
			check(
				`${label}: Navigation prints the named ship and a finite ETA`,
				Number.isFinite(eta.value) &&
					eta.value >= 0 &&
					Number.isFinite(eta.actual) &&
					eta.text.includes(eta.name) &&
					eta.text.includes("SHIP"),
				JSON.stringify(eta),
			);
			check(
				`${label}: target velocity comes from the contact`,
				JSON.stringify(eta.speed) === JSON.stringify(eta.velocity),
			);
			const estimates = await page.evaluate((id) => {
				const g = window.__seelite;
				const c = g.contacts.find((c) => c.id === id);
				const pos = c.pos;
				const regime = g.regime;
				const throttle = g.throttle;
				// All review hulls boot inside the existing 50 km ETA arrival
				// radius. Move one outside it to exercise both non-zero paths.
				c.pos = {
					...g.world.ship.pos,
					x: g.world.ship.pos.x + 2 * g.cruiseParams.dropRadiusKm,
				};
				try {
					g.navEtaCache.clear();
					const normal = g.navRows().find((row) => row.id === id).etaSeconds;
					const expectedNormal = g.timeToBody(c);
					g.regime = "cruise";
					g.throttle = 1;
					g.navEtaCache.clear();
					const cruise = g.navRows().find((row) => row.id === id).etaSeconds;
					return {
						normal,
						expectedNormal,
						cruise,
						expectedCruise: g.timeToBody(c),
					};
				} finally {
					c.pos = pos;
					g.regime = regime;
					g.throttle = throttle;
					g.navEtaCache.clear();
				}
			}, id);
			check(
				`${label}: non-zero Navigation ETA uses the existing flight and cruise laws`,
				estimates.normal > 0 &&
					Number.isFinite(estimates.normal) &&
					estimates.normal === estimates.expectedNormal &&
					estimates.cruise > 0 &&
					Number.isFinite(estimates.cruise) &&
					estimates.cruise === estimates.expectedCruise,
				JSON.stringify(estimates),
			);
			// Click a different contact (or a body in the one-contact case), then
			// select the row to bind Navigation's click path to the same identity.
			await page.evaluate((id) => {
				window.__seelite.targetId = id;
			}, predecessor);
			// The moving target rebuilds its row as the displayed range changes.
			// Dispatch on the current DOM node, as the Navigation console probe does.
			await page.evaluate(
				(id) =>
					document.querySelector(`[data-live-nav-target="${id}"]`).click(),
				id,
			);
			check(
				`${label}: Navigation row selects the contact`,
				await page.evaluate((id) => window.__seelite.targetId === id, id),
			);
		}
		await page.close();
	}
} finally {
	await browser.close();
}
exit();

/** Read pixels as well as calls; equal names/ranges test cache invalidation. */
function designationFrames() {
	const g = window.__seelite;
	const ctx = g.cockpit.targetInstrument.ctx;
	const fillText = ctx.fillText;
	const base = { ...g.world.system.bodies[0], name: "SAME NAME" };
	const ship = {
		...base,
		kind: "ship",
		shipType: "interceptor",
		legalStatus: null,
		velocity: { x: 0, y: 0, z: 0 },
	};
	const cases = [
		[{ ...base, kind: "star" }, "STAR"],
		[{ ...base, kind: "planet" }, "PLANET"],
		...["trade", "refinery", "shipyard", "outpost"].map((stationType) => [
			{ ...base, kind: "station", stationType },
			`STATION · ${stationType.toUpperCase()}`,
		]),
		[{ ...ship, scannerClass: "unknown" }, "SHIP · INTERCEPTOR · UNKNOWN"],
		[{ ...ship, scannerClass: "hostile" }, "SHIP · INTERCEPTOR · HOSTILE"],
	];
	return cases.map(([target, expected]) => {
		let seen = false;
		let fits = false;
		try {
			ctx.fillText = function (text, x, y, ...args) {
				if (text === expected && y === 78) {
					seen = true;
					fits = x + this.measureText(text).width <= this.canvas.width - 28;
				}
				return fillText.call(this, text, x, y, ...args);
			};
			g.updateInstruments(target, 100, g.velocityReadout());
			const actual = ctx.getImageData(0, 54, ctx.canvas.width, 30).data;
			ctx.fillText = function (text, x, y, ...args) {
				if (y !== 78) return fillText.call(this, text, x, y, ...args);
			};
			g.cockpit.instrumentKey = "";
			g.updateInstruments(target, 100, g.velocityReadout());
			const control = ctx.getImageData(0, 54, ctx.canvas.width, 30).data;
			let changed = 0;
			for (let i = 0; i < actual.length; i += 4)
				if (
					actual[i] !== control[i] ||
					actual[i + 1] !== control[i + 1] ||
					actual[i + 2] !== control[i + 2]
				)
					changed++;
			return { expected, seen, fits, changed };
		} finally {
			ctx.fillText = fillText;
		}
	});
}
