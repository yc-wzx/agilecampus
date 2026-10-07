# 唯笃队 D 模块 P2：验收统计、个人待办与可追溯证据

日期：2026-09-29。接续已实现的 P0、P1；本文件说明 P2 新增部分。继续使用本地分支 `codex/d-deliverables-p0`，保护此前全部未提交工作。未推送 GitHub。

## 你作为 D，这次做出了什么

1. **本人待修改成果**：学生只看到自己作为成果作者、当前被要求修改的成果，附对应版本与教师意见。管理员代为提交的报告仍归原作者，不归管理员。
2. **项目验收统计**：提供待验收、需修改、已通过数量；同一成果不因提交多版而重复计数。
3. **教师项目统计列表**：教师只看到自己当前作为 teacher/admin 的团队项目。默认不显示归档项目，空项目返回真实的零。
4. **成果证据列表**：逐条提供正式提交、版本审核、里程碑文字反馈，标明时间、原作者、实际操作者和来源链接。
5. **可打开的证据原记录接口**：来源链接对应实际实现的只读 HTTP 接口，登录后仍需当前项目权限；不是公开分享链接。
6. **权限与并发复核、教师说明**：补充隐私、日期、分页、退组、角色变化、并发编辑提交及接口测试。教师操作表见 `docs/deliverables-teacher-guide.md`。

这些都是 D 的数据与规则层。A 的工作台/教师总览、B 的成果/证据页面、E 的 Markdown 导出仍需接入；没有把数据接口当作完整页面已经上线。

## 新增文件与接入方式

| 文件 | 用途 |
|---|---|
| `src/lib/deliverable-reporting.ts` | 查询、统计、证据筛选与原记录读取 |
| `src/app/(app)/projects/[projectId]/deliverables/actions.ts` | 在已有12个 Action 上新增4个查询 Action |
| `src/app/api/projects/[projectId]/deliverable-evidence/[kind]/[recordId]/route.ts` | 证据来源 GET 路由 |
| `drizzle/0003_d_deliverables_p2.sql` | 反馈历史里程碑 ID 增量字段与可验证回填 |
| `tests/deliverable-p2.test.ts` | 统计、证据、权限、日期、分页、并发与回填测试 |
| `tests/deliverable-p2-actions.test.ts` | 查询 Action 与来源路由测试 |

客户端沿用现有 Actions 导入路径：`@/app/(app)/projects/[projectId]/deliverables/actions`。每次从当前 session 取用户，不接受客户端代传查询者身份。

服务端可直接调用 reporting 中的同名业务函数，首参数为可信登录用户 ID。不要拿表单、URL 参数或 AI 输出中的 actorId 充当当前查询者。

| Action / 对应服务函数 | 参数（Action 无 actorId 参数） | 使用方 |
|---|---|---|
| `getProjectDeliverableStatsAction` / `getProjectDeliverableStats` | projectId | B 项目概览、A 教师项目卡 |
| `listTeacherDeliverableStatsAction` / `listTeacherDeliverableStats` | `{includeArchived?, offset?, limit?}` | A 教师总览 |
| `listMyRevisionRequiredDeliverablesAction` / `listMyRevisionRequiredDeliverables` | `{projectId?, includeArchived?, offset?, limit?}` | A 学生工作台 |
| `listDeliverableEvidenceAction` / `listDeliverableEvidence` | projectId, `{kind?, authorId?, actorId?, milestoneId?, type?, fromDate?, toDate?, offset?, limit?}` | E 答辩证据、B 证据页面 |

查询返回仍为 `{ok:true,data}` 或 `{ok:false,code,error}`。请求失败必须显示失败，不能当作“0份成果”或空记录。

## 统计口径：必须所有页面一致

```ts
{
  projectId,
  projectStatus: "active" | "archived",
  byStatus: { submitted: 1, changes_requested: 1, approved: 1 },
  total: 3,
  approvedRatio: 1 / 3,
  scope: "current-submitted-deliverables"
}
```

- `total` 是当前已经正式提交过的成果数，不是提交版本数、反馈数或任务数。
- 初版 draft 不计数，即使管理员有权看到所有草稿，也不会向其他页面透露草稿数量。
- 需修改成果开始私有草稿后仍计为 changes_requested；已通过成果开始私有草稿后仍计为 approved。只有正式重交才转为 submitted。
- `approvedRatio` 是 0—1 的比值；没有正式成果时为 null，不显示100%通过。页面可显示“暂无已提交成果”。
- 这是成果验收进展，不是学生贡献比例，也不是任务完成度。不可据此生成成员分数或排名。
- 项目统计允许当前有项目访问权的学生、教师和管理员读取，便于 B 展示项目共同进度。
- 教师统计列表按每个团队的当前角色筛选；一个人在甲团队是教师、乙团队是学生，只在教师总览看到甲团队项目。若没有任何 teacher/admin 成员身份，返回 FORBIDDEN。
- 归档项目在每日待办和教师列表中默认排除；显式 `includeArchived: true` 可查询历史。直接查询已归档项目统计或证据仍要求项目访问权。

教师列表的外层 `total` 是匹配项目数，`items[i].total` 才是该项目成果数。不能把分页项目数当成果总数。

## 本人待修改成果

返回分页对象，每项包含：

- 成果 ID、项目 ID/名称/状态、正式成果标题和类型。
- 原作者 ID、最新正式版本 ID/版本号、提交时间。
- 最新退回反馈 ID、意见、审核者 ID及审核时间。
- `hasWorkingCopy`：是否已经开始新草稿；不返回私有正文。
- `canRevise`：当前角色是否允许修改；作者后来变成 teacher 时不会错误显示可修改按钮。
- `sourceHref`：该退回意见的真实来源接口。

