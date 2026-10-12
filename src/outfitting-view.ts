import { escapeHtml as esc } from "./escape-html";
import { moduleLabel, type OutfittingScreen } from "./outfitting";
import { refusalSentence, type RefusalHold } from "./station-console";
import { EQUIPMENT, FUEL_CR_PER_LY } from "./market";
import type { ModuleRow } from "./module-catalog";

const action = (type: string, name: string, label: string) =>
	`<button type="button" class="lc-station-action" data-live-station-action="${type}" data-live-station-name="${esc(name)}">${label}</button>`;
const stats = (r: ModuleRow) =>
	`${r.massT.toFixed(2)} t · ${r.drawPerS.toFixed(1)} E/s`;
const locked = (g: { ladder: string; rung: number; name: string } | null) =>
	g ? `LOCKED · ${g.ladder.toUpperCase()} ${g.rung} · ${esc(g.name)}` : "";

export function outfittingBody(
	s: OutfittingScreen,
	hold: RefusalHold,
	fuel: { ly: number; capacityLy: number },
) {
	// **Fuel is the first ship row, not a footnote** (hotfix after #869). The
	// slot screen moved it from the old Equipment list to a 9 px line under the
	// preview, and a pilot looking for fuel did not find it there.
	const shortLy = Math.max(0, fuel.capacityLy - fuel.ly);
	const fuelRow = `<div class="lc-outfit-slot lc-outfit-fuel" data-live-fuel><div><small>FUEL · ${FUEL_CR_PER_LY} Cr/LY</small><b>${fuel.ly.toFixed(1)} / ${fuel.capacityLy.toFixed(1)} LY</b><small>${shortLy > 0 ? `${(shortLy * FUEL_CR_PER_LY).toFixed(1)} Cr to fill` : "TANK FULL"}</small></div>${action("buy-fuel", "Fuel", "FILL")}</div>`;
	const slots = s.slots
		.map(
			(
				row,
			) => `<div class="lc-outfit-slot" data-live-slot="${row.key}" data-selected="${s.slot === row.key}">
		<button type="button" class="lc-outfit-pick" data-outfit-slot="${row.key}" aria-pressed="${s.slot === row.key}"><small>${esc(row.kind.toUpperCase())} ${row.size} · ${esc(row.key.toUpperCase())}</small><b>${row.module ? esc(moduleLabel(row.module)) : "EMPTY"}</b><small>${row.row ? stats(row.row) : "Select to fit a module"}${row.module?.variant ? ` · ${esc(row.module.variant)}` : ""}</small></button>
		${row.module && !row.removeReason ? action("remove-module", row.key, "REMOVE") : row.module ? `<small class="lc-station-locked">${esc(row.removeReason === "core-required" ? "REPLACE ONLY" : "HOLD FULL")}</small>` : ""}
		${row.module?.module === "missile-rack" ? `<small>${row.module.ammo ?? 0}/${row.row!.output.missiles} MISSILES</small>${(row.module.ammo ?? 0) < row.row!.output.missiles ? action("buy-missiles", row.key, "REARM") : ""}` : ""}
	</div>`,
		)
		.join("");
	const carried =
		s.retired
			.map(
				(c) =>
					`<div class="lc-outfit-slot" data-live-recovered-fitting="${esc(c.id)}"><span>${esc(c.id)} · ${c.tonnes} t · ${c.saleCr.toFixed(1)} Cr · SELL ONLY</span>${action("sell-recovered", String(c.index), "SELL")}</div>`,
			)
			.join("") +
		s.carried
			.map(
				(c) =>
					`<div class="lc-outfit-slot" data-live-recovered-fitting="${esc(moduleLabel(c.module))}"><button type="button" class="lc-outfit-pick" data-outfit-candidate="${c.id}" ${c.fits ? "" : "disabled"}><b>${esc(moduleLabel(c.module))}</b><small>1 t carried · ${c.saleCr.toFixed(1)} Cr resale</small><small>${c.fits ? locked(c.locked) || "SELECT TO FIT" : "CHOOSE A COMPATIBLE SLOT"}</small></button>${action("sell-recovered", String(c.index), "SELL")}</div>`,
			)
			.join("");
	const stock = s.stock
		.map(
			(c) =>
				`<button type="button" class="lc-outfit-pick lc-outfit-stock" data-outfit-candidate="${c.id}" data-selected="${s.candidate?.id === c.id}" aria-pressed="${s.candidate?.id === c.id}"><b>${esc(moduleLabel(c.module))}<em>${c.row.priceCr.toLocaleString("en-US")} Cr</em></b><small>${stats(c.row)}</small>${c.locked ? `<small class="lc-station-locked">${locked(c.locked)}</small>` : ""}</button>`,
		)
		.join("");
	const delta = s.after
		? `<div class="lc-outfit-deltas" data-live-outfit-deltas><span>ACCEL <b>${s.before.accel.toFixed(3)} → ${s.after.accel.toFixed(3)}</b> km/s²</span><span>TANK <b>${s.before.tankLy.toFixed(1)} → ${s.after.tankLy.toFixed(1)}</b> LY</span><span>JUMP <b>${s.before.jump.toFixed(1)} → ${s.after.jump.toFixed(1)}</b> LY</span><span>CREDIT / RAIDER <b>${s.before.credit.toFixed(2)} → ${s.after.credit.toFixed(2)}</b></span></div>`
		: "";
	let confirm = "";
	if (s.action && s.offer?.accepted) {
		const name = JSON.stringify(
			s.action.type === "buy-module"
				? { slot: s.slot, module: s.candidate!.module }
				: { slot: s.slot, index: "index" in s.action ? s.action.index : 0 },
		);
		confirm = action(
			s.action.type,
			name,
			s.action.type === "buy-module"
				? `BUY & FIT · ${s.candidate!.row.priceCr.toLocaleString("en-US")} Cr`
				: "FIT FROM HOLD",
		);
	} else if (s.offer && !s.offer.accepted) {
		confirm = `<span class="lc-station-locked">${s.candidate?.locked ? locked(s.candidate.locked) : esc(refusalSentence(s.offer.reason, hold))}</span>`;
	}
	const missilePrice = EQUIPMENT.find((e) => e.name === "Missile")!.priceCr;
	return `<div class="lc-outfitting" data-live-outfitting><div class="lc-outfit-panes"><section><h3>SHIP SLOTS</h3><div class="lc-outfit-scroll">${fuelRow}${slots}${carried ? `<h3>FITTINGS IN HOLD · SELL AT 90%</h3>${carried}` : ""}</div></section><section><h3>STATION STOCK · ${esc(s.slot.toUpperCase())}</h3><div class="lc-outfit-scroll">${stock || "No compatible modules here."}</div></section></div><div class="lc-outfit-preview" data-live-outfit-preview><b>${s.candidate ? esc(moduleLabel(s.candidate.module)) : "Select a slot, then a module to compare."}</b>${delta}${s.moved ? `<small>${esc(s.moved)} moves to the hold · 1 t</small>` : ""}${confirm}</div><div class="lc-outfit-services"><span>MISSILES ${missilePrice} Cr each · rearm a fitted rack</span></div></div>`;
}
