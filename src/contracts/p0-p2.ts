// 跨模块冻结契约（P0—P2）。见《P0-P2 统一接口标准·定稿》第 9.1 节。
//
// 本文件只允许放「类型」与「常量」：
//   - 不得 import 数据库、认证或任何服务代码（@/db、@/lib、next/* 一律禁止）
//   - 浏览器可直接 `import type { ... } from "@/contracts/p0-p2"`，不会把 pg / drizzle 打进前端包
//
// C 负责创建本文件；各模块作者负责自己的 DTO，D 检查是否符合本标准。
// 字段名与返回结构是冻结的，改名视为破坏契约。

/* ------------------------------------------------------------------ *
 * 错误码
 * ------------------------------------------------------------------ */

/** 判别式结果与 QueryPart 共用的错误码。与成果模块 DeliverableResult 的口径一致。 */
export const ERROR_CODES = [
  "UNAUTHENTICATED",
  "FORBIDDEN",
  "NOT_FOUND",
  "VALIDATION",
  "CONFLICT",
  "UNAVAILABLE",
  "INTERNAL",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

/**
 * 写操作的统一返回。`data` 即定稿各表格「成功 data」列的内容。
 * 新页面统一读 `ok`；`ok === false` 时 `code` 可判别、`error` 可直接展示。
 */
export type Result<T> =
  | { ok: true; data: T }
  | { ok: false; code: ErrorCode; error: string };

/* ------------------------------------------------------------------ *
 * 分页
 * ------------------------------------------------------------------ */

export const PAGE_LIMIT_DEFAULT = 50;
export const PAGE_LIMIT_MAX = 100;
export const PAGE_OFFSET_MAX = 100000;

/** offset ≥ 0；limit 为 1—100，默认 50；最大 offset 按 D 约定 100000。 */
export type PageInput = { offset?: number; limit?: number };

/**
 * 分页结果。排序必须补唯一 ID 兜底，否则翻页不稳定。
 * `total` 是总数，不是当前项数。
 */
export type PageResult<T> = {
  items: T[];
  total: number;
  offset: number;
  limit: number;
  nextOffset: number | null;
};

/* ------------------------------------------------------------------ *
 * 查询状态 / 写入元信息 / 来源引用 / 时间范围
 * ------------------------------------------------------------------ */

/** 读接口的标准状态：拿到数据，或明确说明为什么拿不到。不允许用空数组冒充「失败」。 */
export type QueryPart<T> =
  | { state: "ready"; data: T }
  | { state: "unavailable"; code: ErrorCode; message: string };

/** 写操作元信息。新实体可编辑时带 revision（从 1 开始，变更后自增）；创建不传。 */
export type NewWriteMeta = { requestId: string; expectedRevision?: number };

/** 来源种类。任务详情接 D 的来源反馈、E 的评论/活动时统一用它。 */
export const SOURCE_KINDS = [
  "task",
  "iteration",
  "activity",
  "comment",
  "deliverable",
  "feedback",
  "retrospective",
  "announcement",
] as const;

export type SourceKind = (typeof SOURCE_KINDS)[number];

/** `deleted` 表示来源已删除但历史仍指向它；`unavailable` 表示暂时读不到（如外部服务故障）。 */
export type SourceAvailability = "available" | "deleted" | "unavailable";

export type SourceRef = {
  sourceKind: SourceKind;
  sourceId: string;
  projectId: string;
  sourceHref: string | null;
  evidenceKey: string;
  availability: SourceAvailability;
};

/** 北京时间语义：起始日包含、结束日不包含，且 fromDate < toDate。 */
export type DateRange = { fromDate: string; toDate: string };

/** 统计覆盖范围说明：数据从哪天起可用、是否完整、有什么要交代的。 */
export type QueryCoverage = {
  availableFrom: string | null;
  complete: boolean;
  note: string | null;
};

/* ------------------------------------------------------------------ *
 * 复用既有枚举的浏览器安全字面量
 * （不 import @/db/schema，避免把 drizzle 带进前端包）
 * ------------------------------------------------------------------ */

export const TASK_STATUS_VALUES = ["todo", "doing", "done"] as const;
export type TaskStatusValue = (typeof TASK_STATUS_VALUES)[number];

export const TASK_PRIORITY_VALUES = ["low", "medium", "high"] as const;
export type TaskPriorityValue = (typeof TASK_PRIORITY_VALUES)[number];

export const ITERATION_STATUS_VALUES = ["planned", "active", "completed"] as const;
export type IterationStatusValue = (typeof ITERATION_STATUS_VALUES)[number];

/* ------------------------------------------------------------------ *
 * C · 任务 DTO（定稿 9.2）
 * ------------------------------------------------------------------ */

export type TaskLabel = { id: string; name: string; color: string };

/**
 * 任务标准 DTO。定稿 9.2 冻结字段。
 * 说明：DB 内部列名为 sprint_id，此处映射为 iterationId —— C 负责，不同时存两份归属。
 * P0 阶段 isBlocked/blockedReason/blockedAt 是 P1 才落库的列，先返回字面量 false/null/null。
 */
export type TaskSummary = {
  id: string;
  projectId: string;
  title: string;
  description: string | null;
  status: TaskStatusValue;
  assigneeId: string | null;
  assigneeName: string | null;
  startDate: string | null;
  dueDate: string | null;
  priority: TaskPriorityValue;
  milestoneId: string | null;
  parentTaskId: string | null;
  iterationId: string | null;
  acceptanceCriteria: string | null;
  isBlocked: boolean;
  blockedReason: string | null;
  blockedAt: string | null;
  completionNote: string | null;
  /** ISO 时间串。修改/删除时须原样回传为 expectedUpdatedAt，不得在浏览器重新生成。 */
  updatedAt: string;
  sourceHref: string | null;
};

/** 直接子任务进度。0 个子任务时 ratio 为 null（不是 0，也不是 100%）。 */
export type SubtaskProgress = {
  parentTaskId: string;
  total: number;
  doneCount: number;
  ratio: number | null;
};

/** C-T07：批量入口一次最多接受多少个父任务。 */
export const SUBTASK_PROGRESS_MAX_PARENTS = 100;

export type TaskAllowedActions = { edit: boolean; delete: boolean; comment: boolean };

/** 侧边栏一次取回的聚合数据。对应固定服务 getTaskPanelData(actorId, projectId, taskId)。 */
export type TaskPanelData = {
  task: TaskSummary;
  labels: TaskLabel[];
  dependencies: { predecessorId: string; successorId: string }[];
  subtaskProgress: SubtaskProgress;
  allowedActions: TaskAllowedActions;
};

/** 任务池筛选。默认即「无迭代 + 未完成 + 仅主任务」。 */
export type BacklogFilters = PageInput & {
  assigneeId?: string;
  priority?: TaskPriorityValue;
};

/* ------------------------------------------------------------------ *
 * C · 迭代 DTO（定稿 9.3）
 * ------------------------------------------------------------------ */

/**
 * 迭代。name 1—200 字，goal 最多 10000 字；日期必填且 startDate ≤ endDate。
 * status 为 planned/active/completed，时间字段按状态可 null。
 */
export type Iteration = {
  id: string;
  projectId: string;
  name: string;
  goal: string | null;
  startDate: string;
  endDate: string;
  status: IterationStatusValue;
  revision: number;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
};

export type IterationStats = { taskTotal: number; doneCount: number; doneRatio: number };

/** 当前迭代 = active 那一轮 + 主任务口径统计。无 active 轮时返回 null。 */
export type CurrentIteration = Iteration & {
  taskTotal: number;
  doneCount: number;
  doneRatio: number;
  scope: "main-tasks";
  asOf: string;
  sourceHref: string | null;
};

/** 历史条目。P1 由不可变快照填充；P0 先返回空数组。 */
export type IterationHistoryEntry = {
  id: string;
  type: string;
  at: string;
  actorId: string | null;
};

/** 复盘。P1 落库；P0 返回 null，且「没填复盘」不等于「迭代没结束」。 */
export type Retrospective = {
  id: string;
  projectId: string;
  iterationId: string;
  wentWell: string | null;
  problems: string | null;
  nextActions: string | null;
  authorId: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
};

export type IterationDetail = {
  iteration: Iteration;
  tasks: TaskSummary[];
  stats: IterationStats;
  history: IterationHistoryEntry[];
  retrospective: Retrospective | null;
};

export type IterationListFilters = PageInput & { status?: IterationStatusValue };

/* ------------------------------------------------------------------ *
 * C · 动作输入 / 成功载荷（定稿 3.4 / 9.2 / 9.3）
 * 对外一律包在 Result<T> 里返回，即 Result<TaskV1Result> 之类。
 * ------------------------------------------------------------------ */

/* --- 任务 V1 对象式 Action --- */

export type CreateTaskV1Input = {
  requestId: string;
  title: string;
  description?: string | null;
  assigneeId?: string | null;
  startDate?: string | null;
  dueDate?: string | null;
  milestoneId?: string | null;
  priority?: TaskPriorityValue;
  parentTaskId?: string | null;
  acceptanceCriteria?: string | null;
};

/** patch 中字段传 null 表示「清空」，省略表示「不改」。任务所属项目不允许通过 patch 修改。 */
export type UpdateTaskV1Patch = {
  title?: string;
  description?: string | null;
  assigneeId?: string | null;
  startDate?: string | null;
  dueDate?: string | null;
  milestoneId?: string | null;
  status?: TaskStatusValue;
  priority?: TaskPriorityValue;
  completionNote?: string | null;
  acceptanceCriteria?: string | null;
};

export type UpdateTaskV1Input = {
  requestId: string;
  expectedUpdatedAt: string;
  patch: UpdateTaskV1Patch;
};

export type DeleteTaskV1Input = { requestId: string; expectedUpdatedAt: string };

export type TaskV1Result = { task: TaskSummary };
export type DeleteTaskV1Result = { taskId: string; deleted: true };

/* --- 任务池排序 / 入轮 / 移出 --- */

export type ReorderBacklogInput = {
  requestId: string;
  taskId: string;
  beforeTaskId: string | null;
  expectedUpdatedAt: string;
};

export type ReorderBacklogResult = { taskId: string; sortOrder: number; updatedAt: string };

/** 入轮/移出时对每个任务的版本要求。 */
export type IterationTaskRef = { taskId: string; expectedUpdatedAt: string };

export type AssignTasksInput = {
  requestId: string;
  expectedRevision: number;
  tasks: IterationTaskRef[];
};

export type AssignTasksResult = { iteration: Iteration; taskIds: string[] };

/* --- 迭代基础操作 --- */

export type CreateIterationInput = {
  requestId: string;
  name: string;
  goal?: string | null;
  startDate: string;
  endDate: string;
};

export type UpdateIterationInput = {
  requestId: string;
  expectedRevision: number;
  name?: string;
  goal?: string | null;
  startDate?: string;
  endDate?: string;
};

export type IterationRevisionInput = { requestId: string; expectedRevision: number };

/* --- 结束迭代、不可变历史与复盘（P1） --- */

export const ITERATION_EVENT_TYPES = [
  "created",
  "started",
  "updated",
  "tasks_assigned",
  "tasks_removed",
  "completed",
  "retrospective_saved",
] as const;

export type IterationEventType = (typeof ITERATION_EVENT_TYPES)[number];

/** 结束预览里对任务版本的基线要求（C-I06 的 taskVersions）。 */
export type IterationTaskVersion = { taskId: string; updatedAt: string };

/** 未完成任务的去向：退回任务池，或转入同项目另一轮 planned/active 迭代。 */
export type UnfinishedDisposition = {
  taskId: string;
  destination: "backlog" | "iteration";
  targetIterationId?: string;
};

/** C-I06：结束前的确认表单数据。不落库，纯预览。 */
export type IterationCompletionPreview = {
  iterationRevision: number;
  completedTasks: TaskSummary[];
  unfinishedTasks: TaskSummary[];
  /** 可作为未完成任务落点的一轮：同项目、未完成、且不是本轮。 */
  eligibleNextIterations: Iteration[];
  /** 预览时各任务的版本基线，结束时要原样回传。 */
  taskVersions: IterationTaskVersion[];
};

/**
 * C-I07 结束迭代。`unfinishedDisposition` 必须完整覆盖全部未完成主任务——
 * 少一个都会被服务端拒绝，免得「没提到的任务」被静默冻结或静默退回。
 */
export type CompleteIterationInput = {
  requestId: string;
  expectedRevision: number;
  taskVersions: IterationTaskVersion[];
  unfinishedDisposition: UnfinishedDisposition[];
};

export type CompleteIterationResult = {
  iteration: Iteration;
  historyId: string;
  movedTaskIds: string[];
};

/**
 * C-I08 不可变历史快照。快照保存当时的任务标题/状态/归属/负责人/日期/阻塞与统计，
 * 之后任务被改名、完成或删除都不重算历史。
 */
export type IterationHistory = {
  historyId: string;
  iterationId: string;
  closedAt: string;
  iterationSnapshot: Iteration;
  taskSnapshots: TaskSummary[];
  stats: IterationStats;
  dispositions: UnfinishedDisposition[];
};

/* --- 复盘（P1） --- */

export type SaveRetrospectiveInput = {
  requestId: string;
  /** 首次创建可不传；之后修改必传。 */
  expectedRevision?: number;
  wentWell?: string | null;
  problems?: string | null;
  nextActions?: string | null;
};

export type SaveRetrospectiveResult = { retrospective: Retrospective };

/** C-I11：删除尚未开始的迭代，关联任务退回任务池，任务本身不删。 */
export type DeletePlannedIterationResult = { deleted: true; iterationId: string };

/* --- 我的活跃迭代（C-I13 / A 跨项目工作台） --- */

export type MyActiveIteration = Iteration & {
  projectName: string;
  taskTotal: number;
  doneCount: number;
  doneRatio: number;
  scope: "main-tasks";
  asOf: string;
  sourceHref: string;
};

/* --- 阻塞（P1） --- */

export type SetTaskBlockedInput = {
  requestId: string;
  expectedUpdatedAt: string;
  isBlocked: boolean;
  /** isBlocked 为 true 时必填，1—2000 字；解除阻塞时忽略。 */
  blockedReason?: string | null;
};

export type SetTaskBlockedResult = { task: TaskSummary };

/* --- 项目级任务统计与需关注清单（P2） --- */

/**
 * C-T08。口径固定为主任务：子任务不计入，否则一个父任务会被算两次。
 * total 为 0 时 doneRatio 是 null 而非 0——「没有任务」与「一个都没做完」是两回事。
 */
export type ProjectTaskStats = {
  projectId: string;
  asOf: string;
  scope: "main-tasks";
  byStatus: Record<TaskStatusValue, number>;
  total: number;
  doneRatio: number | null;
  /** 未完成且 dueDate 早于北京时间今天。没有日期不算逾期。 */
  overdueCount: number;
  blockedCount: number;
};

export const TASK_ATTENTION_KINDS = ["overdue", "blocked"] as const;
export type TaskAttentionKind = (typeof TASK_ATTENTION_KINDS)[number];

/** C-T09。kind 必传：风险详情按「逾期」或「阻塞」分开列，混在一起页面没法分组。 */
export type TaskAttentionFilters = PageInput & { kind: TaskAttentionKind };

/** 需关注任务条目。字段固定，页面据此渲染并跳回来源。 */
export type TaskAttentionItem = {
  taskId: string;
  title: string;
  dueDate: string | null;
  blockedAt: string | null;
  sourceRef: SourceRef;
};

/* --- AI 迭代草案（P2 / C-AI01、C-AI02） ---
 * 草案由 E 生成并持有存储（E-AI05/E-AI06）；C 只负责预览校验与事务确认。
 * ------------------------------------------------------------------ */

export const ITERATION_DRAFT_STATUSES = [
  "pending",
  "confirmed",
  "cancelled",
  "expired",
] as const;
export type IterationDraftStatus = (typeof ITERATION_DRAFT_STATUSES)[number];

export type IterationDraftCandidateTask = {
  taskId: string;
  /** 生成草案时的任务版本基线，确认时要原样回传。 */
  expectedUpdatedAt: string;
  reason: string;
};

export type IterationDraft = {
  id: string;
  projectId: string;
  createdById: string;
  conversationId: string | null;
  status: IterationDraftStatus;
  revision: number;
  name: string;
  goal: string | null;
  startDate: string;
  endDate: string;
  candidateTasks: IterationDraftCandidateTask[];
  createdAt: string;
  expiresAt: string;
  sourceRefs: SourceRef[];
};

/** C-AI01：草案的校验结果。conflicts 逐条说清哪个任务为什么不能入轮。 */
export type IterationDraftValidation = {
  valid: boolean;
  conflicts: { taskId: string; reason: string }[];
};

export type PreviewIterationDraftResult = {
  draft: IterationDraft;
  validation: IterationDraftValidation;
  /** 各候选任务此刻的真实版本，供确认时回传。 */
  currentTaskVersions: IterationTaskVersion[];
};

/** C-AI02：确认草案。一次事务建 planned 轮 + 归任务 + 标记草案已确认 + 事件。 */
export type ConfirmIterationDraftInput = {
  requestId: string;
  expectedDraftRevision: number;
  expectedTaskVersions: IterationTaskVersion[];
};

export type ConfirmIterationDraftResult = {
  iteration: Iteration;
  taskIds: string[];
  /** 同一草案重放时 true：返回原迭代，不再建第二轮。 */
  replayed: boolean;
};
