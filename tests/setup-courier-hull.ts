import { installShippedCourierHull } from "../scripts/lib/shipped-courier-hull";

// The game draws the authored courier (node #812); every headless row sees
// the same hull, so no row measures a courier the player never flies.
await installShippedCourierHull();
