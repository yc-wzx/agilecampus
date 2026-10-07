# B 模块 P1 / P2：交付与核对

日期：2026-10-07。范围：原六人任务书第 12.2 节 B 的 **P1 与 P2**，以及《P0—P2 统一接口标准（定稿）》中与 B 有关的固定契约。

**基线：**`master` = `edfe765f90acc11de613e7d84dac4a34c49c57c6`；本次交付**叠在 C 的 `feature/C`（PR #4，head `ff8d520616f6861d44913e0408627964f3cec324`）之上**，因为 B 的 P1/P2 依赖 C 的任务统计、当前迭代与迭代页面。P0 的核对与完善见 `docs/b-p0-completion.md`。

## 1. 本次交付

### P1

| 任务书条目 | 交付 |
|---|---|
| 教师/admin 显示通过或要求修改的表单；退回必须填意见 | `deliverables/review-form.tsx`：只针对**当前待审 versionId**；退回时意见必填（服务端同样强制）；冲突（版本已处理）提示刷新，不自动换版本再批 |
| 重交页面保留旧版本与反馈，明确“当前草稿 / 第 N 次提交 / 该意见对应哪个版本” | 成果详情页：每个版本下方挂**该版本自己的**意见；里程碑反馈单独一节；顶部标明当前草稿或当前正式成果，并提示“已有未提交的新版本草稿” |
| 反馈转任务：先确认表单，重复操作显示已有任务 | `deliverables/feedback-task-form.tsx`：预填标题与反馈正文，负责人/截止日/优先级由用户确认；同一反馈已有关联任务时直接显示入口；任务已删除时提示“原修改任务已删除”，不自动补建 |
| 双进展（任务完成数 / 成果通过·待验收·需修改） | 概览页分别渲染 `TaskProgress`（C-T08 主任务口径）与 `DeliverableProgress`（D 成果口径）；无数据显示“暂无”，不写 100% |
| 空项目引导（目标/里程碑/任务/成员/迭代，允许跳过） | `components/projects/setup-guide.tsx` + 概览页按真实数据推导五项；可“暂时跳过”；**没有**“标记完成”开关；没有编辑入口的目标项不放假链接 |

另外，`开始修改（新建草稿）` 走 D 的 `startRevision`：先建草稿 → 编辑 → 显式“提交新版本”，旧版本与旧意见不覆盖。**任务 → 反馈** 的反向链接由 C 的任务详情面板提供（已确认 C 的面板读取 D 的来源反馈），B 只补了**反馈 → 任务**这一侧。

### P2

| 任务书条目 | 交付 |
|---|---|
| 给 A 可复用 TeacherProjectCard / RiskCard，不另建统计逻辑 | `components/projects/teacher-project-card.tsx`、`risk-card.tsx`，固定路径与 props（`{item: TeacherProjectOverview}` / `{item: RiskItem}`）；只展示，不在浏览器重算阈值；待处理事项与风险分开显示；单项不可用显示“暂时不可用”而不是 0 |
| 证据页与 Markdown 导出 | 已交付 **成果过程证据页** `/projects/[projectId]/evidence`：按类别（正式提交/版本审核/里程碑反馈）、成果类型、成果作者、里程碑、日期区间筛选；每条带**作者与操作者两种身份**、来源原记录链接与稳定证据键；Markdown 导出**逐页取全量**（上限 1000，达到上限如实标注 truncated）。数据来自 D 第 7 节证据服务；任务/迭代/评论类证据待 E 的统一证据服务（E-V01）在同一页追加 |
| 与 A 做真实试用 | **未做**，需要真人参与，见第 4 节 |

## 2. 合入 C 的 `feature/C`

C 交付了 40 个文件（迁移 0004–0007、`task-contract`、`iteration`、`TaskDetailPanel`、迭代与任务页面、`contracts/p0-p2.ts`）。双方改动集合只有 **2 个文件重叠**，处理如下：

