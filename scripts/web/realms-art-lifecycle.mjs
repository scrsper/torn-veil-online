import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
const out=resolve('.debug/realms/art-lifecycle');mkdirSync(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:false});
const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[],checks=[],observations=[];
page.on('pageerror',e=>errors.push(String(e)));
const read=()=>page.evaluate(()=>window.tvRealms.inspect());
const ready=()=>page.waitForFunction(()=>window.tvRealms?.ready,null,{timeout:90000});
const wait=fn=>page.waitForFunction(fn,null,{timeout:45000});
const hold=async(k,ms)=>{await page.keyboard.down(k);await page.waitForTimeout(ms);await page.keyboard.up(k);await page.waitForTimeout(350);};
let result='failed';
try {
  await page.goto('http://127.0.0.1:7510/?realms');await ready();
  const initial=(await read()).state;assert.equal(initial.realm,'aether');
  await page.locator('#rv-tower').click();
  await wait(()=>Math.hypot(window.tvRealms.state.body.pos.x-3120.5,window.tvRealms.state.body.pos.z-3120.5)<.6);
  if((await read()).state.prompt.includes('Close Tower'))await page.keyboard.press('KeyE');
  await wait(()=>window.tvRealms.inspect().towerDoors[0]?.enabled);
  assert.ok((await read()).towerDoors[0].panels.every(Boolean));
  await hold('KeyW',1000);assert.ok((await read()).state.body.pos.z<3122);checks.push('closed canonical door blocks movement; all leaf decorations visible');
  await page.keyboard.press('KeyE');await wait(()=>window.tvRealms.inspect().towerDoors[0]?.enabled===false);
  assert.ok((await read()).towerDoors[0].panels.every(x=>!x));
  await hold('KeyW',1200);assert.equal((await read()).state.tower,true);checks.push('open canonical door and all child panels clear the traversable aperture');
  await page.screenshot({path:resolve(out,'open-door-atrium.png')});
  for(let i=0;i<4;i++) {
    await page.locator('#rv-portal').click();await wait(()=>window.tvRealms.state.prompt.includes('Cross the Veil'));
    await page.keyboard.press('KeyE');await page.locator('#rv-cross').click();
    const expected=i%2?'aether':'brass';await page.waitForFunction(r=>window.tvRealms?.state.realm===r,expected);await ready();
    await page.waitForTimeout(1500);const o=await read();
    assert.equal(o.loaded,81);assert.equal(o.lights,4);assert.deepEqual(o.state.person,initial.person);assert.equal(o.state.body.id,initial.body.id);
    observations.push({realm:expected,meshes:o.meshes,materials:o.materials,textures:o.textures,lights:o.lights,heap:o.heap});
  }
  for(let i=0;i<2;i++)for(const field of ['meshes','materials','textures','lights'])assert.equal(observations[i][field],observations[i+2][field],`${field} grew on returning to ${observations[i].realm}`);
  checks.push('four crossings preserve identity/inventory/rank, 81 resident chunks and four total lights');
  checks.push('warmed meshes, textures, materials and lights remain stable after repeated realm returns');
  assert.equal(errors.length,0);result='passed';
}catch(e){errors.push(String(e));console.error(String(e));}
finally{writeFileSync(resolve(out,'report.json'),JSON.stringify({result,checks,observations,errors,note:'Actual ordinary-input browser lifecycle check; resource counts are renderer observations, not VRAM measurements.'},null,2));await browser.close();}
console.log(JSON.stringify({result,checks,observations,errors},null,2));if(result!=='passed')process.exitCode=1;
