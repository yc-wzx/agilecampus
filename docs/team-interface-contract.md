# 唯笃队 AgileCampus：P0—P2 统一接口标准（定稿）

版本：v2.0，2026-10-07。状态：接口标准已定稿，按此实施。适用对象：A—F 六位成员及各自的 AI。范围：原六人任务书中 P0、P1、P2 的全部任务接口与交付约定。

这是原六人任务书的统一接口标准。大家进度可以不同，但对外提供的名称、导入路径、参数、返回字段、状态和业务口径必须按本文件实现。负责人D已确定公共标准，各成员完成自己模块的实现与接入，无须再逐对商量一套不同接口。第4—8节列已有接口；第9节固定新增契约；第13节覆盖原规划32项功能。

**执行原则：调用方按标准写，提供方按标准交付；已有代码有差异，由提供方在内部做适配。** 本文件的“待实现”仅表示代码进度，不表示接口可以自行改名。

## 1. 先确定代码基线和实际状态

团队协作仓库：[yc-wzx/agilecampus](https://github.com/yc-wzx/agilecampus)。老师的 sdiver/agilecampus 是原始参考仓库。

原定稿核对基线为 PR #1/#2 后的 `edfe765`；当前实现基线更新为 P0–P2 补齐 PR #10 后的 `7041e9a`，本轮另接入五项 P3。以后拉取最新 master，并在交接中写出实际提交号；本文件的核对状态不自动代表后续提交状态。

| 标记 | 含义 |
|---|---|
| 【已有】 | 在本次基线中有真实代码，可以按源码接入 |
| 【待接入】 | 服务已有，使用方页面、消费者或整条链路还缺接入 |
| 【待实现】 | 接口名称、路径和契约已经固定，提供方仍需实现；调用方可按固定类型开发，但不能冒充真实服务已可用 |
| 【P3 接入】 | 本轮五项扩展已接入，新增接口见第 14 节；其他候选不据此视为完成 |

当前核对更新至 2026-10-10：PR #10 已补齐原 P0–P2 的评论/@、公告、站内到期规则与外部重试、周报、风险、统一过程证据、教师总览、完整 AI 草案管理及部署恢复代码，保留此前 A/B/C/D/E/F 已合并模块。服务器尚未购买，真实试用、真实飞书／AI 与目标服务器验收仍待实际条件。存在代码不代表真实条件已验收；固定 P0–P2 接口、32 项规划及职责保持不变。最新逐条结果见 README、team-progress-20261009.md 与 p0-p2-completion.md。

【P3 接入】本轮已整合模板、会议资料、日历、负责人交接和正式成果版本对比，接口补充在第 14 节；无需更改现有 P0–P2 调用方。说明见 [P3 接入文档](p3-project-extensions.md)。

## 2. 每个人对接口负责什么

接口就是两个模块交换数据的约定。例如 D 提供“老师退回报告的意见”，A 把它显示在“我的待修改成果”里，B 提供修改和重交按钮。

| 成员 | 自己交付的东西 | 必须接入的上下游 |
|---|---|---|
| A | 学生工作台、全局导航、教师总览页面 | C 的任务/当前迭代；D 的待修改成果/教师成果统计；E 的活动/风险；F 的未读数 |
| B | 项目概览、成果提交/审核/重交页面、证据页面、共用展示组件 | C 的任务/迭代统计；D 的成果和反馈服务；E 的活动/证据；F 的公告组件 |
| C | 任务/迭代服务、任务池、任务详情侧边栏；协调数据库结构与迁移 | 保持 D 复用的任务服务兼容；任务详情接 D 的来源反馈、E 的讨论；向 A/B/E 提供查询 |
| D（负责人） | 成果、版本、反馈、验收权限和统计服务；公共接口协调和整组合并检查 | 复用 C 的任务写入；向 A/B/E 提供成果数据，向 E/F 交付事件 |
| E | 评论、活动、复盘/周报、证据汇总和 AI 读取 | 接 C 的任务/迭代及 D 的正式证据/事件；向 A/B 提供展示数据，向 F 交付 @ 等通知需求 |
| F | 站内通知、公告、外部提醒；运行说明、服务器部署、备份恢复 | 接 D/E/C 的通知来源；向 A 提供未读数，向 B 提供公告组件；和 C 对齐迁移 |

服务提供者负责服务代码、类型、权限、迁移和示例；使用者负责自己页面的实际调用、刷新、空数据、失败提示和跳转。负责人核对冲突和完整流程。部署仍由 F 主负责，D 协调，C 核对数据库升级。

## 3. 所有模块共同遵守的约定

### 3.0 定稿后不各改一套

1. 本文件规定的跨模块函数名、路径、参数和DTO字段就是统一标准。第9节省写actorId的规则仅用于排版，实际服务端签名按第9节说明。
2. 服务提供方不得要求别的成员“为了接我的代码改字段名”。内部已有sprintId、content、其他数据格式时，自己映射为契约中的iterationId、body和固定DTO。
3. 新业务Action统一对象参数与Result返回；原有FormData/Agent API保留兼容，通过第3.4节的固定适配入口给新页面使用，不去逐个重写旧调用方。
4. 所有成员使用同一份公共类型。字段缺失是提供方的实现问题，不能让消费方新增猜字段的兼容代码。接口未就绪用同类型开发样例，并标清状态。
5. 对外字段只允许增加可选字段；不删除或改名现有字段、不新增必填参数、不改变状态/日期/计数含义。P0—P2范围内按本版实现。
6. 实现确需破坏性变化时，另建v2入口保留本版，不直接改坏v1。内部重构、SQL和表名调整无需调用方跟着改。普通需求扩展按可选字段处理。
7. 合并检查以“是否符合统一标准、实际链路是否通过”为准，不把不符合的接口先合入master再由负责人兜底适配。

### 3.1 沿用现有调用方式

- 服务端页面可以调用 `src/lib` 的业务服务，先通过 `auth()` 取得登录用户。
- 浏览器交互调用带 `"use server"` 的 Server Action，由 Action 读取会话。浏览器不导入数据库服务，不把前端传来的 `actorId` 当身份。
- 复用已有任务、项目、成果服务。站内功能不需要为每个函数再建一个 HTTP API。
- 已有 Agent API 属于原项目独立能力，保持兼容，不作为普通网页调用的必经层。

### 3.2 数据和权限

| 项目 | 约定 |
|---|---|
| ID | 现有实体 ID 为 UUID；项目名、成员名只用于展示，不用于关联 |
| 权限 | 当前团队角色为 `admin / teacher / student`；按项目所属团队的当前成员资格校验，没有另建项目成员模型 |
| 日期 | 任务日期为 `YYYY-MM-DD`；事件时间展示统一用北京时间。新跨模块 DTO 的时间用 ISO 字符串；已有服务的 Date 不强行重写 |
| 空值 | 未指定负责人/日期等按现有类型传 `null` 或省略；不要拿空字符串冒充 UUID。D 草稿 URL 可为 `""` |
| 分页 | D 分页为 `{items,total,offset,limit,nextOffset}`，默认 limit=50，允许 1—100；不要把分页当前项数当总数 |
| 内容 | 标题、反馈和说明按普通文本展示；不直接拼成 HTML |
| 数据归属 | C 维护任务/迭代，D 维护成果/反馈，E 维护评论/活动，F 维护通知/公告；不绕过所属业务服务直接修改状态 |

教师可读有权限的项目、审核别人的正式成果和写里程碑反馈；现有任务服务中教师不写任务，也不替学生改报告。管理员有相应管理权限。学生只能按服务规则编辑自己的成果，不能审核。项目负责人这个名称本身不新增管理员权限。

### 3.3 返回值必须按实际接口处理

D 的 Action 使用以下格式，所有P0—P2新增或标准适配Action必须使用相同格式；原旧接口保留原返回值供旧调用方使用：

```ts
type Result<T> =
  | { ok: true; data: T }
  | { ok: false; code: "UNAUTHENTICATED" | "FORBIDDEN" | "VALIDATION" | "CONFLICT" | "INTERNAL"; error: string };
```

现有任务 Action 有不同返回值：创建/拖动成功返回 `null`，失败返回 `{error}`；编辑成功返回 `{ok:true}`。不能把旧接口的 `null` 成功误判为失败，也不能假设所有接口都有 `data`。

| 情况 | 使用者怎么处理 |
|---|---|
| 成功且列表为空 | 显示“暂无……” |
| 接口未实现 | 开发阶段标明“待接入”；展示验收不能拿样例充当真实数据 |
| 请求/服务失败 | 显示失败和重试入口，不转换成空数组或数字 0 |
| 未登录/无权限 | 登录提示或拒绝访问，不能泄露其他团队数据 |
| 并发冲突 | 保留输入，刷新最新状态，让用户重新确认；不自动覆盖或重新审核 |
| 写入结果不确定 | 提示先刷新确认；支持幂等的操作重试复用原 requestId |

保存后要验证所有消费页面刷新：例如提交成果后，成果详情和概览统计更新；回到工作台也应重新查询。各页面作者负责接入刷新，不能只验证自己弹出了成功提示。

### 3.4 任务旧接口的固定适配入口【待实现，C负责】

现有任务Action有FormData和null成功返回。新页面统一调用下面的对象式入口；C内部复用同一套task业务，不复制CRUD。旧看板/旧Agent API保留原入口和字段，不被新规范破坏。

固定导入路径：`@/app/(app)/projects/[projectId]/tasks/actions`。

| 标准Action | 固定输入 | 成功data |
|---|---|---|
| `createTaskV1Action(projectId,input)` | `{requestId,title,description?,assigneeId?,startDate?,dueDate?,milestoneId?,priority?,parentTaskId?,acceptanceCriteria?}` | `{task:TaskSummary}` |
| `updateTaskV1Action(projectId,taskId,input)` | `{requestId,expectedUpdatedAt,patch:{title?,description?,assigneeId?,startDate?,dueDate?,milestoneId?,status?,priority?,completionNote?,acceptanceCriteria?}}` | `{task:TaskSummary}` |
| `deleteTaskV1Action(projectId,taskId,input)` | `{requestId,expectedUpdatedAt}` | `{taskId,deleted:true}` |

标题1—200字；描述、验收标准、完成说明最多10000字；日期YYYY-MM-DD并校验开始≤截止。新增可选负责人、日期、里程碑清空时patch传null；status仅todo/doing/done。expectedUpdatedAt用详情返回的ISO时间，不在浏览器重新生成。任务所属项目不允许通过patch修改，其他额外字段拒绝。新入口必须实现服务端幂等和事务内版本检查，失败按第3.3节Result返回。

标签和依赖继续走原有统一服务。迭代归属/阻塞必须走第9.2节专用入口，不能夹在通用patch里绕过规则。

## 4. 【已有】任务、项目与工作台接口

下表是服务端函数。`actorId` 必须由服务端会话取得，函数可能抛异常；它们不直接返回上一节的 Action 包装。

| 源文件 | 调用 | 返回/用途 | 使用者 |
|---|---|---|---|
| `src/lib/dashboard.ts` | `getMyOpenTasks(actorId)` | 当前仍有成员资格、活跃项目中，指派给本人的未完成任务数组，包括已指派子任务 | A |
| 同上 | `groupMyTasks(items, today)` | 逾期/今天/未来7天/其余四组；today 使用 `todayInShanghai()` | A |
| `src/lib/project.ts` | `getProjectForUser(actorId, projectId)` | `{project,role}` 或 null；判断项目访问权 | A/B/C/E/F |
| 同上 | `getProjectDetail(actorId, projectId)` | `{project,role,milestones,taskTotal,byStatus}` | B，A 教师页 |
| 同上 | `listProjectMilestones(actorId, projectId)` | 有权限项目的里程碑 | B/C/D/E |
| `src/lib/task.ts` | `listProjectTasks(actorId, projectId)` | 现有项目任务列表；具体字段按函数类型读取 | C，A/B/E |
| 同上 | `getTaskDetail(actorId, taskId)` | 现有任务详情聚合 | C |
| 同上 | `createTask(actorId, projectId, input, opts?)` | 新任务；支持 `opts.tx` 参加业务事务 | C，D 反馈转任务 |
| 同上 | `updateTask(actorId, taskId, patch, opts?)` | 更新后的任务，服务端检查权限和归属 | C |

现有任务状态为 `todo / doing / done`，优先级为 `low / medium / high`；目前没有已合并的独立迭代模型或四列任务验收状态。D 成果状态与任务状态是两件事。

`getProjectDetail().taskTotal` 按现有实现包含子任务；A 的待办也包含已指派子任务。B 展示时说明口径，不能和“仅主任务”统计混用。

任务网页 Action 位于 `src/app/(app)/projects/[projectId]/actions.ts`：`createTaskAction(previousState, FormData)`、`updateTaskAction(previousState, FormData)`、`moveTaskAction({taskId,projectId,patch})`。复用现有表单字段和返回值。

C 如需扩展任务服务，须保留 D 使用的 `createTask(..., {tx})`，避免反馈已保存而任务未保存；沿用负责人属于团队、里程碑属于项目的校验。

项目准备和成员选择复用已有服务：`createTeam(userId,name)`、`joinTeam(userId,inviteCode)`、`getTeamMembership(userId,teamId)`、`updateMemberRole(actorId,teamId,targetUserId,role)` 位于 team.ts；建团队/加入网页复用现有teams/actions。项目的 `createProject(actorId,teamId,{name,description?,startDate?,endDate?})`、`updateProject(actorId,projectId,{name?,description?,startDate?,endDate?,status?})`、`listTeamProjects(actorId,teamId)`、`listMyProjects(actorId)` 位于 project.ts，建/改/归档仅admin。里程碑创建 `createMilestone(actorId,projectId,{title,targetDate?})` 和网页 createMilestoneAction 仅admin。这些是原项目能力，不再复制一套；本地P3模板参数不属于本次master基线。

## 5. 【已有 / 待接入】D → B：成果提交、审核和重交

网页导入路径：`@/app/(app)/projects/[projectId]/deliverables/actions`。

| Action | 参数 | 成功 data | 页面状态 |
|---|---|---|---|
| `listDeliverablesAction` | projectId | 有权可见的成果数组，包含 allowedActions | B P0 已接 |
| `getDeliverableAction` | projectId, deliverableId | `{deliverable,versions,feedback}` | B P0 已接 |
| `createDeliverableDraftAction` | projectId, input | 新草稿成果 | B P0 已接 |
| `updateDeliverableDraftAction` | projectId, deliverableId, input | 更新后的成果及 revision | B P0 已接 |
| `submitDeliverableAction` | projectId, deliverableId, `{requestId,expectedRevision}` | `{deliverable,versionId,replayed}`；版本正文再查详情 | 初版提交已接；重交流程待接 |
| `startDeliverableRevisionAction` | projectId, deliverableId, `{requestId,expectedRevision}` | 带 workingCopy 和新 revision 的成果 | 待接 |
| `reviewDeliverableAction` | projectId, deliverableId, `{requestId,versionId,decision,comment?}` | `{deliverable,feedback,replayed}` | 待接 |
| `addMilestoneFeedbackAction` | projectId, milestoneId, `{requestId,comment}` | `{feedback,replayed}` | 待接 |
| `listProjectFeedbackAction` | projectId | 正式成果和里程碑反馈数组 | 待接 |

创建 input：`title,type,url?,description?,milestoneId?,requestId`。修改 input：同样的五个内容字段，加 `expectedRevision`，不传创建 requestId。

- `title` 去空白后 1—200 字；`description` 最多 10000 字。
- `type` 为 `report/presentation/video/survey/code/prototype/demo/other`，页面展示中文。
- `url` 最多 2048 字，必须为完整 HTTP/HTTPS 链接且不含账号密码；初版草稿可空，正式提交不可空。
- `milestoneId` 可为 null；有值必须属于当前项目。
- 创建/提交/审核/开始修改的 requestId 是一次操作的稳定 UUID；同一次请求重试沿用。内容改变后视作新操作，使用新 requestId。
- 更新和提交使用最新 `deliverable.revision`。`revision` 是并发检查数字，`versionNumber` 是正式提交次数，两者不同。
- 不要把整个 deliverable 展开成 input。D 严格拒绝额外字段，例如 `authorId/status/allowedActions`。

### B 实现审核/重交时的顺序

1. 查询详情，根据 `allowedActions.edit/submit/startRevision/review` 显示操作；服务端仍会再次检查权限。
2. 教师审核传当前正式 `versionId`。decision 只能是 `approved` 或 `changes_requested`；退回必须写意见，最多10000字。
3. 作者点击“开始修改”，调用 startRevision；编辑表单优先读取 `workingCopy`，没有时读取初版草稿字段。
4. 保存草稿使用最新 revision；用户明确点击“提交新版本”时才生成新的正式版本。
5. 反馈按 `versionId` 归到对应版本。旧版内容和旧意见保留，不能合并成一段“最新意见”覆盖历史。

状态链：`draft → submitted → approved / changes_requested`。已通过或需修改成果开始新草稿时，对其他成员仍显示上一版正式状态；正式重交后才回到 submitted。

初版私有草稿和新版 workingCopy 不能暴露给其他学生或教师；管理员按服务权限可见。完成修改任务不自动批准成果，通知已读也不消除待修改事项。

### 调用示例：保存后再正式提交

```ts
import { createDeliverableDraftAction, submitDeliverableAction }
  from "@/app/(app)/projects/[projectId]/deliverables/actions";

// projectId 为真实有权项目；这两个 key 在本次操作及其重试期间保持不变。
const created = await createDeliverableDraftAction(projectId, {
  title: "开题报告", type: "presentation", url: "https://example.com/report",
  description: "开题汇报材料", milestoneId: null, requestId: createRequestId,
});
if (!created.ok) { /* 显示 created.error，保留输入 */ return; }
// 实际页面保存后先显示草稿；以下调用由用户点击“正式提交”触发。
const submitted = await submitDeliverableAction(projectId, created.data.id, {
  requestId: submitRequestId, expectedRevision: created.data.revision,
});
if (!submitted.ok) { /* 显示 submitted.error，刷新确认 */ return; }
// 成功后刷新详情和相关统计，勿把示例网址作为验收材料。
```

## 6. 【已有 / 待接入】D ↔ B/C：反馈转修改任务

同一成果 Action 文件中：

| Action | 参数 | data |
|---|---|---|
| `createTaskFromFeedbackAction` | projectId, feedbackId, `{requestId,title,description?,assigneeId?,dueDate?,priority?}` | `{feedbackId,taskId,originalTaskId,replayed,deleted}` |
| `getFeedbackTaskLinkAction` | projectId, feedbackId | 关联信息或 null |
| `listTaskFeedbackAction` | projectId, taskId | 当前任务的来源反馈 |

B 先显示确认表单，让学生/admin 确认任务标题、负责人、截止日，再调用创建；查看反馈本身不创建任务。C 在任务详情接来源反馈和反向跳转，继续使用同一套任务服务。

同一反馈最多关联一个修改任务，重复操作返回已有任务。若任务已删除，返回 `deleted:true,taskId:null,originalTaskId`，显示“原修改任务已删除”，不自动补建第二个。额外任务走普通创建流程。

## 7. 【已有 / 待接入】D → A/B/E：统计和可追溯证据

| Action | 输入 | 使用者 |
|---|---|---|
| `getProjectDeliverableStatsAction` | projectId | B 概览已接；其他页面可复用 |
| `listMyRevisionRequiredDeliverablesAction` | `{projectId?,offset?,limit?,includeArchived?}`，可省略 | A 工作台待接 |
| `listTeacherDeliverableStatsAction` | `{offset?,limit?,includeArchived?}`，可省略 | A 教师总览待接，B 共用卡片 |
| `listDeliverableEvidenceAction` | projectId, `{offset?,limit?,kind?,authorId?,actorId?,milestoneId?,type?,fromDate?,toDate?}` | E 证据/周报，B 证据页面待接 |

服务端可直接调用 `src/lib/deliverable-reporting.ts` 中同名去掉 Action 的函数，并在第一参数传会话用户 ID。

项目成果统计格式：

```ts
{
  projectId, projectStatus,
  byStatus: { submitted: 1, changes_requested: 1, approved: 1 },
  total: 3,
  approvedRatio: 1 / 3,
  scope: "current-submitted-deliverables"
}
```

只统计当前正式成果，不含初版草稿，不重复计算历史版本。没有正式成果时 approvedRatio 为 null，显示“暂无正式提交”，不显示100%。成果通过率、任务完成率和成员贡献不是同一个数字，不能据此生成评分排名。

教师列表只返回当前在所属团队为 teacher/admin 的项目；默认不包含归档项目。外层 total 是项目数，`items[i].total` 是该项目成果数。

本人待修改成果返回分页对象，项内有 `id/projectId/projectName/title/versionId/versionNumber/feedbackId/comment/reviewedAt/hasWorkingCopy/canRevise/sourceHref` 等。A 展示退回意见和成果入口，不自行根据通知标题猜测需修改状态。

证据 kind 为 `submission / review / milestone_feedback`；每项包含稳定 `evidenceKey`、对象/版本 ID、行为时间和 `sourceHref`，不会返回私有草稿。日期区间按北京时间，fromDate 包含、toDate 不包含；例如统计10月7日用 `fromDate:"2026-10-07",toDate:"2026-10-08"`。

证据来源路由【已有】：`GET /api/projects/{projectId}/deliverable-evidence/{kind}/{recordId}`，路由 kind 为 `submission / feedback`，与列表的三个 kind 不同，应直接使用 sourceHref。该路由成功为 `{data:record}`；错误有 code/error 和 HTTP 401/403/400/500，要求登录和当前成员资格。它不是匿名公开分享链接。

E 的周报/AI 若引用成果，只使用正式证据和真实统计，保留 evidenceKey/sourceHref；没有来源的数据不得编造成已完成成果。

## 8. 【已有 / 待接入】D → E/F：事件交付

入口：`src/lib/deliverable-events.ts` 的 `dispatchDeliverableEvents(sink, limit=50)`，仅服务端调用。D 在业务事务中写入事件；E/F 共同接消费者，由 F 接入服务器的受控定时执行方式。

事件字段以 `DeliverableEvent` 类型为准：`id,eventKey,projectId,actorId,type,payload,recipientIds,createdAt,deliveredAt`。payload 只含必要对象 ID，不是成果正文。

| type | 稳定 eventKey | 默认接收人 |
|---|---|---|
| `deliverable.submitted` | `deliverable.submitted:{versionId}` | 教师/admin，排除操作者 |
| `deliverable.approved` / `deliverable.changes_requested` | `deliverable.reviewed:{feedbackId}` | 仍有团队资格的作者，排除操作者 |
| `milestone.feedback` | `milestone.feedback:{feedbackId}` | 有权团队成员，排除操作者 |
| `feedback.task_created` | `feedback.task_created:{feedbackId}` | 修改任务负责人，排除操作者 |

不要让 E 和 F 各自单独调 dispatcher 抢同一条事件：第一次成功会将它标为已交付，另一个可能收不到。使用一个组合 sink，在一笔消费者事务内保存 E 的活动和 F 的站内通知意图，再返回成功。

- 用 eventKey 对活动去重；站内通知按 eventKey+recipientId 去重。
- 同一事件可能重复送达，因此重放不能产生第二条活动/通知。
- 处理失败应抛出异常，事件保留供重试；不能吞异常后让 dispatcher 认为已成功。
- D 在分发时会重新过滤已退组收件人；读取通知/活动时使用方仍须检查当前访问权。
- 飞书等外部发送在消费者事务提交后执行，单独记录失败和重试，不阻塞成果保存或回滚成果审核。
- 不在 sink 中直接调用耗时的外部发送；不将 dispatcher 暴露为任意用户可调用的 Action。

当前 `deliveredAt` 只能说明 sink 已完成持久化交付，不代表飞书实际发送成功；有 outbox 不等于已完成通知功能。

## 9. 【固定契约，部分待实现】P0—P2 其余完整接口

**这一节的名称、路径、输入和返回已经定稿。** 部分代码尚未实现，提供者必须按此补齐；已写同等内部服务时保留内部实现，增加固定入口进行映射，不让调用方跟着内部格式改。后续交接只更新实现提交和完成状态，不重写接口契约。第4—8节的已有接口原样保留。

只读服务统一省写第一参数 `actorId`：例如表内 `getCurrentIteration(projectId)` 的完整服务签名是 `getCurrentIteration(actorId, projectId)`。actorId取服务端会话。新Action表内不带actorId，由Action内部读取。Action成功data如表列，外层使用第3节Result；服务函数抛业务错误，由Action包装。record/dispatch/scan等内部事务与调度函数按其明确签名，不自动套actorId。

### 9.1 公共类型、写入和路径规则

公共类型固定导出位置为 `src/contracts/p0-p2.ts`，导入路径为 `@/contracts/p0-p2`；C负责创建文件，各模块作者负责自己DTO，D检查符合本标准。文件只含类型/常量，不导入数据库、认证或服务代码，浏览器可安全import type。依赖未实现时也可先交公共类型，调用方不必等完整服务。公共类型建好后，不在各页面重新声明同名类型。

| 类型 | 字段与限制 |
|---|---|
| PageInput | `{offset?:number,limit?:number}`；offset≥0，limit为1—100，默认50，最大offset按D约定100000 |
| PageResult<T> | `{items:T[],total:number,offset:number,limit:number,nextOffset:number|null}`；排序补唯一ID以免翻页不稳定 |
| QueryPart<T> | `{state:"ready",data:T}`或`{state:"unavailable",code:ErrorCode,message:string}`；聚合中每个独立数据源固定使用此类型，不额外包Result |
| NewWriteMeta | `{requestId:string,expectedRevision?:number}`；UUID请求标识；新实体可编辑时增加 revision，从1开始，变更后增加；修改/删除/流转必传最新 expectedRevision，创建不传 |
| SourceRef | `{sourceKind,sourceId,projectId,sourceHref:string|null,evidenceKey,availability:"available"|"deleted"|"unavailable"}`；sourceKind为`task/iteration/activity/comment/deliverable/feedback/retrospective/announcement`，其余ID为UUID、evidenceKey为稳定字符串；不可访问/已删除时sourceHref=null |
| DateRange | `{fromDate:string,toDate:string}`，北京时间起始日包含、结束日不包含，fromDate<toDate；统计/导出使用相同区间 |
| QueryCoverage | `{availableFrom:string|null,complete:boolean,note:string|null}`；说明事件从何时开始可信，无历史不编造 |

新变更中使用 requestId 的操作都应保存服务端幂等凭据；相同标识与内容重放返回原操作结果，相同标识配不同内容返回 CONFLICT。新实体修改、删除和流转再校验 expectedRevision。旧任务已有 `updatedAt` 字段，但普通任务 Action 目前未提供完整的并发版本校验；C新增的 expectedUpdatedAt 必须在事务内锁定任务/条件更新时验证，不能只查一次时间后无条件覆盖，也不凭文档假设已有任务 revision。

#### 固定导入路径与归属

以下所有新增文件都是标准实施入口；尚未创建不改变路径。每个模块自己创建其入口文件并导出下列函数，内部可调用既有服务。所有表格中的新函数为async，输入严格校验，未列出的额外参数拒绝。

| 负责者/能力 | 固定服务导入路径 | 固定Action导入路径 |
|---|---|---|
| C任务标准DTO、任务池、阻塞、子任务进度、统计 | `@/lib/task-contract`；第9.2节C-T02/07/08/09及`getTaskPanelData(actorId,projectId,taskId)` | `@/app/(app)/projects/[projectId]/tasks/actions`；第3.4节与C-T03/04/05/06 |
| C迭代、结束、历史、复盘、本人活跃轮 | `@/lib/iteration`；第9.3节全部读取函数 | `@/app/(app)/projects/[projectId]/iterations/actions`；C-I01/02/05/07/10/11 |
| E活动 | `@/lib/activity`；E-A01/02/03 | 无独立活动写Action，业务服务/组合sink内部写 |
| E评论/@ | `@/lib/comment`；E-C01 | `@/app/(app)/projects/[projectId]/comments/actions`；E-C02/03/04 |
| E规则周报 | `@/lib/report`；E-R01 | `@/app/(app)/projects/[projectId]/reports/actions`；E-R02 |
| E统一证据 | `@/lib/evidence`；E-V01/02 | `@/app/(app)/projects/[projectId]/evidence/actions`；E-V03 |
| E风险 | `@/lib/risk`；E-K01 | 只读服务，无额外写Action |
| F站内通知/意图/渠道/发送 | `@/lib/notification`；F-N01/02/05/07/08 | `@/app/(app)/notifications/actions`；F-N03/04 |
| F到期扫描 | `@/lib/notification-reminders`；F-N06，内部适配已有notify.ts | 沿用受控cron入口，浏览器不可调用 |
| F公告 | `@/lib/announcement`；F-A01/02 | `@/app/(app)/projects/[projectId]/announcements/actions`；F-A03—07 |
| E AI会话/历史/有权上下文 | `@/lib/agent/context`；E-AI01/02/03 | 复用/api/chat；personal/project新增可选scope，省略时project，旧调用不变 |
| E AI业务只读工具 | `@/lib/agent/p0-p2-tools`；E-AI04各读取函数，完整签名首参actorId、次参projectId，后接表列参数 | 原工具装配调用，不直接开放浏览器任意工具执行 |
| E/C迭代草案管理/预览/确认 | `@/lib/agent/iteration-draft`；C-AI01，E维护存储/C实现业务确认 | `@/app/(app)/projects/[projectId]/ai-drafts/actions`；E-AI05/06、C-AI02及updateIterationDraftAction |
| A工作台/教师聚合 | `@/lib/workspace-summary`；A-G01/02 | 服务端页面查询，不另建Action |
| B项目聚合 | `@/lib/project-overview-summary`；B-G01 | 服务端页面查询，不另建Action |

同文件协作只有AI草案Action入口由E主维护、C提供确认服务；C不另建第二份草案库。固定服务导出 `previewIterationDraft(actorId,projectId,draftId)`、`confirmIterationDraft(actorId,projectId,draftId,input)`，E的对应Action调用它们。交接按第10节更新提交/状态，不更换上述公共路径。

固定组件路径：C `@/components/tasks/task-detail-panel` 导出TaskDetailPanel；E `@/components/comments/task-comments` 导出TaskComments；F `@/components/announcements/project-announcement` 导出ProjectAnnouncement、`@/components/announcements/announcement-manager`导出AnnouncementManager；B `@/components/projects/teacher-project-card` 导出TeacherProjectCard、`@/components/projects/risk-card`导出RiskCard、`@/components/projects/progress`导出TaskProgress和DeliverableProgress。均使用命名导出和文档规定props，不自行互换默认导出。

固定props：`TeacherProjectCard({item:TeacherProjectOverview})`、`RiskCard({item:RiskItem})`、`TaskProgress({stats:ProjectTaskStats})`、`DeliverableProgress({stats:ProjectDeliverableStats})`；另外三个业务组件及侧边栏按各自章节props。聚合中的QueryPart先由页面按state处理，再给展示组件传ready数据。

固定来源入口：任务为`/projects/{projectId}?task={taskId}`，迭代为`/projects/{projectId}/iterations/{iterationId}`，成果为已有`/projects/{projectId}/deliverables/{deliverableId}`；版本/反馈深链接由成果页固定识别`?versionId={versionId}&feedbackId={feedbackId}`，若只定位版本省略feedbackId。评论用任务URL加`&commentId={commentId}`，公告用项目概览`/projects/{projectId}/overview?announcementId={announcementId}`。统一证据页为`/projects/{projectId}/evidence?record={URL编码evidenceKey}`。对应页面作者实现定位/占位与授权，发送方按这些路径生成，不自行发明URL参数。D已有证据sourceHref读API继续原样保留。

页面/组件只传实体ID和显示参数，写入字段显式白名单。SourceRef 只指向站内有权限来源或已交付的来源读路由，不包含匿名分享权限。所有查询再次检查成员资格；所有新写入校验角色、项目和关联对象归属。

### 9.2 C：任务扩展、任务池、侧边栏与子任务（P0/P1/P2）

**已有保留：**第4节任务 CRUD，`listSubtasks(actorId,parentTaskId)`、`createSubtask(actorId,parentTaskId,input)`、`setTaskSuccessors(actorId,predecessorId,successorIds)`、`listProjectDependencies(actorId,projectId)` 位于现有 task.ts；`setTaskLabels(actorId,taskId,labelIds)` 位于 label.ts。删除复用 `deleteTask(actorId,taskId)`；标签管理权限继续按旧服务。成员选项先经项目访问校验，再使用现有 `listTeamMembers(teamId)`，不要向浏览器开放未经授权的成员查询。

| 编号/阶段 | 待交付调用 | 输入 | 成功 data / 返回 | 使用方 |
|---|---|---|---|---|
| C-T01/P0 | 扩展已有创建/修改及详情 | 新增可选 `acceptanceCriteria`；创建可省略，修改清空用null；最长10000字 | 现有任务 DTO 增加 acceptanceCriteria，不删除旧字段 | C侧边栏、B交互、E |
| C-T02/P0 | `listBacklog(projectId, filters)` | PageInput及`assigneeId?,priority?` | PageResult<TaskSummary>；默认无迭代、未完成、仅主任务 | C任务池 |
| C-T03/P0 | `reorderBacklogAction(projectId,input)` | `{requestId,taskId,beforeTaskId:string|null,expectedUpdatedAt}` | `{taskId,sortOrder,updatedAt}`；服务端重算排序位置，beforeTaskId须为本任务池其他任务 | C任务池 |
| C-T04/P0 | `assignTasksToIterationAction(projectId,iterationId,input)` | `{requestId,expectedRevision,tasks:[{taskId,expectedUpdatedAt}]}` | `{iteration,taskIds}`，一次事务全部加入 | C；E确认草案 |
| C-T05/P0 | `removeTasksFromIterationAction(projectId,iterationId,input)` | 同上 | `{iteration,taskIds}`，移出后回任务池 | C |
| C-T06/P1 | `setTaskBlockedAction(projectId,taskId,input)` | `{requestId,expectedUpdatedAt,isBlocked,blockedReason?:string}`；阻塞必有原因，1—2000字 | `{task}`，isBlocked/blockedReason/blockedAt | C；A/E读取 |
| C-T07/P1 | `getSubtaskProgress(projectId,parentTaskIds)` | 本项目主任务ID数组，最多100个 | `[{parentTaskId,total,doneCount,ratio:number|null}]`，直接子任务，0个时ratio=null | C卡片、B可复用 |
| C-T08/P2 | `getProjectTaskStats(projectId)` | projectId | `{projectId,asOf,scope:"main-tasks",byStatus,total,doneRatio,overdueCount,blockedCount}`，total=0时doneRatio=null | A/B/E |
| C-T09/P2 | `listProjectTaskAttention(projectId,filters)` | `{kind:"overdue"|"blocked",...PageInput}` | PageResult，项含任务ID/标题/日期/阻塞时间和 SourceRef | A/E风险详情 |

TaskSummary固定字段为 `id,projectId,title,description,status,assigneeId,assigneeName,startDate,dueDate,priority,milestoneId,parentTaskId,iterationId,acceptanceCriteria,isBlocked,blockedReason,blockedAt,completionNote,updatedAt,sourceHref`。description/负责人/开始截止日/关联ID/验收标准/阻塞说明时间/完成说明可null，其余必有；status/priority沿用现有枚举，updatedAt/blockedAt为ISO时间。DB内部sprintId映射为DTO iterationId，C负责，不同时存两份归属。

固定范围：每个主任务至多属于一个 planned/active 迭代；完成迭代不接受直接增删任务；不能把另一轮中的任务偷偷搬入，跨轮移动须先明确移出。子任务在执行视图跟随父任务上下文，不单独加入迭代，历史快照可同时记录子任务但与主任务统计分开。

任务写权限沿用 student/admin，teacher只读。改任务状态、负责人、日期、迭代归属、阻塞、验收标准均通过原任务服务或其增量入口，并产生 E 的真实事件；不把阻塞扩成第四个状态列，不加入 P3/P4 能力。

新页面的项目进度统一使用 `getProjectTaskStats` 的 `scope:"main-tasks"`，现有getProjectDetail按全任务含子任务的结果保留给旧调用。B同时显示“主任务”口径；不混用旧total与新doneCount。A个人待办仍包含指派给本人的子任务。

固定 `getTaskPanelData(actorId,projectId,taskId)` 返回 `{task:TaskSummary,labels:TaskLabel[],dependencies:{predecessorId,successorId}[],subtaskProgress:{parentTaskId,total,doneCount,ratio},allowedActions:{edit,delete,comment}}`；TaskLabel沿用已有id/name/color，edit/delete按student/admin任务权限，comment按当前成员资格。来源反馈由D接口、评论由E组件各自读取，不把它们重存到任务表。

侧边栏组件契约【待实现，C主写、B提供样式】：`TaskDetailPanel({projectId,taskId,onClose,onSaved})`；刷新和任务ID切换重新授权取详情，onSaved只在服务确认成功后触发。任务深链接沿用现有 `/projects/{projectId}?task={id}`，手机全屏、关闭恢复焦点，保留原看板筛选；内部嵌入 E TaskComments 与 D 来源反馈，不能重建任务CRUD。

### 9.3 C：迭代完整生命周期、结束历史和复盘（P0/P1/P2）

Iteration DTO：`{id,projectId,name,goal,startDate,endDate,status,revision,createdAt,updatedAt,startedAt,completedAt}`。name为1—200字，goal最多10000字，日期必填且startDate≤endDate；status为 `planned/active/completed`，时间字段按状态可null。

| 编号/阶段 | 待交付调用 | 输入 | 成功 data / 返回 | 使用方 |
|---|---|---|---|---|
| C-I01/P0 | `createIterationAction(projectId,input)` | `{requestId,name,goal?,startDate,endDate}` | Iteration，初始planned，revision=1 | C人工创建；E确认写入复用业务 |
| C-I02/P0 | `updateIterationAction(projectId,iterationId,input)` | `{requestId,expectedRevision,name?,goal?,startDate?,endDate?}`，至少一个改动 | Iteration；仅planned允许改基本字段 | C |
| C-I03/P0 | `listProjectIterations(projectId,filters)` | `{status?,...PageInput}` | PageResult<Iteration>，startDate降序+id | C；E |
| C-I04/P0 | `getIterationDetail(projectId,iterationId)` | 两个ID | `{iteration,tasks,stats,history,retrospective}`；活动轮看当前，结束轮看快照 | C；E；A/B入口 |
| C-I05/P0 | `startIterationAction(projectId,iterationId,input)` | `{requestId,expectedRevision}` | Iteration，active；同项目最多一轮active | C |
| C-I06/P1 | `previewIterationCompletion(projectId,iterationId)` | 两个ID | `{iterationRevision,completedTasks,unfinishedTasks,eligibleNextIterations,taskVersions}` | C结束确认表单 |
| C-I07/P1 | `completeIterationAction(projectId,iterationId,input)` | `{requestId,expectedRevision,taskVersions,unfinishedDisposition}`，见下文 | `{iteration,historyId,movedTaskIds}` | C |
| C-I08/P1 | `getIterationHistory(projectId,iterationId)` | 已完成轮ID | `{historyId,closedAt,iterationSnapshot,taskSnapshots,stats,dispositions}`，immutable | C历史；E证据 |
| C-I09/P1 | `getIterationRetrospective(projectId,iterationId)` | 两个ID | Retrospective或null | C/E |
| C-I10/P1 | `saveIterationRetrospectiveAction(projectId,iterationId,input)` | `{requestId,expectedRevision?,wentWell,problems,nextActions}`；每字段最多10000字，可空 | Retrospective | C；E读取 |
| C-I11/P1 | `deletePlannedIterationAction(projectId,iterationId,input)` | `{requestId,expectedRevision}` | `{deleted:true,iterationId}`；仅planned，关联任务事务内退回池，不删任务 | C |
| C-I12/P1/P2 | `getCurrentIteration(projectId)` | projectId | null，或 `{...Iteration,taskTotal,doneCount,doneRatio,scope:"main-tasks",asOf,sourceHref}`；只取active | A/B/E |
| C-I13/P1 | `listMyActiveIterations(filters)` | `{...PageInput}` | 仅含本人当前有权活跃项目的active轮、项目名、统计和sourceHref | A跨项目工作台 |

结束 input 中 `taskVersions` 为预览的 `[{taskId,updatedAt}]`；`unfinishedDisposition` 为 `[{taskId,destination:"backlog"|"iteration",targetIterationId?:string}]`，完整覆盖全部未完成主任务。未完成任务转入另一轮时 targetIterationId 必须同项目、未完成且不是本轮；UI先选择已有下一轮，没有则先创建planned。

结束时再次锁定/检查本轮和任务版本，任何任务改变则返回 CONFLICT，要求重新预览。状态变completed、任务移动、结束快照、E事件和F通知意图保持事务一致；同一次结束重放不再搬任务。历史快照保存当时任务标题、状态、归属、负责人、日期、阻塞和统计，后续任务完成/改名/删除不重算历史。快照查看仍检查当前项目权限。

复盘只为completed轮保存；Retrospective为 `{id,projectId,iterationId,wentWell,problems,nextActions,authorId,revision,createdAt,updatedAt}`。第一次创建可不传expectedRevision，之后修改必传。student/admin写，teacher读；空复盘可不保存，不能说没填复盘就是迭代没结束。

### 9.4 E：通用活动、评论和 @（P0/P1）

ActivityItem：`{id,eventKey,projectId,actorId,objectType,objectId,type,summary,occurredAt,sourceRef}`。objectType按已交付实体枚举为task/iteration/deliverable/feedback/comment/announcement；必要元信息白名单保存，不收整段私有草稿。

| 编号/阶段 | 待交付调用 | 输入 | 返回 | 使用方 |
|---|---|---|---|---|
| E-A01/P0 | `recordProjectActivity(tx,event)`，仅服务端 | `{eventKey,projectId,actorId,objectType,objectId,type,occurredAt,metadata}`；时间由真实业务确定 | 持久化ActivityItem；eventKey唯一，重复不新增 | C任务/迭代；D事件sink；F公告 |
| E-A02/P0/P1 | `listProjectActivities(projectId,filters)` | PageInput及`objectType?,objectId?,actorId?,fromDate?,toDate?` | PageResult<ActivityItem>加coverage，occurredAt降序+id | C任务历史、B项目、A教师、E周报 |
| E-A03/P2 | `getActivityEvidence(projectId,activityId)` | ID | 有权限的活动证据/已删除占位，不能吐出已失去权限的正文 | E证据来源 |
| E-C01/P1 | `listTaskComments(projectId,taskId,paging)` | ID+PageInput | PageResult<CommentItem> | C嵌入E评论组件 |
| E-C02/P1 | `createTaskCommentAction(projectId,taskId,input)` | `{requestId,body,mentionedUserIds}` | CommentItem | E组件 |
| E-C03/P1 | `updateTaskCommentAction(projectId,taskId,commentId,input)` | `{requestId,expectedRevision,body,mentionedUserIds}` | CommentItem；只给首次新增被提及者通知 | E组件 |
| E-C04/P1 | `deleteTaskCommentAction(projectId,taskId,commentId,input)` | `{requestId,expectedRevision}` | `{commentId,deleted:true}` | E组件；F处理旧通知 |

CommentItem：`{id,projectId,taskId,authorId,authorName,body,mentionedUserIds,revision,createdAt,updatedAt}`。body去空白后1—10000字；mentionedUserIds最多50个、去重、剔除本人，必须是当前团队成员ID。名字只用于显示，服务端不靠解析字符串中的 @姓名 确定收件人。同名成员用真实ID区分。

成员有项目访问权可评论，包括teacher；作者或admin可改删。发布时校验taskId属于projectId，通知只发新增实际被提及者，幂等重试不重复；同一评论编辑后再次提及已通知过的人不再自动提醒，编辑记录不丢原行为来源。删除不展示正文，历史通知进入“评论已删除”占位。

TaskComments组件参数为 `{projectId,taskId}`，内部调用E自己的Actions，C负责嵌入；禁止让C重复实现一份评论库。活动只记发生过的业务操作，不用 updatedAt 猜完成事件；旧数据coverage必须说明可核验开始日期。

E给C/F的事件目录【待交付】至少包含以下类型和稳定键，不让消费方猜type：

| 来源 | type与key约定 | 必要metadata |
|---|---|---|
| C任务 | type固定为task.created、task.completed、task.reopened、task.assigned、task.updated、task.blocked、task.unblocked；创建key为`task.created:{taskId}`，其他key为`{type}:{taskId}:{newUpdatedAt}` | taskId、changedFields、变更前后必要状态/负责人/日期、当时iterationId；一次修改可产生不同type，各最多一条；只有从非done→done写completed，改标题不写completed |
| C迭代 | `iteration.started:{iterationId}`、`iteration.completed:{iterationId}` | iterationId、结束historyId、当时统计；完成事务内保存 |
| C复盘 | `retrospective.saved:{id}:{revision}` | iterationId、retrospectiveId、revision，不把整篇正文群发 |
| E评论 | `comment.created:{id}`、`comment.updated:{id}:{revision}`、`comment.deleted:{id}:{revision}` | taskId、commentId、新增mentionedUserIds、revision；不要在删除事件塞旧正文 |
| F公告 | `announcement.published:{id}:{revision}`、`announcement.withdrawn:{id}:{revision}` | announcementId、revision，收件规则见第9.7节 |
| D成果 | 完全沿用第8节既有type/eventKey | 从D payload映射，不另造第二条相同业务事件 |

真实 occurredAt 由业务提交时记录；业务写入和事件保存使用同一tx或已有D outbox可靠交付。metadata只包含白名单数据；必要历史快照由所属服务保存，不能把当前状态误用为过去状态。

### 9.5 E：规则周报、统一过程证据和 Markdown 导出（P1/P2）

| 编号/阶段 | 待交付调用 | 输入 | 返回 | 使用方 |
|---|---|---|---|---|
| E-R01/P1 | `getWeeklyReport(projectId,input)` | `{weekStart}`，必须为北京时间周一YYYY-MM-DD | WeeklyReport；区间自动到下周一 | E规则版；B周报页；AI只读 |
| E-R02/P1 | `exportWeeklyReportMarkdownAction(projectId,input)` | 同上，重新检查权限 | `{filename,markdown,generatedAt,coverage}` | B下载/复制 |
| E-V01/P2 | `listProjectEvidence(projectId,filters)` | PageInput+DateRange可选+`milestoneId?,iterationId?,memberId?,memberRole?,kinds?` | PageResult<EvidenceItem>加filterSummary、coverage、generatedAt | B证据页 |
| E-V02/P2 | `getProjectEvidenceItem(projectId,evidenceKey)` | 稳定证据key | EvidenceItem或受控占位，仍授权 | 原记录跳转/抽查 |
| E-V03/P2 | `exportProjectEvidenceMarkdownAction(projectId,filters)` | 同一筛选、不含分页；`limit?:number`默认1000最大5000 | `{filename,markdown,total,exportedCount,truncated,generatedAt,filterSummary,coverage}` | B下载/复制 |

WeeklyReport固定为 `{projectId,weekStart,weekEnd,asOf,coverage,sections}`。sections固定字段为 `createdTasks,completionEvents,reopenedTasks,currentDoing,overdue,blocked,activeIteration,deliverables,feedback,scheduledNextSteps`，每个字段均为ReportFact[]，空时为[]。ReportFact固定为 `{factKey,title,summary,occurredAt:string|null,sourceRefs:SourceRef[]}`，不写空泛“进度良好”。完成过的任务后来重开需明确标注；不拿事件总数当贡献数，任何后续可选汇总字段必须明确次数或独立任务数。

事件部分按该周业务时间筛选；currentDoing/overdue/blocked是生成时现状，报告显式写asOf，不能说是过去周末的状态。下一步仅列已排期未完成任务/迭代；AI建议另标建议。历史事件缺失时给coverage提示，仍能生成当前状态版，不伪造之前事件。

EvidenceItem：`{evidenceKey,kind,projectId,objectId,iterationId?,milestoneId?,title,summary,occurredAt,identities,sourceRef}`，kind为 `task_activity/iteration_history/comment/deliverable_submission/deliverable_review/milestone_feedback/retrospective`。

identities为 `[{userId,role:"actor"|"assignee"|"submitter"|"reviewer"|"author"}]`。memberId筛选必须同时指定memberRole；不传角色就返回VALIDATION，防止将参与角色模糊成独立贡献。按阶段日期以各项occurredAt过滤；milestoneId用真实关联/历史快照，iterationId使用事件当时归属或结束历史，不能根据结转后的当前任务位置倒算旧证据。

D的正式成果证据来自第7节服务，E负责统一映射，不再建一套成果/反馈历史。任务、活动、迭代、复盘使用C/E真实记录。查询页与导出使用同一过滤规则和事实组装；导出需遍历各来源分页直至结束或上限，不能只导出页面当前50项。导出如达到上限必须注明truncated和计数，不能假装全量；记录generatedAt，导出期间新增记录的处理边界明确说明。导出前及来源打开时都重查权限，不输出他人草稿、已撤权正文；站内来源URL在异地分享后仍需登录，不承诺匿名可看。

### 9.6 E/A：透明风险、教师聚合和待处理事项（P2）

| 编号 | 待交付调用 | 输入 | 返回 | 负责者/使用方 |
|---|---|---|---|---|
| E-K01 | `listProjectRisks(projectId)` | projectId，阈值用服务端已登记配置 | `{projectId,asOf,coverage,items:RiskItem[],unknownRules:string[]}` | E统一计算，A/B展示 |
| A-G01 | `listTeacherProjectOverview(filters)` | PageInput+`includeArchived?:boolean`默认false | PageResult<TeacherProjectOverview>；只限本人当前teacher/admin团队 | A聚合；B卡片 |
| A-G02 | `getMyWorkspaceSummary()` | 无业务身份参数 | `{tasks,activeIterations,revisionRequired,unread,asOf}`；按C/D/F查询聚合 | A工作台 |
| B-G01 | `getProjectOverviewSummary(projectId)` | projectId | `{project,role,milestones,taskStats,activeIteration,deliverableStats,pinnedAnnouncement,recentActivities,asOf}` | B项目页聚合 |

聚合使用第9.1节固定服务入口，page只调用，不在各页面重复拼不同格式。TeacherProjectOverview固定字段为 `projectId,projectName,taskStats,activeIteration,deliverableStats,lastActivity,risks,pendingItems,asOf`。pendingItems固定为 `{submittedCount,changesRequestedCount,sourceHref}`，来源D，不混入风险评分。

聚合内部各项声明查询状态 `{state:"ready",data:T}` 或 `{state:"unavailable",code,message}`。核心认证/项目访问失败整体拒绝；已授权的单项服务故障可展示局部不可用，不能拿0/null代替失败。所有数字来自同一口径服务，注明asOf，不保证跨不同服务调用天然事务快照。

聚合字段的固定类型：TeacherProjectOverview的taskStats/activeIteration/deliverableStats/lastActivity/risks/pendingItems分别为QueryPart，data对应ProjectTaskStats、CurrentIteration|null、ProjectDeliverableStats、ActivityItem|null、ProjectRiskResult、上述PendingItems。MyWorkspaceSummary的tasks为QueryPart<TaskGroup[]>，activeIterations和revisionRequired为对应PageResult的QueryPart，unread为QueryPart<{count,asOf}>。ProjectOverviewSummary的project/role/asOf为必有基础字段，其余服务结果为对应QueryPart。分页条目必须保留nextOffset，页面不以第一页50条声称全部数据。

RiskItem固定为`{ruleId,severity:"warning",message,threshold,observedValue,evaluatedAt,sourceRefs:SourceRef[],evidenceKeys:string[]}`。ruleId仅为下列四值；threshold/observedValue为`Record<string,number|string>`，由服务端同时给message便于直接展示。ProjectRiskResult为本节E-K01返回，配置变更登记版本：

- `overdue_task`：主任务未完成且dueDate早于北京时间今天；没有日期不算逾期。
- `blocked_task`：主任务未完成、isBlocked=true且持续超过3个日历日；无blockedAt记未知，不臆测。
- `iteration_progress`：活跃轮主任务总数>0，剩余时间比例<25%、doneRatio<50%。比例按北京时间 startDate当天00:00到endDate后一天00:00计算，remainingRatio=max(0,endExclusive-now)/(endExclusive-start)；起止不合法记未知。
- `inactive_project`：项目active、可靠活动覆盖已满3天、至少存在一条真实活动，且超过72小时无任务/评论/成果/反馈/迭代/复盘活动。新项目、覆盖不足或数据源不可用都不触发。

归档项目不触发上述活跃风险，返回items为空并注明归档。每条风险提供真实来源；没有风险返回空数组，缺数据则列unknownRules。不得自动评分、排名或判断学生能力。上述阈值是本版固定标准，算法仍需E按标准实现。

B交付的展示组件契约：TeacherProjectCard接单个TeacherProjectOverview，RiskCard接单个RiskItem，TaskProgress和DeliverableProgress分别接对应统计；仅展示，不在浏览器再算另一套阈值。教师路由由A主写。

### 9.7 F：站内通知、已读、提醒和外部渠道（P0/P1）

NotificationItem：`{id,eventKey,recipientId,projectId,type,title,summary,sourceRef,createdAt,readAt}`。发送意图包含channel，站内通知去重至少eventKey+recipientId，渠道发送记录再以eventKey+recipientId+channel去重。摘要短且不保存私有草稿，读取时移除已失去项目权限的内容。

| 编号/阶段 | 待交付调用 | 输入 | 返回 | 使用方 |
|---|---|---|---|---|
| F-N01/P0 | `listMyNotifications(filters)` | PageInput+`unreadOnly?,projectId?` | PageResult<NotificationItem>；createdAt降序+id | F通知中心 |
| F-N02/P0 | `getUnreadNotificationCount()` | 无参数 | `{count,asOf}`，只计本人仍有权未读项 | A导航/工作台 |
| F-N03/P0 | `markNotificationReadAction(notificationId)` | 本人通知ID | `{id,readAt}`，重复已读返回原结果 | F中心；A入口 |
| F-N04/P0 | `markAllNotificationsReadAction(input)` | `{requestId,beforeCreatedAt,projectId?}`；以页面加载时服务器时间为界 | `{markedCount,asOf}`，界线后新消息不被误读 | F中心 |
| F-N05/P0/P1 | `recordNotificationIntent(tx,input)`，仅服务端 | `{eventKey,projectId,actorId,type,recipientIds,sourceRef,summary}` | `{createdCount}`，验证/过滤接收者并去重 | C/E/F业务；D组合sink |
| F-N06/P1 | `scanAndRecordDueReminders(now?)`，仅服务端 | now内部服务器时间，测试可注入，业务日期北京时间 | `{scanned,created,skipped,failed}` | F受控调度 |
| F-N07/P1 | `dispatchExternalNotifications(limit?)`，仅服务端 | limit默认50最大100 | `{sent,failed,skipped}`，按持久化意图重试 | F受控调度 |
| F-N08/P1 | `getMyNotificationChannels()` | 无参数 | `{inAppEnabled:true,feishuBound:boolean,externalStatus:"unbound"|"unconfigured"|"configured"|"failed"}`；configured只表示配置就绪，不冒充实测送达 | F设置、错误提示 |

现有 notify.ts 的 `notifyTaskAssigned(task)`、`notifyTaskCompleted(task,actorId)`、`scanAndNotifyDue()` 和 `/api/cron/reminders` 【已有】，主要是飞书路径，不等于站内通知和可靠发送账本已实现。F做增量适配，保留既有调用，避免新旧路径各发一遍。

提醒固定规则：临期为今天/明天截止的未完成已指派任务，逾期为dueDate<今天；每任务、种类、接收人、北京时间业务日期最多一次。已完成/归档/无负责人不提醒；重复调度不重复，改期按新日期重新判断。提醒类型和时间写进配置说明，不交给页面任意传。

| 事件 | 接收人 | 来源 |
|---|---|---|
| 任务初次指派/改派 | 当前新负责人，排除操作者 | C真实任务事件；F适配已有入口 |
| 评论新增@ | 当前有权新被提及者，排除作者和已通知过者 | E评论事件 |
| 成果提交/通过/退回/里程碑反馈/反馈任务 | 按第8节D既有规则 | D组合sink |
| 迭代结束 | 当前有权团队成员，排除操作者 | C结束事件 |
| 公告发布/显式重新发布 | 当前有权团队成员，排除发布者 | F公告事件 |
| 临期/逾期 | 当前有权任务负责人 | F扫描 |

标已读不等于任务完成/成果重交。来源删除显示占位；退组后不读旧敏感摘要，不向该用户继续发送。批量已读限定服务器认可的时间界线，不修改别人通知。

现有cron为 `POST /api/cron/reminders`，使用 `Authorization: Bearer <CRON_SECRET>`，现有成功字段为 `{notified,tasksScanned}`；它目前不自动分发D outbox。F接入后保留这两个字段及原含义：notified为本轮成功发送到期汇总卡的收件人数，tasksScanned为原到期扫描路径的候选任务数；新作业指标增加可选`inAppCreated,outboxDelivered,outboxFailed,externalSent,externalFailed,reminderTasksScanned`。F配置D组合sink、到期扫描和外部发送的受控执行，仍使用此入口，不能新旧路径给同一到期事件各发一遍。

外部发送失败独立记录状态/重试；因网络结果不确定，渠道未提供幂等能力时不能保证外部消息绝对只送一次，应记录不确定状态。站内通知去重仍必须保证。飞书未绑定/无凭据仍完整站内可用；真实飞书测试记录账号范围与结果，不把模拟成功当送达。

### 9.8 F/B：公告发布、置顶、编辑、撤下（P1）

AnnouncementItem：`{id,projectId,title,body,authorId,status:"published"|"withdrawn",isPinned,publishedAt,createdAt,updatedAt,revision}`，title 1—200字、body 1—10000字，纯文本；authorId服务端取。每项目最多一条置顶，替换时在同一事务取消旧置顶。

| 编号 | 待交付调用 | 输入 | 返回 |
|---|---|---|---|
| F-A01 | `listProjectAnnouncements(projectId,filters)` | PageInput+`includeWithdrawn?`默认false，含撤下仅teacher/admin可用 | PageResult<AnnouncementItem> |
| F-A02 | `getPinnedAnnouncement(projectId)` | ID | 当前已发布置顶项或null；失败不返回null |
| F-A03 | `publishAnnouncementAction(projectId,input)` | `{requestId,title,body,isPinned}` | AnnouncementItem并保存发布事件/通知意图 |
| F-A04 | `updateAnnouncementAction(projectId,announcementId,input)` | `{requestId,expectedRevision,title?,body?}` | AnnouncementItem，编辑不默认再次通知 |
| F-A05 | `setAnnouncementPinnedAction(projectId,announcementId,input)` | `{requestId,expectedRevision,isPinned}` | AnnouncementItem，只允许已发布项 |
| F-A06 | `withdrawAnnouncementAction(projectId,announcementId,input)` | `{requestId,expectedRevision}` | AnnouncementItem，status=withdrawn，isPinned=false |
| F-A07 | `republishAnnouncementAction(projectId,announcementId,input)` | `{requestId,expectedRevision}` | 新发布revision和时间，显式产生一次新发布通知，key含revision |

teacher/admin可发布、编辑、置顶、撤下和重新发布，student只读当前已发布；不能仅按authorId放行已退组作者。编辑/撤下不抹去必要行为历史，旧通知点击不可读取撤下正文。没有另做公告文件上传或多级审批。

F交给B `ProjectAnnouncement({projectId})` 和 `AnnouncementManager({projectId})` 两个组件，前者概览展示，后者按服务端权限显示表单；B嵌入而不复制F存储。撤下后概览及通知来源刷新，不继续显示旧置顶卡片。

### 9.9 E/C：AI 有界上下文、业务读取和迭代草案（P2）

**核对的已有行为：**`src/lib/agent/conversation.ts` 中 `getOrCreateConversation(actorId,projectId)` 当前复用每项目最近会话，`listConversationMessages(actorId,conversationId)` 按项目权限读取全部消息；这属于项目共享会话，目前不是“已经有私有会话与有界历史”。`buildProjectSnapshot` 已限制快照字符/任务数，但并未完成新增业务上下文。

现有 `POST /api/chat` 输入 `{projectId,userText}`，成功 `{text,toolTrace,drafts}`；`POST /api/chat/commit` 输入 `{projectId,tool,draft}`，成功 `{committed,conflicts}`。现有 `plan_sprint` 只是给任务写milestoneId/dueDate，不创建独立迭代。E保持旧调用语义，新增迭代草案使用新的工具名/版本，不能悄悄重解释旧草案。

P2聊天扩展固定输入为 `{projectId,userText,scope?:"project"|"personal",conversationId?:string}`，省略scope为project；有conversationId时校验它与projectId/scope/当前身份一致，没有则按作用域取得会话。成功保留text/toolTrace/drafts并增加conversationId/scope字段；旧页面忽略新字段仍正常，新页面用于继续会话和草案关联。流转写库仍走明确确认入口，不由聊天响应自动执行。

| 编号 | 待交付/扩展调用 | 输入 | 返回/规则 | 责任 |
|---|---|---|---|---|
| E-AI01 | `getOrCreateScopedConversation(projectId,input)` | `{scope:"project"|"personal"}` | `{id,projectId,scope,ownerId:string|null}`；personal owner取会话本人 | E扩展现有模型 |
| E-AI02 | `listBoundedConversationMessages(conversationId,input)` | `{beforeMessageId?,limit?}`默认20最大40 | 有界消息、hasMore、nextBeforeMessageId；单轮总字符上限12000，截断注明 | E人工历史/模型上下文 |
| E-AI03 | `buildAuthorizedProjectContext(projectId,input)` | `{conversationId,maxChars?}`默认12000最大20000，服务端限制 | `{context,sourceRefs,coverage,truncated,asOf}`；仅当前有权数据 | E现有orchestrator |
| E-AI04 | 扩展已有只读工具 | `readIteration(iterationId)`、`readDeliverables(paging)`、`readFeedback(paging)`、`readRetrospective(iterationId)`、`readProjectStats()`；actor/project绑定服务端 | 分别复用C/D服务和E规则报告；输出受限/有来源 | E工具实现；C/D供服务 |
| E-AI05 | `generateIterationDraftAction(projectId,input)` | `{requestId,conversationId,prompt}`；prompt 1—4000字 | IterationDraft，只存待确认草案，不创建/移动业务任务 | E生成，C提供可用任务 |
| C-AI01 | `previewIterationDraft(projectId,draftId)` | ID，草案有权且属于本项目 | `{draft,validation:{valid,conflicts},currentTaskVersions}` | C校验；E卡片 |
| C-AI02 | `confirmIterationDraftAction(projectId,draftId,input)` | `{requestId,expectedDraftRevision,expectedTaskVersions}` | `{iteration,taskIds,replayed}`；一次事务planned轮+任务归属+草案已确认+事件 | C写入；E按钮 |
| E-AI06 | `cancelIterationDraftAction(projectId,draftId,input)` | `{requestId,expectedRevision}` | `{draftId,status:"cancelled"}`；不修改项目任务 | E |

IterationDraft：`{id,projectId,createdById,conversationId,status:"pending"|"confirmed"|"cancelled"|"expired",revision,name,goal,startDate,endDate,candidateTasks:[{taskId,expectedUpdatedAt,reason}],createdAt,expiresAt,sourceRefs}`。固定创建后24小时到期，服务端校验；仅创建者可确认/取消，且确认时仍需student/admin任务/迭代写权限。

P2草案只选择已有任务，模型输出taskId必须来自本次有权任务列表，不能用名字猜ID。确认前修改固定调用 `updateIterationDraftAction(projectId,draftId,{requestId,expectedRevision,name?,goal?,startDate?,endDate?,taskIds?})`，返回IterationDraft，并重新保存基线任务版本；修改只保存pending草案，不写任务/迭代业务数据。

确认默认仅创建planned轮并加入任务，不自动开始，也不代教师审核。再次检查权限、项目归属、任务未完成/未被他轮占用、任务版本和草案到期；冲突整体拒绝，刷新重确认，不部分写入。已确认同一草案重放返回原iteration，不再建第二轮；取消/到期不许确认。

个人会话仅owner可读，admin/teacher也不能借团队角色读取别人的个人聊天。旧会话迁移标为project共享并在页面说明，不把旧共享记录回填成某人的私有记录；从个人消息转为共享必须显式动作，不能自动复制。共享会话读取亦需当前成员资格，日志/工具Trace不能泄露他人私有数据。

规则业务与周报不依赖模型。没有密钥/调用失败返回明确错误，保留人工建轮和规则周报，不能用虚构AI响应验收；真实模型调用、上下文隔离和确认写入分别测试登记。

### 9.10 A/B：页面与可用性验证交付（P0/P1/P2）

以下功能主要复用上文接口，不再为每个按钮造服务：

| 功能 | 页面作者/接入 | 交付与验收 |
|---|---|---|
| 登录后入口、全局导航、设置入口 | A；现有认证复用 | 工作台/项目/团队/通知可到达，头像设置保留飞书/Token；未交付入口不放假链接 |
| 项目概览和内部导航 | B；第4、7、9.3/6/8节 | 概览/任务/迭代/成果能进入；旧甘特/AI入口仍可用 |
| 空项目引导 | B；用现有项目/里程碑/任务/成员+当前迭代读取 | `{goalSet,milestoneCreated,taskCreated,membersPresent,iterationCreated}`按真实数据推导，允许跳过，不添加“已完成”假开关 |
| 教师共用卡片与风险卡 | B给A组件，第9.6节 | 组件只展示，服务端聚合授权；逾期、待验收、未知数据区分 |
| 证据页和导出入口 | B接E第9.5节 | 筛选与导出一致，点击来源能授权查看；占位/截断明确 |
| 手机关键操作与刷新 | A/B统一样式，C/E/F各自组件 | 任务侧栏、改状态、评论/@、通知、成果提交/重交真实可用 |
| 新用户试用记录 | A/B共同，P2 | 文档字段见下，无需新增产品里的“试用管理系统” |

试用记录交付为Markdown/表格：`日期、测试版本、参与者匿名编号、场景、开始/结束时间、耗时、成功/失败、卡点、对应修复提交、修复后复测`。至少覆盖找到本人任务、快速创建任务、找到教师反馈、重交和手机操作。真实记录，不把预设3分钟理解/5—10秒创建目标写成已经达标。

### 9.11 C/F/全员：部署、迁移、恢复和最终回归交接（P0/P2）

**这些是操作与文档交付接口，不是网站HTTP API。** 不开放“点网页恢复生产数据库”等入口。F负责执行与说明，C协调迁移，每位模块作者提交自己的规则、升级和测试。

| 编号 | 交付项 | 必须给出的输入/前置条件 | 必须给出的结果/证据 |
|---|---|---|---|
| OPS01/P0 | 本地启动交接 | 基线提交、实际Node版本、依赖安装、开发库/测试库、环境变量名称、种子/账号准备 | 非作者按说明可启动、登录、完成P0核心流程；开发/测试库分离 |
| OPS02/P0/P2 | 数据库升级契约 | migration文件、依赖顺序、schema/journal、空库/旧库账本判断、备份和兼容说明 | 升级前后用户/团队/项目/任务/成果等校验，旧数据可用，不清库 |
| OPS03/P2 | 版本发布 | 发布提交/tag、构建产物/镜像、服务器环境、站点URL、数据库升级记录 | 实际网址、登录/权限、核心链路结果、发布日期、回滚版本 |
| OPS04/P2 | 定时作业接入 | CRON_SECRET等变量名称、受控执行方式、时区、运行频率、锁/重试策略 | 到期提醒、D组合sink、外部发送确实执行；重跑不重复站内通知 |
| OPS05/P2 | 备份 | 目标库版本、备份工具/命令、范围、文件位置/访问权限、保留策略 | 时间、大小/校验值、备份日志；密钥不进入交接文档 |
| OPS06/P2 | 独立恢复演练 | 备份文件、独立目标库/应用、对应代码版本和迁移兼容范围 | 实际恢复耗时、用户/项目/任务/评论/成果版本可读写，不覆盖生产演练 |
| OPS07/P2 | 回滚与故障交接 | 上一版产物、配置差异、DB前后兼容限制、排错步骤 | 代码回滚验证；不可逆DB变更单独说明，不能声称回退代码等于回退库 |
| OPS08/P2 | 最终检查记录 | 集成提交、测试环境、角色账号准备、旧数据副本、飞书/AI真实条件 | test/lint/build、权限反例、迁移、恢复、真实飞书/AI结果及跳过项 |

当前master实际脚本有 `npm ci`（安装命令）、`npm run dev/build/start/lint/test/db:generate/db:migrate/db:push:test`。具体执行环境与变量模板由F按发布版本确认；生产不把db:push当无审查升级方案。本地旧库无初始化账本时按第10节和B评审文档处理，不机械重放0000。

服务器租好前可以完成文档、打包、测试环境与独立恢复；租好后才能填实际公网验收结果。部署对象是AgileCampus应用，团队腾讯文档项目主页是另一个对象。中国网络访问用实际目标服务器和普通网络验证，不凭本地localhost或国外托管可打开就认为完成。

环境模板只列变量名称/占位，不含真实密码、token、数据库连接凭据。公开交付说明写当前已完成项、待配置项和未实测项，每个模块作者仍对自己的测试失败负责，不把整组集成全留给负责人。

## 10. 进度不同的时候怎么合作

1. **直接采用统一契约。** 提供者按固定路径/字段实现并填交付提交与状态；使用者按固定契约开发，无须每次重新商量名称和数据形状。
2. **缺服务时先做布局。** 使用者可用相同类型的 fixture，显式标为开发样例，集中放在开发用途文件；不要混进正式业务数据或验收演示。
3. **服务一可用就接入。** 不等整个人的 P1/P2 全完成。接入真实查询后验证空数据、失败、越权、刷新和对象链接。
4. **提供者负责内部适配。** 已有代码与契约不同的，在模块入口转换并保持旧调用兼容，不要求消费方跟着改。只增加可选字段，不替换本版名称/参数/状态值。
5. **各模块提交小 PR。** 写明依赖哪个已合并提交、迁移和联调结果；缺依赖的 PR 标明阻塞原因，别先把坏调用合入 master。
6. **负责人按依赖顺序合并。** 通常先数据/服务，后消费者/页面；每次核对相关相邻链路，展示前再走完整链路。

已有个人未提交工作先保留。使用 Git 前检查 status，不能为了跟最新 master 对齐直接 reset 覆盖自己的代码；同一文件冲突时先核对双方变更。A 主写工作台，B 主写成果页面，C 主写任务侧边栏，尽量通过组件接入避免抢改。

数据库只做增量升级。空库可以走当前完整迁移；已有老师旧表且无账本的库不能重放初始化 SQL。不能清库重建或覆盖他人的 drizzle journal/snapshot。详细升级按本次 B/D 交付说明处理；F 在副本验证、备份之后才升级实际部署库。

### 每个接口的交接模板

```text
能力名称：
状态：待实现 / 服务可调用 / 使用方已接入 / 联调通过
提供者：          使用者：
基线提交：        实现提交或 PR：
源码路径与导入方式：
函数/Action 名与完整输入类型：
成功返回、空数据、失败形式：
权限和对象所属范围：
统计口径 / 日期时区 / 分页规则：
写操作的重试、并发、事件规则（若适用）：
是否需要数据库迁移，旧数据如何保留：
可复制的调用例子：
实际联调账号角色、操作和结果（不写密码）：
未完成项与接入方下一步：
```

## 11. 可直接交给每位同学 AI 的指令

先复制公共指令，再复制自己模块对应的一行任务。完整功能范围仍按原六人任务书，本文件只补接口接入要求。

```text
请在唯笃队 AgileCampus 当前源码上完成我负责模块的接口接入。
先阅读 AGENTS.md、docs/team-interface-contract.md 和相关实际源码。
本文件是已定稿标准，名称/导入路径/参数/DTO/返回/状态/计数口径必须一致，不自行改名。
确认基线和实现状态：待实现表示代码未交付，不表示接口可随意设计，也不冒充服务已经可用。
服务端业务复用现有 src/lib，浏览器用现有 Server Actions，身份取登录会话。
只实现我模块范围内的服务/页面，保留别人接口和已有功能；内部已有实现由我做适配，不让调用方返工。
公共类型统一从 @/contracts/p0-p2 导入；新任务页面调用固定V1对象式Action，旧接口保持兼容。
交接必须列出输入输出、权限、错误、迁移、调用示例、真实联调结果和未完成项。
不得把样例数据当完成证据，不重复创建任务/成果/事件/通知体系，不清库重建。
不更改本版公共接口。新需求增加可选字段；破坏性升级另建入口并保留本版，不让队友反复改调用。
```

| 成员 | 加在公共指令后的具体任务 |
|---|---|
| A | 我是 A。完成P0—P2工作台/导航/教师总览。保留已合并P0，接D本人待修改成果和教师统计、C本人active轮/任务统计、F未读数、E活动/风险；按第9.6/10节聚合与试用。缺接口明确标待接入。教师总览按每团队当前角色过滤，风险和待验收分开。 |
| B | 我是 B。完成P0—P2项目/成果/证据页面。保留真实P0；按第5—7节接审核、workingCopy修改、重交、反馈转任务，按第9.5节接完整证据查询与Markdown导出，按第9.8节嵌入F公告。双进度、空项目引导、教师共用卡片及手机/试用按第9.6/10节。不要复制C侧边栏或E/F存储。 |
| C | 我是 C。第9.2/3节全部为我的P0—P2范围：验收标准、任务池排序/入轮/移出、迭代创建/开始/预览结束/结转/不可变历史、阻塞、复盘、直接子任务进度、任务侧边栏、统计明细；接D反馈来源、E评论事件。第9.9节提供草案预览/事务确认，保留原CRUD和tx参数。协调迁移并保护旧看板/标签/依赖/甘特/Agent API。 |
| D | 我是 D。核对并维护第5—8节已有服务，给 A/B/E/F 最小调用例子，处理公共契约冲突；不替各成员重做其页面。评审依赖和迁移，分批合并并检查真实链路。 |
| E | 我是 E。第9.4/5/6/9节全部为我的P0—P2范围：活动事件、评论改删/@、规则周报、统一证据/Markdown、风险、个人/共享会话隔离、有界上下文、新业务只读工具、迭代草案生成/取消。和F共用D组合sink；给C评论组件、给A风险、给B周报/证据。确认写入交C，不读私有成果草稿，不伪造旧事件或AI成功。 |
| F | 我是 F。第9.7/8/11节全部为我的P0—P2范围：通知分页/未读/单条和全部已读、指派/@/成果/到期/结束提醒、外部发送账本/重试、公告发布编辑/置顶撤下/显式重新发布、部署备份恢复回滚。和E共用D组合sink，给A未读数、给B公告组件，C核对迁移。飞书/AI/公网未实测独立注明。 |

## 12. 联调与展示前验收

每次 PR 优先检查本次改动影响的相邻模块；不能仅凭“页面有按钮”“截图好看”确认接口完成。

| 联调双方 | 要实际操作的事 | 通过条件 |
|---|---|---|
| A ↔ C | 给学生指派任务，改截止日/状态，再回工作台 | 正确分组；完成后消失；退出团队不能继续读旧数据；链接打开对应任务 |
| B ↔ D | 创建草稿、提交、教师退回、开始修改、重交、通过 | 状态和按钮正确；旧版及旧意见保留；双击/重复请求不多建一版；统计同步 |
| B/C ↔ D | 将反馈确认转为任务，从任务回看来源 | 同一反馈仅关联一项；任务详情有正确来源；任务完成不自动批准报告 |
| A/B/E ↔ D | 查看待修改、教师统计和证据 | 口径一致，分页正确，来源可打开，外队/已退组用户不能读取 |
| E ↔ F ↔ D | 提交和退回产生事件，重复分发，再标已读 | 活动/通知不重复；接收人正确；未读数刷新；外部失败不影响主业务 |
| A/B ↔ C/E/F | 当前迭代、活动、风险、未读和公告显示 | 用真实数据；暂无数据与接口失败分开；跳转和刷新正常 |
| F ↔ C/D | 在副本升级数据库，再启动和恢复 | 旧用户/项目/任务/成果保留；迁移不重复；恢复后能完成核心流程 |

展示前由负责人组织一次串联，负责上台的同学实际操作，其他人配合角色账号。没有明确展示日期时不虚构每周进展。

- [ ] 学生登录 → 工作台找到任务 → 任务/迭代推进 → 提交阶段成果。
- [ ] 教师查看有权项目 → 写退回意见 → 作者确认修改任务 → 修改并重交 → 教师通过。
- [ ] 每个正式版本及意见可查；任务、成果统计不混算；草稿和越权访问隔离。
- [ ] 已交付的活动/通知/证据能追溯到真实对象；未交付功能明确列出，不模拟成功。
- [ ] 刷新页面、重复点击、旧页面提交冲突、请求失败都有正确结果；手机基本可用。
- [ ] 每位成员能说明自己实现什么、接谁的接口、真实测过什么、还有什么缺口。
- [ ] 最终服务器展示时，普通中国网络可打开网站；数据库升级、备份恢复和环境交接完成。

阶段展示只验本阶段约定已交付的能力，不要求每次展示都全部完成。最终展示前，承诺交付的核心链路必须在同一份代码、同一数据库、同一实际部署中跑通；本地 P3 或单模块测试不能替代整组验收。

### 三个阶段的完整接口验收范围

| 阶段 | 展示前应跑通 | 特别检查 |
|---|---|---|
| P0 | 登录/导航→管理员准备项目→任务带可选验收标准并指派→工作台和通知定位→侧边栏保存→任务池排序/选入planned轮/开始→学生推进→成果草稿/提交→活动记录→重登录数据仍在 | 并发开始只一轮active、他队拒绝、旧数据/旧看板可用；不能只展示A/B/D就称整组P0完成 |
| P1 | 在P0基础上：任务完成与成果待审分别统计→退回通知→反馈确认转任务→评论/@去重→修改重交/通过→公告发布置顶撤下→阻塞/直接子任务进度→结束结转且历史不变→复盘/规则周报 | 已读不消待修改、重复审核/提交/结束不重做、任务完成不代替验收、关闭AI仍完整可用；外部失败不回滚业务 |
| P2 | 教师总览按角色聚合→透明风险来源→阶段/成员身份/类型证据筛选与Markdown→个人/共享AI隔离和有界历史→新业务读取→草案预览/取消/确认→新用户试用→服务器/独立恢复/回滚交接 | 缺数据不误报、导出逐条来源、未确认不写、过期/重复确认不多建；真实飞书/AI/公网未测项不能记通过 |

## 13. P0—P2 全量覆盖对照表

以下逐行对应原六人任务书第4、5、6节，共32项功能。一个功能可能消费多个接口；无新增服务的页面/测试任务用组件或交付契约覆盖，不为凑数建API。完成状态仍以真实提交和联调为准。

| 规划编号 | 原规划功能 | 提供/接入者 | 本文对应契约 |
|---|---|---|---|
| P0-01 | 个人工作台 | A，C/D/F供数 | 第4节 getMyOpenTasks/groupMyTasks；A-G02 |
| P0-02 | 简化全局导航 | A | 第9.10节导航，F-N02 |
| P0-03 | 项目概览 | B，C/D供数 | 第4、7节，B-G01 |
| P0-04 | 任务池Backlog | C | C-T02—05 |
| P0-05 | 迭代基础 | C | C-I01—05；C-T04—05 |
| P0-06 | 任务验收标准 | C | C-T01；第3.4节V1任务Action |
| P0-07 | 任务详情侧边栏 | C主写，B样式 | 第9.2节TaskDetailPanel和已有CRUD |
| P0-08 | 阶段成果基础 | D服务/B页面 | 第5节已有创建/编辑/列表/详情/提交 |
| P0-09 | 最小活动记录 | E，C/D写来源 | E-A01—02；第8节与9.4节事件目录 |
| P0-10 | 站内通知基础 | F，A入口 | F-N01—05及任务指派适配 |
| P0-11 | 数据与权限基础 | C统筹，全员 | 第3、9.1、10节；OPS01—02 |
| P1-01 | 完整迭代结束与历史 | C | C-I06—08、11—12；事务结转/快照 |
| P1-02 | 阻塞与轻量复盘 | C | C-T06；C-I09—10 |
| P1-03 | 子任务完成度 | C | 已有listSubtasks/createSubtask；C-T07 |
| P1-04 | 成果版本和教师验收 | D服务/B页面 | 第5节 review/startRevision/submit/detail |
| P1-05 | 教师反馈转任务 | D/C服务，B确认 | 第6节 createTaskFromFeedback/getFeedbackTaskLink/listTaskFeedback |
| P1-06 | 双进展展示 | B，C/D供数 | C-T08与第7节成果统计，统计范围分别说明 |
| P1-07 | 基础评论与活动 | E服务组件，C接入 | E-A01—02；E-C01—04 |
| P1-08 | 轻量@成员 | E识别成员/F通知 | E-C02—03；F-N05，新增提及名单去重 |
| P1-09 | 项目公告 | F服务组件/B接入 | F-A01—07 |
| P1-10 | 规则周报 | E服务/B界面 | E-R01—02，coverage/事实来源 |
| P1-11 | 教学通知与飞书 | F，C/D/E事件 | 第8节；F-N05—08，受控调度及外部重试 |
| P1-12 | 手机关键操作 | A/B统一，全员 | 第9.10节各模块组件/刷新和手机验收 |
| P2-01 | 教师项目总览 | A聚合/B卡片，C/D/E供数 | A-G01；C-T08—09/C-I12；第7节；E-K01/E-A02 |
| P2-02 | 透明风险提示 | E计算/A展示 | E-K01，四条明确规则与unknownRules |
| P2-03 | 过程证据与答辩清单 | E服务/B页面 | E-V01—03，第7节D证据、C-I08历史和成员身份筛选 |
| P2-04 | AI有界连续上下文 | E | E-AI01—03及共享/个人权限迁移 |
| P2-05 | AI读取新增业务 | E，C/D供数 | E-AI04复用迭代/成果/反馈/复盘/统计 |
| P2-06 | AI规划迭代草案 | E生成/C确认 | E-AI05—06；C-AI01—02；草案编辑/旧plan_sprint兼容 |
| P2-07 | 可用性验证 | A/B | 第9.10节匿名试用记录/修复前后复测 |
| P2-08 | 部署与恢复 | F执行/C数据库/全员交接 | OPS03—07，独立恢复与回滚限制 |
| P2-09 | 最终回归 | 全员，F统筹 | OPS08，第12节P2串联和真实条件记录 |

使用方法：每人认领自己的行，填对应实现提交、接口交接和真实联调结果。涉及多个成员的一行只有完整链路跑通才算完成；后端已交付、页面没接入时写“服务完成/页面待接”，不能把整行勾成已完成。

## 14. P3 增量接口（2026-10-10）

本节为【P3 接入】补充，不改第 3—13 节冻结的 P0–P2 参数、DTO、状态或事件目录。浏览器新写入沿用 `Result<T>`，五个错误码为 `UNAUTHENTICATED / FORBIDDEN / VALIDATION / CONFLICT / INTERNAL`。

### 14.1 模板和读取服务

| 服务导入 | 签名／返回 | 约束 |
|---|---|---|
| `@/lib/project`：`createProject` | 原 `actorId, teamId, input` 保留；input 新增可选 `templateId`、`requestId` | 模板 `blank / course / research / competition`，默认 blank；管理员创建；同请求不重复建立项目／阶段 |
| `@/lib/project-extras`：`listProjectReferences` | `(actorId, projectId, { offset?, type? } = {})` → `{ items, offset, nextOffset }` | 每页 50 条，类型为下表五种；当前团队可读，返回当前角色的可编辑标记 |
| 同上：`getProjectLeadership` | `(actorId, projectId)` → `{ leaderId, name, active, revision, changes }` | active 表示当前仍在团队；changes 为最近 20 条，数据库保留全部历史 |
| `@/lib/project-calendar`：`exportProjectCalendar` | `(actorId, projectId, origin)` → `{ content, count }` | 当前团队可读；只含有截止日期的事项；content 为 ICS 文本 |
| `@/lib/deliverable-comparison`：`getDeliverableComparison` | `(actorId, projectId, deliverableId, fromId, toId)` → `{ from, to, title, description, links, metadata, changed }` | 两个 ID 都是同一成果的正式版本；权限复用 D 查询，不包含私有工作稿 |

日历浏览器入口为 `GET /api/projects/{projectId}/calendar`，使用 session，返回下载文件。未登录 401、无权限／项目 ID 无效 403、内部错误 500；禁止共享缓存，不新增无需登录的公开订阅地址。

### 14.2 浏览器写 Action

固定导入路径：`@/app/(app)/projects/[projectId]/extras/actions`。四个 Action 都从 session 获取操作人，浏览器参数不传 actorId。

| Action | 参数 | 成功 data／权限 |
|---|---|---|
| `createProjectReferenceAction` | `(projectId, input: ReferenceInput)` | 当前记录对象；当前团队成员创建 |
| `updateProjectReferenceAction` | `(projectId, id, input: UpdateReferenceInput & { requestId: string })` | 当前记录对象；创建者或管理员修改 |
| `deleteProjectReferenceAction` | `(projectId, id, { expectedRevision, requestId })` | `{ id, deleted: true }`；创建者或管理员删除 |
| `setProjectLeaderAction` | `(projectId, { leaderId, expectedRevision, requestId })` | `{ revision, changed }`；只允许团队管理员；leaderId 为当前成员 UUID 或 null |

`ReferenceInput / UpdateReferenceInput / LeadInput` 类型从 `@/lib/project-extras` 导入，使用 `import type`，不得将服务实现带入客户端。资料 input 字段：

| 字段 | 类型／要求 |
|---|---|
| title | 非空字符串，最多 200 字 |
| type | `meeting / document / video / prototype / other` |
| url | 必填完整 HTTP/HTTPS 链接，最多 2048 字；不包含账号密码或控制字符 |
| minutesUrl / recordingUrl | 可选链接或 null；仅 meeting 使用 |
| meetingDate | 可选 `YYYY-MM-DD` 或 null；仅 meeting 使用 |
| participantIds | 可选 UUID 数组，默认空、去重、最多 100 个；必须是当前团队成员，仅 meeting 使用 |
| milestoneId | 可选 UUID 或 null，必须属于当前项目 |
| note | 可选字符串，默认空，最多 5000 字 |
| requestId | 新 Action 必填 UUID；同一次操作安全重试使用同一个 ID |
| expectedRevision | 修改／删除资料必填，至少 1；负责人变更必填，至少 0 |

读写都核对当前成员与权限；归档项目只读。资料增删改及负责人交接使用事务、版本校验和请求去重：旧版本拒绝覆盖；同键不同内容返回 CONFLICT；重试不绕过角色变化，不复活已删除资料。业务服务中保留的可选 requestId 仅为旧本地调用兼容，新浏览器 Action 始终必填。

页面保存成功自动完整刷新重新读库，失败保留输入；不靠用户手动刷新显示结果。P3 没有新增活动／通知枚举，原 E/F 消费契约保持不变。迁移为 `0012_p3_project_extensions`；生产仍使用 `db:migrate`。

## 15. P3 个人课表与短期工作规划（2026-10-10）

【本轮新增】独立增量，不修改 P0–P2 的任务／迭代／成果 DTO、Action 签名或 E/F 事件目录。本人课表和个人计划不进入共享项目证据、共享会话及通知。入口 `/schedule` 与 `/projects/{projectId}/personal-plan`；后者从项目「AI 与草案」进入。

### 15.1 浏览器对象 Action

固定导入 `@/app/(app)/schedule/actions`。所有 Action 包括预览均经 `runAction` 校验 session，操作人由服务端取得；返回原 `Result<T>` 和五种固定错误码。客户端类型用 `import type` 从 `@/lib/schedule/types` 和 `@/lib/schedule/importer` 导入。

| Action | 参数 | 成功 data |
|---|---|---|
| `previewScheduleAction` | `PreviewImportInput` | `{ events: ScheduleEventInput[], warnings: string[] }`，只解析不写库 |
| `importScheduleAction` | `{ requestId, source: "ics" | "csv", events }` | `{ added, skipped, revision }`，本人范围去重 |
| `addManualScheduleAction` | `ManualScheduleInput & { requestId }` | 同导入结果，source 固定 manual |
| `saveSchedulePreferencesAction` | `{ requestId, expectedRevision, preferences }` | `{ revision }`，成功后重新读取本人偏好 |
| `changeScheduleEventAction` | `(id, { requestId, expectedRevision, event? })` | 修改／删除结果；传 event 修改，不传则删除；仅本人 |
| `generatePersonalPlanAction` | `(projectId, GeneratePlanInput)` | 私有计划视图；不改共享任务或迭代 |
| `changePersonalPlanAction` | `(projectId, id, { requestId, expectedRevision, action: "confirm" | "cancel" })` | 当前私有计划视图 |

所有新写入的 `requestId` 必填 UUID；版本为整数，个人偏好从 0 起，日程／计划从 1 起。同一次操作的安全重试使用同一个 UUID；换内容时不能复用，返回 CONFLICT。读取他人对象拒绝，重试也重新核对当前身份和项目权限。

### 15.2 输入字段

| 类型 | 固定字段 |
|---|---|
| `PreviewImportInput` | `format: "ics" | "csv"`；content 非空且最多 200,000 字符；startDate/endDate 为 ISO 日，范围最多 187 天 |
| `ScheduleEventInput` | title 1–100 字；startAt/endAt 为带 UTC 或偏移量的 ISO 时间；结束晚于开始，单次最多 7 天 |
| `ManualScheduleInput` | title 1–100 字；start/end 为北京时间 `YYYY-MM-DDTHH:mm`，单次最多 24 小时；repeatWeeks 1–26 默认 1；intervalWeeks 1 或 2 默认 1 |
| `SchedulePreferences` | workStart/workEnd 为 HH:mm 且同日开始早于结束；days 数组 0–6（周日为 0），至少一天；dailyMinutes 30–240；blockMinutes 30／45／60；bufferMinutes 0–60 |
| `GeneratePlanInput` | requestId；startDate 今天至未来 14 天；days 7／14；mode ai／rules；goal 最多 1000 字默认空；selections 1–40 个 `{ taskId: UUID, minutes }`，任务不可重复，minutes 15–2400 且为 15 的倍数 |

不能依据任务完成率自动猜剩余工时，因此每项任务由学生填写估计。支持每周／隔周课程和受限 ICS 重复规则；格式、模板与限制见 [使用说明](p3-personal-schedule-planning.md)。

### 15.3 服务与返回类型

| 服务 | 读取范围与返回 |
|---|---|
| `@/lib/schedule/store`：`getMySchedule(actorId, { startDate?, endDate?, offset? } = {})` | 仅本人；items 每页 50 个、nextOffset、revision、preferences；查看范围最多 188 天；日期序列化为 ISO 字符串 |
| `@/lib/schedule/planner`：`getPlanningWorkspace(actorId, projectId, { startDate?, days?, offset? } = {})` | 当前项目成员的本人数据；project／stats／preferences／candidates／candidateTotal／plans／nextOffset；最多 40 个任务候选，计划每页 10 条 |
| 同上：`generatePersonalPlan(actorId, projectId, input)` | 当前学生／管理员；本人未完成、未阻塞、无未完成前置依赖的叶子任务；归档拒绝 |
| 同上：`changePersonalPlan(actorId, projectId, id, input)` | 只能本人确认／取消，确认时重新检查当前项目角色、课表、偏好和任务快照 |

计划视图包含 id、status、revision、goal、mode、startDate/endDate、items、unmet、warnings、isStale、expiresAt、confirmedAt。状态为 draft／confirmed／cancelled，读取已过期草案时显示 expired（不新增共享状态枚举）。`items: WorkBlock[]` 每段含 taskId/title/objective/reason/startAt/endAt/minutes；`unmet: UnmetWork[]` 含 taskId/title/minutes/reason，明确显示未排完工作。

### 15.4 硬性规则与并发

AI 只提出真实选中任务的顺序、目标和理由。服务端按 15 分钟粒度限制工作星期／时段、课程与日程、休息缓冲、跨项目已确认安排和每日总工时，再考虑任务开始日与最早阶段期限。输出包含陌生任务、重复／遗漏任务、错误 JSON 时拒绝保存；不可静默冒充成功或切换为 AI。未配置模型时可由用户明确选择 rules。

个人写入串行锁定本人的偏好状态行。AI 请求有生成租约、同一人同时最多一个请求；模型计算在事务外，完成后检查原任务／课表快照仍一致。草案有效 24 小时；确认时要求未过期、工作段未开始、快照未变化且至少有一个工作段。同项目重叠的已确认安排通过指定原计划重新规划，其他项目安排作为忙碌时间和已投入分钟扣除。

课表名称和原始日程不发送给模型；模型获得可投入容量和项目任务内容。确认只改 `personal_work_plans`，不改任务状态、负责人、日期或团队迭代。没有写入 E/F 活动事件和通知，因此其他成员无需增加枚举适配。

迁移 `0013_personal_schedule_planning` 新增 `personal_schedule_state / personal_schedule_events / personal_schedule_requests / personal_work_plans` 四表，全库备份包含这些私有数据。服务器使用原 `db:migrate` 发布流程；真实 AI 与学生课表样本另行验收。

### 15.5 【本轮新增】临时事件、重新规划与模糊时间共享

本节只增加可选参数和独立接口，P0–P2 及原个人规划输入继续兼容。

| 增量接口／字段 | 固定约定 |
|---|---|
| `ScheduleEventInput.shareBusy` / `ManualScheduleInput.shareBusy` | 可选 boolean，默认 false；仅允许将模糊时间显示给本人授权的团队；导入文件本身不能设置公开权限 |
| `GeneratePlanInput.replacePlanId` | 可选 UUID；必须是本人、同一项目的 confirmed 计划；生成草案保留原计划，确认时原子替换 |
| 计划视图 `replacesPlanId` | UUID 或 null；保留历史替换关系，不属于共享 DTO |
| `addEmergencyScheduleAction(input)` | `{ requestId, start, end, title?, shareBusy? }`；北京时间 `YYYY-MM-DDTHH:mm`，单次最多 7 天，title 最多 100 字，空时用「临时安排」，source 固定 emergency；返回原导入结果 |
| `saveScheduleSharingAction(input)` | `{ requestId, expectedRevision, teamIds: UUID[], shareWorkPlans: boolean }`；最多 50 个不重复当前团队；expectedRevision 指独立 sharingRevision，从 0 起；返回 `{ revision }` |
| `getMySchedule` 返回增加 | sharingRevision、sharedTeamIds、shareWorkPlans；事件含 shareBusy；只在本人页面返回完整字段 |
| `@/lib/schedule/planner`：`getReplanningSeed(actorId, projectId, id)` | 当前项目成员的本人 confirmed 计划，返回 `{ id, goal, mode, selections }`，用于带入表单；剩余工时仍需本人核对 |
| `@/lib/schedule/availability`：`getTeamAvailability(actorId, teamId, { startDate?, days? })` | 当前团队成员／教师可读；days 7 或 14，默认 7；严格使用下方共享 DTO |
| 同上：`getMyPlansNeedingReview(actorId)` | 本人未来 confirmed 计划，课表 revision 变化且本人仍在项目团队；最多 100 条，返回 id/projectId/projectName |

两个新 Action 导入路径仍为 `@/app/(app)/schedule/actions`，操作人由 session 提供，严格拒绝客户端身份字段；返回原 `Result<T>`，同请求重试不重复写入，旧版本返回 CONFLICT。事件是否共享使用该事件 revision 校验；团队共享使用独立 sharingRevision。只改变共享设置不改变日程 revision；仅改同一事件的 shareBusy 也不使工作计划过时。

未传 shareBusy 或传 false 的私有事件沿用升级前的请求内容哈希；旧成功导入可安全重放，不因新增默认字段报冲突，也不复活已删除日程。改为 true 属于新内容，必须使用新 requestId。

共享 HTTP 入口：`GET /api/teams/{teamId}/availability?from=YYYY-MM-DD&days=7`。未登录 401、非当前团队成员 403、无效范围／数据过多 400、内部失败 500；所有响应 `Cache-Control: private, no-store`。页面入口 `/teams/{teamId}/availability`，无匿名订阅链接。

共享 DTO 严格为 `{ team: { id, name }, startDate, endDate, timeZone: "Asia/Shanghai", members: [{ id, name, role, sharingEnabled, periods: [{ startAt, endAt }] }] }`。每段按半小时向外取整并合并重叠／相接片段；不返回事件 ID、名称、来源、备注、任务／项目 ID、目标或理由。只含当前成员主动授权的事件；工作时段需要额外 shareWorkPlans 授权且项目属于当前查看团队，只显示 confirmed 安排。最多 100 位成员、5,000 个事件、500 个计划；超过拒绝，不截断后当作空闲。未共享及零个公开时段均不能证明有空。撤回、退出后新请求重新检查权限。

重新规划快照包含原计划版本；新草案排程时忽略待替换原计划的时间，保留所有其他冲突约束。生成失败、取消草案、确认过期或快照冲突均保留原安排。确认在同一事务中取消原计划、确认新计划并更新新快照；另一替换草案随后不能确认，旧幂等请求不复活原计划。不改共享任务／迭代，不增加 E/F 事件枚举。迁移 `0014_emergency_availability`，旧课表／安排默认保持私有。
