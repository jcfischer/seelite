import * as THREE from "three";

export const STATION_KEY_GAIN = 2;
export const STATION_AMBIENT_GAIN = 0.6;
/** Navigation lamps alone exceed EMISSIVE_CEILING to bloom, at the principal's gain:
 * https://github.com/jcfischer/seelite/issues/1142#issuecomment-6526047964 */
export const STATION_BEACON_GAIN = 8;

export const isStationBeacon = (name: string) =>
	name === "navigation-red" || name === "navigation-green";

const DIRECT_LINE = "getDirectionalLightInfo( directionalLight, directLight );";
const HEMISPHERE_LINE =
	"irradiance += getHemisphereLightIrradiance( hemisphereLights[ i ], geometryNormal );";
const LIGHTS_INCLUDE = "#include <lights_fragment_begin>";

export function stationLightsChunk(
	chunk = THREE.ShaderChunk.lights_fragment_begin,
) {
	for (const marker of [DIRECT_LINE, HEMISPHERE_LINE])
		if (chunk.split(marker).length !== 2)
			throw new Error(
				"three's lights_fragment_begin no longer matches the Station splice",
			);
	return chunk
		.replace(
			DIRECT_LINE,
			`${DIRECT_LINE}\n\t\tdirectLight.color *= ${STATION_KEY_GAIN.toFixed(3)};`,
		)
		.replace(
			HEMISPHERE_LINE,
			HEMISPHERE_LINE.replace(
				"irradiance += ",
				`irradiance += ${STATION_AMBIENT_GAIN.toFixed(3)} * `,
			),
		);
}

const keyLit = new WeakSet<THREE.MeshStandardMaterial>();
export function applyStationKeyLight(material: THREE.MeshStandardMaterial) {
	if (keyLit.has(material) || material.emissive.getHex() !== 0) return;
	keyLit.add(material);
	const previous = material.onBeforeCompile;
	const previousKey = material.customProgramCacheKey();
	material.onBeforeCompile = (shader, renderer) => {
		previous.call(material, shader, renderer);
		if (shader.fragmentShader.split(LIGHTS_INCLUDE).length !== 2)
			throw new Error(
				"Station material no longer includes three's lights_fragment_begin",
			);
		shader.fragmentShader = shader.fragmentShader.replace(
			LIGHTS_INCLUDE,
			stationLightsChunk(),
		);
	};
	material.customProgramCacheKey = () =>
		`${previousKey}|station-key-${STATION_KEY_GAIN}-ambient-${STATION_AMBIENT_GAIN}`;
}
