export const stationModelNames = [
	"ring",
	"drum",
	"assembly",
	"wheel",
	"derrick",
	"buoy",
	"rig",
	"cluster",
	"salvage",
];

export function stationModelUrl(id: string, flight: boolean): string {
	const kind = ["ring", "drum", "assembly", "wheel"].includes(id)
		? "trade"
		: "outpost";
	return flight ? `/src/models/${kind}-${id}.glb` : `./${id}.glb`;
}
