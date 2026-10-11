# Slot loadouts and save migration

Implemented by [The slot loadout in the save](https://github.com/jcfischer/seelite/issues/876).

`CommanderState.loadout` maps hull-owned slot keys to modules: kind, size,
grade, optional variant identity, and ammunition for missile racks. `plant` is
the required core slot. Empty non-core slots are absent. `src/loadout.ts` owns
validation and transfer; `src/module-catalog.ts` owns the approved price, mass
and capacity rows shared with the pricing instrument.

A module may be smaller than its slot. Kind and internal-family compatibility
still apply; a larger module never fits a smaller slot. The same size rule
applies to the core plant. Stock commanders have an E-grade plant and an
E-grade pulse laser, sized for their hull.

## Schema 14

Schema 14 writes the slot loadout and optional purchase-cost provenance (node
#869). Schema 13 remains readable. Both refuse a simultaneous
`ownedEquipment` field; older versions refuse a loadout. Unknown module kinds,
sizes, grades, fields, slot keys, incompatible placements and missing plants
are refused. Missile racks require whole ammunition within capacity; other
modules cannot carry ammunition. Variant identity is preserved as a nonempty
string; generating and interpreting traits belongs to the variants node.

Typed carried modules occupy one hold tonne each, retain their exact module
fields, and survive salvage and save round trips. Older recovered fittings keep
their legacy item identity and hold footprint until fitted or sold. Fitting a
legacy item converts it through the same catalogue adapter as migration.

## Migration from schemas 2–12

The original envelope hash is checked before migration; migration changes a
copy. Every owned legacy item is accounted for:

- The best owned combat laser occupies h1: Military, then Beam, then Pulse.
  With none owned, the stock pulse occupies h1.
- Remaining items use compatible empty slots in hull order, after sorting their
  legacy names. Overflow becomes carried modules, never discarded.
- An owned Missile becomes a full E-grade rack, including when carried.
- Large Cargo Bay chooses a compatible rack nearest its old +15 t capacity,
  breaking ties by price and then size. Other legacy items become E grade.
- Energy Bomb and Galactic Hyperdrive refund their full legacy list price.
  Any cheaper replacement also refunds the difference, so fitted plus carried
  list value and credits do not fall below the old equipment value.

Migration may leave an overfull hold: preserving possessions takes priority
and existing hold rules prevent further loading until space is made.

## Hull changes and readers

A hull purchase transfers the same modules, retaining size, grade, variant and
ammunition. Anything incompatible becomes carried cargo; an incompatible plant
is carried and the new hull receives its stock plant. Legal commodity auto-sales
use the original ship's prices and hold capacity. If protected cargo and spare
fittings cannot fit, the transaction refuses without changing state.

Fitted catalogue mass contributes to flown mass; carried modules use their hold
footprint. Cargo racks contribute their catalogue capacity. Existing consoles
and scanners use a derived legacy-name projection or the central `fitted`
query. That projection is never persisted. Slot-oriented UI and graded device
behaviours are separate: the Equipment tab now shows slots and seeded station
stock (#869), while device behaviours belong to the following outfitting nodes.

The compatibility console permits repeated hardpoint modules, subject to free
compatible slots and existing ladder gates. Its legacy name projection describes
installed module kinds, so the stock pulse projects as Extra Pulse Laser; it is
not purchase history. Kill credit still ignores equipment until weapon behaviours
are implemented. Recovered fittings sell at 90% of list value, as ratified by
Ship outfitting D10; the displayed quote and till use the same fraction.

Typed carried modules and wreck containers retain `id` as a frozen persisted
alias (the legacy equipment name where one exists, otherwise the module kind).
The parser validates this alias against `module`; retiring the legacy console
must preserve these aliases for existing schema-13 records.

The death notice counts modules beyond the lost hull's stock fit. It already
names the lost hull, so its baseline plant and pulse are not separately counted;
upgraded core modules, weapon replacements and additional slots are counted.

Stock modules are also excluded from wreck salvage: respawn already replaces
them, so recovering them would mint saleable fittings from repeated deaths.
Upgraded modules and additional fittings retain the existing survival lottery.

## Purchase cost and the outfitting tab (#869)

`purchaseCostCr` follows a bought module through slots, removal into the hold,
hull transfer, wreck survival and save round trips. It must be finite and
nonnegative. Zero means known salvage. An absent cost on a typed module uses
list value conservatively; untyped legacy salvage keeps zero basis. A resale
banks only `max(0, proceeds - cost)` on the trade ladder. All resale proceeds
still reach the purse. Schemas before 14 refuse explicit cost fields.

The Equipment tab selects a slot, then a compatible station or carried module.
The preview calculates the same transaction the confirm button commits,
including any replaced module's carried tonne and the resulting hold capacity.
Removal is atomic and the core plant can only be replaced. Fuel and per-rack
missile refills remain separate services. The gate assignments and cost ruling
are recorded in `../research/outfitting-869-codex.md`.
