// Browser verification against a local production build. Use isolated synthetic accounts.
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { config } from "dotenv";
import postgres from "postgres";
import { hash } from "bcryptjs";

config({ path: [".env.local", ".env"], quiet: true });
const origin = process.env.B_TEST_URL || "http://localhost:3008";
if (!["localhost", "127.0.0.1", "[::1]"].includes(new URL(origin).hostname)) throw Error("Local browser verification only");
const databaseUrl = new URL(process.env.DATABASE_URL);
if (!["localhost", "127.0.0.1", "[::1]"].includes(databaseUrl.hostname)) throw new Error("Browser fixture must use a local database");
const fixturePath = process.env.P3_SMOKE_FIXTURE || ".next/p3-smoke-fixture.json";
const sql = postgres(process.env.DATABASE_URL);
if (!fs.existsSync(fixturePath)) {
  const teamId = randomUUID(), token = randomUUID(), password = randomUUID();
  const passwordHash = await hash(password, 10);
  const members = [
    ["admin", "P3测试管理员"], ["student", "P3测试组员"],
    ["teacher", "P3测试教师"], ["outsider", "P3其他团队用户"],
  ].map(([role, name]) => ({ id: randomUUID(), email: role + "." + token + "@p3.example.test", name, role }));
  await sql.begin(async (tx) => {
    await tx`insert into teams (id,name,invite_code) values (${teamId},${"P3浏览器验证-" + token.slice(0, 8)},${token})`;
    for (const member of members) {
      await tx`insert into users (id,name,email,password_hash) values (${member.id},${member.name},${member.email},${passwordHash})`;
      if (member.role !== "outsider") await tx`insert into team_members (team_id,user_id,role) values (${teamId},${member.id},${member.role})`;
    }
  });
  fs.mkdirSync(path.dirname(fixturePath), { recursive: true });
  fs.writeFileSync(fixturePath, JSON.stringify({ teamId, password, members }), { mode: 0o600 });
}
const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const browser = await chromium.launch({ channel: "msedge", headless: true });
const output = process.env.P3_SCREENSHOT_DIR || ".next/p3-browser-verification";
fs.mkdirSync(output, { recursive: true });
const pageErrors = [];
async function signedIn(member) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto(origin + "/login");
  await page.locator('input[name="email"]').fill(member.email);
  await page.locator('input[name="password"]').fill(fixture.password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.waitForURL("**/dashboard");
  return { context, page };
}
try {
  const admin = fixture.members.find((m) => m.role === "admin");
  const student = fixture.members.find((m) => m.role === "student");
  const teacher = fixture.members.find((m) => m.role === "teacher");
  const outsider = fixture.members.find((m) => m.role === "outsider");
  const { context: adminContext, page } = await signedIn(admin);
  await page.goto(origin + "/teams/" + fixture.teamId + "/projects");
  await page.getByLabel("项目名称", { exact: true }).fill("P3完整流程演示");
  await page.getByLabel("项目模板").selectOption("course");
  await page.getByLabel("开始日期").fill("2026-10-03");
  await page.getByLabel("结束日期").fill("2026-11-30");
  assert.equal(await page.getByText("原型与设计", { exact: true }).count(), 1);
  await page.getByRole("button", { name: "创建", exact: true }).click();
  await page.waitForURL(/\/projects\/[0-9a-f-]{36}$/);
  const projectId = new URL(page.url()).pathname.split("/").at(-1);
  fixture.projectId = projectId; fs.writeFileSync(fixturePath, JSON.stringify(fixture));
  const stages = await sql`select id,title from milestones where project_id=${projectId}`;
  assert.equal(stages.length, 4);
  await page.getByLabel("指定负责人").selectOption(student.id);
  await page.getByRole("button", { name: "保存负责人" }).click();
  await page.getByRole("heading", { name: "项目负责人：" + student.name, exact: true }).waitFor();
  await page.getByLabel("指定负责人").selectOption(teacher.id);
  await page.getByRole("button", { name: "保存负责人" }).click();
  await page.getByRole("heading", { name: "项目负责人：" + teacher.name, exact: true }).waitFor();
  await page.getByText("最近20条负责人变更", { exact: true }).click();
  assert.ok((await page.locator('section[aria-label="项目负责人"]').innerText()).includes(student.name));
  await sql`insert into tasks (project_id,title,due_date,created_by_id) values (${projectId},'P3日历测试任务','2026-10-10',${admin.id})`;
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出截止日期", exact: true }).click();
  const download = await downloadPromise;
  await download.saveAs(path.join(output, "deadlines.ics"));
  const calendar = fs.readFileSync(path.join(output, "deadlines.ics"), "utf8");
  assert.ok(calendar.includes("20261010")); assert.ok(calendar.includes("20261130"));
  await page.screenshot({ path: path.join(output, "project-desktop.png"), fullPage: true });

  await page.getByRole("link", { name: "会议与资料", exact: true }).click();
  let form = page.getByRole("button", { name: "添加记录", exact: true }).locator("..");
  await form.getByLabel("名称", { exact: true }).fill("P3需求讨论");
  await form.getByLabel("会议或资料链接").fill("https://user:password@example.com/reference");
  await form.getByRole("button", { name: "添加记录", exact: true }).click();
  await form.getByRole("status").filter({ hasText: "不能包含账号密码" }).waitFor();
  assert.equal(await form.getByLabel("名称", { exact: true }).inputValue(), "P3需求讨论");
  assert.equal(await form.getByLabel("会议或资料链接").inputValue(), "https://user:password@example.com/reference");
  await form.getByLabel("会议或资料链接").fill("https://meeting.tencent.com/example");
  await form.getByLabel("纪要链接").fill("https://docs.qq.com/example");
  await form.getByLabel("录制链接").fill("https://example.com/recording");
  await form.getByLabel("会议日期").fill("2026-10-03");
  await form.getByLabel("关联阶段（可选）").selectOption(stages[0].id);
  await form.getByLabel(student.name, { exact: true }).check();
  await form.getByRole("button", { name: "添加记录", exact: true }).click();
  await page.getByRole("heading", { name: "P3需求讨论", exact: true }).waitFor();
  await page.reload();
  let article = page.locator("article").filter({ has: page.getByRole("heading", { name: "P3需求讨论", exact: true }) });
  assert.ok((await article.innerText()).includes(student.name));
  await article.getByText("编辑记录", { exact: true }).click();
  await article.getByLabel("名称", { exact: true }).fill("P3需求讨论已更新");
  await article.getByRole("button", { name: "保存修改", exact: true }).click();
  await page.getByRole("heading", { name: "P3需求讨论已更新", exact: true }).waitFor();
  form = page.getByRole("button", { name: "添加记录", exact: true }).locator("..");
  await form.locator('select[name="type"]').selectOption("document");
  await form.getByLabel("名称", { exact: true }).fill("P3可删除文档");
  await form.getByLabel("会议或资料链接").fill("https://docs.qq.com/document");
  await form.getByRole("button", { name: "添加记录", exact: true }).click();
  await page.getByRole("heading", { name: "P3可删除文档", exact: true }).waitFor();
  const docArticle = page.locator("article").filter({ has: page.getByRole("heading", { name: "P3可删除文档", exact: true }) });
  page.once("dialog", (dialog) => dialog.accept());
  await docArticle.getByRole("button", { name: "删除记录", exact: true }).click();
  await page.getByRole("heading", { name: "P3可删除文档", exact: true }).waitFor({ state: "detached" });
  await page.screenshot({ path: path.join(output, "references-desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: path.join(output, "references-mobile.png"), fullPage: true });
  const mobileWidth = await page.evaluate(() => ({ viewport: window.innerWidth, content: document.documentElement.scrollWidth }));
  assert.equal(mobileWidth.content, mobileWidth.viewport);
  const mobileChecks = [];
  for (const width of [320, 390, 430]) {
    await page.setViewportSize({ width, height: 844 });
    for (const route of ["references", "overview", ""]) {
      await page.goto(origin + "/projects/" + projectId + (route ? "/" + route : ""));
      const size = await page.evaluate(() => ({ viewport: window.innerWidth, content: document.documentElement.scrollWidth }));
      assert.equal(size.content, size.viewport, `Overflow: ${route || "tasks"} at ${width}px`);
      mobileChecks.push({ page: route || "tasks", width });
    }
  }

  const deliverableId = randomUUID(), v1 = randomUUID(), v2 = randomUUID();
  await sql.begin(async (tx) => {
    await tx`insert into deliverables (id,project_id,author_id,title,type,url,description,status,creation_key,creation_hash)
      values (${deliverableId},${projectId},${student.id},'需求调研','report','https://example.com/v2','访谈了8位同学','approved',${randomUUID()},'browser-fixture')`;
    for (const [id,number,url,description] of [[v1,1,"https://example.com/v1","访谈了3位同学"],[v2,2,"https://example.com/v2","访谈了8位同学"]]) {
      await tx`insert into deliverable_versions (id,deliverable_id,version_number,draft_revision,submission_key,author_id,submitted_by_id,title,type,url,description)
        values (${id},${deliverableId},${number},${number},${randomUUID()},${student.id},${student.id},'需求调研','report',${url},${description})`;
    }
  });
  const { context: teacherContext, page: teacherPage } = await signedIn(teacher);
  await teacherPage.goto(origin + "/projects/" + projectId + "/deliverables/" + deliverableId);
  await teacherPage.getByRole("link", { name: "查看与比较版本", exact: true }).click();
  await teacherPage.waitForURL("**/compare");
  await teacherPage.getByRole("heading", { name: "成果版本对比", exact: true }).waitFor();
  assert.ok((await teacherPage.locator("ins").allTextContents()).join("").includes("8"));
  assert.ok((await teacherPage.locator("del").allTextContents()).join("").includes("3"));
  await teacherPage.screenshot({ path: path.join(output, "comparison-desktop.png"), fullPage: true });
  await teacherPage.locator('select[name="from"]').selectOption(v2);
  await teacherPage.locator('select[name="to"]').selectOption(v2);
  await teacherPage.getByRole("button", { name: "比较", exact: true }).click();
  await teacherPage.getByText("所比较的内容没有变化。", { exact: true }).waitFor();
  await teacherPage.setViewportSize({ width: 390, height: 844 });
  await teacherPage.screenshot({ path: path.join(output, "comparison-mobile.png"), fullPage: true });
  const comparisonWidth = await teacherPage.evaluate(() => ({ viewport: window.innerWidth, content: document.documentElement.scrollWidth }));
  assert.equal(comparisonWidth.content, comparisonWidth.viewport);
  for (const width of [320, 390, 430]) {
    await teacherPage.setViewportSize({ width, height: 844 });
    const size = await teacherPage.evaluate(() => ({ viewport: window.innerWidth, content: document.documentElement.scrollWidth }));
    assert.equal(size.content, size.viewport, `Overflow: comparison at ${width}px`);
    mobileChecks.push({ page: "comparison", width });
  }
  const { context: outsiderContext, page: outsiderPage } = await signedIn(outsider);
  const calendarDenied = await outsiderPage.request.get(origin + "/api/projects/" + projectId + "/calendar");
  assert.equal(calendarDenied.status(), 403);
  const referenceDenied = await outsiderPage.goto(origin + "/projects/" + projectId + "/references");
  assert.equal(referenceDenied.status(), 404);
  const comparisonDenied = await outsiderPage.goto(origin + "/projects/" + projectId + "/deliverables/" + deliverableId + "/compare");
  assert.equal(comparisonDenied.status(), 404);
  assert.deepEqual(pageErrors, []);
  const report = { template: "passed", leader: "passed", references: "passed", calendar: "passed", comparison: "passed", invalidLinkInputRetained: "passed", otherTeamDenied: "passed", pageErrors, mobileWidth, comparisonWidth, mobileChecks };
  fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
  await adminContext.close(); await teacherContext.close(); await outsiderContext.close();
} finally { await browser.close(); await sql.end(); }
