/** Read the ray helper and the crater walk's own cell geometry independently.
 * No sanitisation: a broken shader/readback must remain a failed measurement.
 */
export function raySourceFragment(fragment, craterCell, mode) {
	const start = fragment.lastIndexOf("void main() {");
	if (start < 0 || !fragment.includes("vec4 airlessRayCrater("))
		throw new Error("airless ray diagnostic splice missed");
	const outputs = {
		ray: "gl_FragColor = source;",
		walk: "gl_FragColor = vec4(centre / 8.0 - seedOffset * 1.7, radius / 8.0);",
		eligibility: `float floorRim;
  float floorMask = basinFloor(anchor, floorRim);
  vec3 steps = abs(base - rayCell);
  float inWalk = max(steps.x, max(steps.y, steps.z)) <= 1.0 ? 1.0 : 0.0;
  gl_FragColor = vec4(d, floorMask, airlessRayEligible(source) ? 1.0 : 0.0, inWalk);`,
	};
	if (!outputs[mode]) throw new Error("invalid airless ray diagnostic mode");
	return `${fragment.slice(0, start)}
uniform vec3 rayCell;
void main() {
  vec4 source = airlessRayCrater(rayCell);
  vec3 anchor = normalize(source.xyz);
  vec3 p = (anchor + seedOffset * 1.7) * 8.0;
  vec3 base = floor(p);
  // Use the walk's geometry verbatim with its offsets chosen to name this cell.
  float x = rayCell.x - base.x, y = rayCell.y - base.y, z = rayCell.z - base.z;
${craterCell}
  ${outputs[mode]}
}`;
}

/** CPU agreement within 5% of the source radius is a selection check, not
 * bit parity. The two GPU reconstructions must agree to 1e-6 body radii.
 * Eligibility is independently read from the GPU: near the shell, unflooded,
 * accepted by the production guard, and in the actual 3x3x3 neighbourhood.
 */
export function raySourcePasses({ cpu, ray, walk, eligibility }) {
	const finite = (a, n) =>
		Array.isArray(a) && a.length === n && a.every(Number.isFinite);
	if (
		!cpu ||
		!finite(cpu.centre, 3) ||
		!Number.isFinite(cpu.radius) ||
		![ray, walk, eligibility].every((a) => finite(a, 4))
	)
		return false;
	const radius = walk[3];
	return (
		radius >= 0.02 - 1e-6 &&
		radius <= 0.0625 + 1e-6 &&
		ray.every((v, i) => Math.abs(v - walk[i]) <= 1e-6) &&
		Math.hypot(...cpu.centre.map((v, i) => v - walk[i])) < radius * 0.05 &&
		Math.abs(cpu.radius - radius) < radius * 0.05 &&
		eligibility[0] >= 0 &&
		eligibility[0] < 0.25 &&
		eligibility[1] === 0 &&
		eligibility[2] === 1 &&
		eligibility[3] === 1
	);
}