列表只查登录者作为原作者的成果，不把协助提交者当作者。正式重交后离开列表；通知已读不会移除它；开始草稿但未提交时仍保留。

## 证据字段与筛选

每条证据有：

| 字段 | 含义 |
|---|---|
| `evidenceKey` | kind:id，作为页面和导出的稳定去重键 |
| `id / kind` | 原记录 ID；submission、review 或 milestone_feedback |
| `projectId / deliverableId` | 所属项目与成果；里程碑文字反馈没有成果 ID |
| `versionId / versionNumber` | 对应正式版本；里程碑文字反馈为空 |
| `title / type / url / description` | 正式版本内容；没有对应内容的字段为空 |
| `authorId` | 原成果作者；里程碑文字反馈为空 |
| `actorId` | 实际提交人或反馈/审核人，不能与作者混用 |
| `occurredAt` | 真实提交或反馈时间，以 UTC ISO 字符串返回 |
| `milestoneId / milestoneTitle` | 当时的里程碑 ID/名称；能查证时保留删除后的历史 |
| `decision / comment` | 审核决定或里程碑反馈；提交事件本身没有审核决定 |
| `sourceHref` | 需要登录及权限的来源接口相对路径 |

筛选说明：

- `authorId` 找此人的成果及其相关审核；`actorId` 找此人实际做出的提交/反馈操作。两者同时传入表示交集。
- `type` 与成果类型枚举相同；里程碑文字反馈没有成果类型，按 report 等类型筛选时不会混入。
- `milestoneId` 可以是已经删除的历史里程碑 ID，不要求它仍在当前里程碑表中。
- `fromDate` 包含开始日，`toDate` 不包含结束日。统一 Asia/Shanghai。例如查询10月2日，传 `fromDate:"2026-10-02", toDate:"2026-10-03"`。
- `kind` 可只查正式提交、审核或里程碑反馈。
- 日期、ID、类型、分页参数和额外未知参数全部在服务端校验。

证据仅来自正式版本和正式反馈，即使查询者是作者或管理员，也不导出初版草稿、新版本 workingCopy、内部请求标识、创建校验哈希或登录信息。原作者/操作者使用明确 ID，不自动生成“独立完成”“贡献百分比”等结论；显示姓名时由 E 使用有权数据映射。

## 来源链接实际如何工作

路由：`GET /api/projects/{projectId}/deliverable-evidence/{kind}/{recordId}`。

路由 kind 只接受 `submission` 或 `feedback`，与列表中的三种 kind 不同：review 和 milestone_feedback 都使用 feedback 路由。

- 成功返回 `{data:证据记录}`，目前是 JSON 原记录，不是 B 的漂亮详情页面。
- 未登录401、无权/不存在/串项目403、格式无效400、服务异常500。
- 设置 `Cache-Control: private, no-store` 与 `Vary: Cookie`，避免缓存其他用户的数据。
- 每次重新核查当前成员资格。把 URL 发给别人不会赋予访问权；退出团队后原 URL 也不可读。
- E 导出到 Markdown 时，使用实际部署站点的受信任 origin 拼接相对路径，不得把 localhost 或虚构线上地址写成已上线链接。
- 后续 B 可以增加界面跳转，但不能用尚未实现的页面替换这里可核实的来源接口。

外部报告/视频 URL 的第三方阅读权限仍由提交人设置，本接口不能绕过腾讯文档或其他服务的权限。

## 分页与一致性

列表默认 limit=50，最大100；offset默认0。统一返回 `{items,total,offset,limit,nextOffset}`，证据列表还返回 timezone。

每次查询使用只读、可重复读数据库事务，使权限读取、total 和本页内容来自同一个数据库快照。教师项目列表按项目 ID 排序；证据按时间降序，再按 kind 和 ID 排序，解决同一时刻多条记录的顺序问题。

不同分页请求是不同快照，期间如有新提交或删除记录，页内容可能变化。E 导出应在固定演示版本/暂停编辑期间读取全部页，用 evidenceKey 去重并核对 total；不能只导出第一页却说“已导出全部”。这不是一个长期冻结数据库的导出会话。

## 给 C：P2 数据变更

只新增 `deliverable_feedback.milestone_snapshot_id`（可空 UUID，无外键），保留历史里程碑身份；P1写反馈时同时保存它。

`0003_d_deliverables_p2.sql` 回填顺序：

1. 优先采用关联正式版本里的历史里程碑 ID，否则采用尚存在的反馈里程碑 ID。
2. 对删除了里程碑的独立文字反馈，仅在项目、反馈 ID、事件类型和稳定 eventKey 匹配时，从 P1 事务事件取原 ID，并检查 UUID 格式。
3. 没有可信来源时保持 null；不通过同名标题猜测阶段。

本机开发/测试库已应用，旧字段行数与内容摘要未变，不要重复执行添加字段。团队合并仍由 C 根据实际迁移历史生成/接入；不覆盖他人的 journal/snapshot，不重跑初始化迁移，不清库。

## 当前完成边界

D 的 P0/P1/P2 服务代码、Actions、来源接口、数据迁移、自动测试与交接说明已提供。仍需：

- A/B 接实际页面，展示统计、待办和老师操作。
- E 接证据筛选与最终导出。
- E/F 接 P1 的事件交付与真实通知渠道。
- C 合入团队分支并验证团队数据库升级。
- F 部署服务器，组织浏览器真实账号验收。

实际测试记录见 `docs/deliverables-p2-validation.md`，教师说明见 `docs/deliverables-teacher-guide.md`。
