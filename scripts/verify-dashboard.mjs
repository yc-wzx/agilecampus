// Local browser checks; isolated synthetic accounts only. Never use a remote database.
import fs from "node:fs";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { config } from "dotenv";
import postgres from "postgres";
import { hash } from "bcryptjs";

config({ path: [".env.local", ".env"], quiet: true });
const origin = process.env.DASHBOARD_TEST_URL || "http://localhost:3002";
if (!["localhost", "127.0.0.1"].includes(new URL(origin).hostname)) throw new Error("Local website required");
if (!["localhost", "127.0.0.1"].includes(new URL(process.env.DATABASE_URL).hostname)) throw new Error("Local database required");
const sql = postgres(process.env.DATABASE_URL);
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const browser = await chromium.launch({ channel: "msedge", headless: true });
const output = ".next/dashboard-verification";
fs.mkdirSync(output, { recursive: true });
const pageErrors = [], results = [];
try {
  const stamp = randomUUID(), password = randomUUID(), passwordHash = await hash(password, 10);
  const admin = randomUUID(), student = randomUUID(), other = randomUUID(), team = randomUUID(), project = randomUUID(), archived = randomUUID();
  const email = (role) => role + "." + stamp + "@dashboard.example.test";
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const day = (offset) => { const value = new Date(today + "T00:00:00Z"); value.setUTCDate(value.getUTCDate() + offset); return value.toISOString().slice(0, 10); };
  const records = [
    ["逾期任务", day(-1), student, "todo", project], ["今天任务", today, student, "todo", project],
    ["第七天任务", day(7), student, "doing", project], ["第八天任务", day(8), student, "todo", project],
    ["无日期" + "VeryLongTitle".repeat(20), null, student, "todo", project],
    ["已完成不出现", today, student, "done", project], ["他人专属任务", today, other, "todo", project],
    ["归档不出现", today, student, "todo", archived],
  ].map(([title, dueDate, assignee, status, projectId]) => ({ id: randomUUID(), title, dueDate, assignee, status, projectId }));
  await sql.begin(async (tx) => {
    for (const [id,role,name] of [[admin,"admin","测试组长"],[student,"student","同学" + "VeryLongName".repeat(10)],[other,"student","另一同学"]]) {
      await tx`insert into users (id,email,name,password_hash) values (${id},${email(role + id.slice(0, 4))},${name},${passwordHash})`;
    }
    await tx`insert into teams (id,name,invite_code) values (${team},'工作台浏览器验证',${stamp})`;
    for (const [id,role] of [[admin,"admin"],[student,"student"],[other,"student"]]) await tx`insert into team_members (team_id,user_id,role) values (${team},${id},${role})`;
    await tx`insert into projects (id,team_id,name) values (${project},${team},'工作台验证项目')`;
    await tx`insert into projects (id,team_id,name,status) values (${archived},${team},'历史项目','archived')`;
    for (const record of records) await tx`insert into tasks (id,project_id,title,due_date,assignee_id,status,created_by_id) values (${record.id},${record.projectId},${record.title},${record.dueDate},${record.assignee},${record.status},${admin})`;
  });
  async function login(id) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage(); page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.goto(origin + "/login");
    await page.locator('input[name="email"]').fill(email("student" + id.slice(0, 4)));
    await page.locator('input[name="password"]').fill(password);
    await page.getByRole("button", { name: "登录", exact: true }).click(); await page.waitForURL("**/dashboard");
    await page.getByRole("heading", { name: "我的任务", exact: true }).waitFor();
    return { page, context };
  }
  const { page, context } = await login(student);
  assert.equal(await page.locator("main li").count(), 5);
  assert.equal(await page.getByText("已完成不出现", { exact: true }).count(), 0);
  assert.equal(await page.getByText("归档不出现", { exact: true }).count(), 0);
  assert.equal(await page.getByText("他人专属任务", { exact: true }).count(), 0);
  for (const [label, title] of [["已逾期","逾期任务"],["今天截止","今天任务"],["未来 7 天","第七天任务"],["其余任务","第八天任务"]]) {
    const section = page.locator("main section").filter({ has: page.getByRole("heading", { name: new RegExp(label) }) });
    assert.equal(await section.getByRole("link", { name: title, exact: true }).count(), 1);
  }
  results.push("登录跳转、四组边界、已完成/归档/他人任务过滤");
  await page.screenshot({ path: output + "/desktop.png", fullPage: true });
  const todayTask = records.find((record) => record.title === "今天任务");
  await page.getByRole("link", { name: "今天任务", exact: true }).click();
  await page.waitForURL("**?task=" + todayTask.id);
  const taskDialog = page.getByRole("dialog", { name: "编辑任务" });
  await taskDialog.waitFor();
  assert.equal(await taskDialog.locator('input[name="title"]').inputValue(), "今天任务");
  results.push("任务卡进入已有详情弹窗");
  await page.goto(origin + "/dashboard");
  for (const width of [320,390,430,640]) {
    await page.setViewportSize({ width, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width);
    const menu = page.getByLabel("账户菜单"); await menu.click();
    await page.getByRole("link", { name: "个人令牌", exact: true }).waitFor({ state: "visible" });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width);
    await page.screenshot({ path: output + "/mobile-" + width + ".png", fullPage: true });
    await menu.click();
  }
  results.push("320/390/430/640px 长名称、任务标题与账户菜单");
  const otherLogin = await login(other);
  assert.equal(await otherLogin.page.getByRole("link", { name: "他人专属任务", exact: true }).count(), 1);
  assert.equal(await otherLogin.page.getByRole("link", { name: "今天任务", exact: true }).count(), 0);
  await otherLogin.context.close(); results.push("两个账号的任务隔离");
  await sql`update tasks set status='done' where id=${todayTask.id}`;
  await page.reload(); assert.equal(await page.getByRole("link", { name: "今天任务", exact: true }).count(), 0);
  await sql`delete from team_members where team_id=${team} and user_id=${student}`;
  await page.reload(); await page.getByText(/暂无待处理任务/).waitFor();
  results.push("完成与退组后刷新不再显示（SQL 构造状态）");
  await page.getByLabel("账户菜单").click(); await page.getByRole("button", { name: "退出", exact: true }).click();
  await page.waitForURL("**/login"); await page.goto(origin + "/dashboard"); await page.waitForURL("**/login");
  results.push("退出与未登录保护");
  assert.deepEqual(pageErrors, []);
  fs.writeFileSync(output + "/report.json", JSON.stringify({ passed: results, pageErrors }, null, 2));
  console.log(JSON.stringify({ passed: results, pageErrors }));
  await context.close();
} finally { await browser.close(); await sql.end(); }
