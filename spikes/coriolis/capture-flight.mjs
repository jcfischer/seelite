import {createServer} from 'vite';
import {mkdir,writeFile} from 'node:fs/promises';
import {guardedOrigin,launchChromium,bootedGame} from '../../scripts/probe-guard.mjs';
import {gameUrl} from '../../scripts/lib/game-url.mjs';
const server=await createServer({server:{host:'127.0.0.1',port:5187,strictPort:true}});await server.listen();
const origin='http://127.0.0.1:5187';await guardedOrigin(origin);
await mkdir('.dream-loop/flight',{recursive:true});
const browser=await launchChromium({headless:false});
try{
 const page=await browser.newPage({viewport:{width:1440,height:1000},deviceScaleFactor:1});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(gameUrl(origin,{seed:42,system:0,'no-save':true,'coriolis-start':'approach',fps:true}));
 await bootedGame(page,90000);await page.waitForTimeout(3500);
 const initial=await page.evaluate(()=>{
  const g=window.__seelite;const scenes=[g.nearScene,g.approachScene,g.farScene];
  const exterior=scenes.map(s=>s.getObjectByName('industrial-coriolis-exterior')).find(Boolean);
  if(!exterior)throw Error('industrial exterior missing in live scenes');
  const gl=g.renderer.getContext();const ext=gl.getExtension('WEBGL_debug_renderer_info');
  return {phase:g.dockPhase,station:g.targetId,snapshot:g.dockingSnapshot(g.targetId),bay:!!exterior.parent.getObjectByName('station-interior'),renderer:gl.getParameter(ext.UNMASKED_RENDERER_WEBGL),storeAttached:!!g.saveStore,frames:g.frames};
 });
 await page.screenshot({path:'.dream-loop/flight/approach.png'});
 await page.evaluate(()=>{const g=window.__seelite;for(const scene of [g.nearScene,g.approachScene,g.farScene]){const root=scene.getObjectByName('industrial-coriolis-spinner');if(root)root.getObjectByName('station-interior').visible=false;}g.render(0);});
 await page.screenshot({path:'.dream-loop/flight/exterior-only.png'});
 await page.evaluate(()=>{const g=window.__seelite;for(const scene of [g.nearScene,g.approachScene,g.farScene]){const root=scene.getObjectByName('industrial-coriolis-spinner');if(root)root.getObjectByName('station-interior').visible=true;}g.render(0);});
 if(!initial.bay||initial.storeAttached||initial.phase!=='flying')throw Error('flight boot invariant failed');
 if(/swiftshader|llvmpipe|software/i.test(initial.renderer))throw Error('hardware renderer required');
 // Real key binding: fly forward, then stop before the docking demonstration.
 await page.keyboard.down('Shift');await page.waitForTimeout(1000);await page.keyboard.up('Shift');
 const flight=await page.evaluate(()=>{const g=window.__seelite;const snap=g.dockingSnapshot(g.targetId);g.clockHeld=true;g.setThrottle(0);return {axialKm:snap.axialKm,frames:g.frames};});
 if(initial.snapshot.axialKm-flight.axialKm<.0001)throw Error('Throttle key did not move ship toward station');
 const docking=await page.evaluate(()=>{
  const g=window.__seelite;const id=g.targetId;const dt=1/60;
  if(!g.hasDockingComputer)g.commander={...g.commander,ownedEquipment:[...g.commander.ownedEquipment,g.dockingComputerName]};
  const grant=g.requestDockingClearance();g.toggleDockingComputer();
  for(let t=0;t<240&&g.dockPhase!=='docked';t+=dt){g.step(dt);if(g.dockPhase==='arriving')g.skipDockTraversal();}
  g.render(0);return {phase:g.dockPhase,grant:grant.state?.clearance.kind,snapshot:g.dockingSnapshot(id)};
 });
 await page.screenshot({path:'.dream-loop/flight/docked.png'});
 if(docking.phase!=='docked')throw Error('real docking failed: '+JSON.stringify(docking));
 const launch=await page.evaluate(()=>{
  const g=window.__seelite;const dt=1/60;let accepted=false;
  for(let t=0;t<240;t+=dt){if(g.dockPhase==='docked')accepted=g.launch()||accepted;g.step(dt);if(g.dockPhase==='flying')break;}
  g.render(0);return {accepted,phase:g.dockPhase,impacts:g.collisionImpacts};
 });
 await page.screenshot({path:'.dream-loop/flight/launched.png'});
 if(!launch.accepted||launch.phase!=='flying')throw Error('real launch failed');
 if(errors.length)throw Error(errors.join('\n'));
 const ordinary=await browser.newPage({viewport:{width:900,height:620}});
 const industrialRequests=[];ordinary.on('request',r=>{if(r.url().includes('coriolis-industrial'))industrialRequests.push(r.url());});
 await ordinary.goto(gameUrl(origin,{seed:42,system:0,'no-save':true}));await bootedGame(ordinary,90000);
 const normalHasIndustrial=await ordinary.evaluate(()=>{const g=window.__seelite;return [g.nearScene,g.approachScene,g.farScene].some(s=>!!s.getObjectByName('industrial-coriolis-exterior'));});
 if(industrialRequests.length !== 1 || !normalHasIndustrial)throw Error('ordinary game did not load the default Coriolis');
 await ordinary.close();
 const report={initial,flight,docking,launch,errors,ordinary:{industrialRequests:industrialRequests.length,hasIndustrial:normalHasIndustrial}};
 await writeFile('.dream-loop/flight/report.json',JSON.stringify(report,null,2));
 console.log(JSON.stringify(report,null,2));
}finally{await browser.close();await server.close();}
