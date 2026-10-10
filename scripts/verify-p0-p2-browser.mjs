import fs from "node:fs";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { config } from "dotenv";
import postgres from "postgres";
import { hash } from "bcryptjs";
config({ path: [".env.local", ".env"], quiet: true });
const origin = process.env.B_TEST_URL ?? "http://localhost:3008";
if (
  !["localhost", "127.0.0.1"].includes(new URL(origin).hostname) ||
  !["localhost", "127.0.0.1"].includes(
    new URL(process.env.DATABASE_URL).hostname,
  )
)
  throw Error("Local synthetic verification only");
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE ?? "playwright"
);
const browser = await chromium.launch({ channel: "msedge", headless: true }),
  sql = postgres(process.env.DATABASE_URL, { connection: { TimeZone: "UTC" } }),
  output = ".next/p0p2-verification";
fs.mkdirSync(output, { recursive: true });
let current;
const errors = [],
  checks = [];
try {
  const password = randomUUID(),
    stamp = randomUUID(),
    passwordHash = await hash(password, 10),
    team = randomUUID(),
    project = randomUUID(),
    task = randomUUID(),
    iteration = randomUUID();
  const members = ["admin", "student", "teacher", "outsider"].map((role) => ({
    id: randomUUID(),
    role,
    email: `${role}.${stamp}@p0p2.test`,
  }));
  await sql.begin(async (tx) => {
    for (const member of members)
      await tx`insert into users(id,name,email,password_hash) values(${member.id},${"测试" + member.role},${member.email},${passwordHash})`;
    await tx`insert into teams(id,name,invite_code)values(${team},'全阶段联调',${stamp})`;
    for (const member of members.filter((m) => m.role !== "outsider"))
      await tx`insert into team_members(team_id,user_id,role)values(${team},${member.id},${member.role})`;
    await tx`insert into projects(id,team_id,name)values(${project},${team},'P0–P2 集成测试')`;
    await tx`insert into tasks(id,project_id,created_by_id,assignee_id,title,due_date,status)values(${task},${project},${members[0].id},${members[1].id},${"长任务标题" + "联调".repeat(40)},'2026-10-08','doing')`;
    await tx`insert into iterations(id,project_id,name,start_date,end_date,status)values(${iteration},${project},'浏览器活跃迭代','2026-10-01','2026-10-15','active')`;
  });
  async function login(role) {
    const context = await browser.newContext({
        viewport: { width: 1280, height: 900 },
      }),
      page = await context.newPage();
    page.on("pageerror", (e) => errors.push(e.message));
    current = page;
    const user = members.find((m) => m.role === role);
    await page.goto(origin + "/login");
    await page.locator('input[name="email"]').fill(user.email);
    await page.locator('input[name="password"]').fill(password);
    await page.getByRole("button", { name: "登录", exact: true }).click();
    await page.waitForURL("**/dashboard");
    return { context, page };
  }
  const teacher = await login("teacher"),
    student = await login("student"),
    base = origin + "/projects/" + project;
  current = teacher.page;
  await teacher.page.goto(base + "/announcements");
  await teacher.page.getByLabel("公告标题", { exact: true }).fill("本周联调");
  await teacher.page
    .getByLabel("公告内容", { exact: true })
    .fill("周五展示前保存成果");
  await teacher.page
    .getByLabel("置顶，替换当前置顶公告", { exact: true })
    .check();
  await teacher.page
    .getByRole("button", { name: "发布公告", exact: true })
    .click();
  await teacher.page
    .getByRole("heading", { name: "本周联调", exact: true })
    .waitFor();
  current = student.page;
  await student.page.goto(base + "/overview");
  await student.page.getByText("周五展示前保存成果", { exact: true }).waitFor();
  await student.page.goto(base + "/announcements");
  assert.equal(
    await student.page
      .getByRole("button", { name: "发布公告", exact: true })
      .count(),
    0,
  );
  checks.push("教师发布并置顶公告；学生只读，概览展示真实公告");
  await student.page.goto(base + "?task=" + task);
  const discussion = student.page.getByRole("region", { name: "任务讨论" });
  await student.page.getByRole("dialog", { name: "任务详情" }).waitFor();
  await student.page
    .getByLabel("发表评论", { exact: true })
    .fill("请老师检查接口");
  await student.page
    .getByLabel(/^@ 提及成员/)
    .selectOption(members.find((m) => m.role === "teacher").id);
  await student.page
    .getByRole("button", { name: "发布评论", exact: true })
    .click();
  await student.page
    .locator("article")
    .getByText("请老师检查接口", { exact: true })
    .waitFor();
  assert.ok(discussion);
  const [comment] =
    await sql`select id from task_comments where task_id=${task}`;
  const [notice] =
    await sql`select id from notifications where recipient_id=${members.find((m) => m.role === "teacher").id} and source_id=${comment.id}`;
  assert.ok(notice);
  current = teacher.page;
  await teacher.page.goto(origin + "/notifications");
  await teacher.page
    .locator(`[data-notification-id="${notice.id}"]`)
    .getByRole("link", { name: "查看来源", exact: true })
    .click();
  await teacher.page.locator("#comment-" + comment.id).waitFor();
  checks.push("任务侧栏评论、@ 通知、来源精确定位");
  current = student.page;
  await student.page.goto(base + "/reports");
  await student.page.getByRole("heading", { name: /规则周报/ }).waitFor();
  const weeklyDownload = student.page.waitForEvent("download");
  await student.page
    .getByRole("button", { name: "下载 Markdown", exact: true })
    .click();
  const weekly = await weeklyDownload;
  await weekly.saveAs(output + "/weekly.md");
  assert.ok(
    fs.readFileSync(output + "/weekly.md", "utf8").includes("长任务标题"),
  );
  checks.push("规则周报真实现状与 Markdown 下载");
  await student.page.goto(base + "/evidence/process?kind=comment");
  await student.page.getByText("请老师检查接口", { exact: true }).waitFor();
  const evidenceDownload = student.page.waitForEvent("download");
  await student.page
    .getByRole("button", { name: "下载当前筛选的证据清单", exact: true })
    .click();
  await (await evidenceDownload).saveAs(output + "/evidence.md");
  assert.ok(
    fs.readFileSync(output + "/evidence.md", "utf8").includes("请老师检查接口"),
  );
  checks.push("过程证据筛选、真实评论与 Markdown 下载");
  const conv = randomUUID(),
    draft = randomUUID();
  await sql`insert into conversations(id,project_id,created_by_id,scope)values(${conv},${project},${members[1].id},'personal')`;
  await sql`insert into messages(conversation_id,role,content)values(${conv},'user','私有测试消息')`;
  const [taskVersion] =
    await sql`select updated_at at time zone 'UTC' as updated_at from tasks where id=${task}`;
  await sql`insert into iteration_drafts(id,project_id,created_by_id,conversation_id,name,start_date,end_date,candidate_tasks,expires_at)values(${draft},${project},${members[1].id},${conv},'已有任务草案','2026-10-12','2026-10-18',${JSON.stringify([{ taskId: task, expectedUpdatedAt: new Date(taskVersion.updated_at).toISOString(), reason: "合成夹具，仅验证 UI" }])}::jsonb,now()+interval '1 day')`;
  await student.page.goto(base + "/ai-drafts?scope=personal");
  await student.page.getByText("私有测试消息", { exact: true }).waitFor();
  await student.page
    .getByRole("button", { name: "预览并校验", exact: true })
    .click();
  await student.page
    .getByText("当前校验通过，确认会创建未开始的迭代", { exact: true })
    .waitFor();
  await student.page
    .getByRole("button", { name: "确认创建迭代", exact: true })
    .click();
  await student.page.getByText(/已有任务草案 · 已确认/).waitFor();
  assert.ok(
    (await sql`select sprint_id from tasks where id=${task}`)[0].sprint_id,
  );
  checks.push("个人会话、真实草案预览与确认；UI 夹具不冒充外部 AI 生成");
  current = teacher.page;
  await teacher.page.goto(base + "/ai-drafts?scope=personal");
  assert.equal(
    await teacher.page.getByText("私有测试消息", { exact: true }).count(),
    0,
  );
  await teacher.page.goto(origin + "/teacher");
  await teacher.page
    .getByRole("link", { name: "P0–P2 集成测试", exact: true })
    .waitFor();
  checks.push("教师多项目总览；他人个人 AI 会话不可见");
  current = student.page;
  await student.page.goto(origin + "/dashboard");
  await student.page.getByText("浏览器活跃迭代", { exact: true }).waitFor();
  checks.push("个人工作台展示真实活跃迭代");
  const cron = await student.page.request.post(origin + "/api/cron/reminders", {
    headers: { authorization: "Bearer " + process.env.EF_TEST_CRON_SECRET },
  });
  assert.equal(cron.status(), 200);
  const cronData = await cron.json();
  assert.equal(cronData.reminders.failed, 0);
  assert.ok(cronData.reminders.scanned > 0);
  const repeatedCron = await student.page.request.post(origin + "/api/cron/reminders", {
    headers: { authorization: "Bearer " + process.env.EF_TEST_CRON_SECRET },
  });
  assert.equal(repeatedCron.status(), 200);
  assert.equal((await repeatedCron.json()).reminders.created, 0);
  assert.equal(
    (await student.page.request.post(origin + "/api/cron/reminders")).status(),
    401,
  );
  checks.push("受控 cron 到期记录、重复去重，未授权拒绝");
  for (const route of [
    "/announcements",
    "/reports",
    "/evidence/process",
    "/ai-drafts?scope=personal",
    "/overview",
  ]) {
    await student.page.goto(base + route);
    for (const width of [320, 390, 430]) {
      await student.page.setViewportSize({ width, height: 844 });
      assert.equal(
        await student.page.evaluate(() => document.documentElement.scrollWidth),
        width,
        route,
      );
      if (width === 390)
        await student.page.screenshot({
          path: output + "/" + route.replace(/[^a-z]/gi, "-") + ".png",
          fullPage: true,
        });
    }
  }
  const outside = await login("outsider");
  await outside.page.goto(base + "/reports");
  await outside.page
    .getByRole("heading", { name: "404", exact: true })
    .waitFor();
  assert.deepEqual(errors, []);
  checks.push("新页面 320/390/430px 无横向溢出，项目外成员拒绝，无页面异常");
  fs.writeFileSync(
    output + "/browser.json",
    JSON.stringify({ checks, project, pageErrors: errors }, null, 2),
  );
  console.log(JSON.stringify({ checks, pageErrors: errors }));
} catch (error) {
  if (current) {
    console.log((await current.locator("body").innerText()).slice(0, 5000));
    await current.screenshot({
      path: output + "/browser-failure.png",
      fullPage: true,
    });
  }
  throw error;
} finally {
  await browser.close();
  await sql.end();
}
