// Domain coordinates are metres. The renderer uniformly divides them by WORLD.renderScale,
// so distances, speeds, search radii and path lengths entered here stay consistent in the UI.
export const WORLD={width:6800,depth:5200,cell:40,renderScale:100,searchRadius:300,uavSpeed:18,dogSpeed:2.2};
export const BASE={x:1100,z:750};
// The bridge sits east of the base so the north-south trunk road no longer runs
// through the parking apron.
export const river={z:1800,halfWidth:180,bridgeX:1240,bridgeHalf:120};
export const REGRESSION_EVENTS=[{kind:'person',x:-2400,z:-1500},{kind:'gas',x:-1800,z:-700},{kind:'collapse',x:2400,z:-1700}];

const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const smooth=(e0,e1,x)=>{const t=clamp((x-e0)/(e1-e0),0,1);return t*t*(3-2*t);};
function rng(seed){let s=seed>>>0;return()=>{s=(s*1664525+1013904223)>>>0;return s/4294967296;};}

// Height is defined over the whole world: a north-west massif, rolling forest hills
// and a gently sloping southern plain, with the river valley cut through the south.
function naturalHeight(x,z){
 const w=smooth(0,-2200,x);            // 0 in the east, 1 in the far west
 const north=smooth(400,-900,z);       // 1 in the north-west, 0 in the south
 const gate=w*north;
 let h=gate*32;                                                         // gentle regional uplift
 h+=gate*300*Math.exp(-((x+1900)**2+(z+1500)**2)/2200000);              // main summit
 h+=gate*205*Math.exp(-((x+2850)**2+(z+350)**2)/1500000);               // north-west peak
 h+=gate*165*Math.exp(-((x+950)**2+(z+2150)**2)/1250000);               // north ridge
 h+=(0.25+0.75*w)*(58*(Math.sin(x/520)*Math.cos(z/470)+1))*(0.35+0.65*north); // rolling hills
 h+=gate*16*(Math.sin(x/210)*Math.cos(z/190)+1);                        // ridge texture
 h+=gate*(14*Math.abs(Math.sin((x+z*.55)/150))+9*Math.sin(z/110)*Math.cos(x/175));
 h-=gate*18*Math.exp(-((Math.sin(x/580)*260+z+950)**2)/18000);
 h+=4*(Math.sin(x/900)*Math.cos(z/820)+1);                              // plain undulation
 const d=Math.abs(z-river.z);
 if(d<river.halfWidth*2.5)h*=clamp(d/(river.halfWidth*2.5),0,1);
 return Math.max(0,h);
}

// Keep the entire operations apron level, then blend back into natural terrain.
export function height(x,z){const r=Math.hypot(x-BASE.x,z-BASE.z),blend=smooth(165,235,r);return naturalHeight(BASE.x,BASE.z)*(1-blend)+naturalHeight(x,z)*blend;}

// Buildings are shared between rendering and collision so nothing can drift outside the map.
export const buildings=(()=>{const r=rng(20260914),out=[];
 for(let gx=0;gx<8;gx++)for(let gz=0;gz<7;gz++){const tall=r()>.62;
  out.push({x:1250+gx*250+(r()*70-35),z:-1800+gz*270+(r()*70-35),w:45+r()*45,d:48+r()*48,h:tall?55+Math.floor(r()*85):18+Math.floor(r()*26),kind:'city'});}
 for(let i=0;i<52;i++)out.push({x:-560+r()*1560,z:-2380+r()*760,w:15+r()*10,d:19+r()*13,h:8+Math.floor(r()*7),kind:'village'});
 for(let i=0;i<22;i++)out.push({x:-1420+r()*920,z:80+r()*920,w:46+r()*32,d:34+r()*26,h:12+Math.floor(r()*10),kind:'industry'});
 return out;})();

// Highest solid surface at a point: terrain, or a building roof if inside its footprint.
// Air vehicles must clear this; ground vehicles never need to (pathfinding avoids footprints).
export function surfaceHeight(x,z){
 let h=height(x,z);
 for(const b of buildings)if(Math.abs(x-b.x)<=b.w/2&&Math.abs(z-b.z)<=b.d/2)h=Math.max(h,height(b.x,b.z)+b.h*(b.kind==='village'?1.5:1)+4);
 if(Math.abs(z-river.z)<=river.halfWidth+80&&Math.abs(x-river.bridgeX)<=river.bridgeHalf)h=Math.max(h,12);
 return h;
}
export function walkable(x,z){
 if(Math.abs(x)>3360||Math.abs(z)>2560)return false;
 if(Math.abs(z-river.z)<river.halfWidth&&Math.abs(x-river.bridgeX)>river.bridgeHalf)return false;
 for(const b of buildings)if(Math.abs(x-b.x)<b.w/2+25&&Math.abs(z-b.z)<b.d/2+25)return false;
 return true;
}

export function pathfind(start,target){
 const C=WORLD.cell,key=(x,z)=>`${x},${z}`,sx=Math.round(start.x/C),sz=Math.round(start.z/C);
 const open=[{x:sx,z:sz,g:0,f:0}],seen=new Set(),cost=new Map([[key(sx,sz),0]]),parents=new Map();let goal;
 while(open.length){open.sort((a,b)=>a.f-b.f);const cur=open.shift(),k=key(cur.x,cur.z);if(seen.has(k))continue;seen.add(k);
  if(Math.hypot(cur.x*C-target.x,cur.z*C-target.z)<=C*1.5&&walkable(cur.x*C,cur.z*C)){goal=cur;break;}
  for(const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1]]){const x=cur.x+dx,z=cur.z+dz;if(!walkable(x*C,z*C))continue;
   const rise=Math.abs(height(x*C,z*C)-height(cur.x*C,cur.z*C));if(rise/C>.45)continue;
   const g=cur.g+1+rise/C*3,nk=key(x,z);if(g>=(cost.get(nk)??Infinity))continue;cost.set(nk,g);parents.set(nk,cur);open.push({x,z,g,f:g+Math.hypot(x-target.x/C,z-target.z/C)});}}
 if(!goal)return null;const route=[];while(goal.x!==sx||goal.z!==sz){route.unshift({x:goal.x*C,z:goal.z*C});goal=parents.get(key(goal.x,goal.z));}return route;
}
export function distance(a,b){return Math.hypot(a.x-b.x,a.z-b.z);}
export function routeLength(start,route){let last=start,sum=0;for(const p of route){sum+=distance(last,p);last=p;}return sum;}