| 冲突文件 | 处理 |
|---|---|
| `src/contracts/p0-p2.ts` | **采用 C 的版本**（C 负责最终整合），在其后**追加** D/E/F/B 的 7 个标准固定 DTO：`ProjectDeliverableStats`、`ActivityItem`、`AnnouncementItem`、`RiskItem`、`ProjectRiskResult`、`PendingItems`、`TeacherProjectOverview`。未改动 C 已发布的任何类型 |
| `src/app/(app)/projects/[projectId]/page.tsx` | **采用 C 的版本**（多了迭代入口），只把导航块换成 `<ProjectNav projectId={projectId} current="tasks" />` 并加一行 import |

顺带打开迭代入口：`project-nav.tsx` 的 `ITERATION_ENTRY_ENABLED` 由 `false` 改为 `true`（C 已交付 `/projects/[projectId]/iterations`）。

**测试库按 C 的 schema 重建**（24 张表，`tasks` 新增 `sprint_id` / `is_blocked` / `blocked_reason` / `blocked_at` / `acceptance_criteria`）。本次**没有改任何迁移文件**。

## 3. 验证记录

### 3.1 静态检查与构建

| 检查 | 结果 |
|---|---|
| `tsc --noEmit` | **0 error** |
| `eslint .` | **0 error**，1 条上游既有 warning（`tests/agent-api.test.ts` 未使用的 `joinTeam`） |
| `npm run build`（Next.js 16.2.10 / Turbopack） | 通过 |
| `vitest run`（真实 PostgreSQL 18） | **491 passed / 2 skipped**（共 493 项；在 C 的 452 项基线上替换并净增 41 项：B-G01 7、卡片渲染 6、引导步骤 7、页面组件 5、成果表单与进度 10、证据 Markdown 6、导出 Action 5；2 项跳过为真实 DeepSeek 凭据测试） |

### 3.2 真实数据库 + 真实会话的页面验证

播种：一个数据齐全的项目（2 个主任务 + 1 个子任务、已开始的迭代、一个被退回的成果、一个待验收成果、一个空白项目），生产构建 + Auth.js JWT 会话访问真实端点。

| 场景 | 期望 | 实测 |
|---|---|---|
| 学生 `/projects/{A}/overview` | 200；真实当前迭代、双进展、里程碑 | 200，含“第一轮迭代”“中期答辩”；**不再出现**“当前迭代待接入” |
| 学生 `/projects/{B}/overview`（空白项目） | 200；出现起步引导与“暂无” | 200，五步齐全 + `/iterations`、`/teams/` 真实链接；无“0/0”“100%” |
| 学生成果详情（被退回） | 200；开始修改 + 转任务 + 旧版与意见 | 200，含“开始修改（新建草稿）”“将这条意见转为修改任务”“第 1 版”“要求修改”“李老师”“请补充三场访谈记录”；**不出现**教师验收表单 |
| 教师成果详情（待验收） | 200；验收表单 | 200，含“教师验收 · 当前待审第 1 版”、两个决定单选、意见文本域（`review-comment`）；**不出现**学生的开始修改/转任务 |
| 学生 `/projects/{A}/iterations` | 200（C 的页面） | 200 |
| 学生 `/projects/{A}/evidence` | 200；列出正式提交与版本审核，作者与操作者分列，来源可打开 | 200，共 3 条（2 提交 + 1 审核），含“作者 张同学；操作者 李老师”“打开来源原记录”“导出 Markdown” |
| 同上 `?kind=review` | 只出现版本审核 | 200，只剩审核条目，另一份成果不再出现 |
| 同上 `?milestoneId=` | 只出现该里程碑下的记录 | 200，仅“用户调研报告”相关证据 |
| **非成员**访问 `/evidence` | 404 | **404**（段 layout 保证硬 404） |
| 未登录访问 `/evidence` | 跳登录 | **307** |
| 导出 Action（真实数据库 5 项） | 未登录 UNAUTHENTICATED；非成员 FORBIDDEN；成员得到含两类与来源的全文；按类别筛选生效；非法日期区间 VALIDATION | **5/5 通过** |
| 任务看板导航 | 出现“迭代”入口 | 200，导航含概览/任务/迭代/成果/时间线 |

