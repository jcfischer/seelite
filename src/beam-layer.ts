/**
 * The pass that draws the cockpit's laser beams into the frame (node #806).
 *
 * It runs **between the near layer and the cabin's pass**. The cabin pass
 * draws over a cleared depth buffer and leaves alone every pixel no fitting
 * covers (#651), so a beam drawn here is hidden wherever a fitting is in front
 * of it and shown everywhere else — which is the occlusion the beam on the
 * overlay could not have. `beam-glass.ts` says why the beams left the overlay
 * and owns the arithmetic; this module only puts its quads on the GPU.
 *
 * The quads are in clip space already, so the camera is never read. The
 * material tests no depth: a beam is a mark on the frame of something far
 * outside the canopy, and nothing in the world layers is between it and the
 * eye in a way the overlay ever drew.
 */
import * as THREE from "three";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import {
	BEAM_CAPACITY,
	type BeamStroke,
	newBeamQuads,
	writeBeamQuads,
} from "./beam-glass";

const VERTEX = /* glsl */ `
attribute vec2 edge;
attribute vec4 beamColour;
varying vec2 vEdge;
varying vec4 vColour;
void main() {
	vEdge = edge;
	vColour = beamColour;
	gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const FRAGMENT = /* glsl */ `
varying vec2 vEdge;
varying vec4 vColour;
void main() {
	// A one-pixel ramp at the edge: the overlay's strokes were antialiased by
	// the 2D canvas, and the composer's target is not multisampled by default.
	float cover = clamp(vEdge.y + 0.5 - abs(vEdge.x), 0.0, 1.0);
	gl_FragColor = vec4(vColour.rgb, vColour.a * cover);
}
`;

export class BeamLayer {
	readonly scene = new THREE.Scene();
	readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
	readonly pass: RenderPass;
	readonly mesh: THREE.Mesh;
	private readonly quads = newBeamQuads(BEAM_CAPACITY);
	private readonly attributes: THREE.BufferAttribute[];

	constructor() {
		const geometry = new THREE.BufferGeometry();
		const position = new THREE.BufferAttribute(this.quads.position, 2);
		const edge = new THREE.BufferAttribute(this.quads.edge, 2);
		const colour = new THREE.BufferAttribute(this.quads.colour, 4);
		this.attributes = [position, edge, colour];
		for (const a of this.attributes) a.setUsage(THREE.DynamicDrawUsage);
		geometry.setAttribute("position", position);
		geometry.setAttribute("edge", edge);
		geometry.setAttribute("beamColour", colour);
		geometry.setDrawRange(0, 0);
		this.mesh = new THREE.Mesh(
			geometry,
			new THREE.ShaderMaterial({
				name: "cockpit-beams",
				vertexShader: VERTEX,
				fragmentShader: FRAGMENT,
				transparent: true,
				depthTest: false,
				depthWrite: false,
				side: THREE.DoubleSide,
			}),
		);
		this.mesh.name = "cockpit-beams";
		this.mesh.frustumCulled = false;
		this.scene.add(this.mesh);
		this.pass = new RenderPass(this.scene, this.camera);
		this.pass.clear = false;
		this.pass.enabled = false;
	}

	/**
	 * This frame's strokes, for a drawing buffer of `bufferW` × `bufferH` at
	 * `pxPerCss` buffer pixels per CSS pixel. An empty list disables the pass,
	 * so a frame with no beam pays nothing for it.
	 */
	draw(
		strokes: readonly BeamStroke[],
		bufferW: number,
		bufferH: number,
		pxPerCss: number,
	): void {
		writeBeamQuads(strokes, bufferW, bufferH, pxPerCss, this.quads);
		this.mesh.geometry.setDrawRange(0, this.quads.count);
		this.pass.enabled = this.quads.count > 0;
		if (this.pass.enabled)
			for (const a of this.attributes) {
				a.clearUpdateRanges();
				a.addUpdateRange(0, this.quads.count * a.itemSize);
				a.needsUpdate = true;
			}
	}

	/** Vertices drawn this frame, for a probe to read beside the pixels. */
	get vertexCount(): number {
		return this.pass.enabled ? this.quads.count : 0;
	}
}
