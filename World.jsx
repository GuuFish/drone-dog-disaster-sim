import React,{useEffect,useRef} from 'react';
import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {clone as cloneSkeleton} from 'three/addons/utils/SkeletonUtils.js';
import {height as metreHeight,surfaceHeight,WORLD,buildings,river,BASE} from './terrain.js';
import {TYPES} from './simulation.js';

// 1 render unit = 100 m. Real-world sizes are kept for terrain, buildings, trees and rocks;
// only the device symbols are deliberately enlarged so they stay readable on a 6.8 km map.
const S=WORLD.renderScale;
const VE=1; // True proportions in both first-person and overview.
const height=(x,z)=>metreHeight(x*S,z*S)/S*VE;
const W=WORLD.width/S, D=WORLD.depth/S;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const bx=BASE.x/S, bz=BASE.z/S, rz=river.z/S, rhw=river.halfWidth/S, rbx=river.bridgeX/S, rbh=river.bridgeHalf/S;

function canvasTexture(size,draw,repeat){
 const c=document.createElement('canvas');c.width=c.height=size;draw(c.getContext('2d'),size);
 const t=new THREE.CanvasTexture(c);t.wrapS=t.wrapT=THREE.RepeatWrapping;t.anisotropy=4;
 if(repeat)t.repeat.set(repeat[0],repeat[1]);return t;
}
const grassTex=canvasTexture(256,(x,s)=>{x.fillStyle='#4c6b4d';x.fillRect(0,0,s,s);
 for(let i=0;i<4200;i++){const g=90+Math.random()*70;x.fillStyle=`rgba(${g*.55|0},${g},${g*.6|0},.5)`;x.fillRect(Math.random()*s,Math.random()*s,2,2);}},[34,26]);
const facadeTex=canvasTexture(256,(x,s)=>{x.fillStyle='#9aa0a0';x.fillRect(0,0,s,s);
 x.fillStyle='#7d8484';for(let i=0;i<8;i++)x.fillRect(0,i*32,s,2);
 for(let r=0;r<6;r++)for(let c=0;c<6;c++){const lit=(r*6+c)%5===0;x.fillStyle=lit?'#cfe4dd':'#4b6570';x.fillRect(12+c*40,8+r*40,26,24);x.fillStyle='rgba(20,30,36,.35)';x.fillRect(12+c*40,8+r*40,26,5);}});
const waterTex=canvasTexture(256,(x,s)=>{x.fillStyle='#1d5d72';x.fillRect(0,0,s,s);
 for(let i=0;i<600;i++){x.strokeStyle=`rgba(160,220,235,${Math.random()*.25})`;x.beginPath();const y=Math.random()*s;x.moveTo(Math.random()*s,y);x.lineTo(Math.random()*s,y+2);x.stroke();}},[8,2]);

