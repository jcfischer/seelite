# First raw ore sale notice — node #1236

An accepted raw ore sale from a hull other than the Longwall prints:

> First ore sold. A dedicated mining ship like the Longwall earns far more per hour.

The existing cockpit station status line carries the sentence. The successful
transaction also sets `CommanderState.firstOreNoticeSeen`. Later transactions
clear the status line normally and never generate the sentence again.

The flag is optional and serializes only as `true`. Saves without it retain
their previous encoding and load as eligible, so no schema bump is needed.
Malformed values are refused. Hull auto-sales forward the sentence, and ship
replacement after destruction retains the flag. Longwall sales, refined goods,
purchases and rejected sales leave an unseen flag untouched.

## Evidence

- `tests/mining-goods.test.ts` tests every non-Longwall hull, repeat sales,
  Longwall exclusion, refined goods, purchases, refusals, hull auto-sales,
  save/reload, absent and malformed flags, and death restoration. New behavior
  tests were observed failing before implementation.
- Affected commerce, save and holdings tests passed: 148 tests in six files;
  the subsequent mining/holdings/death run passed 92 tests in three files.
- `probe-mining-goods` passed 14/14 checks on the Apple M5 Pro hardware renderer.
  The probe clicks Market SELL, reads the exact sentence from the visible
  station status element, verifies a second sale does not repeat it, reads
  the persisted flag from IndexedDB, and sells again after reload without
  another notice. It also verifies no notice for a Longwall sale.
- Browser log: `/tmp/node1236-browser.log`. Screenshot:
  `/tmp/seelite-1193-mining-goods/first-ore-notice.png`.
- Typecheck, production build, formatting, script lint and comment lint passed.
- The single required `npm test` run passed all 8,151 tests across 498 files,
  with zero failures. Full log: `/tmp/node1236-full-test.log`.

Probe selection was inspected before the run. The diagnostic selection expands
shared runtime changes to all 126 probes. The worker contract permits only
affected probes and reserves the final browser gate for the supervisor, so this
is one affected hardware probe, not a full browser-suite pass.
