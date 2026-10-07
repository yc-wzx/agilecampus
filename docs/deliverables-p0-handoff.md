# 唯笃队 D 模块 P0：成果保存与提交交接

> 本文保留 P0 交付记录。后续 P1、P2 已增量实现，请同时阅读 `docs/deliverables-p1-handoff.md` 与 `docs/deliverables-p2-handoff.md`；下文未完成项仅描述 P0 当时范围。

日期：2026-09-29。开发基线：`632367b5ff66396f60692ad9b4817dfd0f605a1f`，工作分支：`codex/d-deliverables-p0`。

本次从已有本地项目增量开发。目录中原先的 Vercel/Neon 等未提交改动保留，本文件仅说明 D 的新增部分。D 的 P0 服务实现不等于全组阶段已经验收完成。

## 你作为 D，实际做了什么

你负责“报告交上来后，网站怎样正确保存”。这次做出了五项能力：

1. 保存成果草稿：报告、PPT、视频、问卷、代码、原型、Demo 或其他链接。
2. 作者继续编辑自己的草稿，管理员可以协助；其他学生和教师看不到别人的未提交草稿。
3. 正式提交前检查链接和里程碑；提交后团队成员可查看。
4. 正式提交同时保存第一版快照，包括内容、提交人、时间和当时的里程碑名称，之后不能用编辑草稿接口覆盖。
5. 防止双击创建/提交产生重复记录；旧页面不能覆盖或提交另一页面刚修改的内容。

直观例子：学生保存“用户调研报告”草稿时，同组其他学生看不到；补好链接后正式提交，教师才能看到。此时不能直接把已提交报告链接换掉，避免老师看的内容在后台发生变化。

本阶段只包含 `draft → submitted`。教师通过/退回、第二版重交、反馈转任务属于 P1；待修改统计与证据接口属于后续阶段。没有伪造按钮，也没有把这些写成已完成。

## 文件与负责人

| 文件 | 用途 | 接入人 |
|---|---|---|
| `src/lib/deliverable.ts` | 统一读写、权限、输入校验、提交事务与并发处理 | D 维护，其他模块复用 |
| `src/app/(app)/projects/[projectId]/deliverables/actions.ts` | 五个基于现有登录会话的 Server Actions | B 调用 |
| `src/db/schema.ts` 末尾成果部分 | 两张新表、两个新枚举，旧表未改 | C 整合 |
| `drizzle/0001_d_deliverables_p0.sql` | 本次加法迁移 | C/F 审阅并接入实际迁移流程 |
| `drizzle/meta/0001_snapshot.json`、`_journal.json` 新条目 | 本地 Drizzle 生成记录 | C 与团队其他迁移合并 |
| `tests/deliverable.test.ts` | 真实 PostgreSQL 业务与权限测试 | D 自测，B/C 复测 |
| `tests/deliverable-actions.test.ts` | 使用真实业务服务和数据库的 Action 测试；登录会话/缓存使用替身 | D 自测，B 接口联调 |

没有替 B 编写成果页面。因此现在不能通过一个新网页直接演示这段流程；可以运行真实数据库测试验证，B 接入下述 Actions 后再做登录页面的完整联调。

## 给 B：接口契约

Server Component 使用 `src/lib/deliverable.ts` 的查询函数时，先从 `auth()` 取当前用户；不要把浏览器传来的用户 ID 当作登录身份。客户端页面直接调用下列 Actions，身份由服务端会话确定。

导入路径：`@/app/(app)/projects/[projectId]/deliverables/actions`。

| Action | 参数 | 成功返回的 `data` |
|---|---|---|
| `listDeliverablesAction` | `projectId` | 有权成果数组，每项带 `allowedActions` |
| `getDeliverableAction` | `projectId, deliverableId` | `{ deliverable, versions }` |
| `createDeliverableDraftAction` | `projectId, input` | 新草稿或同一请求已创建的成果 |
| `updateDeliverableDraftAction` | `projectId, deliverableId, input` | 更新后的草稿，包含新的 `revision` |
| `submitDeliverableAction` | `projectId, deliverableId, input` | `{ deliverable, versionId, replayed }` |

所有 Action 返回：

```ts
{ ok: true, data: /* 对应业务结果 */ }
// 或
{ ok: false, code: "UNAUTHENTICATED" | "FORBIDDEN" | "VALIDATION" | "CONFLICT" | "INTERNAL", error: "可显示给用户的说明" }
```

