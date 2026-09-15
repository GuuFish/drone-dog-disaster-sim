import {surfaceHeight,pathfind,walkable,WORLD,BASE,REGRESSION_EVENTS,distance,routeLength} from './terrain.js';
export const TYPES={person:'疑似被困人员',fire:'森林火情',gas:'气体泄漏',collapse:'建筑坍塌'};
export const uid=()=>crypto.randomUUID();
export const region=(x,z)=>z>1400?'南部河谷':x>1100&&z<-300?'东部城区':x<-600&&z>-200?'西部工业区':x<0||z<0?'西北山地林区':'中部平原';
export const parkedHeight=type=>type==='uav'?.35:.82;
// Two separate parking zones on the apron: UAV pads to the west, ground-unit bays to
// the east, so the two fleets never share a marking.
export function berth(type,index){const col=index%3,row=Math.floor(index/3);return {x:(type==='dog'?BASE.x+44:BASE.x-100)+col*28,z:BASE.z-42+row*28};}
// Full-region search pattern. The enabled UAVs split the map into vertical strips and
// each flies a lawnmower sweep; pass spacing stays under the 600 m search diameter so
// there are no blind spots, and the sweep repeats until the unit is recalled.
export const COVERAGE={x0:-3300,x1:3300,z0:-2500,z1:2500,spacing:440};
const coverageCache=new Map();
export function coverageRoute(strip,strips){
 const key=`${strip}/${strips}`;const hit=coverageCache.get(key);if(hit)return hit;
 const width=(COVERAGE.x1-COVERAGE.x0)/strips,sx0=COVERAGE.x0+strip*width;
 const lanes=Math.max(1,Math.round(width/COVERAGE.spacing)),pts=[];
 for(let i=0;i<=lanes;i++){const x=sx0+i*(width/lanes);
  if(i%2===0)pts.push({x,z:COVERAGE.z0},{x,z:COVERAGE.z1});
  else pts.push({x,z:COVERAGE.z1},{x,z:COVERAGE.z0});}
 coverageCache.set(key,pts);return pts;
}
export const LOW_BATTERY=18,RESUME_BATTERY=92;
export const DOG_MAX_DISTANCE=6000;
export const BERTHS_PER_TYPE=12;
// Repairs persisted state: older saves (or a save made while the apron layout changed)
// can hold stale home positions or two devices on the same pad. Every device is
// re-assigned a unique per-type slot, and parked devices are moved onto it.
export function normalizeBerths(state){
 const n=structuredClone(state);const usedGlobal=new Set(),usedType={uav:new Set(),dog:new Set()};
 for(const d of n.devices){
   if(!d.type)d.type='uav';
   if(d.type==='dog'&&!(d.maxDistance>0))d.maxDistance=DOG_MAX_DISTANCE;
  let slot=d.berth;if(typeof slot!=='number'||usedGlobal.has(slot)){slot=0;while(usedGlobal.has(slot))slot++;}
  usedGlobal.add(slot);
  let typeSlot=d.typeBerth;
  if(typeof typeSlot!=='number'||usedType[d.type].has(typeSlot)||typeSlot>=BERTHS_PER_TYPE){typeSlot=0;while(usedType[d.type].has(typeSlot))typeSlot++;}
  usedType[d.type].add(typeSlot);
  const home=berth(d.type,typeSlot),moved=d.typeBerth!==typeSlot;
  d.berth=slot;d.typeBerth=typeSlot;d.home=home;
  // Only teleport a device that is parked; one that is mid-task keeps its position.
  if(moved&&!d.enabled&&d.state==='待命'){d.x=home.x;d.z=home.z;d.y=surfaceHeight(home.x,home.z)+parkedHeight(d.type);}
 }
 return n;
}
export function createDevice(s,fields){
 const type=fields.type||'uav';
 // Global slot drives the "停靠位 0X" label; the per-type slot drives the pad position,
 // so removing a device frees its pad instead of shifting everyone onto a shared one.
 const usedGlobal=new Set(s.devices.map(d=>d.berth));let slot=0;while(usedGlobal.has(slot))slot++;
 if(slot>=25)throw Error('集结中心的 25 个停靠位已满');
 const usedType=new Set(s.devices.filter(d=>d.type===type).map(d=>d.typeBerth));
 let typeSlot=0;while(usedType.has(typeSlot))typeSlot++;
 if(typeSlot>=BERTHS_PER_TYPE)throw Error(`${type==='uav'?'无人机':'机器狗'}的 ${BERTHS_PER_TYPE} 个停靠位已满`);
 const home=berth(type,typeSlot);
  return {...fields,id:fields.id||uid(),type,berth:slot,typeBerth:typeSlot,home,x:home.x,z:home.z,y:surfaceHeight(home.x,home.z)+parkedHeight(type),cruise:fields.cruise||100,maxDistance:type==='dog'?(fields.maxDistance||DOG_MAX_DISTANCE):undefined,battery:100,state:'待命',enabled:false};
}
export function fresh(){const s={version:4,time:0,auto:false,devices:[],events:[],tasks:[],logs:[],messages:[]};for(const [i,type] of ['uav','uav','dog','dog'].entries())s.devices.push(createDevice(s,{type,name:(type==='uav'?'苍穹 ':'猎隼 ')+(i%2+1).toString().padStart(2,'0')}));log(s,'集结中心已就绪 · 2 架无人机 / 2 台机器狗');return s;}
export function log(s,text){s.logs=[{id:uid(),text,time:s.time},...s.logs].slice(0,100);}
// Local protocol outbox. A future transport sends these same envelopes through the gateway.
export function emit(s,type,deviceId,payload){s.messages=[{schemaVersion:'1.0',messageId:uid(),type,source:'simulator',deviceId,timestamp:new Date().toISOString(),simulationTimeSeconds:s.time,payload},...(s.messages||[])].slice(0,150);}
export function addEvent(s,kind,x,z,severity){const n=structuredClone(s);n.events.push({id:uid(),kind,x,z,severity,status:'待侦察',created:s.time});log(n,`已布设${TYPES[kind]} · 尚未被设备发现`);return n;}
export function randomEvent(s,kind,severity){for(let i=0;i<200;i++){const x=-3100+Math.random()*6200,z=-2300+Math.random()*4600;if(distance(BASE,{x,z})<220||!walkable(x,z))continue;if(pathfind(BASE,{x,z}))return addEvent(s,kind,x,z,severity);}return addEvent(s,kind,BASE.x+240,BASE.z+120,severity);}
const busy=(s,id)=>s.tasks.some(t=>t.deviceId===id&&t.status==='执行中');
function task(s,d,phase,route,eventId){const length=routeLength(d,route),t={id:uid(),commandId:uid(),eventId,deviceId:d.id,deviceName:d.name,phase,status:'执行中',stage:'前往目标',route,index:0,hold:0,progress:0,totalDistance:length,travelled:0,etaSeconds:length/(d.type==='uav'?WORLD.uavSpeed:WORLD.dogSpeed)+(phase==='返回基地'?0:20),started:s.time};s.tasks.unshift(t);d.state=phase;emit(s,'task.ack',d.id,{commandId:t.commandId,taskId:t.id,accepted:true});return t;}
export function dispatch(s,eventId,deviceId){const n=structuredClone(s),e=n.events.find(e=>e.id===eventId);if(!e||!['待侦察','待复核'].includes(e.status))return {error:'当前事件已在执行或已完成'};const type=e.status==='待侦察'?'uav':'dog',candidates=n.devices.filter(d=>d.type===type&&(!deviceId||d.id===deviceId)&&d.battery>15&&!busy(n,d.id)).sort((a,b)=>distance(a,e)-distance(b,e));if(!candidates.length)return {error:`没有可用的${type==='uav'?'无人机':'机器狗'}（需空闲且电量 > 15%）`};
  let reachable=false;
  for(const d of candidates){const route=type==='dog'?pathfind(d,e):[{x:e.x,z:e.z}];if(!route)continue;reachable=true;const length=routeLength(d,route);if(type==='dog'&&length>(d.maxDistance||DOG_MAX_DISTANCE))continue;task(n,d,type==='uav'?'空中侦察':'地面复核',route,e.id);e.status=type==='uav'?'侦察中':'复核中';log(n,`${d.name} 已接收${type==='uav'?'侦察':'复核'}任务`);return {state:n};}
  return {error:reachable&&type==='dog'?'没有机器狗在设定作业距离内，无法执行地面复核':'没有可通行的地面复核点，保留空中侦察结果'};}
