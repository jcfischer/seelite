/** #685 prototype: expensive volume integration happens once on arrival.
 * The result is the same equirectangular image for sky and reflected light.
 */
import * as THREE from "three";
import { galaxyToSystem, skyFrame } from "./galaxy-frame";
import { generateNebulae, NEBULA_COUNT, NEBULA_PALETTES } from "./nebula";
import type { Vec3 } from "./vec3";

export const NEBULA_BAKE_WIDTH = 2048;
export const NEBULA_GAIN = 1.275;

export function nebulaOptions(search: string) {
	const query = new URLSearchParams(search);
	const width = Number(query.get("nebula-resolution") ?? NEBULA_BAKE_WIDTH);
	const gain = Number(query.get("nebula-gain") ?? NEBULA_GAIN);
	return {
		enabled: query.get("nebula") !== "off",
		width: [512, 1024, 2048, 4096].includes(width) ? width : NEBULA_BAKE_WIDTH,
		gain: Number.isFinite(gain) ? Math.min(10, Math.max(0, gain)) : NEBULA_GAIN,
	};
}

const fragmentShader = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D baseSky;
uniform vec3 observer;
uniform vec3 gx,gy,gz;
uniform vec4 clouds[${NEBULA_COUNT}];
uniform float seeds[${NEBULA_COUNT}];
uniform vec3 gasColors[${NEBULA_COUNT}];
uniform vec3 filamentColors[${NEBULA_COUNT}];
uniform float gain;
float hash(vec3 p) {
 p=fract(p*0.1031); p+=dot(p,p.yzx+33.33);
 return fract((p.x+p.y)*p.z);
}
float noise(vec3 p) {
 vec3 i=floor(p),f=fract(p); f=f*f*(3.0-2.0*f);
 return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x),mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z);
}
const mat3 turn=mat3(0.00,0.80,0.60,-0.80,0.36,-0.48,-0.60,-0.48,0.64);
float fbm(vec3 p) {
 float n=0.0,a=0.5;
 for(int i=0;i<6;i++){ n+=a*noise(p);p=turn*p*2.04+3.7;a*=0.5; }
 return n;
}
float branchDistance(vec3 p,vec3 a,vec3 b,float ra,float rb) {
 float t=clamp(dot(p-a,b-a)/dot(b-a,b-a),0.0,1.0);
 return length(p-mix(a,b,t))/mix(ra,rb,t);
}
vec3 cloudLight(vec3 rd,vec4 cloud,float seed,vec3 gasColor,vec3 filamentColor) {
 vec3 ro=(observer-cloud.xyz)/cloud.w;
 float b=dot(ro,rd),disc=b*b-dot(ro,ro)+1.0;
 if(disc<=0.0)return vec3(0);
 float h=sqrt(disc),begin=max(0.0,-b-h),end=-b+h;
 if(end<=begin)return vec3(0);
 float stepLength=(end-begin)/96.0;
 vec3 light=vec3(0);float trans=1.0;
 vec3 offset=vec3(seed,seed*0.37,seed*0.71);
 vec3 by=normalize(vec3(hash(offset+1.0),hash(offset+2.0),hash(offset+3.0))-0.5);
 vec3 bx=normalize(cross(by,abs(by.y)<0.9?vec3(0,1,0):vec3(1,0,0)));
 vec3 bz=cross(bx,by);
 float fork=hash(offset+5.0);
 vec3 top=vec3(0.10+0.25*(fork-0.5),0.65,0.12);
 vec3 left=vec3(-0.58,0.1+0.35*hash(offset+6.0),-0.16);
 vec3 right=vec3(0.60,0.40-0.55*hash(offset+7.0),0.14);
 for(int i=0;i<96;i++) {
  // Remaining emission is bounded below 0.0001 at the approved gain.
  if(trans<0.000001)break;
  vec3 q=ro+rd*(begin+(float(i)+0.5)*stepLength);
  // The sphere is only an integration bound, never the visible cloud shape.
  q=vec3(dot(q,bx),dot(q,by),dot(q,bz));
  vec3 p=q*3.8+offset;
  vec3 warp=vec3(fbm(p+11.3),fbm(p.yzx+29.1),fbm(p.zxy-7.2))-0.5;
  vec3 shape=q+warp*0.36;
  shape.x+=0.16*sin(shape.y*5.0+seed);
  float trunkShape=branchDistance(shape,vec3(-0.13,-0.67,-0.12),top,0.16,0.24);
  float leftShape=branchDistance(shape,vec3(0,-0.20,0),left,0.25,0.075);
  float rightShape=branchDistance(shape,vec3(0,0.12,0),right,0.24,0.065);
  float shapeDistance=min(trunkShape,min(leftShape,rightShape));
  float ragged=fbm(p*0.82);
  float envelope=1.0-smoothstep(0.48,1.45,shapeDistance+1.3*(ragged-0.46));
  if(envelope<=0.0)continue;
  p+=warp*2.4;
  float field=fbm(p*1.45);
  float detail=fbm(p*5.0);
  float ridge=pow(max(0.0,1.0-abs(field-0.49)*7.0),2.5);
  float structure=smoothstep(0.22,0.52,fbm(p*0.46));
  float gas=envelope*ridge*pow(detail,2.0)*3.0*structure;
  float vein=fbm(q*2.2+offset+91.0);
  float trunk=abs(q.x+0.28*sin(q.y*3.0)+0.20*(vein-0.5));
  float branch=abs(q.x-q.y*0.75+0.17*(field-0.5));
  float lane=min(trunk,branch);
  float darkRift=1.0-smoothstep(0.035,0.16,lane+0.16*(detail-0.5));
  // Rifts displace luminous gas as well as absorbing background emission.
  // Otherwise foreground gas fills every dark channel for an inside observer.
  gas*=1.0-darkRift*0.98;
  float dustEnvelope=envelope;
  float dust=envelope*smoothstep(0.50,0.59,field)*3.0+dustEnvelope*darkRift*12.0;
  float highlight=smoothstep(0.44,0.68,fbm(p*0.65+35.0));
  vec3 color=mix(gasColor,filamentColor,highlight);
  float luminance=dot(color,vec3(0.2126,0.7152,0.0722));
  color=mix(vec3(luminance),color,0.78);
  float extinction=dust+gas*0.65;
  float alpha=1.0-exp(-extinction*stepLength*3.0);
  light+=trans*color*gas*stepLength*gain*2.0;
  trans*=1.0-alpha;
 }
 return light;
}
void main(){
 float lon=(vUv.x-0.5)*6.28318530718,lat=(vUv.y-0.5)*3.14159265359;
 vec3 world=vec3(cos(lon)*cos(lat),sin(lat),sin(lon)*cos(lat));
 vec3 rd=vec3(dot(world,gx),dot(world,gy),dot(world,gz));
 vec3 radiance=texture2D(baseSky,vUv).rgb;
 for(int j=0;j<${NEBULA_COUNT};j++)radiance+=cloudLight(rd,clouds[j],seeds[j],gasColors[j],filamentColors[j]);
 gl_FragColor=vec4(radiance,1.0);
}`;

/** Scissored full-size viewports preserve UVs while bounding each GPU draw. */
export function nebulaBakeStrips(width: number, height: number) {
	const rows = Math.max(1, Math.floor(16384 / width));
	return Array.from({ length: Math.ceil(height / rows) }, (_, i) => ({
		y: i * rows,
		height: Math.min(rows, height - i * rows),
	}));
}
export interface NebulaBakeJob {
	ready: Promise<THREE.WebGLRenderTarget | null>;
	cancel(): void;
	stats: { strips: number; submitMs: number; elapsedMs: number };
}
export function startNebulaBake(
	renderer: THREE.WebGLRenderer,
	base: THREE.Texture,
	world: {
		worldSeed: number;
		galaxy: number;
		record: { seed: number; pos: Vec3 };
	},
	options: { width: number; gain: number },
): NebulaBakeJob {
	const { worldSeed, galaxy, record } = world;
	const { width, gain } = options;
	const started = performance.now();
	const stats = { strips: 0, submitMs: 0, elapsedMs: 0 };
	if (!renderer.extensions.has("EXT_color_buffer_float"))
		return { ready: Promise.resolve(null), cancel() {}, stats };
	const clouds = generateNebulae(worldSeed, galaxy);
	const frame = skyFrame(record.seed);
	const axis = (v: Vec3) => {
		const a = galaxyToSystem(frame, v);
		return new THREE.Vector3(a.x, a.y, a.z);
	};
	const target = new THREE.WebGLRenderTarget(width, width / 2, {
		type: THREE.HalfFloatType,
		format: THREE.RGBAFormat,
		depthBuffer: false,
		stencilBuffer: false,
		magFilter: THREE.LinearFilter,
		minFilter: THREE.LinearFilter,
	});
	target.texture.mapping = THREE.EquirectangularReflectionMapping;
	target.texture.colorSpace = THREE.LinearSRGBColorSpace;
	const material = new THREE.ShaderMaterial({
		vertexShader:
			"varying vec2 vUv; void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}",
		fragmentShader,
		uniforms: {
			baseSky: { value: base },
			observer: {
				value: new THREE.Vector3(record.pos.x, record.pos.y, record.pos.z),
			},
			gx: { value: axis({ x: 1, y: 0, z: 0 }) },
			gy: { value: axis({ x: 0, y: 1, z: 0 }) },
			gz: { value: axis({ x: 0, y: 0, z: 1 }) },
			clouds: {
				value: clouds.map(
					(c) =>
						new THREE.Vector4(c.center.x, c.center.y, c.center.z, c.radiusLy),
				),
			},
			gasColors: {
				value: clouds.map(
					(c) => new THREE.Vector3(...NEBULA_PALETTES[c.palette].gas),
				),
			},
			filamentColors: {
				value: clouds.map(
					(c) => new THREE.Vector3(...NEBULA_PALETTES[c.palette].filament),
				),
			},
			seeds: { value: clouds.map((c) => (c.seed % 10000) / 97) },
			gain: { value: gain },
		},
		depthTest: false,
		depthWrite: false,
		toneMapped: false,
	});
	const geometry = new THREE.PlaneGeometry(2, 2),
		scene = new THREE.Scene();
	scene.add(new THREE.Mesh(geometry, material));
	const camera = new THREE.Camera();
	const strips = nebulaBakeStrips(width, width / 2);
	let animationFrame = 0,
		done = false;
	let resolve!: (value: THREE.WebGLRenderTarget | null) => void;
	const ready = new Promise<THREE.WebGLRenderTarget | null>((r) => {
		resolve = r;
	});
	const finish = (keep: boolean) => {
		if (done) return;
		done = true;
		cancelAnimationFrame(animationFrame);
		geometry.dispose();
		material.dispose();
		if (!keep) target.dispose();
		stats.elapsedMs = performance.now() - started;
		resolve(keep ? target : null);
	};
	const step = () => {
		if (done) return;
		const previous = renderer.getRenderTarget();
		const face = renderer.getActiveCubeFace(),
			mip = renderer.getActiveMipmapLevel();
		const viewport = renderer.getViewport(new THREE.Vector4());
		const scissor = renderer.getScissor(new THREE.Vector4());
		const scissorTest = renderer.getScissorTest();
		const xr = renderer.xr.enabled,
			autoClear = renderer.autoClear;
		const strip = strips[stats.strips];
		const start = performance.now();
		try {
			renderer.xr.enabled = false;
			renderer.autoClear = false;
			target.scissorTest = true;
			target.scissor.set(0, strip.y, width, strip.height);
			renderer.setRenderTarget(target);
			const gl = renderer.getContext();
			if (
				gl.isContextLost() ||
				gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE
			) {
				finish(false);
				return;
			}
			renderer.render(scene, camera);
			stats.strips++;
		} catch (error) {
			console.warn("nebula bake unavailable; retaining base sky", error);
			finish(false);
		} finally {
			renderer.setRenderTarget(previous, face, mip);
			renderer.setViewport(viewport);
			renderer.setScissor(scissor);
			renderer.setScissorTest(scissorTest);
			renderer.xr.enabled = xr;
			renderer.autoClear = autoClear;
			stats.submitMs += performance.now() - start;
		}
		if (done) return;
		if (stats.strips === strips.length) finish(true);
		else animationFrame = requestAnimationFrame(step);
	};
	animationFrame = requestAnimationFrame(step);
	return { ready, cancel: () => finish(false), stats };
}