### 3.3 局限（如实记录）

- 未做浏览器交互测试（无 Playwright）：审核表单的点击提交、转任务表单展开后的交互、防双击属于代码路径复核 + 服务端测试覆盖，未在真实浏览器里点过。
- **AI 与飞书未测**（无凭据）。
- 用的是本机临时 PostgreSQL 与测试库，不是团队开发库。
- 教师总览页面属于 A，本次只交付卡片组件本身，未在 A 的页面上真实验证组合效果。

## 4. 未完成 / 阻塞（必须如实说明）

| 项 | 阻塞原因 | 现状 |
|---|---|---|
| 项目公告展示与管理组件嵌入（P1） | **F 未交付** `@/components/announcements/project-announcement` 与 `announcement-manager`，也没有 `@/lib/announcement` | 概览页的 `pinnedAnnouncement` 保持 `QueryPart.unavailable`，显示“待接入（F-A02 getPinnedAnnouncement）”，**没有造假组件** |
| 证据页里的任务/迭代/评论证据（P2） | **E 未交付** `@/lib/evidence`、`@/lib/risk`、`@/lib/activity` 及其 Actions | 成果与反馈证据页**已交付**（走 D 第 7 节服务，真实数据与来源）；E 交付后用 `listProjectEvidence`（E-V01）扩展到 `task_activity/iteration_history/comment` 三类，筛选与导出框架已就绪 |
| 风险数据 | **E 未交付** `E-K01 listProjectRisks` | `RiskCard` 已按固定 props 交付并测试；教师卡片的风险区显示“暂时不可用”，不显示“未发现风险”（避免把缺数据说成没风险） |
| 最近活动 | **E 未交付** `E-A02` | 教师卡片显示“待接入（E-A02）” |
| 真实试用与修复（P2） | 需要真人按 `docs/b-p0-apply-guide.md` 第 5 节的清单操作 | 未做 |
| 项目简介/目标的编辑入口 | 仓库本来就没有项目编辑页（`docs/BACKLOG.md` 已记“项目无编辑/归档入口”） | 起步引导的目标项**不给“去完成”链接**，只说明需要管理员补充；不放假链接 |

## 5. 接入点（依赖交付后要改的地方）

| 时机 | 改哪里 | 怎么改 |
|---|---|---|
| F 交付公告组件 | 概览页 | 把 `project-overview-summary.ts` 里的 `pending<AnnouncementItem \| null>(...)` 换成 `queryPart("项目公告", () => getPinnedAnnouncement(actorId, projectId))`，并在页面嵌入 `ProjectAnnouncement` / `AnnouncementManager` |
| E 交付活动服务 | 同上 | 把 `pending<PageResult<ActivityItem>>(...)` 换成 `listProjectActivities` |
| E 交付风险服务 | 教师卡片数据源 | 由 A 的教师总览把 `E-K01` 结果填进 `TeacherProjectOverview.risks`；`RiskCard` 已就绪 |
| E 交付证据服务 | 新增证据页与导出 | 按第 9.5 节接 `E-V01/02/03`；D 的成果证据 `listDeliverableEvidence` 可直接复用 |
| C 整合公共类型 | `src/contracts/p0-p2.ts` | 保留字段名与语义，只做追加 |

## 6. 本地复现

```bash
npm ci
npm test            # 期望 458 passed / 2 skipped
npm run lint        # 期望 0 error（1 条上游既有 warning）
npx tsc --noEmit    # 期望 0 error
npm run build
```

页面自查要点：用一个**被教师退回**的成果打开详情，确认能看到旧版本、对应意见、“开始修改”与“将这条意见转为修改任务”；再用**教师账号**打开一个**待验收**成果，确认只出现验收表单、不出现学生操作；最后用空白项目确认起步引导五步与“暂无”状态。
