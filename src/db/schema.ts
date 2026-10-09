import { sql } from "drizzle-orm";
import {
  pgTable,
  pgEnum,
  uuid,
  text,
  timestamp,
  uniqueIndex,
  primaryKey,
  date,
  doublePrecision,
  index,
  jsonb,
  integer,
  boolean,
  bigserial,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

export const teamRoleEnum = pgEnum("team_role", ["admin", "teacher", "student"]);
export type TeamRole = (typeof teamRoleEnum.enumValues)[number];

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  name: text("name").notNull(),
  // 飞书绑定（一对一，可空=未绑定）：open_id 为应用内用户唯一标识，发私信用之
  feishuOpenId: text("feishu_open_id").unique(),
  feishuName: text("feishu_name"),
  feishuBoundAt: timestamp("feishu_bound_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const teams = pgTable("teams", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  inviteCode: text("invite_code").notNull().unique(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const teamMembers = pgTable(
  "team_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: teamRoleEnum("role").notNull().default("student"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("team_members_team_user_unique").on(t.teamId, t.userId)],
);

export const projectStatusEnum = pgEnum("project_status", ["active", "archived"]);
export const milestoneStatusEnum = pgEnum("milestone_status", ["open", "done"]);
export const taskStatusEnum = pgEnum("task_status", ["todo", "doing", "done"]);
export const taskPriorityEnum = pgEnum("task_priority", ["low", "medium", "high"]);
// C / P0：迭代状态。开始 planned→active，结束 active→completed。
export const iterationStatusEnum = pgEnum("iteration_status", ["planned", "active", "completed"]);
export type ProjectStatus = (typeof projectStatusEnum.enumValues)[number];
export type TaskStatus = (typeof taskStatusEnum.enumValues)[number];
export type TaskPriority = (typeof taskPriorityEnum.enumValues)[number];
export type IterationStatus = (typeof iterationStatusEnum.enumValues)[number];

export const projects = pgTable(
  "projects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    status: projectStatusEnum("status").notNull().default("active"),
    startDate: date("start_date"),
    endDate: date("end_date"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("projects_team_idx").on(t.teamId)],
);

export const milestones = pgTable(
  "milestones",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    targetDate: date("target_date"),
    status: milestoneStatusEnum("status").notNull().default("open"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("milestones_project_idx").on(t.projectId)],
);

// C / P0：迭代（冲刺）。tasks.sprint_id 指向它。
// 契约要求「一个项目最多一轮 active」——由下面的部分唯一索引在数据库层保证，并发也成立。
export const iterations = pgTable(
  "iterations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    goal: text("goal"),
    startDate: date("start_date").notNull(),
    endDate: date("end_date").notNull(),
    status: iterationStatusEnum("status").notNull().default("planned"),
    // 乐观锁版本号：每次修改自增，调用方须回传 expectedRevision。
    revision: integer("revision").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [
    // 每项目至多一轮 active。部分唯一索引让「并发开始两轮」在 DB 层只可能成功一个，
    // 输的一方收到 23505，由服务层翻成友好中文错误。
    uniqueIndex("iterations_one_active_per_project")
      .on(t.projectId)
      .where(sql`${t.status} = 'active'`),
    index("iterations_project_idx").on(t.projectId),
  ],
);

export const tasks = pgTable(
  "tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    milestoneId: uuid("milestone_id").references(() => milestones.id, {
      onDelete: "set null",
    }),
    // C / P0：迭代归属。内部列名 sprint_id，对外 DTO 字段为 iterationId（仅此一份归属）。
    // 迭代删除后置空 = 任务退回任务池，不连带删任务。
    sprintId: uuid("sprint_id").references(() => iterations.id, { onDelete: "set null" }),
    // 子任务层级：自引用，空＝顶层任务。父任务删则子任务随之（cascade）。
    // 自引用外键须显式标注 AnyPgColumn，否则 TS 推断成环。
    parentTaskId: uuid("parent_task_id").references((): AnyPgColumn => tasks.id, {
      onDelete: "cascade",
    }),
    title: text("title").notNull(),
    description: text("description"),
    // C / P0：验收标准。可选文本，旧任务为空；长度上限在服务层校验（10000 字）。
    acceptanceCriteria: text("acceptance_criteria"),
    completionNote: text("completion_note"),
    assigneeId: uuid("assignee_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdById: uuid("created_by_id").references(() => users.id, {
      onDelete: "set null",
    }),
    startDate: date("start_date"),
    dueDate: date("due_date"),
    status: taskStatusEnum("status").notNull().default("todo"),
    priority: taskPriorityEnum("priority").notNull().default("medium"),
    sortOrder: doublePrecision("sort_order").notNull().default(0),
    // C / P1：阻塞标记。三个字段同生共死，只由 lib/task-contract.ts 的 setTaskBlocked 一处写入；
    // updateTask 的白名单里刻意不含它们，免得「解除阻塞」漏写 blockedAt 之类的不一致状态。
    isBlocked: boolean("is_blocked").notNull().default(false),
    blockedReason: text("blocked_reason"),
    blockedAt: timestamp("blocked_at", { withTimezone: true }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("tasks_project_idx").on(t.projectId),
    index("tasks_assignee_idx").on(t.assigneeId),
    index("tasks_parent_idx").on(t.parentTaskId),
    // 任务池查询按 sprint_id IS NULL 过滤，且入轮/移出按 sprint_id 定位
    index("tasks_sprint_idx").on(t.sprintId),
    // P2 的「需关注任务」按项目 + 是否阻塞筛
    index("tasks_blocked_idx").on(t.projectId, t.isBlocked),
  ],
);

