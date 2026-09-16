const {chromium,expect}=require('@playwright/test');

(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  const context=await browser.newContext({viewport:{width:1600,height:1000}});
  await context.addInitScript(()=>{if(!sessionStorage.getItem('test-initialized')){localStorage.removeItem('sky-v4');sessionStorage.setItem('test-initialized','1');}});
  const page=await context.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('dialog',dialog=>dialog.accept());
  await page.goto(process.env.SIM_URL||'http://localhost:5174');

  await expect(page.locator('.device-card')).toHaveCount(4);
  await expect(page.locator('.device-card')).toContainText(['停靠位 01','停靠位 02','停靠位 03','停靠位 04']);
  await expect.poll(()=>page.evaluate(()=>window.__view?.assetTypes?.sort().join(','))).toBe('uav');
  await page.getByRole('button',{name:'添加设备'}).click();
  await page.getByLabel('设备名称').fill('苍穹 03');
   await page.getByRole('button',{name:'保存设备'}).click();
   await expect(page.locator('.device-card')).toHaveCount(5);
   await expect(page.locator('.device-card').last()).toContainText('停靠位 05');
   await page.getByRole('button',{name:'添加设备'}).click();
   await page.getByLabel('设备名称').fill('猎隼 03');
   await page.getByLabel('设备类型').selectOption('dog');
   await expect(page.getByLabel('机器狗最大作业距离（m）')).toBeVisible();
   await expect(page.getByLabel('机器狗最大作业距离（m）')).toHaveValue('6000');
   await page.getByLabel('机器狗最大作业距离（m）').fill('1200');
   await page.getByRole('button',{name:'保存设备'}).click();
   await expect(page.locator('.device-card')).toHaveCount(6);
   await expect(page.locator('.device-card').last()).toContainText('作业距离 1.2 km');

   await page.locator('.device-card').first().getByRole('button',{name:'◎ 跟随'}).click();
   await expect.poll(()=>page.evaluate(()=>window.__view?.followId)).not.toBeNull();
   await expect(page.locator('.tracking')).toContainText('苍穹 01');
   await expect(page.locator('.tracking')).toContainText('仿真坐标 X / Z');
   await expect(page.locator('.tracking')).toContainText('BATTERY');
  const beforeZoom=await page.evaluate(()=>window.__view.targetDistance);
  await page.locator('canvas').hover();await page.mouse.wheel(0,-650);await page.waitForTimeout(500);
  const afterZoom=await page.evaluate(()=>window.__view.targetDistance);
  if(!(afterZoom<beforeZoom))throw Error(`follow zoom did not change: ${beforeZoom} -> ${afterZoom}`);
  await page.screenshot({path:'check-model-follow.png',fullPage:true});
  await page.getByRole('button',{name:'退出跟随'}).click();

  await page.getByRole('button',{name:'＋ 随机分布'}).click();
  await expect(page.locator('.event-card')).toHaveCount(1);
  await page.locator('.event-card').click();
  await page.getByLabel('执行设备').selectOption({index:1});
  await page.getByLabel('仿真速度').selectOption('300');
  await page.getByRole('button',{name:'派遣无人机侦察',exact:false}).click();
  await page.getByRole('button',{name:'派遣机器狗复核',exact:false}).waitFor({timeout:60000});
  await page.getByRole('button',{name:'派遣机器狗复核',exact:false}).click();
  await expect(page.locator('.event-card').filter({hasText:'已处理'})).toHaveCount(1,{timeout:90000});
  await expect(page.locator('.result-card')).toContainText('现场处理完成');
  await page.screenshot({path:'check-fullscreen.png',fullPage:true});
  await expect(page.locator('.event-card')).toHaveCount(0,{timeout:12000});
  await page.getByRole('button',{name:'暂停仿真',exact:false}).click();
  await page.waitForTimeout(1700);
  await page.reload();
  await page.getByRole('button',{name:/灾情与任务/}).click();
  await expect(page.locator('.event-card')).toHaveCount(0);
  if(!await page.evaluate(()=>window.__sim.events.length===1&&window.__sim.events[0].archived===true))throw Error('processed incident history was not persisted');
   await expect(page.locator('.device-card')).toHaveCount(6);
  if(errors.length)throw Error(errors.join('\n'));
  console.log('PASS: drone asset, robot-dog model, centre berths, orbit/zoom follow, processing lifecycle and v4 persistence');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exit(1)});
