export const ORE_FAMILIES = [
	"silicate",
	"metallic",
	"gold",
	"platinum",
	"gem",
] as const;
export type OreFamily = (typeof ORE_FAMILIES)[number];
export const ORE_GRADES = ["poor", "standard", "rich"] as const;
export type OreGrade = (typeof ORE_GRADES)[number];
export const ORE_FAMILY_NAME: Readonly<Record<OreFamily, string>> = {
	silicate: "Silicate ore",
	metallic: "Metallic ore",
	gold: "Gold-bearing ore",
	platinum: "Platinum-bearing ore",
	gem: "Gem-bearing ore",
};
const GRADE_NAME = { poor: "POOR", standard: "STD", rich: "RICH" } as const;
export const oreCargoName = (family: OreFamily, grade: OreGrade): string =>
	`${ORE_FAMILY_NAME[family]} ${GRADE_NAME[grade]}`;
const PRODUCTS = {
	silicate: "Minerals",
	metallic: "Alloys",
	gold: "Gold",
	platinum: "Platinum",
	gem: "Gem-Stones",
} as const;
const YIELD_G = {
	silicate: [200000, 400000, 800000],
	metallic: [200000, 400000, 800000],
	gold: [500, 1000, 2000],
	platinum: [250, 500, 1000],
	gem: [5, 10, 20],
} as const;
export const ORE_GOODS = ORE_FAMILIES.flatMap((family) =>
	ORE_GRADES.map((grade, index) => ({
		family,
		grade,
		name: oreCargoName(family, grade),
		product: PRODUCTS[family],
		yieldGPerT: YIELD_G[family][index],
	})),
);
export const oreGood = (name: string) => ORE_GOODS.find((g) => g.name === name);
export const oreTonnes = (cargo: Readonly<Record<string, number>>): number =>
	Object.entries(cargo).reduce(
		(n, [name, t]) => n + (oreGood(name) ? t : 0),
		0,
	);
export const RAW_VALUE_SHARE = 0.35;
export const RAW_ELASTICITY_SCALE = 0.5;
export const RAW_STOCK_MIN_T = 8;
export const RAW_STOCK_MAX_T = 63;
