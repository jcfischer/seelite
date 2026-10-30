import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fieldRocks, systemFields } from "../src/asteroid-field";
import { SURVEY_LIFETIME_H } from "../src/deposit-state";
import { rockArchetype } from "../src/field-lod";
import { generateGalaxy } from "../src/galaxy";
import { beamHit } from "../src/rock-extraction";
import { decodeRockHeightfields, radiusAt } from "../src/rock-heightfields";
import { rockContents, SURVEY, surveyReading } from "../src/rock-survey";
import {
	edgeAngleOff,
	isRockTargetId,
	resolveRock,
	rockDirectionNow,
	rockLocalVector,
	rockTargetId,
} from "../src/rock-target";
import { generateContents } from "../src/system";
import { range } from "../src/units";
import { add, length, normalizeOr, scale, sub, v3 } from "../src/vec3";
import { gameMethods } from "./lib/game-methods";

const heightfields = decodeRockHeightfields(
	readFileSync("src/models/rock-heightfields.bin"),
);
const record = generateGalaxy(0x5ee11e, 0).systems[173];
const plan = systemFields(record, generateContents(record))[0];
const rocks = fieldRocks(record, plan);
const fields = [{ plan, rocks }];
const ctx = {
	canvas: { width: 512, height: 256 },
	save() {},
	restore() {},
	setLineDash() {},
	beginPath() {},
	arc() {},
	stroke() {},
	fillText() {},
	clearRect() {},
	fillRect() {},
	strokeRect() {},
	measureText: () => ({ width: 0 }),
};
const bindings = {
	ROCK_ASSETS: { heightfields },
	rockArchetype,
	radiusAt,
	rockDirectionNow,
	rockLocalVector,
	rockContents,
	surveyReading,
	SURVEY_LIFETIME_H,
	isRockTargetId,
	normalizeOr,
	sub,
	length,
	SURVEY,
	edgeAngleOff,
	range,
	duration: () => "CALC",
	relativeLabel: () => "",
	targetDesignation: () => "ROCK",
};

describe("survey surface and target instrument (node #1148)", () => {
	test("DEEP lies on the laser-cut heightfield within one cell across archetypes and spin", () => {
		const seen = new Set<number>();
		for (const rock of rocks) {
			const archetype = rockArchetype(rock);
			const contents = rockContents(record.seed, plan.slot, plan.profile, rock);
			if (!contents.deepDir || seen.has(archetype)) continue;
			seen.add(archetype);
			for (const gameTime of [0, 37.5, 3600]) {
				const ref = resolveRock(
					fields,
					rockTargetId(plan, rock.slot),
					v3(),
					gameTime,
				);
				if (!ref) throw new Error("Missing fixture rock");
				const subject = Object.assign(
					Object.create(
						gameMethods(["drawDeepDepositCue", "rockShape"], bindings),
					),
					{
						world: { gameTime },
						targetId: ref.id,
						rockRef: () => ref,
						rockContentsOf: () => contents,
						rockDepositRow: () => ({ surveyedAt: gameTime }),
					},
				);
				const dir = rockDirectionNow(ref, contents.deepDir, gameTime);
				const camera = add(
					ref.pos,
					v3(rock.radiusKm * 2, rock.radiusKm, rock.radiusKm * 3),
				);
				let drawnDir = v3();
				subject.drawDeepDepositCue(
					ctx,
					camera,
					(direction: ReturnType<typeof v3>) => {
						drawnDir = direction;
						return { x: 100, y: 100, on: true };
					},
				);
				const h = heightfields.fields[archetype];
				const expectedRadius = radiusAt(h, [
					contents.deepDir.x,
					contents.deepDir.y,
					contents.deepDir.z,
				]);
				const cellKm = (2 * rock.radiusKm) / h.res;
				const expectedMouth = add(
					ref.pos,
					scale(dir, expectedRadius * rock.radiusKm),
				);
				expect(
					length(sub(drawnDir, normalizeOr(sub(expectedMouth, camera), v3()))),
				).toBeLessThan(1e-8);
				const mouth = subject.deepCueRender.mouth;
				expect(mouth).toBeDefined();
				const local = rockLocalVector(ref, sub(mouth, ref.pos), gameTime);
				expect(
					Math.abs(length(local) - expectedRadius * rock.radiusKm),
				).toBeLessThan(cellKm);
				expect(
					length(sub(normalizeOr(local, v3()), contents.deepDir)),
				).toBeLessThan(1e-5);
				const hit = beamHit(
					add(ref.pos, scale(dir, rock.radiusKm * 3)),
					scale(dir, -1),
					[
						{
							id: ref.id,
							pos: ref.pos,
							vel: ref.vel,
							radiusKm: rock.radiusKm,
							shape: subject.rockShape(ref),
						},
					],
					rock.radiusKm * 4,
				);
				expect(hit).not.toBeNull();
				if (!hit) throw new Error("No surface intersection");
				expect(length(sub(mouth, hit.point))).toBeLessThan(cellKm);
			}
		}
		expect(seen.size).toBeGreaterThanOrEqual(3);
	});

	for (const mining of [true, false]) {
		test(`instrument uses ${mining ? "survey surface" : "unchanged centre"} range with mining=${mining}`, () => {
			const rock = rocks.reduce((a, b) => (a.radiusKm > b.radiusKm ? a : b));
			const id = rockTargetId(plan, rock.slot);
			const at = resolveRock(fields, id, v3(), 37.5);
			if (!at) throw new Error("Missing fixture rock");
			for (const distance of [0, 3.99, 4.01]) {
				const pos = add(at.pos, v3(0, 0, rock.radiusKm + distance));
				const ref = resolveRock(fields, id, pos, 37.5);
				if (!ref) throw new Error("Missing fixture rock");
				const instrument = () => ({
					ctx,
					secondaryText: { setInstrumentSecondary() {}, font: "" },
					texture: {},
					primaryText: "",
				});
				let displayedKm: number | null = null;
				const subject = Object.assign(
					Object.create(
						gameMethods(["updateInstruments", "surveyBlock"], {
							...bindings,
							MINING_ON: mining,
							range: (km: number) => {
								displayedKm = km;
								return range(km);
							},
						}),
					),
					{
						world: { ship: { pos } },
						cockpit: {
							flightInstrument: instrument(),
							targetInstrument: instrument(),
						},
						rockRef: () => ref,
						surveyFiguresFitted: () => ({ rangeKm: 4, dwellS: 4 }),
						triggerHeld: () => false,
						weaponAim: () => v3(0, 0, -1),
						scanReadout: () => ({ designation: {} }),
						targetRelativeKms: () => 0,
						surveyDesignation: () => "ROCK",
						poseThrottleFill() {},
						etaCache: null,
					},
				);
				const centreKm = length(sub(ref.pos, pos));
				subject.updateInstruments(
					{ id, name: "Rock", kind: "rock" },
					centreKm,
					{ speed: "0", context: "", title: "FLIGHT" },
				);
				expect(subject.cockpit.targetInstrument.primaryText).toBe(
					`Rock  ${range(mining ? ref.distKm : centreKm)}`,
				);
				expect(displayedKm).toBe(mining ? ref.distKm : centreKm);
				expect(subject.surveyBlock(ref) === null).toBe(ref.distKm <= 4);
			}
		});
	}
});
