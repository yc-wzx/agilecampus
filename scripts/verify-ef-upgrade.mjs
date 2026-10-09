import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { config } from "dotenv";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";

config({ path: ".env", quiet: true });
const source = new URL(process.env.DATABASE_URL);
if (!["localhost", "127.0.0.1"].includes(source.hostname)) throw new Error("Local verification only");
const databaseName = "agilecampus_ef_upgrade_" + Date.now();
const adminUrl = new URL(source); adminUrl.pathname = "/postgres";
const admin = postgres(adminUrl.toString());
const folder = fs.mkdtempSync(path.join(os.tmpdir(), "agilecampus-ef-migrations-"));
const journal = JSON.parse(fs.readFileSync("drizzle/meta/_journal.json", "utf8"));
const baseline = journal.entries.filter(entry => entry.idx <= 7);
fs.mkdirSync(path.join(folder, "meta"));
fs.writeFileSync(path.join(folder, "meta/_journal.json"), JSON.stringify({ ...journal, entries: baseline }));
for (const entry of baseline) fs.copyFileSync("drizzle/" + entry.tag + ".sql", path.join(folder, entry.tag + ".sql"));
await admin.unsafe("CREATE DATABASE " + databaseName);
const reviewUrl = new URL(source); reviewUrl.pathname = "/" + databaseName;
const sql = postgres(reviewUrl.toString(), { onnotice: () => {} });
try {
  const db = drizzle(sql);
  await migrate(db, { migrationsFolder: folder });
  const userId = randomUUID(), teamId = randomUUID(), projectId = randomUUID(), taskId = randomUUID(), deliverableId = randomUUID();
  await sql`insert into users(id,name,email,password_hash) values(${userId},'升级验证用户',${randomUUID() + "@upgrade.example.test"},'fixture')`;
  await sql`insert into teams(id,name,invite_code) values(${teamId},'升级验证团队',${randomUUID()})`;
  await sql`insert into team_members(team_id,user_id,role) values(${teamId},${userId},'admin')`;
  await sql`insert into projects(id,team_id,name) values(${projectId},${teamId},'升级验证项目')`;
  await sql`insert into tasks(id,project_id,created_by_id,title) values(${taskId},${projectId},${userId},'旧任务')`;
  await sql`insert into deliverables(id,project_id,author_id,title,type,url,description,creation_key,creation_hash)
    values(${deliverableId},${projectId},${userId},'旧成果','report','https://example.com','旧说明',${randomUUID()},'upgrade-fixture')`;
  await migrate(db, { migrationsFolder: "drizzle" });
  assert.equal((await sql`select title from tasks where id=${taskId}`)[0].title, "旧任务");
  assert.equal((await sql`select title from deliverables where id=${deliverableId}`)[0].title, "旧成果");
  assert.equal((await sql`select count(*)::int as count from users where id=${userId}`)[0].count, 1);
  assert.equal((await sql`select count(*)::int as count from team_members where user_id=${userId}`)[0].count, 1);
  const tables = await sql`select to_regclass('public.project_activities') as activities, to_regclass('public.notifications') as notifications, to_regclass('public.notification_read_requests') as read_requests`;
  assert.ok(tables[0].activities && tables[0].notifications && tables[0].read_requests);
  const [{ count }] = await sql`select count(*)::int as count from drizzle.__drizzle_migrations`;
  assert.equal(count, journal.entries.length);
  const report = { database: databaseName, from: "0007", to: journal.entries.at(-1).tag,
    ledgerEntries: count, preserved: ["user", "team", "membership", "project", "task", "deliverable"], tables: tables[0] };
  fs.mkdirSync(".next/ef-integration-verification", { recursive: true });
  fs.writeFileSync(".next/ef-integration-verification/upgrade.json", JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally { await sql.end(); await admin.end(); }
