# Field discovery domain preparation — node #1191

This is an incomplete build, prepared unattended on 2026-11-07. It does not
change play. `src/field-discovery.ts` is imported only by its headless test;
neither the game nor the world save envelope uses it yet.

## Contract and remaining decision

The parent decision [#1190](https://github.com/jcfischer/seelite/issues/1190)
closed with receipt comment 6699097794. Its six rulings were copied into the
build brief through `soma graph edit` before implementation. Rare fields remain
physically drawn but absent from contacts until proximity discovery; a scanner
provides regional provenance, and no scanner is needed to discover by proximity.
Discovery is a per-galaxy set independent of deposits and field generator
migrations. The eventual rollout applies to everyone, including old saves,
without requiring `?mining=1`.

The decision names a fixed discovery radius but supplies no distance. Its
reference, `docs/specs/system-sweep.md`, defines no field discovery distance.
The domain therefore requires an explicit radius argument, with no default.
The test's radius is a fixture, not a proposed production figure.

Runtime integration, scanner leads, contact filtering, save-envelope wiring and
the registered `probe-field-discovery` are still owed. The final browser gate
and the principal's visual acceptance remain pending. The node stays open.

## Independent implementation

`FieldDiscoveries` reuses the existing envelope-relative `FieldKey` identity,
`systemIndex:fieldId`. The codec accepts the stable rare slot declared by
`FIELD_SLOT`, bounds system indices with `SYSTEMS_PER_GALAXY`, rejects duplicate
or malformed rows, and produces canonical numeric system order. An absent
domain reads empty; an empty domain serializes as absent.

Validation checks stable identity rather than today's field occurrence. A
generator migration can stop populating a field slot, and the parent's ruling
requires its discovery to remain. This does not create a field: the eventual
contact producer must still enumerate actual generated plans. No fingerprint,
deposit, reading or generator version enters the discovery codec.

There is one supported rare slot per system, so the set has at most
`SYSTEMS_PER_GALAXY` entries per galaxy. The headless bound test serializes all
supported identities and checks its size against the maximum encoded key
length, including JSON delimiters.

The parameterized proximity function reads field positions at the supplied
game time. Discovery is inclusive at the supplied radius and idempotent. It
does not accept a scanner parameter or write any other domain. Invalid
geometry, time or radius refuses instead of granting knowledge.

## Verification

- The first test run failed because the module did not exist. A later
  migration regression run had six passing tests and two failures, proving
  that today's field-occurrence validation rejected retained identities.
- After implementing the domain and correcting that validation, the affected
  discovery, deposit and field suites passed: 47 tests, 103203 assertions.
- Typecheck, format, script lint, comment lint, launcher wiring and build pass.
- Browser selection is recorded on the draft PR. No browser run is claimed;
  this unfinished domain has no runtime entry point.
- Sage round 1 had two suggestions and no blockers. Both were taken: named
  proximity inputs prevent swapping time and radius, and unused test setup was
  removed. Review stops at that suggestion-only round under the map's SOP.

The production discovery radius still needs a principal ruling. No release,
economy or survey figure was selected by this preparation.

## Boundary-test follow-up

The draft was rebased onto main `a107a16` before this test-only amendment.
Discovery at a valid game clock of zero now has a positive test, and a saved
identity with trailing junk is refused even after a valid preceding row. The
ten discovery tests pass with 44 assertions. Temporary mutations changing the
time guard to `gameTime <= 0` and removing the identity pattern's end anchor
each fail exactly the corresponding new test; production source is restored
unchanged. Logs: `/tmp/discovery1191-followup-baseline.log`,
`/tmp/discovery1191-followup-time-zero-mutant.log` and
`/tmp/discovery1191-followup-identity-suffix-mutant.log`.

The affected discovery, asteroid-field, deposit-state and field-contact suites
pass 57 tests with 132,060 assertions after the rebase. Log:
`/tmp/discovery1191-followup-affected.log`. Typecheck, format, script lint,
comment lint, launcher wiring and build pass; corresponding gate logs use
`/tmp/discovery1191-followup-{tsc,format,lint,comments,wiring,build}.log`.

The remaining advisory survivors are not a claimed runtime defect count.
Removing redundant type/array/match guards still refuses malformed input,
duplicate rejection already bounds the supported stable-slot set, and charted
fields remain known through `fieldIsKnown` even without the rare-only filter.
The set's insertion order is not the persistence contract; its codec sorts on
write. No exact exception-text assertions were added to force a mutation score.

This amendment changes only headless tests and this receipt, so it needs no
additional browser run under `CLAUDE.md`. The complete unfinished draft still
owes runtime integration, its final selected browser gate and principal visual
acceptance after a numeric discovery-radius ruling.
