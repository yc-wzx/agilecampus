import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { config } from "dotenv";
import postgres from "postgres";
import { hash } from "bcryptjs";
config({ path: [".env.local", ".env"], quiet: true });
const origin = process.env.B_TEST_URL || "http://localhost:3008",
  url = new URL(process.env.DATABASE_URL);
if (
  !["localhost", "127.0.0.1", "[::1]"].includes(new URL(origin).hostname) ||
  !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
)
  throw Error("Local verification only");
const sql = postgres(url.href),
  token = randomUUID(),
  password = randomUUID(),
  passwordHash = await hash(password, 10),
  teamId = randomUUID(),
  projectId = randomUUID(),
  taskId = randomUUID();
const members = ["admin", "student", "teacher", "outsider"].map((role) => ({
  id: randomUUID(),
  role,
  email: `${role}.${token}@schedule-browser.test`,
  name: `排程测试${role}`,
}));
const today = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10),
  addDays = (day, n) =>
    new Date(Date.parse(day + "T00:00:00Z") + n * 86400000)
      .toISOString()
      .slice(0, 10);
let startDate = addDays(today, 1);
while ([0, 6].includes(new Date(startDate + "T00:00:00Z").getUTCDay()))
  startDate = addDays(startDate, 1);
const student = members.find((m) => m.role === "student"),
  admin = members.find((m) => m.role === "admin"),
  courseTitle = "私有课程-" + token.slice(0, 8),
  taskTitle = "短期计划测试：登录接口";
await sql.begin(async (tx) => {
  await tx`insert into teams(id,name,invite_code) values(${teamId},'个人日程浏览器测试',${token})`;
  for (const member of members) {
    await tx`insert into users(id,name,email,password_hash) values(${member.id},${member.name},${member.email},${passwordHash})`;
    if (member.role !== "outsider")
      await tx`insert into team_members(team_id,user_id,role) values(${teamId},${member.id},${member.role})`;
  }
  await tx`insert into projects(id,team_id,name,end_date) values(${projectId},${teamId},'课表驱动项目',${addDays(startDate, 14)})`;
  await tx`insert into tasks(id,project_id,title,assignee_id,created_by_id,due_date) values(${taskId},${projectId},${taskTitle},${student.id},${admin.id},${addDays(startDate, 2)})`;
});
const { chromium } = await import(
    process.env.PLAYWRIGHT_MODULE || "playwright"
  ),
  browser = await chromium.launch({ channel: "msedge", headless: true }),
  output = path.resolve(".next/schedule-browser-verification");
