const {chromium,expect}=require('@playwright/test');
const {mkdirSync,copyFileSync,rmSync}=require('node:fs');
const {join}=require('node:path');

const baseUrl=process.env.DEMO_URL||'http://127.0.0.1:5173';
const outputDir=join(__dirname,'demo'),rawDir=join(outputDir,'raw');
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));

async function caption(page,title,subtitle='',center=false){
 await page.evaluate(({title,subtitle,center})=>{
  let node=document.querySelector('#recording-caption');
  if(!node){node=document.createElement('div');node.id='recording-caption';document.body.appendChild(node);}
  node.innerHTML=`<strong>${title}</strong>${subtitle?`<span>${subtitle}</span>`:''}`;
  node.className=center?'center':'';
  requestAnimationFrame(()=>node.classList.add('show'));
 },{title,subtitle,center});
}
async function hideCaption(page){await page.evaluate(()=>document.querySelector('#recording-caption')?.classList.remove('show'));await wait(450);}

(async()=>{
 mkdirSync(rawDir,{recursive:true});
 const browser=await chromium.launch({channel:'msedge',headless:true});
 const context=await browser.newContext({
  viewport:{width:1920,height:1080},deviceScaleFactor:1,
  recordVideo:{dir:rawDir,size:{width:1920,height:1080}}
 });
 await context.addInitScript(()=>localStorage.removeItem('sky-v4'));
 const page=await context.newPage(),errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 try{
  await page.goto(baseUrl,{waitUntil:'networkidle'});
  await page.waitForFunction(()=>window.__view?.assetTypes?.includes('uav'));
  await page.evaluate(()=>{const style=document.createElement('style');style.textContent=`
   #recording-caption{position:fixed;z-index:9999;left:50%;bottom:118px;transform:translate(-50%,20px);min-width:420px;padding:18px 28px;border:1px solid rgba(126,235,211,.48);border-radius:14px;background:rgba(7,27,36,.9);box-shadow:0 18px 55px rgba(0,0,0,.38);color:#eefcf8;text-align:center;opacity:0;transition:.4s ease;pointer-events:none;backdrop-filter:blur(12px);font-family:system-ui,sans-serif}#recording-caption.show{opacity:1;transform:translate(-50%,0)}#recording-caption strong{display:block;font-size:25px;letter-spacing:.06em}#recording-caption span{display:block;margin-top:7px;color:#9fc7c0;font-size:15px}#recording-caption.center{bottom:auto;top:50%;transform:translate(-50%,-42%);padding:30px 48px}#recording-caption.center.show{transform:translate(-50%,-50%)}#recording-caption.center strong{font-size:34px}`;document.head.appendChild(style);});

  await caption(page,'天穹 SKYWARD','无人机 · 机器狗空地协同应急救援仿真平台',true);await wait(3500);await hideCaption(page);
  await page.getByRole('button',{name:'◈ 全景'}).click();await caption(page,'全域三维态势','6.8 × 5.2 km 程序化救援区域');await wait(4200);await hideCaption(page);
  await page.getByRole('button',{name:'⌂ 中心'}).click();await wait(1800);
  await caption(page,'设备集结中心','默认部署 2 架四旋翼无人机与 2 台机器狗');await wait(3000);await hideCaption(page);

  await page.locator('.device-card').first().getByRole('button',{name:'◎ 跟随'}).click();
  await expect.poll(()=>page.evaluate(()=>window.__view?.followId)).not.toBeNull();
  await caption(page,'设备动态跟随','锁定目标后仍可旋转视角与滚轮缩放');
  const canvas=page.locator('canvas');await canvas.hover();await page.mouse.wheel(0,-320);await wait(1200);
  const box=await canvas.boundingBox();if(box){await page.mouse.move(box.x+box.width*.56,box.y+box.height*.52);await page.mouse.down();await page.mouse.move(box.x+box.width*.69,box.y+box.height*.45,{steps:28});await page.mouse.up();}
  await wait(2200);await hideCaption(page);await page.getByRole('button',{name:'退出跟随'}).click();
  await page.getByRole('button',{name:'▤ 设备',exact:false}).click();await wait(700);

  await page.evaluate(()=>{window.__recordingRandom=Math.random;const values=[.7419354839,.7173913043];Math.random=()=>values.length?values.shift():window.__recordingRandom();});
  await page.getByRole('button',{name:'＋ 随机分布'}).click();
  await page.evaluate(()=>{Math.random=window.__recordingRandom;delete window.__recordingRandom;});
  await expect(page.locator('.event-card')).toHaveCount(1);
  await page.locator('.event-card').click();await caption(page,'灾情注入','疑似被困人员 · 高等级');await wait(2600);await hideCaption(page);

  await page.getByLabel('执行设备').selectOption({index:1});await page.getByLabel('仿真速度').selectOption('30');
  await page.getByRole('button',{name:'派遣无人机侦察',exact:false}).click();
  await caption(page,'空中侦察','指定无人机飞赴目标并回传侦察结果');
  await page.getByRole('button',{name:'派遣机器狗复核',exact:false}).waitFor({timeout:30000});await wait(1300);await hideCaption(page);

  await page.getByLabel('执行设备').selectOption({index:1});await page.getByLabel('仿真速度').selectOption('10');
  await page.getByRole('button',{name:'派遣机器狗复核',exact:false}).click();
  await caption(page,'地面复核','机器狗沿 A* 可通行路径抵近灾情位置');
  await expect(page.locator('.event-card').filter({hasText:'处理中'})).toHaveCount(1,{timeout:45000});
  await page.getByRole('button',{name:'暂停仿真',exact:false}).click();await wait(2000);await hideCaption(page);
  await page.locator('.device-card').filter({hasText:'机器狗 / GROUND UNIT'}).first().getByRole('button',{name:'◎ 跟随'}).click();
  await caption(page,'现场处理中','扫描采样 · 风险标记 · 结果上报');await wait(3000);await hideCaption(page);
  await page.getByRole('button',{name:'运行仿真',exact:false}).click();
  await expect(page.locator('.event-card').filter({hasText:'已处理'})).toHaveCount(1,{timeout:10000});
  await page.getByRole('button',{name:'暂停仿真',exact:false}).click();
  await caption(page,'处置完成','机器狗原地待命，灾情标记自动收起');await wait(3300);await hideCaption(page);
  await expect(page.locator('.event-card')).toHaveCount(0,{timeout:10000});
  await caption(page,'闭环留痕','当前态势已清理，任务与协议历史完整保留');await wait(2800);await hideCaption(page);

  await page.getByRole('button',{name:'▤ 设备',exact:false}).click();await wait(500);
  await page.getByLabel('仿真速度').selectOption('300');await page.getByRole('button',{name:'↩ 全部归位'}).click();
  await expect(page.locator('.device-card').filter({hasText:'待命'})).toHaveCount(4,{timeout:30000});
  await page.getByRole('button',{name:'◈ 全景'}).click();await caption(page,'演示完成','空地协同任务闭环 · 本地仿真运行');await wait(4200);
  await page.screenshot({path:join(outputDir,'skyward-demo-poster.png')});
  if(errors.length)throw Error(errors.join('\n'));
 }finally{
  const video=page.video();await context.close();const raw=await video.path();copyFileSync(raw,join(outputDir,'skyward-demo.webm'));await browser.close();rmSync(rawDir,{recursive:true,force:true});
 }
 console.log('RECORDED '+join(outputDir,'skyward-demo.webm'));
})().catch(error=>{console.error(error);process.exit(1)});
