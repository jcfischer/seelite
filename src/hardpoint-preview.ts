import * as THREE from "three";
import { conceptEstimate, isConcept } from "./concept-estimates";
import { fittingFamilies } from "./fitting-families";
import { buildFitting } from "./hardpoint-model";
import { isFittingFamily, type FittingFamily } from "./fitting-families";

export const fittingPreviewSteps = 8;

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
		step: number,
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
		const angle = 0.87 + (step * 2 * Math.PI) / fittingPreviewSteps;
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
					studio.show(selected, step, 288, 168);
					src = studio.renderer.domElement.toDataURL();
					views.set(id, src);
				}
				image.src = src;
			}
			draw(family);
			button.onclick = () => {
				step = (step + 1) % fittingPreviewSteps;
				draw(family);
			};
		}
	}
	customElements.define("seelite-fitting", FittingPreview);
	class FittingBrowser extends HTMLElement {
		connectedCallback() {
			const picker = document.createElement("select");
			picker.setAttribute("aria-label", "Hardpoint model");
			for (const family of fittingFamilies) {
				const name = family.replaceAll("-", " ");
				picker.add(
					new Option(
						name[0].toUpperCase() +
							name.slice(1) +
							(isConcept(family) ? " · Concept" : ""),
						family,
					),
				);
			}
			const result = document.createElement("div");
			const show = () => {
				const family = picker.value;
				if (!isFittingFamily(family)) return;
				const model = document.createElement("seelite-fitting");
				model.setAttribute("family", family);
				result.replaceChildren(model);
				if (isConcept(family)) {
					const estimate = conceptEstimate(family);
					const stats = document.createElement("p");
					stats.textContent = `Size ${estimate.size} · Grade E estimates (all projectiles hit)\n${estimate.dps.toFixed(1)} sustained DPS · ${estimate.priceCr.toLocaleString("en-US")} Cr proposed\n${estimate.value.toFixed(2)} DPS per 1,000 Cr`;
					result.append(stats);
				}
			};
			picker.onchange = show;
			this.replaceChildren(picker, result);
			const details = this.closest("details");
			if (details)
				details.ontoggle = () => {
					if (details.open && !result.firstChild) show();
				};
			if (!details || details.open) show();
		}
	}
	customElements.define("seelite-fitting-browser", FittingBrowser);
}
