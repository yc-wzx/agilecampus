import { db } from "@/db";
import { sql } from "drizzle-orm";

export async function resetDb() {
  // C 新增的 iterations / write_requests / retrospectives / iteration_events 与
  // E 新增的 project_activities 一并在此清空：虽然它们外键指向 projects、会被 CASCADE
  // 连带清掉，但显式列出更稳，也避免将来有人改了外键行为后测试悄悄脏数据。
  await db.execute(
    sql`TRUNCATE write_requests, project_activities, iteration_events, iteration_histories, iteration_drafts, retrospectives, iterations, task_labels, labels, resource_usages, api_tokens, task_dependencies, messages, conversations, tasks, milestones, projects, team_members, teams, users RESTART IDENTITY CASCADE`,
  );
}