export const messageRoleEnum = pgEnum("message_role", ["user", "assistant", "tool"]);
export type MessageRole = (typeof messageRoleEnum.enumValues)[number];

export const conversations = pgTable(
  "conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    createdById: uuid("created_by_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text("title"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("conversations_project_idx").on(t.projectId)],
);

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    role: messageRoleEnum("role").notNull(),
    content: text("content").notNull(),
    toolCalls: jsonb("tool_calls"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("messages_conversation_idx").on(t.conversationId)],
);

export const taskDependencies = pgTable(
  "task_dependencies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    predecessorId: uuid("predecessor_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    successorId: uuid("successor_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("task_dep_pair_unique").on(t.predecessorId, t.successorId),
    index("task_dep_predecessor_idx").on(t.predecessorId),
  ],
);

// Personal API Token：CC 等浏览器外调用的认证凭据。
// 明文只生成时返回一次，库中仅存 sha256 hash（高熵 token 无需 bcrypt，且 hash 可建唯一索引供 O(1) 查验）。
export const apiTokens = pgTable(
  "api_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    lastUsedAt: timestamp("last_used_at"),
    revokedAt: timestamp("revoked_at"),
  },
  (t) => [index("api_tokens_user_idx").on(t.userId)],
);

// 资源占用登记：团队共享资源（服务器/算力等）的占用记录，纯登记无审批。
// endTime 可空=占用中；时长 = endTime - startTime（结束后计算）。
export const resourceUsages = pgTable(
  "resource_usages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    resourceName: text("resource_name").notNull(),
    purpose: text("purpose"),
    startTime: timestamp("start_time").notNull(),
    endTime: timestamp("end_time"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("resource_usages_team_idx").on(t.teamId),
    index("resource_usages_user_idx").on(t.userId),
  ],
);

export const labelColorEnum = pgEnum("label_color", [
  "slate",
  "red",
  "amber",
  "green",
  "blue",
  "violet",
  "pink",
]);
export type LabelColor = (typeof labelColorEnum.enumValues)[number];

// 标签挂在团队而非项目：实验室内项目多且同质，共享一套免去每建一项目重建之苦。
// 唯一索引建在普通两列，大小写不敏感去重由 lib/label.ts 的 lower() 查询承担。
export const labels = pgTable(
  "labels",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    color: labelColorEnum("color").notNull().default("slate"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("labels_team_name_unique").on(t.teamId, t.name),
    index("labels_team_idx").on(t.teamId),
  ],
);