数据库异常不向浏览器输出 SQL、连接信息或内部堆栈。成功后的缓存刷新失败不改报“保存失败”；接口错误也不能被页面当作空列表。

### 表单字段

| 字段 | 约定 |
|---|---|
| `title` | 去除首尾空格后 1—200 字 |
| `type` | `report / presentation / video / survey / code / prototype / demo / other` |
| `url` | 最多 2048 字；草稿可空，提交必填；只接受完整 HTTP/HTTPS，不接受账号密码或控制字符 |
| `description` | 最多 10000 字，省略时为空字符串 |
| `milestoneId` | 同项目里程碑 UUID，或 `null`；省略时解除关联 |
| `requestId` | 创建与正式提交必填 UUID，用于区分一次用户操作及它的网络重试 |
| `expectedRevision` | 编辑与提交必填；使用页面最近一次读到的 `revision` |

创建不接受 `authorId/status/projectId` 等额外字段，不能把整个数据库对象直接展开回传。编辑使用完整表单，不是稀疏 patch；请保留当前说明、链接和里程碑，避免省略后变为空值。

类型展示：report=报告、presentation=PPT、video=视频、survey=问卷、code=代码、prototype=原型、demo=Demo、other=其他。时间字段是 `Date`，界面按 Asia/Shanghai 展示。

### 调用顺序

```ts
// 由客户端为“这一次创建”生成并保留。超时重试必须复用，不能每次点击换新 key。
const createRequestId = crypto.randomUUID();
const created = await createDeliverableDraftAction(projectId, {
  title: "用户调研报告",
  type: "report",
  url: "https://example.com/report-v1",
  description: "第一阶段调研结果",
  milestoneId: null,
  requestId: createRequestId,
});
if (!created.ok) { /* 展示 created.error，停止下一步 */ return; }
const draft = created.data;

// 用户明确点击“正式提交”时再调用；不要把保存草稿自动当作提交。
const submitRequestId = crypto.randomUUID();
const submitted = await submitDeliverableAction(projectId, draft.id, {
  expectedRevision: draft.revision,
  requestId: submitRequestId,
});
// 网络失败时保留 submitRequestId 和原 expectedRevision，用同一组参数重试。
// 成功后刷新列表和详情；冲突时展示说明并重新读取，让用户确认，不自动覆盖。
```

首次生成的请求标识建议在当前编辑流程保存，直到结果明确；同一创建标识用于不同内容会返回冲突。编辑成功后采用返回的新 `revision`。重复编辑旧 revision 返回冲突，不会再覆盖内容。

`allowedActions.edit / submit` 控制当前页面按钮；后端仍然重复校验，不能因为前端允许就跳过鉴权。`submitted` 时二者均为 false。本阶段不出现“通过/退回/重交”按钮。

列表与详情都过滤草稿隐私；详情中的 `versions` 按版本号倒序，目前只有正式提交生成的第1版。外部链接只保存，不由服务端下载、探测或转存。链接的第三方阅读权限由提交人自行确认，不能保证腾讯文档或视频链接一定对所有人开放。

## 权限表

以下都要求用户当前仍是项目所属团队成员。

| 操作 | 成果作者 student | 其他 student | teacher | admin |
|---|---|---|---|---|
| 创建自己的草稿 | 可以 | 可以创建他自己的 | 不可以 | 可以 |
| 查看该草稿 | 可以 | 不可以 | 不可以；若是自己的历史草稿则可读 | 可以 |
| 编辑/提交该草稿 | 可以 | 不可以 | 不可以 | 可以协助 |
| 查看正式提交及版本 | 可以 | 可以 | 可以 | 可以 |
| 覆盖已提交内容 | 不可以 | 不可以 | 不可以 | 不可以 |
| 审核通过或退回 | P1 实现 | P1 实现 | P1 实现 | P1 实现 |

最后一行只是后续范围说明：P1 也不会允许普通学生审核。authorId 由会话用户确定；管理员协助提交时版本同时保留原作者和实际提交人。注册时自填信息不参与角色判断。

## 给 C：模型、迁移和并发规则

