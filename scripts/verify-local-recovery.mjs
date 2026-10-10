import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { config } from "dotenv";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
config({ path: ".env", quiet: true });
const url = new URL(process.env.DATABASE_URL);
if (!["localhost", "127.0.0.1"].includes(url.hostname))
  throw Error("Only isolated LOCAL databases may be used");
const suffix = Date.now(),
  sourceName = `agilecampus_recovery_source_${suffix}`,
  restoredName = `agilecampus_recovery_restored_${suffix}`;
const adminURL = new URL(url);
adminURL.pathname = "/postgres";
const admin = postgres(adminURL.toString(), {
  onnotice: () => {},
  connection: { TimeZone: "UTC" },
});
const sourceURL = new URL(url);
sourceURL.pathname = "/" + sourceName;
const targetURL = new URL(url);
targetURL.pathname = "/" + restoredName;
const source = postgres(sourceURL.toString(), {
    onnotice: () => {},
    connection: { TimeZone: "UTC" },
  }),
  target = postgres(targetURL.toString(), {
    onnotice: () => {},
    connection: { TimeZone: "UTC" },
  });
const folder = path.resolve(".next/p0p2-verification");
fs.mkdirSync(folder, { recursive: true });
const dump = path.join(folder, `recovery-${suffix}.dump`);
function pg(command, args) {
  const bin = process.env.PG_BIN
    ? path.join(
        process.env.PG_BIN,
        command + (process.platform === "win32" ? ".exe" : ""),
      )
    : command;
  const result = spawnSync(
    bin,
    [
      "-h",
      url.hostname,
      "-p",
      url.port || "5432",
      "-U",
      decodeURIComponent(url.username),
      ...args,
    ],
    {
      env: { ...process.env, PGPASSWORD: decodeURIComponent(url.password) },
      encoding: "utf8",
    },
  );
  if (result.status !== 0 || result.error)
    throw Error(`${command} failed (credentials suppressed)`);
}
try {
  await admin.unsafe(`CREATE DATABASE ${sourceName}`);
  await admin.unsafe(`CREATE DATABASE ${restoredName}`);
  const journal = JSON.parse(
    fs.readFileSync("drizzle/meta/_journal.json", "utf8"),
  );
  const baselineFolder = path.join(folder, `baseline-${suffix}`);
  fs.mkdirSync(path.join(baselineFolder, "meta"), { recursive: true });
  const baselineEntries = journal.entries.filter((entry) => entry.idx <= 11);
  for (const entry of baselineEntries)
    fs.copyFileSync(
      path.join("drizzle", entry.tag + ".sql"),
      path.join(baselineFolder, entry.tag + ".sql"),
    );
  fs.writeFileSync(
    path.join(baselineFolder, "meta/_journal.json"),
    JSON.stringify({ ...journal, entries: baselineEntries }),
  );
  await migrate(drizzle(source), { migrationsFolder: baselineFolder });
  const user = randomUUID(),
    team = randomUUID(),
    project = randomUUID(),
    task = randomUUID(),
    comment = randomUUID(),
    announcement = randomUUID(),
    conv = randomUUID(),
    draft = randomUUID(),
    notice = randomUUID();
  await source`insert into users(id,name,email,password_hash) values(${user},'独立恢复测试',${suffix + "@recovery.test"},'synthetic')`;
  await source`insert into teams(id,name,invite_code) values(${team},'恢复团队',${randomUUID()})`;
  await source`insert into team_members(team_id,user_id,role) values(${team},${user},'admin')`;
  await source`insert into projects(id,team_id,name) values(${project},${team},'完整迁移恢复')`;
  await source`insert into tasks(id,project_id,created_by_id,title,acceptance_criteria) values(${task},${project},${user},'原任务','恢复后保留')`;
  const deliverable = randomUUID(),
    version = randomUUID();
  await source`insert into deliverables(id,project_id,author_id,title,type,url,status,creation_key,creation_hash)values(${deliverable},${project},${user},'恢复正式成果','report','https://example.com/recovery','submitted',${randomUUID()},'synthetic')`;
  await source`insert into deliverable_versions(id,deliverable_id,version_number,draft_revision,submission_key,author_id,submitted_by_id,title,type,url,description)values(${version},${deliverable},1,1,${randomUUID()},${user},${user},'历史正式成果','report','https://example.com/recovery','不可变版本')`;
  await source`insert into deliverable_feedback(project_id,deliverable_id,version_id,reviewer_id,decision,comment,request_id,request_hash)values(${project},${deliverable},${version},${user},'changes_requested','反馈仍可追溯',${randomUUID()},'synthetic')`;
  await source`insert into task_comments(id,project_id,task_id,author_id,body) values(${comment},${project},${task},${user},'真实备份里的测试评论')`;
  await source`insert into announcements(id,project_id,author_id,title,body,is_pinned) values(${announcement},${project},${user},'测试公告','公告正文',true)`;
  await source`insert into conversations(id,project_id,created_by_id,scope) values(${conv},${project},${user},'personal')`;
  await source`insert into messages(conversation_id,role,content) values(${conv},'user','仅本人可读的测试会话')`;
  await source`insert into iteration_drafts(id,project_id,created_by_id,conversation_id,name,start_date,end_date,candidate_tasks,expires_at) values(${draft},${project},${user},${conv},'测试草案','2026-10-12','2026-10-18','[]',now()+interval '1 day')`;
  await source`insert into notifications(id,recipient_id,project_id,type,title,source_type,source_id,href,event_key) values(${notice},${user},${project},'task.overdue','恢复通知','task',${task},${"/projects/" + project + "?task=" + task},'recovery-fixture')`;
  await source`insert into external_notification_deliveries(notification_id,status,error_code,attempts) values(${notice},'failed','PROVIDER_TEST',2)`;
  const tables = [
    "users",
    "teams",
    "team_members",
    "projects",
    "tasks",
    "deliverables",
    "deliverable_versions",
    "deliverable_feedback",
    "task_comments",
    "announcements",
    "conversations",
    "messages",
    "iteration_drafts",
    "notifications",
    "external_notification_deliveries",
  ];
  const read = (sql, table) =>
    sql.unsafe(
      `select row_to_json(t) as row from ${table} t order by row_to_json(t)::text`,
    );
  const before = new Map();
  for (const table of tables) before.set(table, await read(source, table));
  await migrate(drizzle(source), { migrationsFolder: "drizzle" });
  for (const table of tables) {
    const old = before.get(table),
      actual = await read(source, table);
    assert.equal(
      actual.length,
      old.length,
      `${table} row count changed on upgrade`,
    );
    assert.deepEqual(
      actual.map(({ row }, index) => ({
        row: Object.fromEntries(
          Object.keys(old[index].row).map((key) => [key, row[key]]),
        ),
      })),
      Array.from(old),
      `${table} legacy data changed on upgrade`,
    );
  }
  const [legacyProject] =
    await source`select template_id,leader_id,leader_revision from projects where id=${project}`;
  assert.deepEqual(legacyProject, {
    template_id: "blank",
    leader_id: null,
    leader_revision: 0,
  });
  await source`update projects set template_id='course',leader_id=${user},leader_revision=1 where id=${project}`;
  await source`insert into project_creation_requests(request_id,request_hash,project_id) values(${randomUUID()},'synthetic',${project})`;
  await source`insert into project_lead_changes(project_id,actor_id,actor_name,leader_id,leader_name,revision) values(${project},${user},'独立恢复测试',${user},'独立恢复测试',1)`;
  const reference = randomUUID();
  await source`insert into project_references(id,project_id,created_by_id,title,type,url,minutes_url,meeting_date,participants,note,request_id,request_hash) values(${reference},${project},${user},'恢复会议','meeting','https://meeting.tencent.com/example','https://docs.qq.com/example','2026-10-10',${JSON.stringify([{ id: user, name: "独立恢复测试" }])}::jsonb,'会议说明',${randomUUID()},'synthetic')`;
  tables.push(
    "project_creation_requests",
    "project_lead_changes",
    "project_references",
  );
  pg("pg_dump", ["-d", sourceName, "-Fc", "-f", dump]);
  pg("pg_restore", ["-d", restoredName, "--exit-on-error", "--no-owner", dump]);
  for (const table of tables) {
    assert.deepEqual(
      await read(target, table),
      await read(source, table),
      `${table} contents differ`,
    );
  }
  assert.deepEqual(
    await target`select * from drizzle.__drizzle_migrations order by id`,
    await source`select * from drizzle.__drizzle_migrations order by id`,
  );
  const [next] =
    await target`insert into messages(conversation_id,role,content) values(${conv},'assistant','恢复后仍可写') returning seq`;
  assert.ok(next.seq > 1);
  const [savedReference] =
    await target`update project_references set revision=revision+1,note='恢复后可修改' where id=${reference} returning revision`;
  assert.equal(savedReference.revision, 2);
  await migrate(drizzle(target), { migrationsFolder: "drizzle" });
  const [ledger] =
    await target`select count(*)::int as total from drizzle.__drizzle_migrations`;
  assert.equal(
    ledger.total,
    JSON.parse(fs.readFileSync("drizzle/meta/_journal.json", "utf8")).entries
      .length,
  );
  const report = {
    durationMs: Date.now() - suffix,
    sourceName,
    restoredName,
    sha256: createHash("sha256").update(fs.readFileSync(dump)).digest("hex"),
    dump,
    tablesMatched: tables,
    migrationLedger: ledger.total,
    postRestoreWrite: true,
    migrationReplay: true,
    upgradedFrom: "0011",
    legacyDataPreserved: true,
    p3PostRestoreWrite: true,
  };
  fs.writeFileSync(
    path.join(folder, "recovery.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report));
} finally {
  await source.end();
  await target.end();
  await admin.end();
}
