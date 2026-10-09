# E / P0 交接：项目动态（通用活动）模块

按《P0—P2 统一接口标准（定稿）》**§9.4**（E-A01 记录活动 / E-A02 活动列表 / E-A03 活动证据）、**§8**（D 事件 sink 的 E 部分）、**§9.6**（概览聚合接入）实现。

日期：2026-10-09　　范围：**只做 P0**。

---

## 1. 能力名称与状态

| 能力 | 契约编号 | 状态 |
|---|---|---|
| 写入一条活动 | §9.4 E-A01 | 服务可调用 |
| 项目活动列表（含覆盖说明） | §9.4 E-A02 | 服务可调用，概览页已接入 |
| 按 id 取活动证据 | §9.4 E-A03 | 服务可调用，**页面尚未接入** |
| 成果 outbox 消费 sink | §8 | 服务可调用，**生产环境暂无人调用，等 F 接 cron** |
| 概览页「我的待办 + 项目动态」 | §9.6 | 已接入 |

- 提供者：E　　使用者：B（概览页）、C（任务/迭代写入点）、D（outbox 产方）、F（通知扩展）
- 源码路径：`src/lib/activity.ts`、`src/lib/deliverable-sink.ts`
- 导入方式：`import { listProjectActivities } from "@/lib/activity";`、`import { handleDeliverableEvent } from "@/lib/deliverable-sink";`

## 2. 本次改动清单

**新增**

| 文件 | 说明 |
|---|---|
| `src/lib/activity.ts` | E-A01/A02/A03 服务 + `computeActivityCoverageFromMin` 纯函数 |
| `src/lib/deliverable-sink.ts` | §8 sink 的 E 部分 + `mapDeliverableEventToActivity` 纯函数 |
| `src/components/activity/activity-feed.tsx` | `ActivityFeed({items, coverage, actorNames?, title?})` |
| `src/components/activity/my-project-todos.tsx` | `MyProjectTodos({items, today, title?})` |
| `drizzle/0008_e_activities_p0.sql` | 建 `project_activities` |
| `drizzle/meta/0008_snapshot.json`、`drizzle/meta/_journal.json` | 迁移快照与日志（**手写，见 §7**） |
| `tests/activity.test.ts`、`tests/activity-events.test.ts`、`tests/deliverable-sink.test.ts` | 已写、**未在本机执行**（无 node_modules / 无库） |

**修改（都要请对应负责人确认）**

| 文件 | 归属 | 改了什么 |
|---|---|---|
| `src/contracts/p0-p2.ts` | 公共 | 附加式新增 `ACTIVITY_OBJECT_TYPES` / `RecordProjectActivityInput` / `ActivityFilters` / `ActivityPage` / `ACTIVITY_EVENT_TYPES` 等。**未改动任何已有字段或已冻结的名字** |
| `src/db/schema.ts` | 公共 | 追加 `projectActivities` 表定义（放在 `iterationEvents` 之后），未动其它表 |
| `src/lib/task-contract.ts` | **C** | `createTaskV1` / `updateTaskV1` / `setTaskBlocked` 三个事务内追加活动；`updateTaskV1` 在改之前多读一次前置快照 |
| `src/lib/iteration.ts` | **C** | `startIteration` / `completeIteration` / `saveIterationRetrospective` 追加活动 |
| `src/lib/project-overview-summary.ts` | **B** | `recentActivities` 由 `pending(...)` 换成 `queryPart(...)`；字段类型 `QueryPart<PageResult<ActivityItem>>` → **`QueryPart<ActivityPage>`** |
| `src/app/(app)/projects/[projectId]/overview/page.tsx` | **B** | 解构出 `recentActivities` 并渲染新板块；新增 `loadMyProjectTodos` |
| `tests/helpers.ts` | 公共 | `TRUNCATE` 列表加入 `project_activities` |
| `tests/project-overview-summary.test.ts` | **B** | E 的状态断言由 `unavailable` 改为 `ready`（E 已交付） |

## 3. 接口签名

```ts
// 仅服务端 · 必须在已有业务事务内调用 · 不做成员校验（调用方事务已授权）
// 幂等：同一 eventKey 重放不会产生第二行，返回已存在的那条
recordProjectActivity(tx: DbTx, event: RecordProjectActivityInput): Promise<ActivityItem>

// §9.1：只读服务省略首参；完整签名首参是 actorId
listProjectActivities(actorId: string, projectId: string, filters?: ActivityFilters): Promise<ActivityPage>
getActivityEvidence(actorId: string, projectId: string, activityId: string): Promise<ActivityItem>

// §8 合并 sink。F 必须在同一个函数里扩展，不得另建第二个 sink
handleDeliverableEvent(event: DeliverableEvent): Promise<void>

// 纯函数，无 IO，便于单测
computeActivityCoverageFromMin(minIso: string | null, fromDate?: string): QueryCoverage
mapDeliverableEventToActivity(event: DeliverableEvent, titles?: DeliverableEventTitles): RecordProjectActivityInput
```

