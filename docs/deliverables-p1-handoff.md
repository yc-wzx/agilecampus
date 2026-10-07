# 唯笃队 D 模块 P1：教师反馈、版本重交与修改任务

> 本文记录 P1 交付范围。P2 统计、证据和教师说明已在后续实现，见 `docs/deliverables-p2-handoff.md`；下文“未做 P2”指 P1 当时范围。

日期：2026-09-29。本文件接续 P0，P1 的状态与接口以本文件为准。项目分支仍为 `codex/d-deliverables-p0`，继续沿用已有分支以保留所有未提交工作；未推送 GitHub。

## D 这次做了什么

你负责的后端现在支持“学生交报告 → 老师退回并给意见 → 学生把意见转为任务 → 修改后重交 → 老师验收通过”。每一版报告和对应意见都保留。

1. 教师和管理员可以通过或退回当前待审版本，退回必须填写意见。学生不能审核；任何人不能审核自己的成果。
2. 作者或管理员可以为需要修改或已通过的成果开始新草稿。草稿只给作者/管理员看，其他成员仍看到上一版正式提交。
3. 正式重交才生成第二版、第三版……；旧 URL、说明和验收意见不会被覆盖。
4. 教师和管理员可以给里程碑写文字反馈。
5. 学生/管理员确认任务标题、负责人、截止日后，可以将反馈转成一个修改任务。任务和关联一起保存；重复操作返回已有任务。
6. 成果提交、审核、里程碑反馈和反馈转任务，在主业务事务中保存稳定的事件，供 E/F 可靠接入。

这次没有代替 B 做页面，也没有实现 P2 总览统计或 P3 扩展。真实通知与完整页面联调仍由对应成员接入。

## 状态怎么理解

| 当前状态 | 可以做什么 | 操作结果 |
|---|---|---|
| draft | 作者/管理员编辑并正式提交 | submitted，生成第1版 |
| submitted | 教师/管理员审核当前版本；不能直接编辑或重交 | approved 或 changes_requested |
| changes_requested | 作者/管理员开始新草稿、编辑、显式重交 | 草稿期间仍保留需修改状态；重交后 submitted，生成新版本 |
| approved | 作者/管理员如需改动，先开始新草稿，再显式重交 | 草稿期间上一版仍是已通过；重交后 submitted，重新等待审核 |

完成修改任务不会自动批准成果。通知已读不会自动消除教师反馈。反馈始终关联具体 `versionId`。

`deliverable.revision` 是并发控制数字，编辑/提交/审核/开始新草稿均可能增加；`versionNumber` 是正式提交序号。两者不能当作同一个数字。

## 给 B：新增接口

导入路径仍为 `@/app/(app)/projects/[projectId]/deliverables/actions`，返回结构仍为 `{ ok: true, data }` 或 `{ ok: false, code, error }`，身份一律来自当前登录会话。

| Action | 参数 | 返回 data |
|---|---|---|
| `reviewDeliverableAction` | projectId, deliverableId, `{requestId, versionId, decision, comment?}` | `{deliverable, feedback, replayed}` |
| `startDeliverableRevisionAction` | projectId, deliverableId, `{requestId, expectedRevision}` | 带新 revision 的成果 |
| `addMilestoneFeedbackAction` | projectId, milestoneId, `{requestId, comment}` | `{feedback, replayed}` |
| `listProjectFeedbackAction` | projectId | 项目中的正式成果反馈及里程碑反馈 |
| `createTaskFromFeedbackAction` | projectId, feedbackId, `{requestId, title, description?, assigneeId?, dueDate?, priority?}` | `{feedbackId, taskId, originalTaskId, replayed, deleted}` |
| `getFeedbackTaskLinkAction` | projectId, feedbackId | 关联信息或 null |
| `listTaskFeedbackAction` | projectId, taskId | 该任务对应的来源反馈，供任务详情反向跳转 |

继续使用 P0 的保存草稿、详情、列表、正式提交接口；不要新增一套直接改 status 的接口。

### 成果详情返回变化

- `deliverable` 增加 `workingCopy`：作者/管理员可见的待提交内容，没有草稿或无权查看则为 null。初版 draft 的内容仍直接在成果字段中。
- 已有正式版本时，`deliverable.title/url/description/milestoneId` 始终表示最近正式提交；编辑表单应优先读取 `workingCopy`，不能把旧版本内容误当新草稿保存。
- `allowedActions` 增加 `startRevision` 和 `review`。`edit/submit` 表示当前是否有可编辑/提交的草稿。
- `versions` 继续按正式版本号倒序；`feedback` 包含该成果各版本的意见、审核者、决定及时间。按 `versionId` 展示到正确版本下。
- `listProjectDeliverables` 继续隐藏别人的初版草稿，同时展示 submitted/approved/changes_requested 的已提交成果。私有 workingCopy 不出现在普通成员/教师响应中。
- 内容是普通文本，页面用文本节点展示，不能直接拼为 HTML。

### B 应实现的操作顺序

1. 教师打开详情，取得当前最新正式版本 ID，选择通过或退回。通过值为 `approved`，退回为 `changes_requested`；退回意见不能为空，最多10000字。
2. 调用审核 Action。旧页面、已处理版本或不是最新待审版本会返回 `CONFLICT`：刷新后让老师重新确认，不要自动换版本再次审批。
3. 作者收到反馈后点击“开始修改”，传最新 `revision` 和本次操作的固定 requestId。
4. 将 `workingCopy` 填入编辑表单，复用 P0 编辑接口，保存时传最新 revision。
5. 用户明确点击“提交新版本”，才调用 P0 的提交接口。成功后刷新版本列表；旧版仍可打开。
6. 点击“将反馈转为任务”时，先展示可编辑的确认表单。默认说明可取反馈正文；负责人和日期由用户确认，不能点击查看意见就自动建任务。
7. 任务详情调用 `listTaskFeedbackAction` 展示来源；反馈旁调用 `getFeedbackTaskLinkAction` 展示任务入口。