fs.mkdirSync(output, { recursive: true });
const pageErrors = [];
async function login(member) {
  const context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
    }),
    page = await context.newPage();
  page.on("pageerror", (e) => pageErrors.push(e.message));
  await page.goto(origin + "/login");
  await page.locator('input[name="email"]').fill(member.email);
  await page.locator('input[name="password"]').fill(password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.waitForURL("**/dashboard");
  return { context, page };
}
async function write(page, button) {
  await Promise.all([
    page.waitForNavigation({ waitUntil: "domcontentloaded" }),
    button.click(),
  ]);
}
try {
  const { page, context } = await login(student);
  await page.getByRole("link", { name: "我的课表与日程", exact: true }).click();
  await page.waitForURL("**/schedule");
  await page.getByLabel("每天最多投入（分钟）", { exact: true }).fill("120");
  await write(
    page,
    page.getByRole("button", { name: "保存可投入时间", exact: true }),
  );
  const date = startDate.replaceAll("-", "");
  const ics = `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:${token}\r\nSUMMARY:${courseTitle}\r\nDTSTART;TZID=Asia/Shanghai:${date}T180000\r\nDTEND;TZID=Asia/Shanghai:${date}T200000\r\nRRULE:FREQ=WEEKLY;COUNT=2\r\nEND:VEVENT\r\nEND:VCALENDAR`;
  await page.getByLabel("课表／日历文件", { exact: true }).setInputFiles({
    name: "timetable.ics",
    mimeType: "text/calendar",
    buffer: Buffer.from(ics),
  });
  await page.getByRole("button", { name: "预览导入", exact: true }).click();
  await page
    .getByRole("heading", { name: "导入预览：2 次日程", exact: true })
    .waitFor();
  await write(
    page,
    page.getByRole("button", { name: "确认导入 2 次日程", exact: true }),
  );
  assert.equal(
    await page.getByRole("heading", { name: courseTitle, exact: true }).count(),
    2,
  );
  const article = page
    .locator("article")
    .filter({
      has: page.getByRole("heading", { name: courseTitle, exact: true }),
    })
    .first();
  await article.getByText("修改／删除这次日程", { exact: true }).click();
  await article
    .getByLabel("名称", { exact: true })
    .fill(courseTitle + "（已核对）");
  await write(
    page,
    article.getByRole("button", { name: "保存这次日程", exact: true }),
  );
  const last = page.locator("article").filter({
    has: page.getByRole("heading", { name: courseTitle, exact: true }),
  });
  await last.getByText("修改／删除这次日程", { exact: true }).click();
  page.once("dialog", (d) => d.accept());
  await write(
    page,
    last.getByRole("button", { name: "删除这次日程", exact: true }),
  );
  assert.equal(
    await page.getByRole("heading", { name: courseTitle, exact: true }).count(),
    0,
  );
  await page.getByText("手动补充日程／每周课程", { exact: true }).click();
  await page.getByLabel("日程名称", { exact: true }).fill("一次考试");
  await page
    .getByLabel("开始（北京时间）", { exact: true })
    .fill(addDays(startDate, 1) + "T08:00");
  await page
    .getByLabel("结束（北京时间）", { exact: true })
    .fill(addDays(startDate, 1) + "T09:00");
  await write(
    page,
    page.getByRole("button", { name: "添加个人日程", exact: true }),
  );
  await page.getByRole("heading", { name: "一次考试", exact: true }).waitFor();
  await page.screenshot({
    path: path.join(output, "schedule-desktop.png"),
    fullPage: true,
  });
  await page.goto(
    origin + "/projects/" + projectId + "/ai-drafts?scope=personal",
  );
  await page
    .getByRole("link", { name: "结合课表规划我的工作", exact: true })
    .click();
  await page.waitForURL("**/personal-plan");
  await page.locator('input[name="startDate"]').fill(startDate);
  await page.locator('select[name="mode"]').selectOption("rules");
  await page
    .getByLabel("本期想推进的目标（可选）", { exact: true })
    .fill("浏览器短期目标");
  await page.getByRole("checkbox").check();
  await page.getByLabel(taskTitle + "剩余分钟", { exact: true }).fill("60");
  await write(
    page,
    page.getByRole("button", { name: "生成短期计划草案", exact: true }),
  );
  await page
    .getByRole("heading", { name: "浏览器短期目标", exact: true })
    .waitFor();
  const [plan] =
    await sql`select * from personal_work_plans where user_id=${student.id} and project_id=${projectId}`;
  assert.equal(plan.status, "draft");
  assert.ok(plan.items.length);
  assert.ok(
    Date.parse(plan.items[0].startAt) >=
      Date.parse(startDate + "T20:15:00+08:00"),
  );
  await write(
    page,
    page.getByRole("button", { name: "确认保存个人安排", exact: true }),
  );
  await page.getByText(/已确认个人安排/).waitFor();
  assert.equal(
    (await sql`select status from tasks where id=${taskId}`)[0].status,
    "todo",
  );
  await page.screenshot({
    path: path.join(output, "plan-desktop.png"),
    fullPage: true,
  });
  // Supplement an emergency, explicitly share only its blurred time, and replan.
  await page.goto(origin + "/schedule");
  const emergencyTitle = "不公开的临时事情-" + token.slice(0, 8);
  const emergencyForm = page
    .locator("section")
    .filter({
      has: page.getByRole("heading", { name: "补充临时事件", exact: true }),
    })
    .locator("form");
  await emergencyForm
    .getByLabel("本人备注（可不填）", { exact: true })
    .fill(emergencyTitle);
  await emergencyForm
    .getByLabel("临时事件开始（北京时间）", { exact: true })
    .fill(startDate + "T20:22");
  await emergencyForm
    .getByLabel("临时事件结束（北京时间）", { exact: true })
    .fill(startDate + "T21:12");
  await write(
    page,
    emergencyForm.getByRole("button", { name: "补充临时事件", exact: true }),
  );
  await page
    .getByRole("heading", { name: "需要重新核对的个人安排", exact: true })
    .waitFor();
  const sharingForm = page
    .locator("section")
    .filter({
      has: page.getByRole("heading", { name: "日程共享设置", exact: true }),
    })
    .locator("form");
  await sharingForm
    .getByRole("checkbox", { name: "个人日程浏览器测试", exact: true })
    .check();
  await write(
    page,
    sharingForm.getByRole("button", { name: "保存日程共享设置", exact: true }),
  );
  const teacher = await login(members.find((m) => m.role === "teacher"));
  const busyURL =
    origin + "/teams/" + teamId + "/availability?from=" + startDate;
  const apiURL =
    origin + "/api/teams/" + teamId + "/availability?from=" + startDate;
  await teacher.page.goto(busyURL);
  let response = await teacher.page.request.get(apiURL),
    data = await response.json();
  assert.equal(response.status(), 200);
  assert.equal(response.headers()["cache-control"], "private, no-store");
  assert.deepEqual(data.members.find((m) => m.id === student.id).periods, []);
  const emergencyArticle = page.locator("article").filter({
    has: page.getByRole("heading", { name: emergencyTitle, exact: true }),
  });
  await emergencyArticle
    .getByText("修改／删除这次日程", { exact: true })
    .click();
  await emergencyArticle.getByRole("checkbox").check();
  await write(
    page,
    emergencyArticle.getByRole("button", { name: "保存这次日程", exact: true }),
  );
  await teacher.page.reload();
  response = await teacher.page.request.get(apiURL);
  data = await response.json();
  assert.deepEqual(data.members.find((m) => m.id === student.id).periods, [
    {
      startAt: new Date(startDate + "T20:00:00+08:00").toISOString(),
      endAt: new Date(startDate + "T21:30:00+08:00").toISOString(),
    },
  ]);
  for (const privateText of [
    emergencyTitle,
    courseTitle,
    taskTitle,
    "浏览器短期目标",
    "fingerprint",
    "taskId",
  ])
    assert.ok(!JSON.stringify(data).includes(privateText));
  assert.ok(
    !(await teacher.page.locator("body").innerText()).includes(emergencyTitle),
  );
  await teacher.page.screenshot({
    path: path.join(output, "team-busy-desktop.png"),
    fullPage: true,
  });
  await emergencyArticle
    .getByText("修改／删除这次日程", { exact: true })
    .click();
  await emergencyArticle.getByRole("checkbox").uncheck();
  await write(
    page,
    emergencyArticle.getByRole("button", { name: "保存这次日程", exact: true }),
  );
  await teacher.page.reload();
  data = await (await teacher.page.request.get(apiURL)).json();
  assert.deepEqual(data.members.find((m) => m.id === student.id).periods, []);
  await page
    .getByRole("link", { name: "课表驱动项目：重新规划", exact: true })
    .click();
  await page.getByText(/正在按新日程重新规划/).waitFor();
  assert.ok(await page.getByRole("checkbox").isChecked());
  await page.locator('input[name="startDate"]').fill(startDate);
  await page
    .getByLabel("本期想推进的目标（可选）", { exact: true })
    .fill("调整后的短期目标");
  await write(
    page,
    page.getByRole("button", { name: "生成短期计划草案", exact: true }),
  );
  const [replacement] =
    await sql`select * from personal_work_plans where replaces_plan_id=${plan.id} and status='draft'`;
  assert.ok(replacement.items.length);
  assert.ok(
    replacement.items.every(
      (b) =>
        Date.parse(b.startAt) >= Date.parse(startDate + "T21:12:00+08:00") ||
        Date.parse(b.endAt) <= Date.parse(startDate + "T20:22:00+08:00"),
    ),
  );
  assert.equal(
    (await sql`select status from personal_work_plans where id=${plan.id}`)[0]
      .status,
    "confirmed",
  );
  await write(
    page,
    page.getByRole("button", { name: "确认保存个人安排", exact: true }),
  );
  await page.waitForURL((url) => !url.searchParams.has("replan"));
  assert.equal(new URL(page.url()).searchParams.has("replan"), false);
  assert.equal(
    (await sql`select status from personal_work_plans where id=${plan.id}`)[0]
      .status,
    "cancelled",
  );
  assert.equal(
    (
      await sql`select status from personal_work_plans where id=${replacement.id}`
    )[0].status,
    "confirmed",
  );
  assert.equal(
    (await sql`select status from tasks where id=${taskId}`)[0].status,
    "todo",
  );
  const mobile = [];
  for (const width of [320, 390, 430]) {
    await page.setViewportSize({ width, height: 844 });
    for (const route of [
      "/schedule",
      "/projects/" + projectId + "/personal-plan",
      "/projects/" + projectId + "/ai-drafts?scope=personal",
      "/teams/" + teamId + "/availability",
    ]) {
      await page.goto(origin + route);
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth),
        width,
        `Overflow ${route} ${width}`,
      );
      mobile.push({
        page: route.includes("availability")
          ? "availability"
          : route.includes("personal-plan")
            ? "plan"
            : route.includes("ai-drafts")
              ? "ai"
              : "schedule",
        width,
      });
      if (width === 390 && route === "/schedule")
        await page.screenshot({
          path: path.join(output, "schedule-mobile.png"),
          fullPage: true,
        });
    }
  }
  await page.goto(origin + "/projects/" + projectId + "/personal-plan");
  await write(
    page,
    page.getByRole("button", { name: "取消已确认安排", exact: true }),
  );
  await page
    .locator("article")
    .filter({
      has: page.getByRole("heading", { name: "调整后的短期目标", exact: true }),
    })
    .getByText(/规则排程 · 已取消/)
    .waitFor();
  const cancelled = (
    await sql`select status from personal_work_plans where id=${replacement.id}`
  )[0].status;
  assert.equal(cancelled, "cancelled");
  const manager = await login(admin);
  await manager.page.goto(origin + "/schedule");
  assert.equal(
    await manager.page
      .getByText(courseTitle + "（已核对）", { exact: true })
      .count(),
    0,
  );
  await manager.page.goto(origin + "/projects/" + projectId + "/personal-plan");
  assert.equal(
    await manager.page
      .getByRole("heading", { name: "浏览器短期目标", exact: true })
      .count(),
    0,
  );
  const outsider = await login(members.find((m) => m.role === "outsider"));
  assert.equal(
    (
      await outsider.page.goto(
        origin + "/projects/" + projectId + "/personal-plan",
      )
    ).status(),
    404,
  );
  assert.equal((await outsider.page.request.get(apiURL)).status(), 403);
  assert.deepEqual(pageErrors, []);
  const report = {
    importPreview: "passed",
    eventEditDelete: "passed",
    manualSchedule: "passed",
    ruleDraft: "passed",
    avoidCourses: "passed",
    confirmation: "passed",
    cancel: "passed",
    sharedTasksUnchanged: "passed",
    privateData: "passed",
    otherTeamDenied: "passed",
    emergencySupplement: "passed",
    fuzzyBusyOnly: "passed",
    teacherView: "passed",
    sharingRevocation: "passed",
    atomicReplanning: "passed",
    mobile,
    pageErrors,
  };
  fs.writeFileSync(
    path.join(output, "report.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report));
  await context.close();
  await manager.context.close();
  await outsider.context.close();
  await teacher.context.close();
} finally {
  await browser.close();
  await sql.end();
}