`ActivityFilters = PageInput & { objectType?, objectId?, actorId?, fromDate?, toDate? }`
`ActivityPage = PageResult<ActivityItem> & { coverage: QueryCoverage }`

## 4. 权限与错误

- 读（A02/A03）：`getProjectForUser` 失败一律抛 `NotFoundError("项目不存在或无权访问")`——非本项目成员与不存在的项目**同一句话**，不泄露项目是否存在。口径与同目录 `listProjectIterations` 一致（注意：**不是** `task-contract.ts` 的 `ForbiddenError`）。
- `getActivityEvidence` 另有 `NotFoundError("活动不存在")`：活动 id 不存在、或不属于 `projectId`，同一个错误，不泄露归属。
- 写（A01）：不查权限，由调用方事务里的 `requireTaskWrite` / `requireLockedAccess` 负责。
- 校验失败统一 `ValidationError`（事件类型不在目录、摘要为空、metadata 越白名单、`fromDate >= toDate`）。
- 空数据不是错误：`items: []`、`total: 0`、`nextOffset: null`，不抛异常、不伪造 0 条失败。

## 5. 口径：排序 / 时区 / 分页 / 覆盖说明

- **排序**：`occurred_at DESC, id ASC`（补 id 保证翻页稳定）。
- **occurredAt 来源**：一律取业务行写入后的 DB 时间（`tasks.updated_at`、`iterations.started_at/completed_at`、outbox 行的 `created_at`、`retrospectives.updated_at`），**不用宿主机 `new Date()`**。
- **日期筛选**：北京时间语义，`fromDate` 含、`toDate` 不含；用固定 `+08:00` 字面量换算（中国无夏令时）。`fromDate >= toDate` 直接报错，不返回半个区间。
- **分页**：`normalizePage` / `pageResult`，`limit` 默认 50、上限 100；`nextOffset` 以实际取出条数为准。
- **覆盖说明（coverage）**：`availableFrom` = 库里**真实最早一条活动**的时间，没有记录就是 `null`；`complete` 仅在请求窗口起点不早于 `availableFrom` 时为 true；`note` 固定说明「此前的操作没有回填，不代表没有发生过」。**不用「功能上线日期」冒充，也不用空列表冒充「什么都没发生」。**
- **隐私**：`metadata` 按事件类型走白名单（`src/lib/activity.ts` 的 `METADATA_KEYS`）。任务描述、验收标准、完成说明、迭代目标、复盘正文、评论正文、**阻塞原因原文**都不进活动表（阻塞只存 `blockedReasonLength`）。活动摘要里只用任务/迭代/成果的**标题**。
- **深链接**：`sourceRef.sourceHref` 恒为 `null`。定稿 §9.1 没有为活动定义深链接 URL 参数，不自行发明；把活动映射到底层对象的固定路由是 E-V01（P2）的事。`sourceRef.evidenceKey` = `activity:{id}`。

## 6. 写入的幂等、并发与事件规则

- 活动**只追加**，不 update、不 delete。
- 与业务操作**同事务**：业务回滚，活动一并消失。
- **幂等三重保障**：
  1. 任务/迭代写操作本身走 `runIdempotent`，`run` 只在首次请求执行，重放直接吐回缓存结果；
  2. `project_activities.event_key` 唯一索引；
  3. `recordProjectActivity` 用 `onConflictDoNothing(...).returning()`，冲突时回查并返回已存在的那条。
- **一次修改可产生不同 type、各最多一条**：例如 `{status: "done", assigneeId: X}` 产出 `task.completed` + `task.assigned`。除状态/负责人之外的字段变化**合并成一条** `task.updated`，变了的字段名放在 `metadata.changedFields`（拆成多条会撞同一个事件键）。
- 事件键格式：`{type}:{taskId}:{写入后的 updatedAt}`；创建是 `task.created:{taskId}`；迭代是 `iteration.started:{iterationId}` / `iteration.completed:{iterationId}`；复盘是 `retrospective.saved:{retrospectiveId}:{revision}`。

## 7. ⚠️ 数据库迁移（唯一无法自我验证的产物）

- `drizzle/0008_e_activities_p0.sql`、`drizzle/meta/0008_snapshot.json`、`drizzle/meta/_journal.json`（`idx: 8`，tag `0008_e_activities_p0`）**均为手写**，照 `0007` 镜像生成。
  - 快照 `id` = `e388c8bc-1799-490c-a34d-1489be16e9e2`，`prevId` = `7cde4caf-142e-43e9-9669-a6542627b281`（0007 的 id）。
