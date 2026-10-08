import { mkdir, writeFile } from 'node:fs/promises';
import { launchChromium, guardedOrigin } from '../../scripts/probe-guard.mjs';
import { assertBrowserRenderer } from '../../scripts/lib/players-renderer.mjs';
const origin='http://127.0.0.1:5192';
const label=process.argv[2]??'round-1';
const out=`.dream-loop/${label}`;
await mkdir(out,{recursive:true});
await guardedOrigin(origin);
const browser=await launchChromium({headless:false});
try{
 const page=await browser.newPage({viewport:{width:1586,height:992},deviceScaleFactor:1});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(`${origin}/spikes/courier-cockpit/`);
 await page.waitForFunction(()=>window.__cockpit?.stats.loaded,{},{timeout:60000});
 const gpu=await assertBrowserRenderer(page,'capture cockpit');
 await page.waitForTimeout(1800);
 await page.evaluate(()=>window.__cockpit.capture());
 for(const view of ['pilot','orbit','instruments','side']){
  await page.evaluate(v=>window.__cockpit.setView(v),view);
  await page.waitForTimeout(700);
  await page.screenshot({path:`${out}/${view}.png`});
 }
 await page.evaluate(()=>{window.__cockpit.setView('orbit');window.__cockpit.setFit(true);});
 await page.screenshot({path:`${out}/fit.png`});
 await page.evaluate(()=>{window.__cockpit.setFit(false);window.__cockpit.setView('pilot');document.body.classList.remove('capture');});
 await page.waitForTimeout(1200);
 await page.screenshot({path:`${out}/viewer.png`});
 const metrics=await page.evaluate(()=>({...window.__cockpit.stats}));
 await page.locator('[data-view=orbit]').click();
 const before=await page.evaluate(()=>window.__cockpit.camera.position.toArray());
 await page.mouse.move(790,430);await page.mouse.down();await page.mouse.move(910,500,{steps:8});await page.mouse.up();
 await page.waitForTimeout(500);
 const after=await page.evaluate(()=>window.__cockpit.camera.position.toArray());
 if(before.every((v,i)=>Math.abs(v-after[i])<.001))throw Error('Orbit control did not move camera');
 await page.locator('#target').click();await page.locator('#target-dialog:not([hidden])').waitFor();
 await page.keyboard.press('Escape');if(await page.locator('#target-dialog').isVisible())throw Error('Target dialog did not close');
 await page.locator('[data-view=pilot]').click();
 const aim=await page.evaluate(()=>window.__cockpit.controls.target.toArray());
 await page.mouse.move(790,430);await page.mouse.down();await page.mouse.move(830,440,{steps:5});await page.mouse.up();
 const moved=await page.evaluate(()=>window.__cockpit.controls.target.toArray());
 if(aim.every((v,i)=>Math.abs(v-moved[i])<.001))throw Error('Pilot look did not move');
 await page.keyboard.press('p');
 await page.locator('#lights').click();if(await page.locator('#lights').getAttribute('aria-pressed')!=='true')throw Error('Work lights did not toggle');
 await page.locator('#lights').click();
 await page.setViewportSize({width:900,height:700});await page.waitForTimeout(500);await page.screenshot({path:`${out}/narrow.png`});
 const result={gpu,errors,...metrics,controls:'orbit, pilot look, target dialog, reset, lights passed'};
 await writeFile(`${out}/metrics.json`,JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
 if(errors.length)throw Error('Browser errors');
}finally{await browser.close();}
