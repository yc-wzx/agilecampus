import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
// Explicitly opt in: this test creates only clearly labelled, private synthetic data.
if(process.env.ALLOW_PRODUCTION_QA !== 'true') throw Error('Set ALLOW_PRODUCTION_QA=true to create private verification examples');
const require = createRequire(import.meta.url);
const {chromium} = require('playwright');
const dir = process.env.VERIFY_OUTPUT_DIR;
if(!dir || !path.isAbsolute(dir)) throw Error('Set an absolute private VERIFY_OUTPUT_DIR');
fs.mkdirSync(dir,{recursive:true,mode:0o700});
const origin = process.env.VERIFY_ORIGIN;
if(origin !== 'https://47.242.210.133') throw Error('This verification is scoped to the purchased AgileCampus server');
const file = path.join(dir, 'verification-account.private.json');
let account;
if (fs.existsSync(file)) account = JSON.parse(fs.readFileSync(file, 'utf8'));
else {
  const suffix = crypto.randomBytes(5).toString('hex');
  account = {origin, name:'部署验收（示例）', email:`deploy-check-${suffix}@example.com`, password:crypto.randomBytes(24).toString('base64url'), teamName:`部署验收示例-${suffix}`, projectName:'部署验收示例项目', taskTitle:'验收示例：检查部署后的任务保存'};
  fs.writeFileSync(file, JSON.stringify(account,null,2), {mode:0o600});
}
const checks=[];
let completed=false;
if(process.env.GITHUB_ACTIONS) console.log(`::add-mask::${account.password}`);
const browser=await chromium.launch({headless:true, ...(process.platform === 'win32' ? {channel:'msedge'} : {}), ...(process.env.QA_PROXY ? {proxy:{server:process.env.QA_PROXY}} : {})});
const context=await browser.newContext({viewport:{width:1440,height:1000}});
const page=await context.newPage();
page.setDefaultTimeout(25000);
page.setDefaultNavigationTimeout(30000);
const errors=[];
page.on('pageerror', e=>errors.push(e.message));
async function visit(route) {
  const response=await page.goto(origin+route);
  assert.equal(response.status(),200,route);
  assert(!page.url().includes('/login'),`Authenticated route ${route}`);
  await page.locator('main').last().waitFor();
}
async function login() {
  await page.goto(origin+'/login');
  await page.locator('input[name=email]').fill(account.email);
  await page.locator('input[name=password]').fill(account.password);
  await page.getByRole('button',{name:'登录',exact:true}).click();
  await page.waitForURL('**/dashboard');
}
try {
  const health=await context.request.get(origin+'/api/health');
  assert.equal(health.status(),200);
  assert.equal((await health.json()).ok,true);
  checks.push('HTTPS certificate validation and database health');
  if(!account.registered) {
    await page.goto(origin+'/register');
    await page.locator('input[name=name]').fill(account.name);
    await page.locator('input[name=email]').fill(account.email);
    await page.locator('input[name=password]').fill(account.password);
    await page.getByRole('button',{name:'注册',exact:true}).click();
    await page.waitForURL('**/login?registered=1');
    account.registered=true;
    fs.writeFileSync(file,JSON.stringify(account,null,2));
    checks.push('Register new private synthetic account');
  }
  await login();
  checks.push('Login and authenticated session');
  await visit('/teams');
  if(!account.teamId) {
    const teamForm=page.locator('form').filter({has:page.getByRole('heading',{name:'创建团队',exact:true})});
    await teamForm.locator('input[name=name]').fill(account.teamName);
    await teamForm.getByRole('button',{name:'创建',exact:true}).click();
    const card=page.locator('li').filter({hasText:account.teamName});
    await card.waitFor();
    account.teamId=(await card.getByRole('link',{name:'项目',exact:true}).getAttribute('href')).split('/')[2];
    fs.writeFileSync(file,JSON.stringify(account,null,2));
    checks.push('Create private team');
  }
  await visit(`/teams/${account.teamId}/projects`);
  if(!account.projectId) {
    const form=page.locator('form').filter({has:page.getByRole('heading',{name:'创建项目',exact:true})});
    await form.locator('input[name=name]').fill(account.projectName);
    await form.locator('select[name=templateId]').selectOption('course');
    await form.locator('textarea[name=description]').fill('自动部署验收示例，用于核对功能，不代表团队真实进度。');
    await form.getByRole('button',{name:'创建',exact:true}).click();
    await page.waitForURL(/\/projects\/[0-9a-f-]{36}$/);
    account.projectId=page.url().split('/').at(-1);
    fs.writeFileSync(file,JSON.stringify(account,null,2));
    checks.push('Create course project with template');
  }
  await visit(`/projects/${account.projectId}`);
  if(!account.taskCreated) {
    const form=page.locator('form').filter({has:page.getByRole('heading',{name:'新建任务',exact:true})});
    await form.locator('input[name=title]').fill(account.taskTitle);
    await form.locator('textarea[name=description]').fill('这是可区分的验收样例，请勿作为实际每周进度。');
    await form.locator('select[name=assigneeId]').selectOption({label:account.name});
    await form.getByRole('button',{name:'创建任务',exact:true}).click();
    await page.getByText(account.taskTitle,{exact:true}).first().waitFor();
    account.taskCreated=true;
    fs.writeFileSync(file,JSON.stringify(account,null,2));
    checks.push('Create assigned task');
  }
  await page.reload();
  await page.getByText(account.taskTitle,{exact:true}).first().waitFor();
  checks.push('Task persists after reload');
  await page.screenshot({path:path.join(dir,'production-board.png'),fullPage:true});
  await visit('/schedule');
  if(!account.eventCreated) {
    const form=page.locator('form').filter({has:page.getByRole('button',{name:'补充临时事件',exact:true})});
    assert.equal(await form.locator('input[name=shareBusy]').isChecked(),false);
    const day=new Date(Date.now()+86400000+8*3600000).toISOString().slice(0,10);
    await form.locator('input[name=title]').fill('验收示例私有事件');
    await form.locator('input[name=start]').fill(day+'T19:10');
    await form.locator('input[name=end]').fill(day+'T19:50');
    await form.getByRole('button',{name:'补充临时事件',exact:true}).click();
    await page.getByText('验收示例私有事件',{exact:true}).first().waitFor();
    account.eventCreated=true;
    fs.writeFileSync(file,JSON.stringify(account,null,2));
    checks.push('Save private emergency event, default sharing disabled');
  }
  await visit(`/teams/${account.teamId}/availability`);
  assert(!(await page.locator('main').innerText()).includes('验收示例私有事件'));
  await page.getByText('未共享日程，不能判断是否有空。',{exact:true}).waitFor();
  checks.push('Private emergency event absent from team availability');
  await visit(`/projects/${account.projectId}/personal-plan`);
  if(!account.planConfirmed) {
    const form=page.locator('form').filter({has:page.getByRole('heading',{name:'生成个人短期计划草案',exact:true})});
    await form.locator('select[name=mode]').selectOption('rules');
    await form.locator('textarea[name=goal]').fill('部署验收示例：未来七天完成样例任务');
    await form.getByRole('checkbox',{name:new RegExp(account.taskTitle)}).check();
    await form.getByRole('button',{name:'生成短期计划草案',exact:true}).click();
    await page.getByRole('button',{name:'确认保存个人安排',exact:true}).first().waitFor();
    await page.getByRole('button',{name:'确认保存个人安排',exact:true}).first().click();
    await page.getByRole('link',{name:'按新日程重新规划',exact:true}).first().waitFor();
    account.planConfirmed=true;
    fs.writeFileSync(file,JSON.stringify(account,null,2));
    checks.push('Generate and confirm schedule-aware rule plan');
  }
  const routes=['/dashboard','/projects','/notifications','/settings','/settings/tokens','/teacher','/schedule',`/teams/${account.teamId}/availability`,...['overview','iterations','deliverables','references','announcements','reports','evidence/process','ai-drafts','timeline','personal-plan'].map(p=>`/projects/${account.projectId}/${p}`)];
  for(const route of routes) {
    await visit(route);
    checks.push(`Page renders ${route.replace(account.projectId,'{projectId}').replace(account.teamId,'{teamId}')}`);
  }
  const calendar=await context.request.get(`${origin}/api/projects/${account.projectId}/calendar`);
  assert.equal(calendar.status(),200);
  assert((await calendar.text()).includes('BEGIN:VCALENDAR'));
  checks.push('Calendar export');
  if(!account.outsider) {
    account.outsider={email:`deploy-check-outsider-${crypto.randomBytes(5).toString('hex')}@example.com`,password:crypto.randomBytes(24).toString('base64url')};
    fs.writeFileSync(file,JSON.stringify(account,null,2));
  }
  if(process.env.GITHUB_ACTIONS) console.log(`::add-mask::${account.outsider.password}`);
  const outsiderContext=await browser.newContext();
  const outsider=await outsiderContext.newPage();
  outsider.setDefaultTimeout(25000);
  if(!account.outsider.registered) {
    await outsider.goto(origin+'/register');
    await outsider.locator('input[name=name]').fill('无权限验收示例');
    await outsider.locator('input[name=email]').fill(account.outsider.email);
    await outsider.locator('input[name=password]').fill(account.outsider.password);
    await outsider.getByRole('button',{name:'注册',exact:true}).click();
    await outsider.waitForURL('**/login?registered=1');
    account.outsider.registered=true;
    fs.writeFileSync(file,JSON.stringify(account,null,2));
  }
  await outsider.goto(origin+'/login');
  await outsider.locator('input[name=email]').fill(account.outsider.email);
  await outsider.locator('input[name=password]').fill(account.outsider.password);
  await outsider.getByRole('button',{name:'登录',exact:true}).click();
  await outsider.waitForURL('**/dashboard');
  for(const route of [`/projects/${account.projectId}`,`/teams/${account.teamId}/availability`]) {
    const response=await outsider.goto(origin+route);
    assert.equal(response.status(),404,`Reject outsider ${route}`);
  }
  await outsider.goto(origin+'/schedule');
  assert(!(await outsider.locator('main').innerText()).includes('验收示例私有事件'));
  await outsiderContext.close();
  checks.push('Second account cannot access private team, project or schedule');
  await page.setViewportSize({width:390,height:844});
  for(const route of ['/dashboard','/schedule',`/projects/${account.projectId}/overview`]) {
    await visit(route);
    const sizes=await page.evaluate(()=>({viewport:innerWidth,content:document.documentElement.scrollWidth}));
    assert(sizes.content<=sizes.viewport+2,`Mobile overflow ${route}: ${JSON.stringify(sizes)}`);
  }
  await page.screenshot({path:path.join(dir,'production-mobile.png'),fullPage:true});
  checks.push('Mobile dashboard, schedule and project overview at 390px');
  assert.equal(errors.length,0,`Browser errors: ${errors.join('; ')}`);
  completed=true;
} finally {
  fs.writeFileSync(path.join(dir,'production-verification.json'),JSON.stringify({origin,completed,verifiedAt:new Date().toISOString(),checks,browserErrors:errors},null,2));
  console.log(JSON.stringify({completed,completedChecks:checks, browserErrors:errors}));
  await browser.close();
}