- **不新增枚举、不改动任何已有表，纯增量。**
- 表结构要点：`actor_id` / `object_id` **刻意不设外键**（前者同 `deliverable_outbox.actor_id` 的惯例：删用户不该抹掉历史；后者是多态引用）。`project_id` 有外键、`ON DELETE cascade`。**刻意不加 `seq`**：§9.4 固定按 `occurredAt desc + id` 排序，uuid 主键已能稳定翻页。
- **已复核通过**：`npm run db:generate` 返回 `No schema changes, nothing to migrate`，手写快照与 drizzle-kit 的推导一致（见 §12）。

## 8. 可复制的调用例子

```ts
// 1) 在已有业务事务内写一条活动（C 的写入点就是这么接的）
await db.transaction(async (tx) => {
  await tx.update(tasks).set({ status: "done", updatedAt: sql`now()` }).where(eq(tasks.id, taskId));
  const [row] = await tx.select().from(tasks).where(eq(tasks.id, taskId));
  await recordProjectActivity(tx, {
    eventKey: `task.completed:${taskId}:${row.updatedAt.toISOString()}`,
    projectId, actorId,
    objectType: "task", objectId: taskId,
    type: "task.completed",
    summary: `完成了任务《${row.title}》`,
    occurredAt: row.updatedAt.toISOString(),
    metadata: { taskId, fromStatus: "doing" },
  });
});

// 2) 读项目动态
const page = await listProjectActivities(actorId, projectId, { limit: 10 });
if (page.items.length === 0) showEmpty(page.coverage.note); // 空 ≠ 没发生过，要带上 coverage.note

// 3) 页面里渲染（服务端组件）
<ActivityFeed items={page.items} coverage={page.coverage} actorNames={actorNames} />

// 4) 消费成果事件（F 接 cron 时这样调，不要在别处再写一个 sink）
const result = await dispatchDeliverableEvents(handleDeliverableEvent);
```

## 9. 事件目录接入情况

**已接入（C 的事务内）**

| 事件 | 入口 |
|---|---|
| `task.created` | `createTaskV1` |
| `task.completed` / `task.reopened` | `updateTaskV1`（仅 非done→done / done→非done） |
| `task.assigned` | `updateTaskV1`（assigneeId 真的变了） |
| `task.updated` | `updateTaskV1`（标题/描述/验收标准/起止日期/里程碑/优先级/完成说明；todo↔doing 也归这里，因为没有 `task.status_changed` 这个 type） |
| `task.blocked` / `task.unblocked` | `setTaskBlocked` |
| `iteration.started` | `startIteration` |
| `iteration.completed` | `completeIteration`（metadata 带 `historyId` 与当时的主任务统计） |
| `retrospective.saved` | `saveIterationRetrospective`（`objectType` 用 `iteration`——`ActivityItem.objectType` 没有 retrospective 这一档） |

**由 D 的事件映射而来（`deliverable-sink.ts`）**：`deliverable.submitted`、`deliverable.approved`、`deliverable.changes_requested`、`milestone.feedback`、`feedback.task_created`。

**明确没有写活动的地方（如实列出，不声称全覆盖）**

1. **`iteration.created`**：事件目录里没有这个 type，不硬造。`createIteration` 不产生活动。
2. **`task.deleted`**：同上，目录里没有，`deleteTaskV1` 不产生活动。
3. **`comment.*`**：E-C01 属 **P1**，`src/lib/comment.ts` 目前不存在。
4. **`announcement.*`**：F 的 §9.8 模块，由 F 在自己的发布/撤下事务里调 `recordProjectActivity`。
5. **经旧 `updateTask` 的任务变更不产生活动**——看板拖拽、Agent API、`plan_sprint` 走的就是这条（`task.ts` 里的 `opts.tx` 分支）。**这是真实的覆盖缺口。**
   要补，只能由 **C** 把那些调用点收敛到 V1，或在旧 `updateTask` 里补同样的记录逻辑。测试 `tests/activity-events.test.ts` 的「已知的覆盖缺口」一节把这个现状固定下来了。

## 10. 与 F 共用 sink 的约定（§8）

- 定稿 §8 明令**只允许一个 sink**，E/F 共用。F 落地通知时**必须扩展 `handleDeliverableEvent`**，在标注的位置（`deliverable-sink.ts` 里那句 `// F 扩展点`）往下写通知意图，与活动同一事务；**不要另建第二个 dispatcher**，否则同一事件会被投递两次。
- 投递语义是 **at-least-once**：sink 成功、`deliveredAt` 未落库前崩溃会重投。活动的去重靠「直接复用 outbox 的 `eventKey` 作为活动事件键」，重投撞唯一索引、不产生第二条。
- sink **自己开一个事务**（签名没有 `tx`）。抛异常只回滚它自己的写入，outbox 行的 `deliveredAt` 保持为空等待重投；**绝不能在 sink 里吞异常**，吞了就等于把事件丢了。
- `dispatchDeliverableEvents` 目前**生产环境无人调用**，只在测试里调用。所以**成果类动态在 F 接上 cron 之前不会出现在页面上**——这是既有事实，不是本次引入的缺陷。任务/迭代动态不受影响（它们在业务事务里直接写入）。
- 未登记的 event type 会让 sink 抛错、事件留在 outbox 里等人处理——宁可卡住也不静默丢。将来 D 加新事件类型时，需要在 `mapDeliverableEventToActivity` 与 `METADATA_KEYS` 两处登记。