export default function World(props){
  const host=useRef(),latest=useRef();
  latest.current={...props,
  devices:props.devices.map(d=>({...d,x:d.x/S,z:d.z/S,y:d.y/S*VE})),
  events:props.events.map(e=>({...e,x:e.x/S,z:e.z/S})),
  tasks:props.tasks?.map(t=>({...t,route:t.route.map(p=>({x:p.x/S,z:p.z/S}))})),
   camera:{...props.camera,x:props.camera?.x/S,z:props.camera?.z/S,y:props.camera?.y==null?null:props.camera.y/S*VE},
   onCreate:(x,z)=>props.onCreate(x*S,z*S)};

 useEffect(()=>{
 const el=host.current,scene=new THREE.Scene();
 scene.fog=new THREE.Fog('#1a3542',170,520);
 const homePos=()=>new THREE.Vector3(bx+.68,height(bx,bz)+.44,bz+.94);
 // near/far ratio stays modest; logarithmic depth keeps decals on the ground from
 // z-fighting when the camera pulls back to the whole 6.8 km region.
 const camera=new THREE.PerspectiveCamera(60,1,.004,1600);camera.position.copy(homePos());
 const renderer=new THREE.WebGLRenderer({antialias:true,logarithmicDepthBuffer:true});
 renderer.setPixelRatio(Math.min(devicePixelRatio,1.75));
 renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
 renderer.outputColorSpace=THREE.SRGBColorSpace;el.appendChild(renderer.domElement);

 const sky=new THREE.Mesh(new THREE.SphereGeometry(900,32,20),new THREE.MeshBasicMaterial({side:THREE.BackSide,vertexColors:true,depthWrite:false}));
 {const g=sky.geometry,p=g.attributes.position,col=new Float32Array(p.count*3),top=new THREE.Color('#0d2531'),bot=new THREE.Color('#5b8b98');
  for(let i=0;i<p.count;i++){const t=Math.max(0,Math.min(1,(p.getY(i)/900+1)/2)),c=bot.clone().lerp(top,t);col[i*3]=c.r;col[i*3+1]=c.g;col[i*3+2]=c.b;}
  g.setAttribute('color',new THREE.BufferAttribute(col,3));}
 scene.add(sky);

 const controls=new OrbitControls(camera,renderer.domElement);
 controls.enableDamping=true;controls.enablePan=true;controls.screenSpacePanning=true;
 controls.minDistance=.025;controls.maxDistance=260;controls.minPolarAngle=.05;controls.maxPolarAngle=1.56;
 controls.rotateSpeed=.9;controls.panSpeed=1.2;controls.zoomSpeed=1.1;controls.target.set(bx,height(bx,bz),bz+.3);

 let free=false,locked=false,freeEntryPosition=null;const keys=new Set();let yaw=0,pitch=-.35;const fwd=new THREE.Vector3(),rt=new THREE.Vector3();
 // Free flight always adopts the current camera orientation, so switching from the
 // top view (which uses camera.up = -Z) can never leave the horizon rolled.
 const adoptOrientation=()=>{camera.up.set(0,1,0);camera.rotation.order='YXZ';const e=new THREE.Euler().setFromQuaternion(camera.quaternion,'YXZ');yaw=e.y;pitch=Math.max(-1.35,Math.min(1.35,e.x));camera.rotation.set(pitch,yaw,0);};
 const notifyFree=props.onFreeChange||(()=>{});
 let followId=null,followPosition=null;let eyeOffset=1.7;
 const enterFree=()=>{move=null;followId=null;followPosition=null;freeEntryPosition=camera.position.clone();adoptOrientation();eyeOffset=Math.max(1.7,camera.position.y*S-surfaceHeight(camera.position.x*S,camera.position.z*S));free=true;controls.enabled=false;renderer.domElement.classList.add('flight-mode');notifyFree(true);};
 const stopFree=()=>{free=false;locked=false;keys.clear();controls.enabled=true;camera.up.set(0,1,0);
  const dir=new THREE.Vector3();camera.getWorldDirection(dir);controls.target.copy(camera.position).addScaledVector(dir,3);
  document.exitPointerLock?.();renderer.domElement.classList.remove('flight-mode');notifyFree(false);};
 const keydown=e=>{if(/INPUT|SELECT|TEXTAREA/.test(e.target.tagName))return;if(e.code==='Escape'){if(free)stopFree();return}if(free&&['KeyW','KeyA','KeyS','KeyD','KeyQ','KeyE','ShiftLeft','ShiftRight'].includes(e.code)){keys.add(e.code);e.preventDefault();}};
 const keyup=e=>keys.delete(e.code);
 const mousemove=e=>{if(!free)return;if(!locked&&!dragLook)return;yaw-=e.movementX*.0025;pitch=Math.max(-1.35,Math.min(1.35,pitch-e.movementY*.0025));};
 const lockchange=()=>{const wasLocked=locked;locked=document.pointerLockElement===renderer.domElement;if(wasLocked&&!locked&&free)stopFree();};
 renderer.domElement.addEventListener('dblclick',enterFree);
 document.addEventListener('pointerlockchange',lockchange);
 document.addEventListener('keydown',keydown);document.addEventListener('keyup',keyup);document.addEventListener('mousemove',mousemove);

 scene.add(new THREE.HemisphereLight(0xcfe8f5,0x4a5a48,1.6));
 scene.add(new THREE.AmbientLight(0x46626e,.35));
 const sun=new THREE.DirectionalLight(0xffe9c4,2.5);sun.position.set(-70,110,60);sun.castShadow=true;
 sun.shadow.mapSize.set(2048,2048);Object.assign(sun.shadow.camera,{left:-80,right:80,top:80,bottom:-80,far:400});
 sun.shadow.bias=-.0008;scene.add(sun);

  const std=(color,opts={})=>new THREE.MeshStandardMaterial({color,roughness:.85,metalness:0,...opts});
  const visualDeviceY=d=>d.y+(d.type==='dog'?.0022:0);
 const mesh=(geo,mat,parent=scene)=>{const m=new THREE.Mesh(geo,typeof mat==='number'?std(mat):mat);m.castShadow=true;m.receiveShadow=true;parent.add(m);return m;};
 const box=(x,y,z,w,h,d,mat,parent=scene)=>{const m=mesh(new THREE.BoxGeometry(w,h,d),mat,parent);m.position.set(x,y,z);return m;};
  const worldLabels=[];
  function label(text,x,y,z,color='#bfe4dd',size=4,scaleWithDistance=true){if(typeof color==='number'){size=color;color='#f5fffc';}const cv=document.createElement('canvas');cv.width=1024;cv.height=160;const c=cv.getContext('2d');
   c.fillStyle='#061820';c.fillRect(3,3,1018,154);c.fillStyle=color;c.fillRect(3,3,16,154);c.strokeStyle=color;c.lineWidth=7;c.strokeRect(6.5,6.5,1011,147);
   c.fillStyle='#ffffff';c.font='900 58px sans-serif';c.textAlign='center';c.textBaseline='middle';c.lineJoin='round';c.shadowColor='#000000';c.shadowBlur=9;c.shadowOffsetY=3;c.strokeStyle='#000000';c.lineWidth=12;c.strokeText(text,520,80);c.fillText(text,520,80);
   const t=new THREE.CanvasTexture(cv);t.colorSpace=THREE.SRGBColorSpace;t.minFilter=THREE.LinearFilter;t.magFilter=THREE.LinearFilter;t.generateMipmaps=false;
   const sp=new THREE.Sprite(new THREE.SpriteMaterial({map:t,depthTest:false,depthWrite:false,transparent:true,toneMapped:false}));
   sp.position.set(x,y,z);sp.scale.set(size,size*160/1024,1);scene.add(sp);
   if(scaleWithDistance)worldLabels.push({sp,base:size});return sp;}

 // ---------- ground ----------
 const geo=new THREE.PlaneGeometry(W,D,360,280);geo.rotateX(-Math.PI/2);
 const pos=geo.attributes.position,colArr=new Float32Array(pos.count*3);geo.setAttribute('color',new THREE.BufferAttribute(colArr,3));
 for(let i=0;i<pos.count;i++)pos.setY(i,height(pos.getX(i),pos.getZ(i)));
 geo.computeVertexNormals();
 const cLow=new THREE.Color('#7f8a6b'),cMid=new THREE.Color('#5f7752'),cHigh=new THREE.Color('#8a8b7e'),cSnow=new THREE.Color('#d5dedb');
 for(let i=0;i<pos.count;i++){const y=pos.getY(i),t=Math.min(1,y/(4.6*VE));let c;
  if(t<.5)c=cLow.clone().lerp(cMid,t/.5);else if(t<.82)c=cMid.clone().lerp(cHigh,(t-.5)/.32);else c=cHigh.clone().lerp(cSnow,(t-.82)/.18);
  const n=1+0.045*Math.sin(pos.getX(i)*3.1)*Math.cos(pos.getZ(i)*2.7);
  colArr[i*3]=Math.min(1,c.r*n);colArr[i*3+1]=Math.min(1,c.g*n);colArr[i*3+2]=Math.min(1,c.b*n);}
 const ground=mesh(geo,new THREE.MeshStandardMaterial({vertexColors:true,map:grassTex,roughness:.95}));
 ground.material.map.repeat.set(W/0.9,D/0.9);
 box(0,-1.4,0,W+.4,2.6,D+.4,std(0x22303a));

 // ---------- river + bridge ----------
 const water=mesh(new THREE.PlaneGeometry(W,rhw*2),new THREE.MeshStandardMaterial({map:waterTex,color:0x8fd4e0,roughness:.25,metalness:.1,transparent:true,opacity:.9}));
 water.rotation.x=-Math.PI/2;water.position.set(0,.02,rz);
 const bridgeWidth=rbh*2;
 box(rbx,.115,rz,bridgeWidth,.01,rhw*2+1.6,std(0x7d8584));
 for(const side of [-1,1]){box(rbx+side*(rbh-.015),.132,rz,.02,.025,rhw*2+1.6,std(0xa7b7b6));for(let z=rz-rhw;z<rz+rhw;z+=.6)box(rbx+side*(rbh-.15),.055,z,.08,.12,.08,std(0x737c76));}
 for(const side of [-1,1]){const bankGeo=new THREE.PlaneGeometry(W,.24,180,2);bankGeo.rotateX(-Math.PI/2);const a=bankGeo.attributes.position;for(let i=0;i<a.count;i++){const z=a.getZ(i)+rz+side*(rhw+.13);a.setXYZ(i,a.getX(i),height(a.getX(i),z)+.012,z);}bankGeo.computeVertexNormals();mesh(bankGeo,std(0x8f927a));}

 // ---------- roads follow terrain ----------
 const roadMat=std(0x3c4145,{roughness:.95}),lineMat=std(0xd8cf9c);
 function road(axis,fixed,from,to){if(from>to)[from,to]=[to,from];const vertices=[],width=.12,step=.15;
  const roadY=(x,z)=>Math.abs(z-rz)<=rhw+.8&&Math.abs(x-rbx)<=rbh?.123:height(x,z)+.006;
  for(let t=from;t<to;t+=step){const end=Math.min(t+step,to),points=axis==='x'?[[t,fixed-width/2],[end,fixed-width/2],[t,fixed+width/2],[end,fixed+width/2]]:[[fixed-width/2,t],[fixed-width/2,end],[fixed+width/2,t],[fixed+width/2,end]];for(const i of [0,2,1,1,2,3]){const [x,z]=points[i];vertices.push(x,roadY(x,z),z);}}
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));geometry.computeVertexNormals();mesh(geometry,new THREE.MeshStandardMaterial({color:0x41494a,roughness:1,side:THREE.DoubleSide}));
   for(let t=from;t<to;t+=.3){const x=axis==='x'?t:fixed,z=axis==='x'?fixed:t;box(x,roadY(x,z)+.001,z,axis==='x'?.09:.0015,.0005,axis==='x'?.0015:.09,lineMat);}}
 // Two trunk roads only: one east of the base (crossing the bridge), one south of it.
 const ROAD_EW=8.7,ROAD_NS=12.4;
 road('x',ROAD_EW,-W/2,W/2);road('z',ROAD_NS,-D/2,D/2);
 // city street grid hangs off the eastern trunk road
 for(let gx=0;gx<5;gx++)road('z',15.5+gx*3.0,-21,-3);
 for(let gz=0;gz<5;gz++)road('x',-19.4+gz*3.4,13.5,29.5);

 // ---------- buildings ----------
 for(const b of buildings){const x=b.x/S,z=b.z/S,w=b.w/S,d=b.d/S,h=b.h/S,base=height(x,z);
  const facade=new THREE.MeshStandardMaterial({map:facadeTex.clone(),roughness:.85,color:b.kind==='village'?0xd8c9b4:b.kind==='industry'?0xa7b6b2:0xc3d0ce});
  facade.map.repeat.set(Math.max(1,Math.round(w*7)),Math.max(1,Math.round(h*5)));facade.map.needsUpdate=true;
  box(x,base+h/2,z,w,h,d,facade);
  if(b.kind==='village'){const roof=mesh(new THREE.ConeGeometry(Math.max(w,d)*.8,h*.5,4),std(0x7d5b4a));roof.position.set(x,base+h+h*.25,z);roof.rotation.y=Math.PI/4;}
  else {box(x,base+h+.01,z,w+.015,.02,d+.015,std(0x6d7276));
   if(b.kind==='city'){box(x+w*.23,base+h+.035,z,.05,.04,.07,std(0x929fa0));box(x-w*.2,base+h+.021,z+d*.2,w*.3,.003,d*.3,std(0x335e6e,{metalness:.3}));}
   else for(let i=0;i<3;i++)box(x-w*.3+i*w*.3,base+h+.018,z,w*.2,.005,d*.65,std(0x456b79,{metalness:.4}));}
  box(x,base+.002,z+d/2+.015,w+.04,.004,.03,std(0xb0aa97));}


 // ---------- HQ base ----------
 {const y=height(bx,bz);
  // Apron top sits at y+.0014, so every painted marking must sit above it or it is buried.
  box(bx,y+.0007,bz,2.4,.0014,2.0,std(0x6f7b78));
  // central service lane separates the two parking zones
  box(bx,y+.0016,bz,.6,.0002,2.0,std(0x818c88));
  for(const side of [-1,1])for(let z=-.92;z<.95;z+=.11)box(bx+side*.20,y+.0019,bz+z,.004,.0002,.05,std(0x9aa49b));
  // West half: UAV pads, each a circle with an H
  for(let col=0;col<3;col++)for(let row=0;row<4;row++){
   const px=bx-1.0+col*.28,pz=bz-.42+row*.28;
   const ring=mesh(new THREE.TorusGeometry(.082,.0032,8,36),std(0xe5d4a5));ring.rotation.x=-Math.PI/2;ring.position.set(px,y+.0018,pz);
   box(px-.026,y+.0019,pz,.005,.0002,.05,std(0xe9e9d2));
   box(px+.026,y+.0019,pz,.005,.0002,.05,std(0xe9e9d2));
   box(px,y+.0019,pz,.057,.0002,.005,std(0xe9e9d2));}
  // East half: ground-unit bays painted as flat stalls (no raised slab, no H)
  for(let col=0;col<3;col++)for(let row=0;row<4;row++){
   const px=bx+.44+col*.28,pz=bz-.42+row*.28;
   box(px,y+.0018,pz-.045,.115,.0002,.005,std(0xd8c98a));
   box(px-.0575,y+.0018,pz,.005,.0002,.09,std(0xd8c98a));
   box(px+.0575,y+.0018,pz,.005,.0002,.09,std(0xd8c98a));
   // inward chevron marks the stall entrance; deliberately not an H
   for(const s of [-1,1]){const bar=box(px+s*.018,y+.0019,pz-.015,.005,.0002,.05,std(0xe9e9d2));bar.rotation.y=s*.62;}
   box(px,y+.0019,pz+.028,.038,.0002,.005,std(0xe9e9d2));}
  // perimeter posts
  for(const side of [-1,1])for(let z=-.9;z<.95;z+=.1){box(bx+side*1.17,y+.012,bz+z,.004,.025,.004,std(0xa2aca5));box(bx+side*1.17,y+.02,bz+z,.002,.003,.08,std(0xb4bbb0));}
  // two hangars along the north edge, ~46 x 34 x 12 m
  for(const s of [-1,1]){box(bx+s*.5,y+.06,bz-.82,.46,.12,.34,std(0xb9c0c2));box(bx+s*.5,y+.125,bz-.82,.5,.015,.38,std(0x526b70));box(bx+s*.5,y+.04,bz-.648,.3,.075,.002,std(0x263d43));for(let i=0;i<8;i++)box(bx+s*.5,y+.01+i*.009,bz-.646,.3,.001,.002,std(0x668181));for(let i=0;i<6;i++)box(bx+s*.5-.19+i*.075,y+.09,bz-.994,.04,.025,.002,std(0x77a5ae));}
  // control tower between the hangars, ~14 x 26 m
  box(bx,y+.13,bz-.88,.14,.26,.14,std(0xaab2b4));mesh(new THREE.CylinderGeometry(.09,.09,.04,18),std(0x7fb9c4)).position.set(bx,y+.28,bz-.88);
  // containers, light poles and vehicles kept clear of both parking zones
  const cc=[0xb5533f,0x3f6ea8,0xc79a3c,0x4a7d52,0x8a8f95];
  for(let i=0;i<6;i++)box(bx+.78+i%3*.13,y+.018,bz-.62+Math.floor(i/3)*.11,.11,.026,.028,std(cc[i%cc.length]));
  for(let i=0;i<6;i++){const lx=bx-1.1+i*.44,lz=bz+.94;box(lx,y+.045,lz,.008,.09,.008,std(0x9aa4a8));mesh(new THREE.SphereGeometry(.012,8,6),std(0xffe9a8)).position.set(lx,y+.095,lz);}
  for(const v of [[-1.0,-.62],[1.0,-.62]]){const vx=bx+v[0],vz=bz+v[1];box(vx,y+.012,vz,.02,.016,.05,std(0x2f6f8f));box(vx,y+.03,vz-.006,.017,.016,.026,std(0x9fd0e0));}
  label('HQ · 设备集结中心',bx,y+.35,bz-.88,'#bff0df',.65);}

 // ---------- forest only on the slopes, away from base, city and roads ----------
 {const r=rngLocal(77);
  const nearBase=(x,z)=>Math.hypot(x-bx,z-bz)<5;
  const inCity=(x,z)=>x>11.5&&x<31&&z>-20.5&&z<-2.5;
  const inVillage=(x,z)=>x>-6&&x<10&&z>-24&&z<-15;
  const nearRoad=(x,z)=>Math.abs(z-bz)<.8||Math.abs(x-bx)<.8;
  const trunk=new THREE.InstancedMesh(new THREE.CylinderGeometry(.012,.016,.05,5),std(0x5a4a38),4200),
   leaf=new THREE.InstancedMesh(new THREE.ConeGeometry(.055,.13,6),std(0x2f6a4e),4200),dummy=new THREE.Object3D();
  let n=0,guard=0;
  while(n<4200&&guard++<90000){const x=-W/2+r()*W,z=-D/2+r()*D,h=metreHeight(x*S,z*S);
   if(h<10||h>280)continue;
   if(nearBase(x,z)||inCity(x,z)||inVillage(x,z)||nearRoad(x,z))continue;
   if(Math.abs(z-rz)<rhw*2.6)continue;
   if(r()>clamp((h-8)/34,.04,1))continue;                 // forest thins out toward the plain
   dummy.position.set(x,height(x,z)+.03,z);dummy.rotation.y=r()*6.28;dummy.scale.setScalar(.6+r()*1.1);dummy.updateMatrix();
   trunk.setMatrixAt(n,dummy.matrix);dummy.position.y+=.075;dummy.updateMatrix();leaf.setMatrixAt(n,dummy.matrix);n++;}
  trunk.count=n;leaf.count=n;scene.add(trunk,leaf);
  const rocks=new THREE.InstancedMesh(new THREE.IcosahedronGeometry(.012,1),std(0x74786f),360);
  const rockColor=new THREE.Color();
  for(let i=0;i<360;i++){const x=-W/2+r()*W,z=-D/2+r()*D;if(metreHeight(x*S,z*S)<25&&r()>.3)continue;dummy.position.set(x,height(x,z)+.006,z);dummy.rotation.set(r()*3,r()*3,r()*3);dummy.scale.set(.45+r()*1.55,.35+r(),.45+r()*1.55);dummy.updateMatrix();rocks.setMatrixAt(i,dummy.matrix);rocks.setColorAt(i,rockColor.setHSL(.12,.04,.38+r()*.16));}scene.add(rocks);}

 // field parcels in the plain, with hedgerows
 for(let i=0;i<40;i++){const x=-30+(i%10)*2.4,z=11+Math.floor(i/10)*1.6,y=height(x,z);
  box(x,y+.02,z,2.1,.03,1.3,std(i%2?0x788a58:0x8f8a5d));
  box(x,y+.035,z-0.66,2.1,.03,.04,std(0x3f5c3c));box(x,y+.035,z+0.66,2.1,.03,.04,std(0x3f5c3c));}

 // low shrubs across the plain to break up the empty ground
 {const r=rngLocal(913),bush=new THREE.InstancedMesh(new THREE.IcosahedronGeometry(.012,1),std(0x3c6b48),2600),d=new THREE.Object3D(),bushColor=new THREE.Color();
  let n=0,guard=0;while(n<2600&&guard++<40000){const x=-W/2+r()*W,z=-D/2+r()*D,h=metreHeight(x*S,z*S);
   if(h>26)continue;if(Math.abs(z-rz)<rhw*2.2)continue;if(Math.hypot(x-bx,z-bz)<4)continue;
   d.position.set(x,height(x,z)+.008,z);d.rotation.y=r()*6.28;d.scale.set(.55+r()*1.35,.4+r()*.8,.55+r()*1.35);d.updateMatrix();bush.setMatrixAt(n,d.matrix);bush.setColorAt(n,bushColor.setHSL(.32+r()*.06,.28+r()*.18,.25+r()*.13));n++;}
  bush.count=n;scene.add(bush);}

 // Reed beds and smooth stones make both river banks readable from ground level.
 {const r=rngLocal(1221),reed=new THREE.InstancedMesh(new THREE.CylinderGeometry(.0015,.003,.018,5),std(0x8a9b59),1800),stone=new THREE.InstancedMesh(new THREE.IcosahedronGeometry(.006,1),std(0x777d75),520),d=new THREE.Object3D();
  for(let i=0;i<1800;i++){const x=-W/2+r()*W,side=r()>.5?1:-1,z=rz+side*(rhw+.035+r()*.22);d.position.set(x,height(x,z)+.009,z);d.rotation.y=r()*6.28;d.rotation.z=(r()-.5)*.2;d.scale.set(.55+r()*.7,.65+r()*.8,.55+r()*.7);d.updateMatrix();reed.setMatrixAt(i,d.matrix);}
  for(let i=0;i<520;i++){const x=-W/2+r()*W,side=r()>.5?1:-1,z=rz+side*(rhw+.02+r()*.38);d.position.set(x,height(x,z)+.003,z);d.rotation.set(r()*2,r()*4,r()*2);d.scale.set(.5+r()*1.4,.25+r()*.45,.5+r()*1.4);d.updateMatrix();stone.setMatrixAt(i,d.matrix);}scene.add(reed,stone);}

 // avenue trees along the two main roads
 {const r=rngLocal(404),trunk=new THREE.InstancedMesh(new THREE.CylinderGeometry(.012,.016,.05,5),std(0x5a4a38),900),
   leaf=new THREE.InstancedMesh(new THREE.ConeGeometry(.055,.13,6),std(0x356f52),900),d=new THREE.Object3D();
  let n=0;
   // avenue trees follow the two trunk roads, skipping the apron, the bridge and the city
   const skip=(x,z)=>Math.hypot(x-bx,z-bz)<3||Math.abs(z-rz)<rhw+.8||(x>13&&x<30&&z>-22&&z<-2);
   for(let t=-W/2+.6;t<W/2;t+=.55){for(const s of [-.3,.3]){const x=t,z=ROAD_EW+s;if(skip(x,z))continue;d.position.set(x,height(x,z)+.03,z);d.rotation.y=r()*6.28;d.scale.setScalar(.8+r()*.4);d.updateMatrix();trunk.setMatrixAt(n,d.matrix);d.position.y+=.075;d.updateMatrix();leaf.setMatrixAt(n,d.matrix);n++;}}
   for(let t=-D/2+.6;t<D/2;t+=.55){for(const s of [-.3,.3]){const x=ROAD_NS+s,z=t;if(skip(x,z))continue;d.position.set(x,height(x,z)+.03,z);d.rotation.y=r()*6.28;d.scale.setScalar(.8+r()*.4);d.updateMatrix();trunk.setMatrixAt(n,d.matrix);d.position.y+=.075;d.updateMatrix();leaf.setMatrixAt(n,d.matrix);n++;}}
  trunk.count=n;leaf.count=n;scene.add(trunk,leaf);}

 // parked cars along the city streets
 {const r=rngLocal(515),car=new THREE.InstancedMesh(new THREE.BoxGeometry(.045,.028,.022),std(0xb9c0c4),420),d=new THREE.Object3D();
  let n=0;for(let i=0;i<420;i++){const gx=13.4+Math.floor(r()*6)*3.1,gz=-19.4+Math.floor(r()*5)*3.4;
   const x=gx+(r()>.5?.2:-.2),z=gz+(r()-.5)*2.6;d.position.set(x,height(x,z)+.014,z);d.rotation.y=r()>.5?0:Math.PI/2;d.updateMatrix();car.setMatrixAt(n++,d.matrix);}
  car.count=n;scene.add(car);}

 // small lake in the southern plain
 {const lx=-14,lz=15,ly=height(lx,lz);
  const lake=mesh(new THREE.CircleGeometry(1.15,40),new THREE.MeshStandardMaterial({map:waterTex,color:0x7fc6d6,roughness:.25,metalness:.1,transparent:true,opacity:.92}));
  lake.rotation.x=-Math.PI/2;lake.position.set(lx,ly+.025,lz);}

   label('西北山地林区',-22,4,-14,'#8fe6ff',10);label('东部城区',26,2.6,-10,'#ffd17a',9);label('西部工业区',-18,2.2,6,'#c6a8ff',10);label('南部河谷',20,1.6,22,'#75f0c7',9);

 // ---------- dynamic ----------
 const objects=new Map(),markers=new Map(),routes=new Map(),cones=new Map();
 const deviceAssets={},deviceClips={};let disposed=false;
 function dispose(o){o.traverse(n=>{n.geometry?.dispose();if(n.material)for(const m of [n.material].flat()){m.map?.dispose?.();m.dispose();}});o.removeFromParent();}
 function loadDeviceAsset(type,url){new GLTFLoader().load(url,gltf=>{if(disposed){dispose(gltf.scene);return;}
   const source=gltf.scene,bounds=new THREE.Box3().setFromObject(source),size=new THREE.Vector3(),center=new THREE.Vector3();bounds.getSize(size);
   source.scale.multiplyScalar(.65/Math.max(size.x,size.y,size.z));source.updateMatrixWorld(true);
   new THREE.Box3().setFromObject(source).getCenter(center);source.position.sub(center);source.updateMatrixWorld(true);
   const wrapper=new THREE.Group();wrapper.add(source);deviceAssets[type]=wrapper;deviceClips[type]=gltf.animations||[];
   for(const [id,o] of objects)if(o.type===type){dispose(o.g);dispose(o.tag);objects.delete(id);}
  },undefined,error=>console.warn(`设备素材加载失败：${type}`,error));}
 loadDeviceAsset('uav','/models/rescue-drone.glb');
 function buildDevice(d){const g=new THREE.Group();g.userData.deviceId=d.id;scene.add(g);const rotors=[],legs=[];
  let mixer=null,model=null;const template=deviceAssets[d.type];
  if(template){model=cloneSkeleton(template);model.traverse(n=>{if(!n.isMesh)return;n.geometry=n.geometry.clone();const mats=[n.material].flat().map(m=>{const copy=m.clone();if(m.map){copy.map=m.map.clone();copy.map.needsUpdate=true;}copy.roughness=Math.min(.78,copy.roughness??.7);copy.metalness=Math.max(d.type==='dog'?.28:.16,copy.metalness??0);return copy;});n.material=Array.isArray(n.material)?mats:mats[0];n.castShadow=true;n.receiveShadow=true;});if(d.type==='dog'){model.scale.set(1,2,1.5);model.position.y=-.135;}g.add(model);
   if(deviceClips[d.type]?.length){mixer=new THREE.AnimationMixer(model);const idle=deviceClips[d.type].find(c=>/idle|hover|fly/i.test(c.name))||deviceClips[d.type][0];mixer.clipAction(idle).play();}
   // A small status beacon keeps the imported model readable in the operations view.
   const beacon=mesh(new THREE.SphereGeometry(.028,12,8),std(d.type==='uav'?0x58ead2:0xffc45d,{emissive:d.type==='uav'?0x174d47:0x4a3310,emissiveIntensity:.7}),g);beacon.position.set(0,.2,-.25);
  }
  else if(d.type==='uav'){box(0,0,0,.5,.13,.5,std(0xe6efee),g);box(0,.08,0,.22,.06,.34,std(0x2fc0b4),g);
   for(const a of [0,1,2,3]){const ang=Math.PI/4+a*Math.PI/2,ax=Math.cos(ang)*.32,az=Math.sin(ang)*.32;
    const arm=box(ax/2,.0,az/2,.34,.04,.05,std(0x39494f),g);arm.rotation.y=-ang;
    const rotor=mesh(new THREE.CylinderGeometry(.16,.16,.015,20),std(0x223034),g);rotor.position.set(ax,.05,az);rotors.push(rotor);
    mesh(new THREE.CylinderGeometry(.045,.045,.08,10),std(0x647f80),g).position.set(ax,.0,az);}
   box(0,-.09,-.02,.1,.1,.1,std(0x274d57),g);mesh(new THREE.SphereGeometry(.025,8,6),std(0xff5a52),g).position.set(0,.05,-.2);}
  else{const shell=std(0xc7cfce,{roughness:.4,metalness:.35}),dark=std(0x333d41,{roughness:.5,metalness:.55}),
    joint=std(0x7d888c,{roughness:.3,metalness:.75}),accent=std(0xf0b429,{roughness:.5,metalness:.2}),
    lens=std(0x4fd8cc,{roughness:.12,metalness:.5,emissive:0x0f3f3a,emissiveIntensity:.6});
   // A strut is a box stretched from a to b, which reads as machined metal rather than an organic capsule.
   const strut=(parent,a,b,w,h,mat)=>{const dir=b.clone().sub(a),len=Math.max(.001,dir.length());
    const m=mesh(new THREE.BoxGeometry(w,h,len),mat,parent);m.position.copy(a).add(b).multiplyScalar(.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,1),dir.normalize());return m;};
   // Torso faces -Z; feet land at y = -0.456 so the dog stands on the 0.82 m origin height.
   box(0,.005,0,.155,.085,.47,dark,g);        // chassis
   box(0,.072,0,.17,.03,.42,shell,g);         // light top shell
   box(0,.093,.05,.09,.014,.16,accent,g);     // accent stripe along the back
   box(0,.04,.24,.12,.07,.07,dark,g);         // rear housing
   box(0,.05,-.26,.11,.07,.09,shell,g);       // neck
   box(0,.055,-.355,.125,.09,.12,shell,g);    // head
   box(0,.032,-.36,.13,.03,.11,dark,g);       // visor band
   box(0,.055,-.418,.1,.04,.014,dark,g);      // sensor bar
   for(const x of [-.032,.032])mesh(new THREE.SphereGeometry(.017,12,8),lens,g).position.set(x,.057,-.425);
   for(const x of [-.085,.085])for(const z of [-.18,.18]){
    const hip=new THREE.Vector3(x,.005,z);
    const motor=mesh(new THREE.CylinderGeometry(.043,.043,.055,18),joint,g);motor.rotation.z=Math.PI/2;motor.position.copy(hip);
    const leg=new THREE.Group();leg.position.copy(hip);g.add(leg);legs.push(leg);
    // knee and foot are authored in body space, then converted to the hip-local frame
    const kneeAbs=new THREE.Vector3(x*1.16,-.25,z+(z<0?-.055:.055));
    const footAbs=new THREE.Vector3(x*1.08,-.456,z+(z<0?-.095:.095));
    const knee=kneeAbs.clone().sub(hip),foot=footAbs.clone().sub(hip);
    strut(leg,new THREE.Vector3(0,0,0),knee,.042,.042,dark);
    const kneeJoint=mesh(new THREE.CylinderGeometry(.036,.036,.05,16),joint,leg);kneeJoint.rotation.z=Math.PI/2;kneeJoint.position.copy(knee);
    strut(leg,knee,foot,.028,.028,shell);
    const pad=mesh(new THREE.CylinderGeometry(.032,.026,.022,16),dark,leg);pad.position.copy(foot);
    const band=mesh(new THREE.BoxGeometry(.048,.038,.01),accent,leg);band.position.copy(knee).multiplyScalar(.55);}
   const beacon=mesh(new THREE.SphereGeometry(.018,12,8),std(0xffc45d,{emissive:0x4a3310,emissiveIntensity:.9}),g);beacon.position.set(0,.105,.2);}
   const tag=label(d.name,d.x,d.y+1,d.z,d.type==='uav'?'#83ebdc':'#f4c67c',2.2,false);
  tag.userData.deviceId=d.id;
  const scan=mesh(new THREE.TorusGeometry(1.6,.025,8,48),new THREE.MeshBasicMaterial({color:0x8fffd8,transparent:true,opacity:.7}),g);scan.rotation.x=-Math.PI/2;scan.position.y=-.28;scan.visible=false;
  return {g,rotors,legs,scan,tag,mixer,model,type:d.type,name:d.name};}

 let cameraSeq=-1,move=null,dragLook=false;const ray=new THREE.Raycaster();let press;
 const down=e=>{if(free&&e.button===0&&!locked)renderer.domElement.requestPointerLock?.()?.catch?.(()=>{});press={x:e.clientX,y:e.clientY,b:e.button};if(free&&e.button===0)dragLook=true;};
 const up=e=>{dragLook=false;if(free)return;if(!press||press.b!==0||Math.hypot(e.clientX-press.x,e.clientY-press.y)>5)return;press=null;
  const r=renderer.domElement.getBoundingClientRect();
  ray.setFromCamera(new THREE.Vector2((e.clientX-r.left)/r.width*2-1,-(e.clientY-r.top)/r.height*2+1),camera);
  if(!latest.current.placing){const deviceHit=ray.intersectObjects([...objects.values()].flatMap(o=>[o.g,o.tag]),true)[0];if(deviceHit){let o=deviceHit.object;while(o&&!o.userData.deviceId)o=o.parent;if(o){latest.current.onDeviceSelect?.(o.userData.deviceId);return;}}const hit=ray.intersectObjects([...markers.values()].map(m=>m.g),true)[0];
   if(hit){let o=hit.object;while(o&&!o.userData.id)o=o.parent;if(o)latest.current.onSelect(o.userData.id);}return;}
  const hit=ray.intersectObject(ground)[0];if(hit)latest.current.onCreate(hit.point.x,hit.point.z);};
 renderer.domElement.addEventListener('pointerdown',down);renderer.domElement.addEventListener('pointerup',up);

 const FIT=()=>{const f=Math.tan(THREE.MathUtils.degToRad(camera.fov/2));return Math.max((W/2)/(f*camera.aspect),(D/2)/f)*1.16;};
 const overview=()=>new THREE.Vector3(0.55,0.5,0.72).normalize().multiplyScalar(FIT());
 const observer=new ResizeObserver(()=>{const w=el.clientWidth,h=el.clientHeight;renderer.setSize(w,h);camera.aspect=w/h;camera.updateProjectionMatrix();
  const m=latest.current.camera?.mode;
  if(m==='overview')move={target:new THREE.Vector3(bx,height(bx,bz),bz+.3),pos:overview()};
  else if(!m||m==='home')move={target:new THREE.Vector3(bx,height(bx,bz),bz+.3),pos:homePos()};});observer.observe(el);
 let t=0,lastFrame=performance.now();
 renderer.setAnimationLoop(()=>{const p=latest.current,now=performance.now(),dt=Math.min(.05,(now-lastFrame)/1000);lastFrame=now;t+=dt;
  if(free){camera.rotation.order='YXZ';camera.rotation.set(pitch,yaw,0);
   fwd.set(-Math.sin(yaw),0,-Math.cos(yaw));rt.set(Math.cos(yaw),0,-Math.sin(yaw));
   const v=(p.freeSpeed||30)*(keys.has('ShiftLeft')||keys.has('ShiftRight')?3:1)*dt/S;
   const direction=new THREE.Vector3();if(keys.has('KeyW'))direction.add(fwd);if(keys.has('KeyS'))direction.sub(fwd);if(keys.has('KeyA'))direction.sub(rt);if(keys.has('KeyD'))direction.add(rt);if(direction.lengthSq())camera.position.addScaledVector(direction.normalize(),v);
   camera.position.x=clamp(camera.position.x,-W/2+.1,W/2-.1);camera.position.z=clamp(camera.position.z,-D/2+.1,D/2-.1);
   if(keys.has('KeyQ'))eyeOffset+=v*S;if(keys.has('KeyE'))eyeOffset-=v*S;eyeOffset=clamp(eyeOffset,1.7,10000);
   camera.position.y=surfaceHeight(camera.position.x*S,camera.position.z*S)/S+eyeOffset/S;}
  for(const [id,o] of objects)if(!p.devices.some(d=>d.id===id)){dispose(o.g);dispose(o.tag);objects.delete(id);}
  for(const [id,c] of cones)if(!p.devices.some(d=>d.id===id&&d.type==='uav')){dispose(c);cones.delete(id);}
  for(const d of p.devices){let o=objects.get(d.id);
   if(o&&(o.type!==d.type||o.name!==d.name)){dispose(o.g);dispose(o.tag);objects.delete(d.id);o=null;}
    if(!o){o=buildDevice(d);objects.set(d.id,o);o.g.position.set(d.x,visualDeviceY(d),d.z);}
    const tgt=new THREE.Vector3(d.x,visualDeviceY(d),d.z),delta=tgt.clone().sub(o.g.position);
   if(delta.length()>.0001)o.g.rotation.y=Math.atan2(-delta.x,-delta.z);
   o.g.position.lerp(tgt,1-Math.exp(-12*dt));
    const range=camera.position.distanceTo(o.g.position),sc=d.type==='uav'?.025:.018;
    o.g.scale.setScalar(sc);
    const ls=Math.max(.07,Math.min(.82,range*.1));o.tag.scale.set(ls,ls*160/1024,1);
   o.tag.position.set(o.g.position.x,o.g.position.y+Math.max(.018,range*.025),o.g.position.z);o.tag.visible=followId!==d.id;
   o.mixer?.update(dt);if(p.running){o.rotors.forEach(r=>r.rotation.y+=dt*32);
    // diagonal trot: legs 0 and 3 swing together, 1 and 2 are opposite
    o.legs.forEach((leg,i)=>leg.rotation.x=delta.length()>.00005?Math.sin(t*9+((i===0||i===3)?0:Math.PI))*.34:0);}o.scan.visible=p.tasks?.some(task=>task.deviceId===d.id&&task.status==='执行中'&&task.hold>0)||false;o.scan.rotation.y=t;
   if(d.type==='uav'){let c=cones.get(d.id);
    if(!c){c=mesh(new THREE.ConeGeometry(1,1,44,1,true),new THREE.MeshBasicMaterial({color:0x63e8cb,transparent:true,opacity:.09,side:THREE.DoubleSide,depthWrite:false}),scene);cones.set(d.id,c);}
    const floor=height(d.x,d.z),rr=WORLD.searchRadius/S;
    c.position.set(o.g.position.x,(d.y+floor)/2,o.g.position.z);
    c.scale.set(rr,(d.y-floor),rr);c.visible=d.y>floor+.3&&!free&&range>1;}}
  for(const [id,line] of routes)if(!p.tasks?.some(t=>t.id===id&&t.status==='执行中')){dispose(line);routes.delete(id);}
  for(const task of p.tasks||[]){if(task.status!=='执行中')continue;const d=p.devices.find(d=>d.id===task.deviceId);if(!d)continue;
   const pts=[new THREE.Vector3(d.x,d.type==='uav'?d.y:height(d.x,d.z)+.05,d.z),
    ...task.route.slice(task.index).map(v=>new THREE.Vector3(v.x,d.type==='uav'?d.y:height(v.x,v.z)+.05,v.z))];
   let line=routes.get(task.id);
   if(!line){line=new THREE.Line(new THREE.BufferGeometry(),new THREE.LineDashedMaterial({color:d.type==='uav'?0x74e6da:0xf8c37a,dashSize:.6,gapSize:.35}));scene.add(line);routes.set(task.id,line);}
   line.geometry.dispose();line.geometry=new THREE.BufferGeometry().setFromPoints(pts);line.computeLineDistances();}
   for(const [id,o] of markers)if(!p.events.some(e=>e.id===id)){dispose(o.g);o.tag&&dispose(o.tag);markers.delete(id);}
  for(const e of p.events){let o=markers.get(e.id);
   if(!o){const g=new THREE.Group();g.userData.id=e.id;scene.add(g);
     const ring=mesh(new THREE.TorusGeometry(.2,.022,8,32),new THREE.MeshBasicMaterial({color:0xff9677}),g);ring.rotation.x=Math.PI/2;ring.position.y=.045;
     const pillar=mesh(new THREE.ConeGeometry(.085,.28,12),new THREE.MeshBasicMaterial({color:0xf05d4f}),g);pillar.position.y=.2;
     const plume=mesh(new THREE.IcosahedronGeometry(.15,1),new THREE.MeshBasicMaterial({color:e.kind==='gas'?0xa2b875:0x7f7770}),g);plume.position.y=.42;
     plume.visible=['fire','gas'].includes(e.kind);o={g,ring,pillar,plume,tag:null,tagStatus:''};markers.set(e.id,o);}
     const base=height(e.x,e.z),style=e.status==='已处理'||e.status==='已确认'?{ring:0x50e58d,pillar:0x20bd70}:e.status==='处理中'?{ring:0x62c9ff,pillar:0x258dd1}:e.status==='复核中'||e.status==='待复核'?{ring:0xffdc71,pillar:0xf0a52c}:e.status==='侦察中'?{ring:0x62ead4,pillar:0x19bdb2}:{ring:0xff9677,pillar:0xf05d4f};
     o.g.position.set(e.x,base,e.z);o.g.visible=true;o.ring.material.color.setHex(style.ring);o.pillar.material.color.setHex(e.id===p.selected?0xfff1aa:style.pillar);o.plume.material.color.setHex(style.pillar);
     if(o.tagStatus!==e.status){if(o.tag)dispose(o.tag);o.tag=label(`${TYPES[e.kind]} · ${e.status}`,e.x,base+.5,e.z,'#'+style.ring.toString(16).padStart(6,'0'),.18,false);o.tagStatus=e.status;}
     o.tag.position.set(e.x,base+.5,e.z);o.tag.visible=o.g.visible;
     o.ring.scale.setScalar(e.status==='已处理'||e.status==='已确认'?1.08:1+Math.sin(t*3)*.14);o.plume.rotation.y=t*.4;}
  if(p.camera&&p.camera.seq!==cameraSeq){cameraSeq=p.camera.seq;const cfg=p.camera;if(free&&!['free','exitfree'].includes(cfg.mode))stopFree();if(cfg.mode!=='follow')followId=null;
    if(cfg.mode==='follow'){followId=cfg.deviceId;followPosition=null;move=null;camera.up.set(0,1,0);controls.enabled=true;const o=objects.get(followId);if(o){controls.target.copy(o.g.position);camera.position.copy(o.g.position).add(o.type==='dog'?new THREE.Vector3(.04,.025,.05):new THREE.Vector3(.06,.035,.075));followPosition=o.g.position.clone();}}
   else if(cfg.mode==='orbit'){followId=null;followPosition=null;move=null;}
   else if(cfg.mode==='free'){move=null;enterFree();}
   else if(cfg.mode==='exitfree'){stopFree();}
    else if(cfg.mode==='top'){camera.up.set(0,0,-1);
     // Top view is a true north-up plan view: keep camera and target on one vertical line.
     move=null;camera.position.set(bx,FIT(),bz);controls.target.set(bx,height(bx,bz),bz);controls.update();}
   else{camera.up.set(0,1,0);
    const target=cfg.mode==='focus'?new THREE.Vector3(cfg.x,cfg.y==null?height(cfg.x,cfg.z):cfg.y,cfg.z):new THREE.Vector3(bx,height(bx,bz),bz+.3);
    const pos=cfg.mode==='focus'?target.clone().add(new THREE.Vector3(.65,.5,.75)):cfg.mode==='overview'?overview():homePos();
    move={target,pos};}}
  for(const l of worldLabels){const range=camera.position.distanceTo(l.sp.position),k=Math.max(.62,Math.min(1.18,range*.035));l.sp.scale.set(l.base*k,l.base*k*160/1024,1);}
  if(followId&&!free){const o=objects.get(followId);if(o){if(!followPosition){followPosition=o.g.position.clone();controls.target.copy(o.g.position);}else{const delta=o.g.position.clone().sub(followPosition);camera.position.add(delta);controls.target.add(delta);followPosition.copy(o.g.position);}}else{followId=null;followPosition=null;}}
  if(move&&!free){camera.position.lerp(move.pos,.07);controls.target.lerp(move.target,.07);if(camera.position.distanceTo(move.pos)<.15)move=null;}
  if(!free)controls.update();window.__view={up:camera.up.toArray().map(v=>+v.toFixed(2)),free,followId,eyeHeight:eyeOffset,position:camera.position.toArray().map(v=>v*S),entryPosition:freeEntryPosition?.toArray().map(v=>v*S),targetDistance:camera.position.distanceTo(controls.target)*S,modelScale:.025,assetTypes:Object.keys(deviceAssets)};
renderer.render(scene,camera);});

 const interrupt=()=>{move=null;};
 renderer.domElement.addEventListener('wheel',interrupt);renderer.domElement.addEventListener('pointerdown',interrupt);
 return()=>{disposed=true;renderer.setAnimationLoop(null);observer.disconnect();controls.dispose();
  renderer.domElement.removeEventListener('pointerdown',down);renderer.domElement.removeEventListener('pointerup',up);
  renderer.domElement.removeEventListener('wheel',interrupt);renderer.domElement.removeEventListener('pointerdown',interrupt);
  renderer.domElement.removeEventListener('dblclick',enterFree);
  document.removeEventListener('pointerlockchange',lockchange);document.removeEventListener('keydown',keydown);
  document.removeEventListener('keyup',keyup);document.removeEventListener('mousemove',mousemove);
  dispose(scene);for(const asset of Object.values(deviceAssets))dispose(asset);renderer.dispose();renderer.domElement.remove();};
 },[]);
 return <div className="world" ref={host} style={{cursor:props.placing?'crosshair':'grab'}}/>;
}

function rngLocal(seed){let s=seed>>>0;return()=>{s=(s*1664525+1013904223)>>>0;return s/4294967296;};}
