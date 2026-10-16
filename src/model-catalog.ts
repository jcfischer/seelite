/** Bundle models, one lazy loader per install. The queue is renderer-free;
 * this catalog joins loaders to page consumers without eager GLTF imports. */
import type { ModelLoader } from "./model-progress";

export const modelLoaders = {
	cockpit: async (p?: Parameters<ModelLoader>[0]) =>
		(await import("./cockpit-model")).prepareCockpitModel(p),
	coriolis: async (p?: Parameters<ModelLoader>[0]) =>
		(await import("./coriolis-flight")).prepareCoriolisModel(p),
	courier: async (p?: Parameters<ModelLoader>[0]) =>
		(await import("./courier-hull")).prepareCourierHullModel(p),
	tug: async (p?: Parameters<ModelLoader>[0]) =>
		(await import("./tug-hull")).prepareTugHullModel(p),
	miner: async (p?: Parameters<ModelLoader>[0]) =>
		(await import("./longwall-model")).prepareLongwallModel(p),
	interiors: async (p?: Parameters<ModelLoader>[0]) =>
		(await import("./interior-model")).prepareInteriorModel(p),
	"shipyard/a": async (p?: Parameters<ModelLoader>[0]) =>
		(await import("./shipyard-flight")).prepareShipyardModel("a", p),
	"shipyard/b": async (p?: Parameters<ModelLoader>[0]) =>
		(await import("./shipyard-flight")).prepareShipyardModel("b", p),
	"shipyard/c": async (p?: Parameters<ModelLoader>[0]) =>
		(await import("./shipyard-flight")).prepareShipyardModel("c", p),
	"refinery/a": async (p?: Parameters<ModelLoader>[0]) =>
		(await import("./refinery-flight")).prepareRefineryModel("a", p),
	"refinery/b": async (p?: Parameters<ModelLoader>[0]) =>
		(await import("./refinery-flight")).prepareRefineryModel("b", p),
	"refinery/c": async (p?: Parameters<ModelLoader>[0]) =>
		(await import("./refinery-flight")).prepareRefineryModel("c", p),
	"refinery/d": async (p?: Parameters<ModelLoader>[0]) =>
		(await import("./refinery-flight")).prepareRefineryModel("d", p),
} satisfies Record<string, ModelLoader>;
export type ModelId = keyof typeof modelLoaders;
export const ALL_MODELS = Object.keys(modelLoaders) as ModelId[];

export function stationModel(station: {
	type: string;
	formId: string;
}): ModelId | null {
	const id = `${station.type}/${station.formId}`;
	if (station.type === "trade" && station.formId === "a") return "coriolis";
	return id in modelLoaders ? (id as ModelId) : null;
}
