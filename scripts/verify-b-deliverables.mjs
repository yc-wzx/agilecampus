import fs from "node:fs";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { config } from "dotenv";
import postgres from "postgres";
import { hash } from "bcryptjs";

config({ path: [".env.local", ".env"], quiet: true });
const origin = process.env.B_TEST_URL || "http://localhost:3004";
if (!["localhost", "127.0.0.1"].includes(new URL(origin).hostname) || !["localhost", "127.0.0.1"].includes(new URL(process.env.DATABASE_URL).hostname)) throw new Error("Local verification only");
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const sql = postgres(process.env.DATABASE_URL), browser = await chromium.launch({ channel: "msedge", headless: true });
const output = ".next/b-deliverables-verification", pageErrors = [], checks = [];
let diagnosticPage;
fs.mkdirSync(output, { recursive: true });
try {
  const password = randomUUID(), stamp = randomUUID(), passwordHash = await hash(password, 10);
  const members = ["admin", "student", "teacher", "other", "outsider"].map((role) => ({ id: randomUUID(), role, email: role + "." + stamp + "@b.example.test" }));
  const team = randomUUID(), project = randomUUID(), stage = randomUUID();
  await sql.begin(async (tx) => {
    for (const m of members) await tx`insert into users(id,name,email,password_hash)values(${m.id},${"B验证" + m.role},${m.email},${passwordHash})`;
    await tx`insert into teams(id,name,invite_code)values(${team},'B浏览器验证',${stamp})`;
    for (const m of members.filter((m) => m.role !== "outsider")) await tx`insert into team_members(team_id,user_id,role)values(${team},${m.id},${m.role === "other" ? "student" : m.role})`;
    await tx`insert into projects(id,team_id,name,description)values(${project},${team},${"B真实项目" + "LongProject".repeat(12)},'仅使用合成数据验证')`;
    await tx`insert into milestones(id,project_id,title)values(${stage},${project},'需求调研')`;
  });
  async function login(role) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage(); page.on("pageerror", (error) => pageErrors.push(error.message));
    const member = members.find((m) => m.role === role);
    await page.goto(origin + "/login"); await page.locator('input[name="email"]').fill(member.email); await page.locator('input[name="password"]').fill(password);
    await page.getByRole("button", { name: "登录", exact: true }).click(); await page.waitForURL("**/dashboard");
    return { context, page };
  }
  const { page, context } = await login("student");
  diagnosticPage = page;
  const base = origin + "/projects/" + project;
  await page.goto(base + "/overview"); await page.getByText("暂无正式提交成果", { exact: true }).waitFor();
  assert.equal(await page.locator('main a[href$="/settings"]').count(), 0);
  await page.getByRole("link", { name: "阶段成果", exact: true }).click();
  await page.getByText("暂无可查看的成果。", { exact: true }).waitFor();
  await page.getByRole("link", { name: "新建成果", exact: true }).click();
  const title = "真实调研报告" + "LongResult".repeat(12);
  await page.getByLabel("成果标题", { exact: true }).fill("   ");
  await page.getByRole("button", { name: "保存草稿", exact: true }).click(); await page.getByRole("alert").waitFor();
  assert.equal(await page.getByLabel("成果标题", { exact: true }).inputValue(), "   ");
  await page.getByLabel("成果标题", { exact: true }).fill(title);
  await page.getByLabel("成果链接（草稿可留空）").fill("javascript:alert(1)");
  await page.getByRole("button", { name: "保存草稿", exact: true }).click(); await page.getByRole("alert").filter({ hasText: "HTTP" }).waitFor();
  assert.equal(await page.getByLabel("成果标题", { exact: true }).inputValue(), title);
  await page.getByLabel("成果链接（草稿可留空）").fill("");
  await page.getByLabel("关联里程碑").selectOption(stage);
  await page.getByRole("button", { name: "保存草稿", exact: true }).click();
  await page.waitForURL(/\/deliverables\/[0-9a-f-]{36}$/);
  const id = new URL(page.url()).pathname.split("/").at(-1), detailUrl = page.url();
  assert.equal((await sql`select count(*)::int as total from deliverables where project_id=${project}`)[0].total, 1);
  checks.push("真实空列表、非法输入保留内容、创建草稿");
  for (const role of ["teacher", "other"]) {
    const viewer = await login(role); await viewer.page.goto(base + "/deliverables");
    await viewer.page.getByText("暂无可查看的成果。", { exact: true }).waitFor();
    await viewer.page.goto(detailUrl); await viewer.page.getByRole("heading", { name: "404", exact: true }).waitFor();
    await viewer.context.close();
  }
  checks.push("教师与其他学生不能查看私有草稿");
  await page.getByRole("button", { name: "正式提交", exact: true }).click(); await page.getByRole("alert").filter({ hasText: "链接" }).waitFor();
  assert.equal((await sql`select count(*)::int as total from deliverable_versions where deliverable_id=${id}`)[0].total, 0);
  await page.getByLabel("成果链接（草稿可留空）").fill("https://docs.qq.com/example");
  await page.getByLabel("成果说明").fill("访谈结果已整理");
  await page.getByRole("button", { name: "保存草稿", exact: true }).click();
  await page.getByRole("link", { name: "查看成果链接", exact: true }).waitFor();
  await page.reload();
  await page.getByRole("button", { name: "正式提交", exact: true }).waitFor();
  await page.evaluate(() => { const b = [...document.querySelectorAll("button")].find((button) => button.textContent === "正式提交"); b.click(); b.click(); });
  await page.getByRole("heading", { name: "已提交版本（1）", exact: true }).waitFor();
  assert.equal((await sql`select count(*)::int as total from deliverable_versions where deliverable_id=${id}`)[0].total, 1);
  assert.equal(await page.getByRole("button", { name: "保存草稿", exact: true }).count(), 0);
  checks.push("修改草稿、空链接拒绝提交、双击仅生成一版、提交后禁止覆盖");
  await page.screenshot({ path: output + "/submitted-desktop.png", fullPage: true });
  const teacher = await login("teacher"); await teacher.page.goto(detailUrl);
  await teacher.page.getByRole("heading", { name: "已提交版本（1）", exact: true }).waitFor();
  assert.equal(await teacher.page.getByRole("button", { name: "保存草稿", exact: true }).count(), 0);
  await teacher.page.goto(base + "/overview"); await teacher.page.getByText("0 通过 · 1 待验收 · 0 需修改", { exact: true }).waitFor();
  await teacher.page.screenshot({ path: output + "/overview-desktop.png", fullPage: true });
  checks.push("教师查看正式版本、概览使用真实待验收数");
  for (const width of [320,390,430]) {
    await teacher.page.setViewportSize({ width, height: 844 });
    assert.equal(await teacher.page.evaluate(() => document.documentElement.scrollWidth), width);
    await teacher.page.screenshot({ path: output + "/overview-" + width + ".png", fullPage: true });
    await page.setViewportSize({ width, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width);
    await page.screenshot({ path: output + "/submitted-" + width + ".png", fullPage: true });
  }
  checks.push("320/390/430px 长标题、概览与详情");
  const outsider = await login("outsider");
  for (const url of [base + "/overview",base + "/deliverables",base + "/deliverables/new",detailUrl]) {
    await outsider.page.goto(url); await outsider.page.getByRole("heading", { name: "404", exact: true }).waitFor();
  }
  checks.push("跨团队拒绝概览、列表、新建和详情");
  await sql`update deliverables set status='approved' where id=${id}`;
  await teacher.page.goto(base + "/overview"); await teacher.page.getByText("1 通过 · 0 待验收 · 0 需修改", { exact: true }).waitFor();
  checks.push("通过数独立于任务完成数（SQL 构造状态）");
  assert.deepEqual(pageErrors, []);
  fs.writeFileSync(output + "/report.json",JSON.stringify({checks,pageErrors},null,2));
  console.log(JSON.stringify({checks,pageErrors}));
  await context.close(); await teacher.context.close(); await outsider.context.close();
} catch (error) {
  if (diagnosticPage) {
    await diagnosticPage.screenshot({ path: output + "/failure.png", fullPage: true });
    console.error((await diagnosticPage.locator("main").innerText()).slice(-1600));
  }
  throw error;
} finally { await browser.close(); await sql.end(); }
