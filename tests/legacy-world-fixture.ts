import { fnv1a } from "../src/rng";

/** Build the historical world-3/generator-10 bytes for an older outer-save fixture. */
export function legacyWorldFixture(raw: any): any {
	const { integrity: _, ...body } = JSON.parse(JSON.stringify(raw));
	body.worldSchemaVersion = 3;
	body.worldGeneratorVersion = 10;
	for (const env of body.galaxies) delete env.capabilityTime;
	return { ...body, integrity: fnv1a(JSON.stringify(body)) };
}

/** Stamp the historical nested world before an edited legacy outer fixture is hashed. */
export function pairLegacyWorldFixture(body: Record<string, any>): void {
	if (body.saveSchemaVersion < 20 && body.commander?.state)
		delete body.commander.state.accounting;
	if (body.saveSchemaVersion >= 2 && body.saveSchemaVersion <= 17)
		body.world = legacyWorldFixture(body.world);
}
