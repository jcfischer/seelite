import { mkdir, writeFile } from 'node:fs/promises';
import { PNG } from 'pngjs';
import { launchChromium, guardedOrigin } from '../../scripts/probe-guard.mjs';
import { assertBrowserRenderer } from '../../scripts/lib/players-renderer.mjs';
import { holdProbeLockOrExit } from '../../scripts/lib/probe-lock.mjs';
const origin='http://127.0.0.1:5227';
const roles=process.argv.slice(2);
if(!roles.length)roles.push('interceptor','patrol','explorer','raider','carrier','prospector','dreadnought');
if(roles.some(r=>!['interceptor','patrol','explorer','raider','carrier','prospector','dreadnought'].includes(r)))throw Error('Invalid role');
await guardedOrigin(origin);
const release=await holdProbeLockOrExit('seven ships LOD capture');
let browser;
function changed(a,b) {
 let n=0;for(let i=0;i<a.data.length;i+=4)if(Math.max(...[0,1,2].map(c=>Math.abs(a.data[i+c]-b.data[i+c])))>24)n++;
 return n;
}
try {
 browser=await launchChromium({channel:'chromium',headless:true});
 for(const role of roles) {
  const out=`spikes/seven-ships/review/lod/${role}`;await mkdir(out,{recursive:true});
  const page=await browser.newPage({viewport:{width:1536,height:1024},deviceScaleFactor:1});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`${origin}/spikes/seven-ships/?ship=${role}`);
  await page.waitForFunction(()=>window.__fleet?.stats.loaded,null,{timeout:90000});
  const gpu=await assertBrowserRenderer(page,'seven ship LOD '+role);
  const report={role,gpu,errors,levels:{},transitions:[],pop:{}};
  for(const level of ['full','reduced','outline']) {
   await page.locator('#lod').selectOption(level);
   await page.waitForFunction(l=>window.__fleet.stats.lod===l,level);
   await page.waitForTimeout(600);
   const visible=await page.evaluate(()=>Object.entries(window.__fleet.levels).filter(([,o])=>o.visible).map(([n])=>n));
   if(visible.length!==1||visible[0]!==level)throw Error('More than one level drawn');
   await page.evaluate(()=>window.__fleet.capture());
   await page.screenshot({path:`${out}/${level}.png`});
   report.levels[level]=await page.evaluate(()=>({...window.__fleet.stats}));
   await page.evaluate(()=>document.body.classList.remove('capture'));
   if(role==='carrier') {
    await page.locator('[data-view="rear"]').click();await page.waitForTimeout(300);
    await page.evaluate(()=>window.__fleet.capture());await page.screenshot({path:`${out}/${level}-rear.png`});
    await page.evaluate(()=>document.body.classList.remove('capture'));
    await page.locator('[data-view="hero"]').click();
   }
  }
  await page.locator('#lod').selectOption('auto');
  for(const [range,expected] of [[44,'reduced'],[440,'outline']]) {
   await page.locator(`[data-range="${range}"]`).click();
   await page.waitForFunction(l=>window.__fleet.stats.lod===l,expected);
   report.transitions.push(await page.evaluate(()=>({...window.__fleet.stats})));
   // Same camera, full twice, then reduced: measure material/normal change as
   // well as geometry. A geometric error bound alone is not a pixel guarantee.
   await page.locator('#lod').selectOption('full');await page.waitForTimeout(200);
   await page.evaluate(()=>window.__fleet.capture());
   const full=PNG.sync.read(await page.screenshot({path:`${out}/${expected}-distance-full.png`}));
   const control=PNG.sync.read(await page.screenshot());
   await page.evaluate(()=>window.__fleet.ship.visible=false);await page.waitForTimeout(100);
   const empty=PNG.sync.read(await page.screenshot());
   await page.evaluate(()=>{window.__fleet.ship.visible=true;document.body.classList.remove('capture');});
   await page.locator('#lod').selectOption(expected);await page.waitForTimeout(200);
   await page.evaluate(()=>window.__fleet.capture());
   const level=PNG.sync.read(await page.screenshot({path:`${out}/${expected}-distance-lod.png`}));
   report.pop[expected]={fullFootprintPixels:changed(full,empty),controlChangedPixels:changed(full,control),lodChangedPixels:changed(full,level)};
   await page.evaluate(()=>document.body.classList.remove('capture'));
   await page.locator('#lod').selectOption('auto');
  }
  await page.locator('[data-view="hero"]').click();
  await page.waitForFunction(()=>window.__fleet.stats.lod==='full');
  if(['explorer','carrier','dreadnought'].includes(role)) {
   await page.locator('#habitat').click();await page.waitForTimeout(600);await page.locator('#habitat').click();
   const angles=await page.evaluate(()=>window.__fleet.rotors.map(r=>r.rotation.z));
   if(angles.length!==3||angles.some(a=>a<=0||Math.abs(a-angles[0])>1e-8))throw Error('LOD habitat phases differ');
   report.rotors='three synchronized habitat rotors';
  }
  if(errors.length)throw Error(errors.join('\n'));
  await writeFile(`${out}/metrics.json`,JSON.stringify(report,null,2)+'\n');
  console.log(role,JSON.stringify({triangles:Object.fromEntries(Object.entries(report.levels).map(([l,s])=>[l,s.modelTriangles])),pop:report.pop,errors}));
  await page.close();
 }
}finally{await browser?.close();release();}
