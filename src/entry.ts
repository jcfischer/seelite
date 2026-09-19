const query = new URLSearchParams(window.location.search);

// A bare root is the public threshold. Existing probes and game links carry a
// boot mode; `seed` preserves the overlay probe's deliberate `boot: null` arm.
if (query.has("boot") || query.has("seed")) await import("./main");
else await import("./public-entry");

export {};
