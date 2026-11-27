export const catalogFamilies = [
	"pulse-laser",
	"beam-laser",
	"military-laser",
	"mining-laser",
	"missile-rack",
] as const;
export const conceptFamilies = [
	"autocannon",
	"railgun",
	"scattergun",
	"plasma-projector",
] as const;
export const fittingFamilies = [
	...catalogFamilies,
	...conceptFamilies,
] as const;
export type FittingFamily = (typeof fittingFamilies)[number];
export function isFittingFamily(name: string): name is FittingFamily {
	return fittingFamilies.some((family) => family === name);
}

export const fittingExitName = (family: FittingFamily) =>
	family === "missile-rack" ? "launch-exit" : "muzzle";
