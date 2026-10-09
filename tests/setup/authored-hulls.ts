/**
 * Install the authored hulls before any test file runs (node #813).
 *
 * `buildShipMesh("freighter", "b")` draws the shipped Porter model and throws
 * without it, so every row that measures a hull — the berth envelope, the
 * collision box, the vents, the muzzles — measures the model the game draws,
 * decoded from `public/models/porter.glb` through the browser's own loader.
 * Bun has no image decoder, so only the texture maps are left out.
 */
import { adoptPorterTemplate } from "../../src/porter-model";
import { decodeShippedGlb } from "../helpers/read-coriolis-glb";

adoptPorterTemplate(await decodeShippedGlb("public/models/porter.glb"));
