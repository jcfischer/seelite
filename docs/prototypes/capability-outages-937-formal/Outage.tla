------------------------------ MODULE Outage ------------------------------
EXTENDS Naturals, Integers

CONSTANTS Horizon, Bug
VARIABLES clock, phase, budget, outageEnd, originalEnd, repairedUntil,
          pressure, processed, expected, accountedThrough, anchor

vars == <<clock, phase, budget, outageEnd, originalEnd, repairedUntil,
          pressure, processed, expected, accountedThrough, anchor>>

Init == /\ clock = 0
        /\ phase = "Working"
        /\ budget = 2
        /\ outageEnd = 0
        /\ originalEnd = 0
        /\ repairedUntil = 0
        /\ pressure = 1
        /\ processed = 0
        /\ expected = 0
        /\ accountedThrough = 0
        /\ anchor = 0

Tick == /\ clock < Horizon
        /\ clock' = clock + 1
        /\ processed' = processed + IF phase # "Disabled" THEN 1 ELSE 0
        /\ expected' = expected + IF originalEnd <= clock \/ repairedUntil > clock THEN 1 ELSE 0
        /\ IF phase = "Working"
              THEN IF budget > pressure
                     THEN /\ budget' = budget - pressure
                          /\ UNCHANGED <<phase, outageEnd, originalEnd, repairedUntil>>
                     ELSE /\ phase' = "Disabled"
                          /\ outageEnd' \in {clock + 2, clock + 3}
                          /\ originalEnd' = outageEnd'
                          /\ budget' = 2
                          /\ repairedUntil' = 0
              ELSE IF clock + 1 >= outageEnd
                     THEN /\ phase' = "Working"
                          /\ outageEnd' = 0
                          /\ originalEnd' = 0
                          /\ repairedUntil' = 0
                          /\ budget' = 2
                     ELSE UNCHANGED <<phase, outageEnd, originalEnd, repairedUntil, budget>>
        /\ UNCHANGED <<pressure, accountedThrough, anchor>>

PressureChange == /\ clock < Horizon
                  /\ pressure' = 3 - pressure
                  /\ anchor' = clock
                  /\ accountedThrough' = IF Bug = "replace-first" THEN accountedThrough ELSE clock
                  /\ outageEnd' = IF Bug = "reset-end" /\ phase \in {"Disabled", "Repaired"} /\ outageEnd = originalEnd
                                     THEN outageEnd + 1 ELSE outageEnd
                  /\ phase' = IF Bug = "resurrect" /\ phase = "Repaired"
                                  THEN "Disabled" ELSE phase
                  /\ UNCHANGED <<clock, budget, originalEnd, repairedUntil, processed, expected>>

Repair == /\ clock < Horizon
          /\ phase = "Disabled"
          /\ phase' = "Repaired"
          /\ repairedUntil' = originalEnd
          /\ accountedThrough' = clock
          /\ anchor' = clock
          /\ UNCHANGED <<clock, budget, outageEnd, originalEnd, pressure, processed, expected>>

Settle == /\ accountedThrough # clock
          /\ accountedThrough' = clock
          /\ UNCHANGED <<clock, phase, budget, outageEnd, originalEnd,
                          repairedUntil, pressure, processed, expected, anchor>>

Done == /\ clock = Horizon /\ UNCHANGED vars

Next == Tick \/ PressureChange \/ Repair \/ Settle \/ Done

TypeOK == /\ clock \in 0..Horizon
          /\ phase \in {"Working", "Disabled", "Repaired"}
          /\ budget \in 1..2
          /\ pressure \in 1..2
          /\ processed \in 0..Horizon
          /\ expected \in 0..Horizon

OriginalEndPreserved == phase \in {"Disabled", "Repaired"} => outageEnd = originalEnd
RepairNotResurrected == repairedUntil > clock => phase = "Repaired"
NoDisabledProgress == processed = expected
SettleBeforeReplace == anchor <= accountedThrough /\ accountedThrough <= clock

Spec == Init /\ [][Next]_vars
=============================================================================
