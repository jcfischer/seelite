import { mkdir, writeFile } from 'node:fs/promises';
import { guardedOrigin, launchChromium } from '../../scripts/probe-guard.mjs';
import { PNG } from 'pngjs';
import { createServer } from 'vite';
const server=await createServer({server:{host:'127.0.0.1',port:5183,strictPort:true}});
await server.listen();
const origin='http://127.0.0.1:5183';
await guardedOrigin(origin);
const label=process.argv[2]??'round-1';
await mkdir(`.dream-loop/${label}`,{recursive:true});
const browser=await launchChromium({headless:false});
try {
 const page=await browser.newPage({viewport:{width:1280,height:1280},deviceScaleFactor:1});
 const errors=[];
 page.on('pageerror',e=>{errors.push(e.message);console.error(e.message)});
 page.on('console',m=>{if(m.type()==='error')console.error(m.text())});
 await page.goto(`${origin}/spikes/coriolis/`);
 await page.waitForFunction(()=>window.__coriolis?.stats.loaded,{},{timeout:60000});
 await page.evaluate(()=>window.__coriolis.capture());
 const renderer=await page.evaluate(()=>{
  const gl=window.__coriolis.renderer.getContext();
  const ext=gl.getExtension('WEBGL_debug_renderer_info');
  return ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):null;
 });
 if (!renderer || /swiftshader|llvmpipe|software/i.test(renderer))throw Error(`Hardware renderer required: ${renderer}`);
 for (const view of ['hero','front','detail','rear']) {
  await page.evaluate(view=>window.__coriolis.setView(view),view);
  await page.waitForTimeout(1500);
  const buffer=await page.screenshot({path:`.dream-loop/${label}/${view}.png`});
  const png=PNG.sync.read(buffer);let visible=0;
  for(let i=0;i<png.data.length;i+=4)if(Math.max(png.data[i],png.data[i+1],png.data[i+2])>25)visible++;
  if(visible/(png.width*png.height)<.1)throw Error(`Station not visibly rendered in ${view}`);
 }
 await page.evaluate(()=>window.__coriolis.setView('hero'));
 await page.waitForTimeout(3500);
 const metrics=await page.evaluate(async()=>{
  const THREE=await import('/node_modules/.vite/deps/three.js');
  const app=window.__coriolis;
  app.station.updateMatrixWorld(true);
  let reach=0,triangles=0,meshes=0;
  const point=new THREE.Vector3();
  app.station.traverse(o=>{
   if (!o.isMesh)return;
   meshes++;
   const a=o.geometry.attributes.position;
   triangles+=(o.geometry.index?.count??a.count)/3;
   for(let i=0;i<a.count;i++){
    point.fromBufferAttribute(a,i).applyMatrix4(o.matrixWorld);
    reach=Math.max(reach,point.length());
   }
  });
  const rays=[];
  for(const x of [-.059,0,.059])for(const y of [-.034,0,.034]){
   const ray=new THREE.Raycaster(new THREE.Vector3(x,y,.55),new THREE.Vector3(0,0,-1));
   const hits=ray.intersectObject(app.station,true);
   rays.push({x,y,firstZ:hits[0]?.point.z??null});
  }
  return {reachKm:reach,triangles,meshes,rays,stats:app.stats};
 });
 // Exercise the public controls after collecting industrial-only geometry.
 await page.evaluate(()=>document.body.classList.remove('capture'));
 await page.locator('#original').click();
 await page.waitForFunction(()=>window.__coriolis.stats.selected==='original');
 await page.locator('#new').click();
 await page.waitForFunction(()=>window.__coriolis.stats.selected==='industrial');
 for(const view of ['front','detail','rear','hero'])await page.locator(`[data-view="${view}"]`).click();
 const before=await page.evaluate(()=>window.__coriolis.camera.position.toArray());
 await page.mouse.move(640,640);await page.mouse.down();
 await page.mouse.move(710,675,{steps:6});await page.mouse.up();
 await page.waitForTimeout(300);
 const after=await page.evaluate(()=>window.__coriolis.camera.position.toArray());
 if(before.every((v,i)=>Math.abs(v-after[i])<1e-6))throw Error('Orbit drag did not move camera');
 await page.locator('[data-view="hero"]').click();
 await page.screenshot({path:`.dream-loop/${label}/viewer.png`});
 const result={renderer,errors,...metrics};
 await writeFile(`.dream-loop/${label}/metrics.json`,JSON.stringify(result,null,2));
 console.log(JSON.stringify(result,null,2));
 if(errors.length)throw Error('Browser errors');
 if(metrics.reachKm>.62)throw Error('Display reach exceeds 0.62 km');
 if(metrics.rays.some(r=>r.firstZ!==null&&r.firstZ>.34))throw Error('Dock opening or first 88m of display tunnel obstructed');
}finally{await browser.close();await server.close();}
