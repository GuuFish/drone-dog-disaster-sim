import assert from 'node:assert/strict';
import {fresh,addEvent,dispatch,step,cancelTask,regressionScenario,startDevices,returnDevices,createDevice,berth,normalizeBerths,coverageRoute,COVERAGE,LOW_BATTERY,DOG_MAX_DISTANCE,platformDeviceCode,task} from './simulation.js';
import {BASE,pathfind,walkable,distance,routeLength,WORLD,river,buildings,height,surfaceHeight} from './terrain.js';
let s=addEvent(fresh(),'person',-2400,-1500,'高'),id=s.events[0].id;
assert.deepEqual(s.devices.map(d=>d.home),[berth('uav',0),berth('uav',1),berth('dog',0),berth('dog',1)]);
assert.ok(s.devices.every(d=>distance(d,d.home)<.01));
assert.deepEqual(s.devices.map(platformDeviceCode),['SIM-UAV-001','SIM-UAV-002','SIM-ROBOT-001','SIM-ROBOT-002']);
assert.ok(s.sessionId&&s.sequence&&s.platformMode===false);
// UAVs and dogs must park on opposite sides of the apron
assert.ok(s.devices.filter(d=>d.type==='uav').every(d=>d.home.x<BASE.x-20));
assert.ok(s.devices.filter(d=>d.type==='dog').every(d=>d.home.x>BASE.x+20));
const extra=createDevice(s,{name:'苍穹 03',type:'uav',cruise:80});assert.equal(extra.berth,4);assert.equal(extra.typeBerth,2);assert.deepEqual(extra.home,berth('uav',2));
const dog=createDevice(s,{name:'猎隼 03',type:'dog',maxDistance:120});assert.equal(dog.maxDistance,120);
const limited=addEvent({...s,devices:[dog]},'person',-2400,-1500,'高');limited.events[0].status='待复核';assert.match(dispatch(limited,limited.events[0].id).error,/作业距离/);
assert.equal(normalizeBerths({version:4,devices:[{type:'dog',berth:0}],events:[],tasks:[],logs:[]}).devices[0].maxDistance,DOG_MAX_DISTANCE);
// removing a device must free its pad, and the next new device must reuse that pad
const trimmed=structuredClone(s);trimmed.devices=trimmed.devices.filter(d=>d.typeBerth!==1||d.type!=='uav');
const refilled=createDevice(trimmed,{name:'苍穹 09',type:'uav',cruise:90});
assert.equal(refilled.typeBerth,1);
assert.ok(refilled.home.x!==extra.home.x||refilled.home.z!==extra.home.z);
// stale saves (old layout, duplicate or missing berth fields) are repaired on load
const stale=structuredClone(fresh());
stale.devices.forEach(d=>{delete d.typeBerth;d.home={x:0,z:0};});
stale.devices[3].berth=stale.devices[2].berth;
const fixed=normalizeBerths(stale);
assert.equal(new Set(fixed.devices.map(d=>d.berth)).size,4);
assert.equal(new Set(fixed.devices.map(d=>`${d.type}:${d.typeBerth}`)).size,4);
assert.ok(fixed.devices.filter(d=>d.type==='uav').every(d=>d.home.x<BASE.x-20));
assert.ok(fixed.devices.filter(d=>d.type==='dog').every(d=>d.home.x>BASE.x+20));
assert.ok(fixed.devices.every(d=>distance(d,d.home)<.01));
assert.ok(distance(BASE,s.events[0])>4000);
s=dispatch(s,id).state;assert.ok(dispatch(s,id).error);assert.ok(s.tasks[0].etaSeconds>200);
for(let i=0;i<200;i++)s=step(s,2);assert.equal(s.events[0].status,'待复核');
s=dispatch(s,id).state;assert.ok(s.tasks[0].totalDistance>4000);assert.ok(s.tasks[0].etaSeconds>1800);
cancelTask(s,s.tasks[0]);assert.equal(s.events[0].status,'待复核');
s=dispatch(s,id).state;for(let i=0;i<2500;i++)s=step(s,2);assert.equal(s.events[0].status,'已处理');assert.equal(s.devices.find(d=>d.type==='dog').state,'原地待命');assert.ok(s.events[0].processedWallTime);
let auto=regressionScenario(fresh());for(let i=0;i<3000;i++)auto=step(auto,2);assert.ok(auto.events.every(e=>e.status==='已处理'));assert.ok(auto.logs.some(l=>l.text.includes('搜索范围内发现')));
const route=pathfind({x:0,z:1400},{x:0,z:2300});assert.ok(route);assert.ok(route.every(p=>walkable(p.x,p.z)));assert.ok(route.some(p=>Math.abs(p.x-river.bridgeX)<=river.bridgeHalf&&Math.abs(p.z-river.z)<=WORLD.cell));assert.ok(routeLength({x:0,z:1400},route)>1200);
assert.ok(buildings.length>50);assert.ok(buildings.every(b=>Math.abs(b.x)<WORLD.width/2&&Math.abs(b.z)<WORLD.depth/2));
let short=dispatch(addEvent(fresh(),'person',1100,1100,'高'),null);assert.ok(short.error);
let fast=dispatch(addEvent(fresh(),'person',1500,1000,'高'),null);assert.ok(fast.error);
let a=regressionScenario(fresh()),b=structuredClone(a);a=step(a,120);for(let i=0;i<60;i++)b=step(b,2);assert.deepEqual(a.devices,b.devices);
const peak=surfaceHeight(-1900,-1500);assert.ok(peak>250&&peak>height(-1900,-1500)-1);
const bd=buildings.find(b=>b.kind==='city');assert.ok(surfaceHeight(bd.x,bd.z)>height(bd.x,bd.z)+bd.h-1);
let air=regressionScenario(fresh());for(let i=0;i<400;i++)air=step(air,2);
for(const d of air.devices.filter(d=>d.type==='uav'))assert.ok(d.y>=surfaceHeight(d.x,d.z)+40,`UAV ${d.name} clipped terrain/building`);
for(const d of air.devices.filter(d=>d.type==='dog'))assert.ok(walkable(d.x,d.z),`dog ${d.name} inside an obstacle`);
let operations=startDevices(fresh());assert.ok(operations.devices.every(d=>d.enabled));assert.ok(operations.auto);
operations=returnDevices(operations);for(let i=0;i<200;i++)operations=step(operations,2);assert.ok(operations.devices.every(d=>d.state==='待命'&&!d.enabled));assert.ok(operations.devices.every(d=>distance(d,d.home)<1));
// search coverage: no blind spots, and multiple UAVs split the region without overlapping
{
 const r=coverageRoute(0,1),xs=r.map(p=>p.x),zs=r.map(p=>p.z);
 assert.ok(Math.min(...xs)<=COVERAGE.x0+.01&&Math.max(...xs)>=COVERAGE.x1-.01,'sweep must span the full width');
 assert.ok(Math.min(...zs)<=COVERAGE.z0+.01&&Math.max(...zs)>=COVERAGE.z1-.01,'sweep must span the full depth');
 const uniq=[...new Set(xs)].sort((a,b)=>a-b);
 for(let i=1;i<uniq.length;i++)assert.ok(uniq[i]-uniq[i-1]<=WORLD.searchRadius*2,`coverage gap ${Math.round(uniq[i]-uniq[i-1])} m exceeds the ${WORLD.searchRadius*2} m search diameter`);
 const half=coverageRoute(1,2);
 assert.ok(Math.max(...coverageRoute(0,2).map(p=>p.x))<=Math.min(...half.map(p=>p.x))+.01,'strips must not overlap');
}
// autonomous search must loop forever: a low battery recharges instead of hard-stopping
{
 let loop=startDevices(fresh());
 const id=loop.devices.find(d=>d.type==='uav').id;
 let prev=loop.devices.find(d=>d.id===id).battery,recharged=false,lowSeen=false;
 for(let i=0;i<9000;i++){
  loop=step(loop,2);const u=loop.devices.find(d=>d.id===id);
  if(u.battery>prev+.01)recharged=true;
  if(u.battery<=LOW_BATTERY)lowSeen=true;
  prev=u.battery;
 }
 const u=loop.devices.find(d=>d.id===id);
 assert.ok(u.enabled,'UAV search must never hard-stop');
 assert.ok(lowSeen&&recharged,'UAV must return and recharge instead of stopping');
 // and a recall command still stops it
 const recalled=returnDevices(loop,id);
 assert.equal(recalled.devices.find(d=>d.id===id).enabled,false);
}
// platform mode keeps local auto-dispatch off and preserves platform task IDs in feedback
{
 let linked=fresh();linked.platformMode=true;linked=startDevices(linked);
 // 平台联动模式下无人机仍执行自主巡航搜索（auto=true），但机器狗绝不被本地自动派单
 assert.ok(linked.auto,'平台联动模式下无人机应保持自主巡航搜索');
 let g=addEvent(linked,'person',BASE.x+220,BASE.z+140,'高');
 g.events[0].status='待复核';
 for(const d of g.devices)d.enabled=true;
 for(let i=0;i<400;i++)g=step(g,2);
 assert.equal(g.tasks.find(t=>g.devices.find(d=>d.id===t.deviceId)?.type==='dog'),undefined,
   '平台联动模式下机器狗不应被本地自动派单');
 const uav=linked.devices.find(d=>d.type==='uav');
 task(linked,uav,'空中侦察',[{x:uav.x+100,z:uav.z}],null,{taskId:77,taskCode:'TSK-LINK-001',commandId:'CMD-LINK-001'});
 const ack=linked.messages.find(m=>m.type==='task.ack');
 assert.equal(ack.payload.taskId,77);assert.equal(ack.payload.taskCode,'TSK-LINK-001');assert.equal(ack.correlationId,'TSK-LINK-001');
}
console.log('PASS: 4+ km target, realistic ETA, completion, full-coverage looping search with recharge, bridge routing, air clearance and dog obstacle avoidance');