export const taskLabels = pgTable(
  "task_labels",
  {
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    labelId: uuid("label_id")
      .notNull()
      .references(() => labels.id, { onDelete: "cascade" }),
  },
  (t) => [
    primaryKey({ columns: [t.taskId, t.labelId] }),
    index("task_labels_label_idx").on(t.labelId),
  ],
);

// D / P0: additive tables only. Submitted content is retained in immutable snapshots.
export const deliverableTypeEnum = pgEnum("deliverable_type", [
  "report", "presentation", "video", "survey", "code", "prototype", "demo", "other",
]);
export const deliverableStatusEnum = pgEnum("deliverable_status", ["draft", "submitted", "approved", "changes_requested"]);
export type DeliverableType = (typeof deliverableTypeEnum.enumValues)[number];

export const deliverables = pgTable("deliverables", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  authorId: uuid("author_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  milestoneId: uuid("milestone_id").references(() => milestones.id, { onDelete: "set null" }),
  title: text("title").notNull(),
  type: deliverableTypeEnum("type").notNull(),
  url: text("url").notNull().default(""),
  description: text("description").notNull().default(""),
  status: deliverableStatusEnum("status").notNull().default("draft"),
  revision: integer("revision").notNull().default(1),
  creationKey: uuid("creation_key").notNull(),
  creationHash: text("creation_hash").notNull(),
  // Private copy; public fields remain the latest submitted snapshot.
  workingCopy: jsonb("working_copy").$type<{
    title: string; type: DeliverableType; url: string; description: string;
    milestoneId: string | null; requestId: string; baseRevision: number;
  }>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  submittedAt: timestamp("submitted_at", { withTimezone: true }),
}, (t) => [
  index("deliverables_project_idx").on(t.projectId),
  index("deliverables_author_idx").on(t.authorId),
  uniqueIndex("deliverables_creation_unique").on(t.projectId, t.authorId, t.creationKey),
]);

export const deliverableVersions = pgTable("deliverable_versions", {
  id: uuid("id").primaryKey().defaultRandom(),
  deliverableId: uuid("deliverable_id").notNull().references(() => deliverables.id, { onDelete: "cascade" }),
  versionNumber: integer("version_number").notNull(),
  draftRevision: integer("draft_revision").notNull(),
  submissionKey: uuid("submission_key").notNull(),
  // Snapshot identifiers intentionally have no FK: deleting a milestone must not rewrite history.
  authorId: uuid("author_id").notNull(),
  submittedById: uuid("submitted_by_id").notNull(),
  milestoneId: uuid("milestone_id"),
  milestoneTitle: text("milestone_title"),
  title: text("title").notNull(),
  type: deliverableTypeEnum("type").notNull(),
  url: text("url").notNull(),
  description: text("description").notNull(),
  submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("deliverable_versions_number_unique").on(t.deliverableId, t.versionNumber),
  uniqueIndex("deliverable_versions_submission_unique").on(t.deliverableId, t.submissionKey),
]);

export const deliverableFeedbackDecision = pgEnum("deliverable_feedback_decision", ["approved", "changes_requested", "comment"]);
export const deliverableFeedback = pgTable("deliverable_feedback", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  deliverableId: uuid("deliverable_id").references(() => deliverables.id, { onDelete: "cascade" }),
  versionId: uuid("version_id").references(() => deliverableVersions.id, { onDelete: "cascade" }),
  milestoneId: uuid("milestone_id").references(() => milestones.id, { onDelete: "set null" }),
  milestoneTitle: text("milestone_title"),
  // Historical identity survives deletion of the live milestone (no FK by design).
  milestoneSnapshotId: uuid("milestone_snapshot_id"),
  reviewerId: uuid("reviewer_id").notNull(),
  decision: deliverableFeedbackDecision("decision").notNull(),
  comment: text("comment").notNull(),
  requestId: uuid("request_id").notNull(),
  requestHash: text("request_hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("deliverable_feedback_version_unique").on(t.versionId),
  uniqueIndex("deliverable_feedback_request_unique").on(t.projectId, t.reviewerId, t.requestId),
  index("deliverable_feedback_project_idx").on(t.projectId),
]);