export function startDevices(s,deviceId){const n=structuredClone(s);n.auto=true;for(const d of n.devices.filter(d=>!deviceId||d.id===deviceId)){if(d.battery<=15){log(n,`${d.name} 电量不足，无法启动`);continue;}d.enabled=true;d.returning=false;d.recharging=false;d.patrol=0;d.patrolKey=null;if(!busy(n,d.id))d.state=d.type==='uav'?'搜索中':'等待复核任务';}log(n,deviceId?'指定设备已启动':'全部可用设备已启动 · 机器狗等待复核目标');return n;}
export function cancelTask(n,t){t.status='已取消';t.stage='已取消';const d=n.devices.find(d=>d.id===t.deviceId);if(d)d.state='待命';const e=n.events.find(e=>e.id===t.eventId);if(e)e.status=t.phase==='空中侦察'?'待侦察':'待复核';emit(n,'task.result',t.deviceId,{taskId:t.id,outcome:'CANCELLED'});log(n,`${t.deviceName} 的任务已取消`);}
export function returnDevices(s,deviceId){const n=structuredClone(s);if(!deviceId)n.auto=false;for(const d of n.devices.filter(d=>!deviceId||d.id===deviceId)){d.enabled=false;d.returning=false;d.recharging=false;d.patrol=0;d.patrolKey=null;for(const t of n.tasks.filter(t=>t.deviceId===d.id&&t.status==='执行中'))cancelTask(n,t);const home=d.home||berth(d.berth||0);let route=d.type==='dog'?pathfind(d,home):[{...home}];if(!route){d.state='归位失败';log(n,`${d.name} 无可用返回路线`);continue;}
 // Grid A* accepts a nearby point. Finish at the exact berth through the clear apron.
 if(d.type==='dog')route=[...route,{...home}];task(n,d,'返回基地',route);log(n,`${d.name} 正在返回集结中心`);}return n;}