## 11. 需要他人确认的改动

- **C**：`src/lib/task-contract.ts`、`src/lib/iteration.ts` 各在事务内多了一次插入 / 一次前置读。`updateTaskV1` 多了一次「改之前」的普通 SELECT（不加行锁；乐观锁仍在 `updateTask` 里），并把原来的 `return { task: await summaryById(...) }` 拆成先取 `task` 再记录。请确认这三点不与你后续的改动冲突。
- **B**：`recentActivities` 的类型由 `QueryPart<PageResult<ActivityItem>>` 放宽为 **`QueryPart<ActivityPage>`**（§9.6 要求字段是「对应服务结果」，不能悄悄丢掉 `coverage`）；概览页新增了 `loadMyProjectTodos` 与一个两列板块；`tests/project-overview-summary.test.ts` 里 E 的断言由 `unavailable` 改为 `ready`。另外 `docs/b-p0-completion.md` 里「E 服务目前没有代码」的表述已过期。
- **D**：`handleDeliverableEvent` 复用了 outbox 的 `eventKey` 作为活动事件键，并会**读** `deliverables` / `milestones` / `tasks` 的标题用于摘要。`deliverable-events.ts` 本身**未改动**。
- **F**：见 §10。

## 12. 验证情况

### 已实测通过（Node.js v24.21.0）

| 检查 | 命令 | 结果 |
|---|---|---|
| 类型检查 | `npx tsc --noEmit` | **0 error** |
| Lint | `npm run lint` | **0 error**（唯一 warning 在 `tests/agent-api.test.ts`，仓库原有，与本次无关） |
| 迁移快照 | `npm run db:generate` | `No schema changes, nothing to migrate` —— **手写的 0008 与 drizzle-kit 按 `schema.ts` 的推导完全一致** |
| 纯函数测试 | `npx vitest run tests/activity.test.ts tests/deliverable-sink.test.ts -t "computeActivityCoverageFromMin\|mapDeliverableEventToActivity"` | **8 passed** |

纯函数那 8 项覆盖的正是最容易出错的逻辑：coverage 诚实口径、事件映射、标题兜底、未登记类型拒绝、payload 缺键报错。

### 尚未执行（缺 PostgreSQL）

21 项依赖数据库的测试与页面实测都需要 PostgreSQL 16。装好并建出 `agilecampus_test` 库后：

```bash
npm install
# .env.test 指向测试库：
# DATABASE_URL=postgres://agilecampus:agilecampus_dev@localhost:5432/agilecampus_test
npm run db:push:test
npm test                       # 关注 activity / activity-events / deliverable-sink 三个文件
npm run dev                    # 打开 /projects/{id}/overview
```

手工验收点：
1. 任务看板改一个任务状态 → 概览页「项目动态」出现一条；
2. 重复提交同一请求（同 `requestId`）→ 不重复出现；
3. 非本项目成员打开概览 → 404；
4. 活动为空时显示空态与覆盖说明，而不是 0 条或报错；
5. 「我的待办」只显示当前项目、点击跳到对应任务；
6. 阻塞任务时，动态里**看不到阻塞原因原文**。

## 13. 未完成项与下一步

**本次范围外（属 E 的后续 P1/P2，未实现）**
- E-C01 评论（`comment.*` 事件、@ 提及）
- E-R01 规则周报、E-V01 统一证据与 Markdown 导出、E-K01 风险、E-AI（P2）
- `getActivityEvidence`（E-A03）服务已可用，但**没有页面接入**
- 活动到的深链接（`sourceHref`）仍是 `null`

**接入方下一步**
- **F**：接 cron 调 `dispatchDeliverableEvents(handleDeliverableEvent)`；在同一个 sink 里补通知意图；实现 `announcement.*` 时调用 `recordProjectActivity`。
- **C**：决定是否把看板拖拽 / Agent API / `plan_sprint` 收敛到 V1，以补上覆盖缺口。
- **B**：标题统一用「项目动态」（组件默认值、页面 `QueryUnavailable` 标题、聚合层 `queryPart` 的 label 三处已一致），不再叫「团队动态」；如需要可为 E-A03 增加活动详情入口。
