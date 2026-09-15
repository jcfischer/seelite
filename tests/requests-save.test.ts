import { expect, test } from "bun:test";
import { carrierKey } from "../src/carrier-key";
import { fixtureOffers, requestAction } from "../src/requests-prototype";
import {
	newCommanderRecord,
	parseSave,
	serializeSave,
	SAVE_SCHEMA_VERSION,
} from "../src/save-envelope";
import { newWorld, fnv1a } from "../src/world-state";

test("Requests and credits round-trip under one hash at every stage", () => {
	const commander = newCommanderRecord("courier");
	const world = newWorld(42);
	world.gameTime = 20;
	const offers = fixtureOffers(
		0,
		carrierKey(0, "station-trade"),
		"QUERIOR",
		10,
	);
	const ctx = { now: 20, docked: offers[0].requester, armed: true };
	for (const action of [
		"accept",
		"track",
		"fixture-search",
		"fixture-identify",
		"fixture-disable",
		"report",
	]) {
		const result = requestAction(
			commander.requests,
			offers,
			action,
			offers[0].id,
			ctx,
		);
		commander.requests = result.state;
		commander.state.credits += result.rewardCr;
		expect(parseSave(serializeSave({ world, commander }))).toEqual({
			world,
			commander,
		});
	}
	const graft = JSON.parse(JSON.stringify(serializeSave({ world, commander })));
	graft.commander.state.credits += 250;
	expect(() => parseSave(graft)).toThrow("integrity");
});

test("verified schema 2 migrates a copy to empty journal; corrupt and unsupported originals stay untouched", () => {
	const current = JSON.parse(
		JSON.stringify(
			serializeSave({
				world: newWorld(42),
				commander: newCommanderRecord("courier"),
			}),
		),
	);
	expect(SAVE_SCHEMA_VERSION).toBe(3);
	const { integrity, ...body } = current;
	body.saveSchemaVersion = 2;
	delete body.commander.requests;
	const old = { ...body, integrity: fnv1a(JSON.stringify(body)) };
	const before = JSON.stringify(old);
	expect(parseSave(old).commander.requests.byId).toEqual({});
	expect(JSON.stringify(old)).toBe(before);
	old.commander.state.credits += 1;
	const corrupt = JSON.stringify(old);
	expect(() => parseSave(old)).toThrow("integrity");
	expect(JSON.stringify(old)).toBe(corrupt);
	expect(() => parseSave({ ...current, saveSchemaVersion: 999 })).toThrow(
		"saveSchemaVersion",
	);
});

test("request journal cannot reference a nonexistent generated requester", () => {
	const world = newWorld(42);
	world.gameTime = 20;
	const commander = newCommanderRecord("courier");
	const offers = fixtureOffers(
		0,
		carrierKey(0, "station-invented"),
		"Made up",
		10,
	);
	commander.requests = requestAction(
		commander.requests,
		offers,
		"accept",
		offers[0].id,
		{ now: 20, armed: true, docked: offers[0].requester },
	).state;
	expect(() => parseSave(serializeSave({ world, commander }))).toThrow(
		"requester",
	);
});
