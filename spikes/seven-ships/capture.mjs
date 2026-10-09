import { mkdir, writeFile } from 'node:fs/promises';
import { launchChromium, guardedOrigin } from '../../scripts/probe-guard.mjs';
import { assertBrowserRenderer } from '../../scripts/lib/players-renderer.mjs';
import { holdProbeLockOrExit } from '../../scripts/lib/probe-lock.mjs';
const roles=process.argv.slice(3);if(!roles.length)roles.push('interceptor','patrol','explorer','raider','carrier','prospector','dreadnought');
const label=process.argv[2]??'round-1';
if(!/^[\w-]+$/.test(label)||roles.some(r=>!['interceptor','patrol','explorer','raider','carrier','prospector','dreadnought'].includes(r)))throw Error('Invalid capture arguments');
const origin='http://127.0.0.1:5227';
await guardedOrigin(origin);
const release=await holdProbeLockOrExit('seven ship exterior capture');
let browser;
try{
 browser=await launchChromium({channel:'chromium',headless:true});
 for(const role of roles){
  const out=`.dream-loop/${label}/${role}`;await mkdir(out,{recursive:true});
  const page=await browser.newPage({viewport:{width:1536,height:1024},deviceScaleFactor:1});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`${origin}/spikes/seven-ships/?ship=${role}`);
  await page.waitForFunction(()=>window.__fleet?.stats.loaded,null,{timeout:90000});
  const gpu=await assertBrowserRenderer(page,'seven ships '+role);
  await page.waitForTimeout(3500);
  await page.evaluate(()=>window.__fleet.capture());
  for(const view of ['hero','front','top','rear','detail','under']){
   await page.evaluate(v=>window.__fleet.setView(v),view);await page.waitForTimeout(500);
   await page.screenshot({path:`${out}/${view}.png`});
  }
  await page.evaluate(()=>{window.__fleet.setView('hero');document.body.classList.remove('capture');});
  await page.waitForTimeout(1200);await page.screenshot({path:`${out}/viewer.png`});
  const metrics=await page.evaluate(()=>({...window.__fleet.stats}));
  const a=await page.evaluate(()=>window.__fleet.camera.position.toArray());
  await page.mouse.move(700,400);await page.mouse.down();await page.mouse.move(850,470,{steps:8});await page.mouse.up();
  await page.waitForTimeout(300);
  const b=await page.evaluate(()=>window.__fleet.camera.position.toArray());
  if(a.every((v,i)=>Math.abs(v-b[i])<.01))throw Error('Orbit failed');
  await page.locator('#target').click();await page.locator('#target-dialog').waitFor({state:'visible'});await page.keyboard.press('Escape');
  await page.locator('#lights').click();if(await page.locator('#lights').getAttribute('aria-pressed')!=='true')throw Error('Lights failed');await page.locator('#lights').click();
  await page.locator('#spin').click();const rot=await page.evaluate(()=>window.__fleet.ship.rotation.y);await page.waitForTimeout(250);
  if(await page.evaluate(r=>window.__fleet.ship.rotation.y===r,rot))throw Error('Spin failed');await page.locator('#spin').click();
  if(role==='explorer'){
   const start=await page.evaluate(()=>({angle:window.__fleet.rotor.rotation.z,time:performance.now()}));
   await page.locator('#habitat').click();await page.waitForTimeout(2000);await page.locator('#habitat').click();
   const end=await page.evaluate(()=>({angle:window.__fleet.rotor.rotation.z,time:performance.now()}));
   const rpm=(end.angle-start.angle)/(end.time-start.time)*60000/(2*Math.PI);metrics.measuredRotorRPM=rpm;
   if(rpm<2.7||rpm>3.3)throw Error('Habitat rotation rate wrong: '+rpm);
  }
  const downloadPromise=page.waitForEvent('download');await page.locator('#save').click();const download=await downloadPromise;if(!download.suggestedFilename().endsWith('.png'))throw Error('Export failed');await download.delete();
  const report={gpu,errors,...metrics,controls:'orbit, target, lights, rotation, presets, PNG export passed'};
  await writeFile(`${out}/metrics.json`,JSON.stringify(report,null,2));
  console.log(role,JSON.stringify(report));await page.close();if(errors.length)throw Error('Browser errors');
 }
}finally{await browser?.close();release();}
