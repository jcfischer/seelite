import type { ConsoleView } from "../src/state-gallery";
import type { StationConsoleTab } from "../src/station-console";

// Requests belongs to the normal cockpit, not the Market/Equipment gallery.
const liveRequests: StationConsoleTab = "Requests";
// @ts-expect-error The gallery has no Requests renderer.
const galleryRequests: ConsoleView["tab"] = liveRequests;
