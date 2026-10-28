/** Inside this range of the relay a 1E long-range scanner reads its signal. A
 *  fitted scanner's range is its row's `signalRangeKm`, scaled by size and
 *  grade from this (#977): 3A reads 8,437.5 km. A leaf, so the module catalog
 *  can read it at evaluation without importing `pirate-relay` (#1114). */
export const RELAY_SIGNAL_RANGE_KM = 2_500;
