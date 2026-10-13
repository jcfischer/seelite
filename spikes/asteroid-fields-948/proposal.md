## Resolution: asteroid field geometry and identity contract

Principal rulings, 2026-10-13, live in session:
- **Q7** (#918's Q4): **slow drift**, not a rigid layout. D5 makes it closed-form and cell-bounded.
- **Q8**: **own `FIELD_GENERATOR_VERSION`** and a field fingerprint (D6).
- **Q9**: charted lead 150–300 km and rare chance 0.20, **as proposed** (D3, D4).
- **Q10**: **more, smaller rocks**. D5 holds the re-measured profiles.

Prototype: a headless generator and instrument (scratch, not on a branch). Measured over 10 worlds (47, `0x5ee11e`, `worldSeeds(8)`) × 8 galaxies × 256 = **20,480 systems**, 10 simulated years at 40 samples. Every figure below is a spread across those worlds (#107).

### D1 — Streams: four tags, appended

| Tag | # | Split | Draws |
|---|---|---|---|
| `ASTEROID_FIELD_ROLL` | 38 | system | rare field present or not (one draw) |
| `ASTEROID_FIELD` | 39 | system × field slot | lead/offset, placement branch, frame orientation |
| `ASTEROID_ROCKS` | 40 | system × field slot × rock slot | occupancy, radius, jitter, shape seed, spin axis, period, phase |
| `ASTEROID_DEPOSIT` | 41 | system × field slot × rock slot | hidden contents (reserved; #951 and #920 fill it) |

The roll is its own tag (the `RELAY_ACTIVE` / `RELAY` precedent): tuning the chance moves no placement. The rare branch draws a fixed budget of 8 numbers whatever branch it takes, so a system that gains a belt or a giant moves no other draw. No draw in `BODIES`, `STATIONS` or any existing tag.

### D2 — Ids by slot

- `field-00` is the charted field (exists iff the system has a refinery). `field-01` is the rare field. A later field type takes a new slot number. It never reuses one.
- A rock is identified by `(fieldId, rockSlot)`. The rock slot is the index of a **lattice cell** in a fixed enumeration of the field's ellipsoid. Each slot owns its own sub-stream, so a rock is a function of its slot alone.
- Measured: raise the occupancy by 0.1 and the rocks go from 175,185 to 225,529, but **0 of 175,185** existing rocks move (D5 profiles). A count retune adds or removes rocks. It never moves a rock.
- Positions (`ASTEROID_ROCKS`) and contents (`ASTEROID_DEPOSIT`) are separate tags. A charted field's layout is public. Its contents stay hidden until a survey.
- Fields and rocks are **not** carriers (Q5). They are not in `enumerateCarriers`, `placeBodies` or the body list. They become contacts through #949 and #920.

### D3 — Charted placement (Q2 made geometry)

- The centre is on the refinery's own orbit, **150–300 km** ahead or behind it (signed, uniform), and ±30 km off the plane. That is past the 50 km cruise drop and the docking director range. At the 2 km/s assist cap it is 75–150 s of normal flight. The field shares its orbit with the refinery, so the gap never changes. Measured: 149.8–300.9 km from the refinery surface.
- The relay watches the refinery in **0 of 20,480** systems, because every system has a trade station. The closest charted field to any relay is 3.98 × 10⁶ km. No guard is needed. A test should still pin "relay ≠ refinery, or the lead band clears `RELAY_REGION_KM`".

### D4 — Rare fields (Q6 made geometry)

The chance is **0.20** per system. Measured: 19.3–20.4 % per world.

| Branch | When | Placement | N (10 worlds) |
|---|---|---|---|
| belt | belt exists | the refinery's own orbit, phase ≥ π/6 from the refinery (≥ 0.5 a apart for ever) | 1,543 |
| trojan | no belt, a giant exists | a drawn giant's L4/L5. **The side flips if the outpost holds it** (94 shared a host) | 1,245 |
| outer-orbit | no belt, no giant | star-centric at 1.3–1.8 × the outermost planet's a, within `MAX_ORBIT_AU` | 1,188 |
| outer-trojan | the outer orbit would leave the envelope | the outermost planet's L4/L5, with the same flip | **86 (rarest bucket, 4–11 per world)** |

Every field rides a co-periodic or separate orbit, so no separation closes over time. Measured minimum from a field centre to any other body surface: **3.96 × 10⁶ km**. Rare field to outpost: 0 within 10⁶ km. New-game arrival to any field centre: 1.45 × 10⁷ km. Fields add nothing to `arrivalPoint`'s clearance set, so **no arrival moves**.

### D5 — Rocks, drift and spin (Q7 = drift, Q10 = more, smaller)

- **Field frame.** The orientation is a uniform random rotation drawn on `ASTEROID_FIELD` and fixed in inertial space. The field centre rides its orbit, so there is one `FrameMotion` per field.
- **Slow drift, in closed form (Q7).** Each rock circles a seeded anchor inside its own lattice cell. The circle lies in a drawn plane, its radius is 0.2–0.6 of the cell's free play, and its period is log-uniform 1–6 h. The period is lengthened so the drift speed stays ≤ 2 m/s.
  - Position is `centre(t) + R·(anchor + drift(t))` and velocity is its exact derivative. Both are a function of `(seed, gameTime)`, so nothing is integrated and nothing is saved.
  - |anchor offset| + drift radius ≤ the free play, so **a rock never leaves its cell**. Two rocks cannot touch, whatever the time.
  - Measured: drift p50 0.29 m/s, p90 0.65 m/s, max 1.21 m/s. The analytic velocity against a finite difference: max error 0.0006 mm/s.
  - The minimum surface gap, sampled over 6 h, is **432 m** (a 200 m margin by construction).
  - For #949 this means each rock has its own analytic motion: rock frame = field frame + drift + spin. No rock-to-rock contact exists.
- **Per-rock spin.** The axis is uniform on the sphere. The period is log-uniform 4–40 min, lengthened so the equatorial speed stays ≤ **6 m/s**. Measured: p50 period 12.6 min, p50 surface speed 0.44 m/s, max 6.00 m/s.

| Profile | Ellipsoid semi-axes a × b × c (field frame, randomly oriented) | Cell | Occupancy | Radius, p ∝ r^−α | Rocks (min / p50 / max) |
|---|---|---|---|---|---|
| charted | 24 × 12 × 6 km | 2.4 km | 0.35 | 25–400 m, α 2.4 | 147 / 186 / 234 |
| rare | 16 × 10 × 6 km | 2.6 km | 0.40 | 40–600 m, α 2.0 | 65 / 91 / 124 |

- **`radiusKm` is a bounding radius.** No drawn vertex and no collision-proxy vertex may lie outside it. A test enforces this, like the station reach rows (#28). The 200 m gap holds only for that bound. It does not hold for `buildAsteroid`'s nominal radius plus displacement. This binds #949 and #952.
- **The largest rock fits its cell.** `rockRadiusKm[1] ≤ cellKm/2 − marginKm/2` is asserted. Without that assertion the free play clamps at 0 and two neighbours can overlap.
- Over all rocks: radius p10 27 m, p50 46 m, p90 143 m, p99 378 m. The miner is 84.5 m long, so most rocks are smaller than it and a few are about five times its size. Rare fields keep fewer, bigger rocks.
- Slot stability still holds with drift: raise the occupancy by 0.1 and the rocks go from 175,185 to 225,529, with **0** existing rocks moved.
- The fixed draw order per rock slot is: occupancy, radius, anchor ×3, shape seed, spin axis ×2, spin period, spin phase, drift fraction, drift plane ×2, drift period, drift phase. The production module keeps this order. Any new draw goes at the end.

### D6 — The #351 verdict: neither relabel nor migration

- Fields add no carrier. So `carrierBaselineFingerprint`, `GOLDEN_FINGERPRINTS`, the galaxy digest `47f9eb28`, `station-orbits.json` and `station-fields.json` cannot change. **`WORLD_GENERATOR_VERSION` stays 10.** Those pins are green on `main` today (196 pass, 4 files), and the production test re-runs them unchanged.
- But the deposit rows (Q5) are keyed by `(fieldId, rockSlot)`, and nothing in the carrier fingerprint guards that. So the proposal is a **separate `FIELD_GENERATOR_VERSION`** (starting at 1) and a **field baseline fingerprint**, per galaxy, over `fieldId | kind | rockSlot | radius | local`. The fingerprint is pinned in a new test. A change that moves a rock goes red there and owes a deposit migration, which #951 defines. This is the #46 rule: a saved identity has one owner.
- **Where the headless test goes.** Today the pins are green only because nothing in `src` changed. The test is owed by the generated-fields production brief that #918 files after ratification. It asserts:
  - the four existing pins, unchanged;
  - the new per-galaxy field fingerprint;
  - the bounding-radius and largest-rock rules from D5;
  - slot stability: an occupancy change moves no occupied rock.
- The alternative is to fold fields into `WORLD_GENERATOR_VERSION`. That is cheaper now, but every rock retune would then force a world migration and every carrier change would force a deposit rebase. The two do not move together.

### D7 — Reproducible seeds for the gallery (#952) and LOD (#950)

The world seed is 47 (the view set's), galaxy 0:

- charted / refinery-orbit: system 0 GEVETI, `field-00`
- rare / belt: system 1 TERALA, `field-01`
- rare / trojan: system 30 RAONRA, `field-01`
- rare / outer-orbit: system 28 INATUS, `field-01`
- rare / outer-trojan: system 27 ARORRA, `field-01`

For a worst-case density test, #950 should take the p99 rock count from the fingerprint seed `0x5ee11e`.

### What this leaves to the siblings

- #949: the cruise exclusion and arrival for a field centre that is not in `placeBodies`; swept contact in the field frame plus the spin.
- #950: the instancing budget for 65–234 rocks per field. Each rock moves (drift and spin), so the instance matrices change every frame.
- #951: the deposit rows and the `FIELD_GENERATOR_VERSION` migration rule.
- #952: whether the lattice-cell arrangement reads as a field and not as a grid. The jitter is ≤ the cell's free play, and the principal judges this by eye.
