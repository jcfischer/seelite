import * as THREE from "three";
import {
	buildFitting,
	isFittingFamily,
	type FittingFamily,
} from "./hardpoint-model";

export function fittingStudio() {
	const renderer = new THREE.WebGLRenderer({
		alpha: true,
		antialias: true,
		preserveDrawingBuffer: true,
	});
	renderer.setClearColor(0, 0);
	const scene = new THREE.Scene();
	scene.add(new THREE.HemisphereLight(0xfff4df, 0x897c72, 1.85));
	const key = new THREE.DirectionalLight(0xfff0d2, 3.2);
	key.position.set(-3, 6, -4);
	scene.add(key);
	const rim = new THREE.DirectionalLight(0xb1d9ff, 2.0);
	rim.position.set(3, 3, 4);
	scene.add(rim);
	const camera = new THREE.OrthographicCamera(-2.7, 2.7, 1.85, -1.85, 0.01, 40);
	const models = new Map<FittingFamily, THREE.Group>();
	function show(
		family: FittingFamily,
		angle: number,
		width: number,
		height: number,
	) {
		for (const model of models.values()) model.visible = false;
		let model = models.get(family);
		if (!model) {
			model = buildFitting(family);
			scene.add(model);
			models.set(family, model);
		}
		model.visible = true;
		renderer.setSize(width, height, false);
		camera.left = (-1.52 * width) / height;
		camera.right = -camera.left;
		camera.top = 1.52;
		camera.bottom = -1.52;
		camera.updateProjectionMatrix();
		camera.position.set(6 * Math.sin(angle), 3.3, -6 * Math.cos(angle));
		camera.lookAt(0, 1, -0.33);
		renderer.render(scene, camera);
	}
	return { renderer, show };
}

export function registerFittingPreview() {
	if (customElements.get("seelite-fitting")) return;
	let studio: ReturnType<typeof fittingStudio> | undefined;
	const views = new Map<string, string>();
	class FittingPreview extends HTMLElement {
		connectedCallback() {
			const family = this.getAttribute("family");
			if (!family || !isFittingFamily(family)) return;
			const image = document.createElement("img");
			image.width = 144;
			image.height = 84;
			image.alt = family + " 3D preview";
			const button = document.createElement("button");
			button.type = "button";
			button.title = "Rotate fitting";
			button.setAttribute("aria-label", "Rotate " + family + " preview");
			button.style.cssText =
				"border:0;background:transparent;cursor:grab;padding:0";
			button.append(image);
			this.replaceChildren(button);
			let step = 0;
			function draw(selected: FittingFamily) {
				const id = selected + step;
				let src = views.get(id);
				if (!src) {
					studio ??= fittingStudio();
					studio.show(selected, 0.87 + (step * Math.PI) / 4, 288, 168);
					src = studio.renderer.domElement.toDataURL();
					views.set(id, src);
				}
				image.src = src;
			}
			draw(family);
			button.onclick = () => {
				step = (step + 1) % 8;
				draw(family);
			};
		}
	}
	customElements.define("seelite-fitting", FittingPreview);
}