创建/提交/审核等一次操作的网络重试复用原 requestId；不要每次重试都生成新值。相同请求标识配不同内容会冲突。审核重试可能返回 `replayed: true`，表示原审核已成功，不表示对当前新版本再次审核。

反馈转任务以反馈为单位只创建一个任务：换 requestId 再点也返回已关联任务。关联任务被删除后返回 `deleted: true, taskId: null, originalTaskId`，显示“原修改任务已删除”；不会静默创建第二个。确需另外安排任务时走普通任务创建流程。

## 权限与任务模块衔接

- 当前团队成员资格与角色在服务端重新校验；外队用户、退组用户不能用旧页面继续操作。
- teacher/admin 可以审核和写里程碑反馈，但不能审核自己的成果；其他管理员或教师可以协助审核。
- 保持原任务服务的角色规则：teacher 不创建修改任务，student/admin 确认后创建。
- 草稿编辑/新草稿/提交由作者 student 或有权 admin 完成，教师不能替学生直接改报告。
- 反馈任务复用 `createTask(..., { tx })`，没有第二套任务 CRUD，也没有改写 C 的任务服务。
- 反馈与任务关联按反馈 ID 加锁；任务创建、关联、事件写入在同一事务。关联保存失败时，不会留下无来源任务。
- 任务继承仍存在的反馈里程碑；负责人必须是当前团队成员；日期按 ISO 日期验证。里程碑已删除时仍能查看历史反馈，修改任务不再绑定该里程碑。

## 给 C：模型和升级

本次是在 P0 上的增量：

- `deliverable_status` 新增 approved / changes_requested。
- `deliverables` 增加可空 JSONB `working_copy`，保存新版本草稿及内部请求标识；旧数据默认为 null。
- `deliverable_feedback` 保存版本审核或里程碑文字反馈。同一正式版本最多一个有效审核；相同项目、审核者、请求标识唯一。
- `feedback_task_links` 每条反馈最多一个任务关联，保留删除任务的历史标识。
- `deliverable_outbox` 保存 D 模块尚待 E/F 接入的事件；它不是站内通知中心或通用活动记录系统。
- 迁移：`drizzle/0002_d_deliverables_p1.sql`。本机两库已应用，不能重复手工执行。

依旧沿用 P0 的数据库历史区分规则：已有 `db:push` 数据库不要直接重放初始化迁移；团队已有迁移链应在合并 schema 后由 C 生成自己的下一份迁移。不要覆盖他人的 `_journal.json` 或 snapshot。SQL包含枚举加值，应用升级需等迁移事务成功提交后再开始使用新状态。

本次升级校验了旧用户、项目、任务、成果、版本的行数和内容摘要一致。测试库加入一份明确的 P0 已提交成果作为升级样本，迁移后内容保留；随后测试按原规则清理专用测试库。

## 给 E/F：事件接入与真实边界

业务事务已经写入以下稳定事件：

| type | 稳定 eventKey | 默认接收人 |
|---|---|---|
| deliverable.submitted | deliverable.submitted:versionId | 当前教师/管理员，排除操作者 |
| deliverable.approved / deliverable.changes_requested | deliverable.reviewed:feedbackId | 当前仍在团队的成果作者，排除操作者 |
| milestone.feedback | milestone.feedback:feedbackId | 当前有权团队成员，排除操作者 |
| feedback.task_created | feedback.task_created:feedbackId | 修改任务负责人，排除操作者 |

只保存必要对象 ID，不把私有草稿正文塞进事件。正式提交、审核和关联失败时事件一起回滚；幂等重试不会再写一条事件。

服务端接入函数：`dispatchDeliverableEvents(sink, limit = 50)`，位于 `src/lib/deliverable-events.ts`。它不作为浏览器 Action 暴露。每次最多100条；并发工作者通过行锁跳过正在处理的事件；失败的事件留待下次重试。

E/F 应实现 sink：以 eventKey 去重，在自己的事务内保存活动记录与通知发送意图；对接成功后由 F 的发送流程调用外部渠道。函数执行前会再次过滤退组成员，提交待审事件也会过滤已不具备教师/管理员身份的接收人。F 在实际发信前还应检查当前访问权。

这是“至少一次”的交付：进程可能在 sink 成功后、标记完成前崩溃，因此 sink 必须以 eventKey 去重。不能把它宣称为外部消息绝对只发送一次。

**当前没有 E/F 的真实 sink 或定时工作者，也没有真实飞书发送验证。**主业务已保存，事件处于待接入状态；不会为了外部模块缺失把已成功的审核报成失败。P0 旧数据不补造历史事件。

## 展示前共同验收脚本

1. 学生提交第1版，教师看到 submitted 和具体 versionId。
2. 教师退回并写“补充访谈”，学生能读到这条意见。
3. 学生把意见转成任务，重复点击仍只有一个任务；任务能反查来源。
4. 学生开始新草稿，更换 URL；教师此时仍看到第1版内容。
5. 学生正式重交第2版，教师用旧第1版页面审批时收到冲突。
6. 教师刷新后批准第2版，两个版本和各自意见同时可查。
7. 再为已通过成果开始修改，审批状态不会被私下换内容；再次提交后需要重新审核。
8. 外队、其他学生、退组账号尝试写入均被拒绝。
9. E/F 接入后模拟通知渠道失败：主业务仍成功，事件可重试；检查无重复站内通知。

后端与 Action 自动测试结果见 `docs/deliverables-p1-validation.md`。页面交互、真实登录与外部通知的集成展示仍需 B/E/F 一起完成。
