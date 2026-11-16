/** Station interiors install on the shared background-install scheduler
 * (`install-slices.ts`); these names are the interior callers' view of it.
 */
export {
	INSTALL_SLICE_MS as INTERIOR_SLICE_MS,
	nextInstallFrame as nextInteriorFrame,
	runInstallSlices as runInteriorSlices,
} from "./install-slices";