function move(d,route,index,budget){let travelled=0;while(index<route.length&&budget>0){const p=route[index],dist=distance(d,p);if(dist<=budget){d.x=p.x;d.z=p.z;index++;budget-=dist;travelled+=dist;}else{d.x+=(p.x-d.x)/dist*budget;d.z+=(p.z-d.z)/dist*budget;travelled+=budget;budget=0;}}return {index,travelled};}
function flightHeight(d,dt,landing=false){const floor=surfaceHeight(d.x,d.z),target=floor+(landing?parkedHeight(d.type):(d.cruise||100));if(d.type==='dog'){d.y=floor+parkedHeight(d.type);return true;}d.y=Math.max(floor+.35,d.y+Math.max(-dt*6,Math.min(dt*6,target-d.y)));return Math.abs(d.y-target)<.1;}
function finish(n,t,d,e){t.status='已完成';t.progress=100;t.finished=n.time;t.stage=t.phase==='返回基地'?'已归位':'结果已上报';d.state=t.phase==='返回基地'?'待命':d.type==='dog'?'原地待命':'任务完成';if(e){e.status=d.type==='uav'?'待复核':'已处理';e.discoveredBy=e.discoveredBy||d.name;e.result=d.type==='uav'?'空中目标已确认，等待地面复核':'现场处理完成：模拟采样与风险标记已上报';if(d.type==='dog'){e.processedAt=n.time;e.processedWallTime=Date.now();}emit(n,d.type==='uav'?'event.discovered':'task.result',d.id,{taskId:t.id,eventId:e.id,outcome:'SUCCEEDED',observations:e.result,position:{x:e.x,z:e.z}});}else emit(n,'task.result',d.id,{taskId:t.id,outcome:'SUCCEEDED'});log(n,`${d.name} · ${t.phase==='返回基地'?'已归位':e.result}`);}
function tick(s,dt){let n=structuredClone(s);n.time+=dt;for(const t of n.tasks.filter(t=>t.status==='执行中')){const d=n.devices.find(d=>d.id===t.deviceId),e=n.events.find(e=>e.id===t.eventId);if(!d)continue;if(d.battery<=0){t.status='失败';t.stage='电量耗尽';d.state='电量耗尽';if(e)e.status=d.type==='uav'?'待侦察':'待复核';emit(n,'task.result',d.id,{taskId:t.id,outcome:'FAILED',reason:'LOW_BATTERY'});log(n,`${d.name} 电量耗尽，任务中止`);continue;}
 if(t.index<t.route.length){const ready=d.type!=='uav'||d.y>=surfaceHeight(d.x,d.z)+20;flightHeight(d,dt);t.stage=ready?'前往目标':'起飞中';if(ready){const m=move(d,t.route,t.index,(d.type==='uav'?WORLD.uavSpeed:WORLD.dogSpeed)*dt);t.index=m.index;t.travelled+=m.travelled;}d.y=Math.max(d.y,surfaceHeight(d.x,d.z)+(d.type==='uav'?20:parkedHeight(d.type)));if(d.type==='dog')flightHeight(d,dt);t.progress=Math.min(80,t.travelled/Math.max(1,t.totalDistance)*80);
 }else if(t.phase==='返回基地'){t.stage=d.type==='uav'?'降落中':'停靠中';if(flightHeight(d,dt,true))finish(n,t,d,e);
 }else{flightHeight(d,dt);if(t.hold===0){log(n,`${d.name} 到达目标 · 开始处理`);if(e&&d.type==='dog')e.status='处理中';}t.hold+=dt;t.stage=t.hold<15?'处理中 · 扫描采样':'处理中 · 上报结果';d.state=t.stage;t.progress=80+Math.min(20,t.hold);if(t.hold>=20)finish(n,t,d,e);}
 d.battery=Math.max(0,d.battery-dt*(d.type==='uav'?.012:.003));t.etaSeconds=Math.max(0,(t.totalDistance-t.travelled)/(d.type==='uav'?WORLD.uavSpeed:WORLD.dogSpeed)+(t.phase==='返回基地'?0:20-t.hold));}
 if(n.auto){
  const uavs=n.devices.filter(d=>d.type==='uav'&&d.enabled),strips=Math.max(1,uavs.length);
  uavs.forEach((d,i)=>{
   if(busy(n,d.id))return;
   flightHeight(d,dt);
   if(!d.returning&&d.battery<=LOW_BATTERY){d.returning=true;d.recharging=false;d.patrol=0;log(n,`${d.name} 电量偏低，返回集结中心补给`);}
   if(d.returning){
    if(!d.recharging){d.state='返航补给';move(d,[{x:d.home.x,z:d.home.z}],0,dt*WORLD.uavSpeed);
     if(distance(d,d.home)<60){d.recharging=true;d.state='补给中';}}
    if(d.recharging){d.battery=Math.min(100,d.battery+dt*8);
     if(d.battery>=RESUME_BATTERY){d.returning=false;d.recharging=false;d.patrol=0;d.patrolKey=null;log(n,`${d.name} 补给完成，继续区域搜索`);}}
   }else{
    d.state='搜索中';
    const key=`${i}/${strips}`;if(d.patrolKey!==key){d.patrolKey=key;d.patrol=0;}
    const route=coverageRoute(i,strips);
    if(d.y>=surfaceHeight(d.x,d.z)+20){const m=move(d,route,d.patrol,dt*WORLD.uavSpeed);d.patrol=m.index>=route.length?0:m.index;}
    d.y=Math.max(d.y,surfaceHeight(d.x,d.z)+60);
    d.battery=Math.max(0,d.battery-dt*.012);
    for(const e of n.events)if(e.status==='待侦察'&&distance(e,d)<=WORLD.searchRadius){e.status='待复核';e.discoveredBy=d.name;emit(n,'event.discovered',d.id,{eventId:e.id,eventType:e.kind,position:{x:e.x,z:e.z},severity:e.severity});log(n,`${d.name} 搜索范围内发现${TYPES[e.kind]}`);}
   }
  });}
 for(const e of n.events.filter(e=>e.status==='待复核')){if(e.nextAttempt>n.time)continue;let assigned=false;for(const dog of n.devices.filter(d=>d.type==='dog'&&d.enabled&&!busy(n,d.id)&&d.battery>15)){const result=dispatch(n,e.id,dog.id);if(result.state){n=result.state;assigned=true;break;}}if(!assigned)e.nextAttempt=n.time+10;}
 // Ground units stop when flat; UAVs never hard-stop because they recharge and resume.
 for(const d of n.devices)if(d.type==='dog'&&!busy(n,d.id)&&d.battery<=15&&d.enabled){d.enabled=false;d.state='低电量待命';log(n,`${d.name} 电量不足，已停止自主运行`);}
 if(Math.floor(n.time/5)>Math.floor(s.time/5))for(const d of n.devices)emit(n,'device.telemetry',d.id,{position:{x:d.x,y:d.y,z:d.z},state:d.state,battery:d.battery});return n;}
export function step(s,dt){let n=s;while(dt>0){const part=Math.min(2,dt);n=tick(n,part);dt-=part;}return n;}
// Deterministic fixture for regression tests; it is not exposed as a product action.
export function regressionScenario(s){let n=fresh();n.devices=s.devices.map((d,i)=>createDevice({devices:s.devices.slice(0,i).map((_,j)=>({berth:j}))},{name:d.name,type:d.type}));for(const e of REGRESSION_EVENTS)n=addEvent(n,e.kind,e.x,e.z,'高');return startDevices(n);}
