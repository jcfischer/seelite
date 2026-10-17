import * as F from "./field-proto.ts";
const R = new URL("../..", import.meta.url).pathname;
const { forEachSystem, worldSeeds, ALL_GALAXIES } = await import(`${R}/tests/helpers/station-rows.ts`);
const sys = await import(`${R}/src/system.ts`);
const worlds = [47, 0x5ee11e, ...worldSeeds(8)];
let clashWouldBe = 0, trojans = 0;
let slotMoved = 0, slotsCompared = 0, before = 0, after = 0;
for (const w of worlds) forEachSystem(w, ALL_GALAXIES, (record: any, c: any) => {
  const rare = F.rareField(record, c);
  const op = c.stations.find((s: any) => s.type === "outpost");
  if (rare && (rare.kind === "trojan" || rare.kind === "outer-trojan")) {
    trojans++;
    const host = c.planets.find((p: any) => p.id === rare.hostId);
    // the side the draw asked for, before the flip
    const asked = rare.orbit.theta0 - host.orbit.theta0;
    if (op && op.orbit.radiusKm === host.orbit.radiusKm) clashWouldBe++;
  }
  // slot stability: raise occupancy, every old rock must be unchanged
  const ch = F.chartedField(record, c);
  if (ch && record.index % 8 === 0) {
    const a = F.rocks(record, ch);
    const occ = F.PROFILE.charted.occupancy;
    F.PROFILE.charted.occupancy = occ + 0.1;
    const b = new Map(F.rocks(record, ch).map((r) => [r.slot, JSON.stringify(r)]));
    F.PROFILE.charted.occupancy = occ;
    before += a.length; after += b.size;
    for (const r of a) { slotsCompared++; if (b.get(r.slot) !== JSON.stringify(r)) slotMoved++; }
  }
});
console.log(`trojan rare fields ${trojans}; outpost on the same host (flip guard engaged or side differs) ${clashWouldBe}`);
console.log(`occupancy +0.1: rocks ${before} -> ${after}; existing rocks moved ${slotMoved}/${slotsCompared}`);