export const feedbackTaskLinks = pgTable("feedback_task_links", {
  feedbackId: uuid("feedback_id").primaryKey().references(() => deliverableFeedback.id, { onDelete: "cascade" }),
  taskId: uuid("task_id").references(() => tasks.id, { onDelete: "set null" }),
  originalTaskId: uuid("original_task_id").notNull(),
  createdById: uuid("created_by_id").notNull(),
  requestId: uuid("request_id").notNull(),
  requestHash: text("request_hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("feedback_task_links_task_idx").on(t.taskId)]);

// D's durable handoff; E/F still own activity records and notification delivery.
export const deliverableOutbox = pgTable("deliverable_outbox", {
  id: uuid("id").primaryKey().defaultRandom(),
  eventKey: text("event_key").notNull().unique(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  actorId: uuid("actor_id").notNull(),
  type: text("type").notNull(),
  payload: jsonb("payload").$type<Record<string, string>>().notNull(),
  recipientIds: jsonb("recipient_ids").$type<string[]>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  deliveredAt: timestamp("delivered_at", { withTimezone: true }),
}, (t) => [index("deliverable_outbox_pending_idx").on(t.deliveredAt, t.createdAt)]);

// C / P0：requestId 幂等账本。契约要求「新变更中使用 requestId 的操作都应保存服务端幂等凭据；
// 相同标识与内容重放返回原操作结果，相同标识配不同内容返回 CONFLICT」。
//
// 不把 requestId 挂到 tasks 上：同一任务会被反复修改，一行只能存一个请求标识，那样是错的。
// 改为按 (project, actor, operation, requestId) 记账，一次请求一行，result 存首次成功的返回体供回放。
// 与 D 的 deliverable_* 系列互不重叠。
export const writeRequests = pgTable(
  "write_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    actorId: uuid("actor_id").notNull(),
    operation: text("operation").notNull(),
    requestId: uuid("request_id").notNull(),
    requestHash: text("request_hash").notNull(),
    result: jsonb("result").$type<unknown>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("write_requests_unique").on(t.projectId, t.actorId, t.operation, t.requestId),
    index("write_requests_created_idx").on(t.createdAt),
  ],
);

// C / P1：迭代复盘。一轮迭代至多一份（uniqueIndex 兜底），内容可改故带 revision 做乐观锁。
// authorId 不设外键：契约里它是 string，且起草人与用户删除是两件事，留下 id 更有历史价值。
export const retrospectives = pgTable(
  "retrospectives",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    iterationId: uuid("iteration_id")
      .notNull()
      .references(() => iterations.id, { onDelete: "cascade" }),
    wentWell: text("went_well"),
    problems: text("problems"),
    nextActions: text("next_actions"),
    authorId: uuid("author_id").notNull(),
    revision: integer("revision").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("retrospectives_iteration_unique").on(t.iterationId),
    index("retrospectives_project_idx").on(t.projectId),
  ],
);

// C / P1：迭代结束时的不可变历史快照（定稿 C-I08）。
//
// 刻意用 jsonb 而非再来一套 history_tasks 表：快照的全部意义就是「冻结当时的值」，
// 一旦落成可 join 的行，总有人忍不住去 join 活任务表，历史就跟着变了。
// iteration_id 唯一 = 一轮只能结束一次，重复结束由 DB 兜底。
export const iterationHistories = pgTable(
  "iteration_histories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    iterationId: uuid("iteration_id")
      .notNull()
      .references(() => iterations.id, { onDelete: "cascade" }),
    /** Iteration DTO 快照 */
    iterationSnapshot: jsonb("iteration_snapshot").notNull(),
    /** TaskSummary[] 快照 */
    taskSnapshots: jsonb("task_snapshots").notNull(),
    /** {taskTotal,doneCount,doneRatio} */
    stats: jsonb("stats").notNull(),
    /** UnfinishedDisposition[]：未完成任务各自去了哪里 */
    dispositions: jsonb("dispositions").notNull(),
    closedAt: timestamp("closed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("iteration_histories_iteration_unique").on(t.iterationId),
    index("iteration_histories_project_idx").on(t.projectId, t.closedAt),
  ],
);

// C / P2：AI 迭代草案（定稿 9.9 的 IterationDraft）。
//
// 存储归 C 的数据库整合这一摊，生成/取消归 E（E-AI05/E-AI06），
// 预览校验与事务确认归 C（C-AI01/C-AI02）。表先建好，E 那边照此写入即可。
// candidate_tasks 用 jsonb：它整体就是一份「当时的快照 + 理由」，不需要按任务反查。
export const iterationDrafts = pgTable(
  "iteration_drafts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    createdById: uuid("created_by_id").notNull(),
    /** 会话删除不该带走草案，故置空而非级联。 */
    conversationId: uuid("conversation_id").references(() => conversations.id, {
      onDelete: "set null",
    }),
    /** pending / confirmed / cancelled / expired */
    status: text("status").notNull().default("pending"),
    revision: integer("revision").notNull().default(1),
    name: text("name").notNull(),
    goal: text("goal"),
    startDate: date("start_date").notNull(),
    endDate: date("end_date").notNull(),
    /** IterationDraftCandidateTask[] */
    candidateTasks: jsonb("candidate_tasks").notNull(),
    sourceRefs: jsonb("source_refs"),
    /** 确认后指向真正建出的那轮，便于重放时原样返回。 */
    confirmedIterationId: uuid("confirmed_iteration_id").references(() => iterations.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    /** 创建后 24 小时到期，由服务端校验 */
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    index("iteration_drafts_project_idx").on(t.projectId, t.createdAt),
    index("iteration_drafts_creator_idx").on(t.createdById, t.status),
  ],
);

// C / P1：迭代事件流水。做完的事不再改，只追加，供迭代详情页回看「这一轮都发生了什么」。
// 刻意不建在 iterations 上做 jsonb 数组：追加式流水不会被并发覆盖，也不用读改写整行。
export const iterationEvents = pgTable(
  "iteration_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /**
     * 插入序号，只用来定序。同一事务里写下的多条事件 created_at 完全相同
     * （now() 是事务开始时刻），光靠时间排不出先后，必须有单调列兜底。
     */
    seq: bigserial("seq", { mode: "number" }).notNull(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    iterationId: uuid("iteration_id")
      .notNull()
      .references(() => iterations.id, { onDelete: "cascade" }),
    /** 与契约的 ITERATION_EVENT_TYPES 对应 */
    type: text("type").notNull(),
    actorId: uuid("actor_id"),
    payload: jsonb("payload").$type<unknown>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("iteration_events_iteration_idx").on(t.iterationId, t.seq)],
);

// E / P0：通用项目活动流水（定稿 9.4 E-A01/A02）。只追加、不修改。
// event_key 唯一，重放不会产生第二行；这是契约「用 eventKey 对活动去重」的落点。
//
// 刻意不加 seq：契约固定按 occurred_at desc + id 排序，uuid 主键本身就能稳定翻页。
// iteration_events 需要 seq 是因为它只按 created_at 排且无唯一兜底，此处没有这个问题。
// occurred_at 是业务时间（对外展示），created_at 只是本行的入库时刻，不对外。
export const projectActivities = pgTable(
  "project_activities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventKey: text("event_key").notNull(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    // 不设外键：与 deliverable_outbox.actor_id 一致，删用户不该抹掉「谁做过这件事」的历史
    actorId: uuid("actor_id").notNull(),
    /** task / iteration / deliverable / feedback / comment / announcement，服务层按白名单校验 */
    objectType: text("object_type").notNull(),
    // 不设外键：多态指向任务/迭代/成果/反馈/评论/公告，对象本身可被删除
    objectId: uuid("object_id").notNull(),
    /** 与契约 ACTIVITY_EVENT_TYPES 对应 */
    type: text("type").notNull(),
    summary: text("summary").notNull(),
    /** 只存白名单元信息（ID、changedFields、前后状态），绝不存私有正文 */
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("project_activities_event_key_unique").on(t.eventKey),
    index("project_activities_project_time_idx").on(t.projectId, t.occurredAt, t.id),
    index("project_activities_object_idx").on(t.projectId, t.objectType, t.objectId),
  ],
);