- 新表 `deliverables`：成果当前内容、作者、项目、可选里程碑、状态、revision、请求去重信息和时间。
- 新表 `deliverable_versions`：正式提交快照、版本号、原草稿 revision、提交请求标识、原作者、实际提交人和里程碑快照。
- 新枚举 `deliverable_type` 与 `deliverable_status`。P0 状态只有 draft/submitted，P1 再加审核状态，不预建空反馈系统。
- 创建按 `(projectId, authorId, creationKey)` 唯一；同 key 但不同创建内容返回冲突。
- 版本按 `(deliverableId, versionNumber)` 和 `(deliverableId, submissionKey)` 唯一。
- 编辑和提交先锁定成果行，再检查 revision；同一草稿并发提交只有一个生效。更新状态与插入快照在同一事务。
- 写入会锁住当前项目/成员记录，角色变更或退组与写入有确定顺序；不新增项目成员体系。
- 里程碑必须属于成果项目；版本中的里程碑 ID/名称为快照，删除原里程碑不会重写历史。
- P0 没有删除成果/版本的公开业务入口。删除整个项目或作者账号仍遵循新表外键 cascade；这是数据库级删除，不是“版本永远不可能删除”的承诺。

本机原来使用 `db:push` 建表。本次已在 localhost:55432 的 `agilecampus_test` 和 `agilecampus` 中，单独以事务执行本次增量 SQL，没有重放初始化 SQL，也没有删除旧表。迁移前后已有用户、项目和任务行数一致。

**C 接入时按自己的数据库状态选择一种方式：**

1. 团队已有正常的 Drizzle migration 历史：整合 schema 后重新生成下一个迁移，审阅只新增本模块表和枚举，再在备份/测试库验证后运行正常迁移。
2. 现有数据库与本机一样由 `db:push` 初始化：先核查 schema 和迁移历史，使用本次增量 SQL或经审阅的 schema push；不要直接重跑 `0000_init.sql`，也不要把别人的 `_journal.json` 覆盖上去。
3. 全新空数据库：可以使用完整匹配的 schema 和迁移链初始化；初始迁移文件在本项目已有的未提交部署改动中，转交时必须确保它也存在。

本次 SQL 不是可反复执行的脚本；本机两库已应用，不要再次手工运行。没有清库要求。还未在团队服务器验证，也未声称完成 C 的阶段集成。

## 给 E/F：后续接入点

目前源代码中没有规划中的统一活动事件/站内通知模块，因此本次没有另造一套事件或通知表。`submitDeliverable` 的事务中生成版本并更新成果，未来 E 的“成果已提交”事件必须在同一事务追加，失败时一起回滚。

可采用 `deliverable.submitted:<versionId>` 作为稳定事件标识；F 以事件标识、接收人和渠道去重，事务成功后再发送外部消息。`replayed: true` 是已完成提交的重试，不能再次发通知；它不能替代可靠的持久化事件。

这部分是待联调约定，不是已实现的事件投递。P1 教师验收、反馈和通知在对应阶段继续开发。

## 如何验证和交接

确保 `.env.test` 指向专用测试数据库；现有测试会清理测试库数据，不能把它指向开发或生产库。

```powershell
npm test -- tests/deliverable.test.ts tests/deliverable-actions.test.ts
npx tsc --noEmit
npm run lint
npm run build
```

完整项目回归使用 `npm test`。不要让 dev 和 build 同时写同一个 `.next`。

B 页面接好后，另一个成员按以下步骤验收：

1. 用学生甲保存草稿，刷新后仍存在。
2. 用学生乙和教师访问列表及同一详情，不能看到甲的草稿；管理员可查看。
3. 甲填入其他项目的里程碑或非法链接，服务端拒绝；改为本项目里程碑和有效链接后保存成功。
4. 两个窗口打开同一草稿，甲窗口保存后，乙窗口用旧 revision 保存或提交，收到冲突说明。
5. 正式提交；教师和同组学生能够查看。重复发送同一提交请求只存在一份版本。
6. 再调用编辑接口修改已提交链接，拒绝覆盖。
7. 查看版本中的提交时间、作者、实际提交人和里程碑快照。
8. 外队账号访问、退组后用旧页面访问或提交，均被拒绝。

业务测试已经覆盖真实数据库保存与并发；Action 测试模拟登录会话及缓存，不等于真实浏览器登录联调。具体命令结果见 `docs/deliverables-p0-validation.md`。
