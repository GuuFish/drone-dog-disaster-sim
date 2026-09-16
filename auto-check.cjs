const {chromium,expect}=require('@playwright/test');

(async()=>{
 const sim=await import('./simulation.js');
 const seededState=JSON.stringify(sim.addEvent(sim.fresh(),'person',-2400,-1500,'高'));
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  const context=await browser.newContext({viewport:{width:1600,height:1000}});
  await context.addInitScript(value=>{if(!sessionStorage.getItem('test-initialized')){localStorage.setItem('sky-v4',value);sessionStorage.setItem('test-initialized','1');}},seededState);
  const page=await context.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('dialog',dialog=>dialog.accept());
  await page.goto(process.env.SIM_URL||'http://localhost:5174');
  await page.getByLabel('仿真速度').selectOption('300');
  await page.getByRole('button',{name:'▶ 全部启动'}).click();
  await page.getByRole('button',{name:/灾情与任务/}).click();
  await expect(page.locator('.event-card').filter({hasText:'已处理'})).toHaveCount(1,{timeout:110000});
  await page.screenshot({path:'check-auto-complete.png',fullPage:true});

  await page.getByRole('button',{name:'▦ 俯视'}).click();
  await page.waitForTimeout(1800);
  await page.getByRole('button',{name:'✥ 自由视角'}).click();
  await page.waitForTimeout(500);
  const view=await page.evaluate(()=>window.__view);
  const shift=Math.hypot(...view.position.map((v,i)=>v-view.entryPosition[i]));
  if(!view?.free||Math.abs(view.up[1]-1)>.01||shift>.1||view.modelScale!==.025)throw Error('invalid retained free view: '+JSON.stringify({view,shift}));
  if(await page.getByLabel('视角移动速度').inputValue()!=='30')throw Error('free-view speed default is not 30 m/s');
  await page.keyboard.press('Escape');
  await expect.poll(()=>page.evaluate(()=>window.__view?.free)).toBe(false);

  await page.getByRole('button',{name:'↩ 全部归位'}).click();
  await expect(page.locator('.device-card').filter({hasText:'待命'})).toHaveCount(4,{timeout:60000});
  await page.screenshot({path:'check-auto-home.png',fullPage:true});
  await page.getByRole('button',{name:'◈ 全景'}).click();
  await page.waitForTimeout(1200);
  await page.screenshot({path:'check-overview.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});
  await page.waitForTimeout(800);
  await page.screenshot({path:'check-mobile.png',fullPage:true});
  if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw Error('horizontal overflow');
  if(errors.length)throw Error(errors.join('\n'));
  console.log('PASS: all-start discovery/processing, retained free camera, roll reset, all-return and mobile layout');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exit(1)});
