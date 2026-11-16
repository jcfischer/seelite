import { expect, test } from "bun:test";
import {
	fieldCells,
	latticeRocks,
	systemFields,
} from "../../src/asteroid-field";
import { generateGalaxy } from "../../src/galaxy";
import { generateContents } from "../../src/system";
import {
	CANDIDATES,
	LATTICE_CANDIDATES,
	candidateProfile,
	candidateRocks,
	densityAt,
} from "./profiles";

const record = generateGalaxy(0x5ee11e, 0).systems[173];
const plan = systemFields(record, generateContents(record))[0];

test("baseline reproduces the shipped rocks without mutation", () => {
	expect(candidateRocks(record, plan, "baseline")).toEqual(
		latticeRocks(record, plan),
	);
});

test("candidate identity and shape stay independent of filtering order", () => {
	for (const name of CANDIDATES) {
		const profile = candidateProfile(plan.profile, name);
		const all = latticeRocks(record, plan, { ...profile, occupancy: 1 });
		const bySlot = new Map(all.map((r) => [r.slot, r]));
		const rocks = candidateRocks(record, plan, name);
		expect(rocks.length).toBeGreaterThan(0);
		expect(new Set(rocks.map((r) => r.slot)).size).toBe(rocks.length);
		for (const rock of rocks) {
			expect(rock.shapeSeed).toBe(bySlot.get(rock.slot)!.shapeSeed);
			expect(rock.radiusKm).toBe(bySlot.get(rock.slot)!.radiusKm);
		}
		expect(candidateRocks(record, plan, name)).toEqual(rocks);
	}
});

test("lattice candidate rocks remain inside their indexed cells throughout drift", () => {
	const observed = new Set<string>();
	for (const seed of [47, 0x5ee11e, 7]) {
		const systems = generateGalaxy(seed, 0).systems;
		const rare = systems.find((r) =>
			systemFields(r, generateContents(r)).some((p) => p.profile === "rare"),
		);
		expect(rare).toBeDefined();
		for (const record of [systems[173], rare!]) {
			for (const plan of systemFields(record, generateContents(record))) {
				observed.add(plan.profile);
				for (const name of LATTICE_CANDIDATES) {
					const profile = candidateProfile(plan.profile, name);
					const cells = fieldCells(profile);
					for (const rock of candidateRocks(record, plan, name))
						for (const axis of ["x", "y", "z"] as const)
							expect(
								Math.abs(rock.anchor[axis] - cells[rock.slot][axis]) +
									rock.driftKm +
									rock.radiusKm +
									profile.marginKm / 2,
							).toBeLessThanOrEqual(profile.cellKm / 2 + 1e-12);
				}
			}
		}
	}
	expect([...observed].sort()).toEqual(["charted", "rare"]);
});

test("density has separated peaks, a lower centre and an empty outer edge", () => {
	expect(densityAt(-0.48, -0.18, 0.12)).toBeGreaterThan(densityAt(0, 0, 0));
	expect(densityAt(0.42, 0.25, -0.2)).toBeGreaterThan(densityAt(0, 0, 0));
	expect(densityAt(1, 0, 0)).toBe(0);
	for (let i = -12; i <= 12; i++)
		for (let j = -12; j <= 12; j++)
			for (let k = -12; k <= 12; k++) {
				const d = densityAt(i / 10, j / 10, k / 10);
				expect(d).toBeGreaterThanOrEqual(0);
				expect(d).toBeLessThanOrEqual(1);
			}
});

test("expanded candidates increase extent and filter occupancy", () => {
	for (const name of CANDIDATES.filter((n) => n !== "baseline")) {
		const profile = candidateProfile(plan.profile, name);
		expect(profile.semiKm[0]).toBeGreaterThan(
			candidateProfile(plan.profile, "baseline").semiKm[0],
		);
		if (name !== "expanded") {
			const candidates = latticeRocks(record, plan, profile);
			expect(candidateRocks(record, plan, name).length).toBeLessThan(
				candidates.length,
			);
		}
	}
});

test("realised density favours the peaks over sparse regions", () => {
	const profile = candidateProfile(plan.profile, "clusters");
	const cells = fieldCells(profile);
	const occupied = new Set(
		candidateRocks(record, plan, "clusters").map((r) => r.slot),
	);
	const groups = {
		dense: { cells: 0, rocks: 0 },
		sparse: { cells: 0, rocks: 0 },
	};
	for (let slot = 0; slot < cells.length; slot++) {
		const c = cells[slot];
		const d = densityAt(
			c.x / profile.semiKm[0],
			c.y / profile.semiKm[1],
			c.z / profile.semiKm[2],
		);
		const group = d > 0.5 ? groups.dense : d < 0.1 ? groups.sparse : null;
		if (group) {
			group.cells++;
			if (occupied.has(slot)) group.rocks++;
		}
	}
	expect(groups.dense.cells).toBeGreaterThan(0);
	expect(groups.sparse.cells).toBeGreaterThan(0);
	expect(groups.dense.rocks / groups.dense.cells).toBeGreaterThan(
		(3 * groups.sparse.rocks) / groups.sparse.cells,
	);
});

test("box jitter has larger realised RMS anchor displacement on the comparison field", () => {
	const cells = fieldCells(candidateProfile(plan.profile, "clusters"));
	const rms = (name: "clusters" | "broken") => {
		const rocks = candidateRocks(record, plan, name);
		return Math.sqrt(
			rocks.reduce((sum, r) => {
				const c = cells[r.slot];
				return (
					sum +
					(r.anchor.x - c.x) ** 2 +
					(r.anchor.y - c.y) ** 2 +
					(r.anchor.z - c.z) ** 2
				);
			}, 0) / rocks.length,
		);
	};
	expect(rms("broken")).toBeGreaterThan(rms("clusters"));
});
