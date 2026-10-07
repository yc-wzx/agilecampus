# B 模块 P0：核对结果与本次完善

日期：2026-10-07。范围：原六人任务书第 12.2 节 B 的 **P0**，以及《P0—P2 统一接口标准（定稿）》中与 B 有关的固定契约。

> **P1 / P2 的交付见 [`docs/b-p1-p2-completion.md`](b-p1-p2-completion.md)**（含合入 C 的 `feature/C`、审核/重交/反馈转任务页面、空项目引导、教师卡片，以及 E/F 未交付导致的阻塞项）。P0 阶段标为“待接入”的当前迭代与主任务口径统计，已在 P1 接入 C 的真实服务。

**基线：**团队仓库 `yc-wzx/agilecampus` 的 `master`，提交 `edfe765f90acc11de613e7d84dac4a34c49c57c6`（Merge PR #2；与《统一接口标准》记录的核对基线一致，已通过 GitHub API 复核）。仓库内 `docs/b-p0-review.md` 记录的补齐已经在该基线里，本次不重复，只在其上补缺口。

## 1. 结论

B 的 P0 核心链路（项目概览、成果列表 / 草稿 / 编辑 / 正式提交 / 详情 / 版本）在基线里已经接通 D 的真实服务。本次核对发现并补齐了 **7 类缺口**，其中两处是会在验收时被直接判为问题的：

1. **项目概览没有固定聚合入口**（标准第 9.1 节要求 `@/lib/project-overview-summary` 的 B-G01），页面直接串了两个服务，任一失败整页 500。
2. **成果统计失败会显示成整页错误**，没有“局部不可用”的概念，违反第 3.3 节“请求失败不能显示成空数据”。

其余为：缺少固定路径的共用展示组件、缺少真实加载态、缺少字段级错误提示、缺少深链接定位、项目内部导航在四个页面各写一份且不一致、以及 B 应向 C 交付的侧边栏交互约定与复用样式一直没有交付物。

## 2. 逐条核对（B 的 P0）

| P0 要求（任务书 12.2） | 核对前 | 本次处理 |
|---|---|---|
| 1. 项目概览显示名称、简介/目标、日期、里程碑和任务统计 | 已有 | 保留；改由 B-G01 聚合，代办事项与口径说明更明确 |
| 2. 项目入口采用概览/任务/迭代/成果；甘特保留；AI 可找到 | 部分 | 抽出共用导航组件，四个页面统一；**迭代入口待 C 交付路由后打开**，不放假按钮 |
| 3. 与 C 对齐侧边栏：桌面右侧、手机全屏、键盘关闭、焦点回触发卡片；只交付交互约定与复用样式 | **缺失** | 新增 `docs/b-task-sidebar-interaction.md` 与 `.ac-sidebar*`/`.ac-scrim`/`.ac-focus-return` 复用样式 |
| 4. 接 D 的成果列表、创建草稿、编辑草稿、提交、详情和版本查询 | 已有 | 保留真实链路；补服务失败界面、空状态引导、状态中文说明 |
| 5. 成果类型 8 种；只保存链接、不显示上传按钮 | 已有 | 保留（`report/presentation/video/survey/code/prototype/demo/other`） |
| 6. 真实加载、提交中、成功、字段错误、服务错误、无权限；禁用重复提交 | 部分 | 新增三个 `loading.tsx`、`deliverables/error.tsx`；编辑器补字段级校验与 `aria-invalid`；提交/保存仍用锁 + `requestId` 防重复 |
| 覆盖表 P0-03 指出项目概览应对应 B-G01 | **缺失** | 新增 `src/lib/project-overview-summary.ts`，按标准签名与返回字段实现 |
| 标准第 9.1 节固定的共用展示组件 `@/components/projects/progress` | **缺失** | 新增 `TaskProgress` / `DeliverableProgress`，props 与标准一致 |
| 标准第 9.1 节固定来源入口 `?versionId=&feedbackId=` | **缺失** | 成果详情识别并高亮定位，配 `LocateTarget` 滚动到目标 |

## 3. 变更清单

### 新增（14 个交付文件）

| 文件 | 作用 |
|---|---|
| `src/contracts/p0-p2.ts` | 第 9.1 节公共类型 + 第 7/9.2—9.8 节跨模块 DTO。**C 负责最终整合**，本版由 B 按标准先行落地本模块依赖的部分，字段与标准一致，未新增私有命名 |
| `src/lib/project-overview-summary.ts` | B-G01 `getProjectOverviewSummary(actorId, projectId)`；项目访问失败整体拒绝，单个数据源故障降级为 `QueryPart.unavailable`；C/E/F 未交付项显式标注“待接入” |
| `src/components/projects/progress.tsx` | `TaskProgress`、`DeliverableProgress`；只展示，不在浏览器重算口径 |
| `src/components/projects/project-nav.tsx` | 项目内部导航（概览/任务/迭代/成果/时间线），`ITERATION_ENTRY_ENABLED` 一处开关 |
| `src/components/projects/query-state.tsx` | `QueryUnavailable`：聚合中单项不可用时的统一占位 |
| `.../overview/layout.tsx` | 概览段访问边界（原因见第 4.3 节） |
| `.../overview/loading.tsx` | 概览加载骨架 |
| `.../deliverables/layout.tsx` | 成果段访问边界 |
| `.../deliverables/loading.tsx` | 成果列表加载骨架 |
| `.../deliverables/error.tsx` | 成果段服务失败界面 + 重试，明确“失败不等于没有成果” |
| `.../deliverables/[deliverableId]/loading.tsx` | 成果详情加载骨架 |
| `.../deliverables/locate.tsx` | 深链接定位滚动（客户端小组件） |
| `tests/project-overview-summary.test.ts` | B-G01 的 5 项真实数据库测试 |
| `docs/b-task-sidebar-interaction.md` | 交付给 C 的侧边栏交互约定与样式用法 |

### 修改（7 个）

| 文件 | 改动 |
|---|---|
| `.../overview/page.tsx` | 改用 B-G01；双进展卡分别容错；里程碑与入口保持；空状态提示下一步 |
| `.../deliverables/page.tsx` | 共用导航；真实空状态引导；状态中文说明；“有未提交的新版本草稿”提示 |
| `.../deliverables/[deliverableId]/page.tsx` | 深链接定位与高亮；反馈标注决定/审核人/时间/对应版本；状态提示文本 |
| `.../deliverables/editor.tsx` | 与服务端同规则的字段级校验、错误就近显示、`noValidate` 保证提示一致 |
| `.../deliverables/new/page.tsx` | 共用导航 + 说明文案 |
| `.../projects/[projectId]/page.tsx` | **仅替换导航块**（C 主写页面，最小补丁） |
| `src/app/globals.css` | 追加 `.ac-scrim`/`.ac-sidebar*`/`.ac-focus-return`，不影响既有类 |

> `next-env.d.ts` 是 `next build` 生成的、已被 gitignore 的文件，不属于交付内容。

## 4. 三个需要说明的设计决定

### 4.1 “待接入”必须是 unavailable，不是 0

`taskStats`、`activeIteration`、`pinnedAnnouncement`、`recentActivities` 四项对应的 C/E/F 服务目前没有代码，B-G01 返回
`{ state: "unavailable", code: "INTERNAL", message: "…待接入（编号 接口名）" }`。
页面据此显示“该数据暂时不可用”，不会显示成 0 或空列表。接口交付后，把对应 `pending(...)` 换成 `queryPart(...)` 调用即可，页面无需改动。

### 4.2 任务统计的临时口径

标准第 9.2 节要求新页面统一使用 C 的 `getProjectTaskStats`（主任务口径）。该服务尚未交付，因此：
- `taskStats` 如实标为待接入；
- 概览仍显示现有 `getProjectDetail` 的真实数字，但**明确标注“临时口径：全部任务含子任务”**，并在 `legacyTaskProgress.scope` 里固化这个口径；
- 不与新口径的 `doneCount` 混用；C 交付后概览自动切到主任务口径。

### 4.3 为什么给两个路由段加了 `layout.tsx`

实测发现：给路由段加 `loading.tsx` 后，页面在 Suspense 边界内调 `notFound()` 时响应外壳已按 200 流式发出，于是非团队成员访问会变成**软 404（状态码 200，页面内容是 404 页）**。对照实验（本机真实会话）：

| 路由 | 有无 loading 边界 | 非团队成员状态码 |
|---|---|---|
| `/projects/{id}` | 无 | 404 |
| `/projects/{id}/timeline` | 无 | 404 |
| `/projects/{id}/overview` | 有 | 200（软 404）→ 修复后 **404** |
| `/projects/{id}/deliverables/*` | 有 | 200（软 404）→ 修复后 **404** |

两处都**没有泄露数据**（响应体就是 404 页面），但“无关团队账号不能读取项目数据”是阶段验收条目，状态码不应退化。修复方式是把成员资格判定上移到段 `layout.tsx`：它在流式开始前完成，`notFound()` 因此仍是硬 404，同时保留加载骨架。

残留边界：同项目成员访问**别人尚未提交的私有草稿**时，服务端照样拒绝并只渲染 404 页面，但因为对象级判定发生在页面内，那种情况下状态码可能已是 200。**不会返回草稿正文。**

## 5. 验证记录

### 5.1 静态检查与构建（本机实测）

| 检查 | 命令 | 结果 |
|---|---|---|
| 类型 | `tsc --noEmit` | **0 error** |
| Lint | `eslint .` | **0 error**，1 条上游既有 warning（`tests/agent-api.test.ts` 未使用的 `joinTeam`） |
| 构建 | `npm run build`（Next.js 16.2.10 / Turbopack） | 通过，21 个页面全部产出 |
| 测试 | `vitest run`（真实 PostgreSQL） | **300 passed / 2 skipped**（原 295 项 + 本次新增 5 项；2 项跳过为真实 DeepSeek 凭据测试） |

### 5.2 真实数据库 + 真实会话的页面验证

用真实数据播种（2 个主任务 + 1 个子任务、1 份正式提交并被退回的成果、1 个里程碑），启动生产构建，用 Auth.js JWT 会话访问真实 HTTP 端点：

| 场景 | 期望 | 实测 |
|---|---|---|
| 学生 `/overview` | 200 且渲染项目名/简介/日期/里程碑 | 200，全部命中 |
| 学生 `/overview` 双进展 | 任务数字含子任务且标注口径；成果显示真实数量 | `0/3` + “临时口径：全部任务含子任务”；“0 通过”；当前迭代显示“该数据暂时不可用” |
| 学生 `/deliverables` | 200，列出成果并显示退回原因 | 200，“用户调研报告”“教师已退回，请查看意见后重新提交” |
| 学生 `/deliverables/{id}?versionId=…` | 200，定位并高亮该版本，展示反馈 | 200，“第 1 版”“要求修改”“请补充三场访谈记录”“正在定位” |
| 学生 `/deliverables/new` | 200，表单字段齐全 | 200 |
| 项目看板（B 只改导航） | 200，导航统一 | 200，“项目内部导航”出现 |
| 已登录但非团队成员（概览/列表/详情/新建） | 404 | **404 / 404 / 404 / 404** |
| 未登录 | 跳转登录 | **307** |
| 成果段服务失败 | 显示失败与重试，不显示成“暂无成果” | `deliverables/error.tsx` 已接（未构造真实故障注入，按代码路径复核） |

### 5.3 局限（如实记录）

- **没有做浏览器交互测试**（无 Playwright）：双击防重、字段级提示的视觉表现、侧边栏键盘行为属于 C 的实现，本次只交付约定与样式。
- **AI 与飞书未测**：无凭据，两个跳过项属于真实外部调用测试。
- 本次验证用的是本机临时 PostgreSQL 18 与测试库，**不是团队开发库**；迁移文件未改动，无需新增迁移。
- 真实提交号、服务器部署与公网验收不在本次范围。

## 6. 未完成 / 待联调

| 项 | 归属 | 说明 |
|---|---|---|
| 迭代入口与概览“当前迭代” | C | 交付 `/projects/[projectId]/iterations` 与 `getCurrentIteration` / `getProjectTaskStats` 后，把 `ITERATION_ENTRY_ENABLED` 置为 `true`，并把 B-G01 里的 `pending(...)` 换成真实调用 |
| 主任务口径任务统计卡 | C | 同上；切换后概览自动使用 `TaskProgress` |
| 公告展示、最近活动 | F、E | B-G01 已留好 `QueryPart` 字段，页面按需渲染 |
| 审核、开始修改、重交、反馈转任务确认表单 | B（P1） | 后端已具备（`docs/deliverables-p1-handoff.md`），本次不做 |
| 教师共用卡片、证据页与 Markdown 导出 | B（P2） | `@/components/projects/teacher-project-card`、`risk-card` 尚未创建，本次不做假的 |
| 公共类型文件合并 | C | B 先按标准落地；C 整合时应保留字段名与语义，只做追加 |
| 任务侧边栏主组件 | C | 按 `docs/b-task-sidebar-interaction.md` 实现 |

## 7. 复现步骤

```bash
npm ci
npm run db:push          # 或按团队既有迁移流程升级数据库
npm test                 # 需要 .env.test 指向测试库
npm run lint
npx tsc --noEmit
npm run build
```

页面自查（需真实数据）：用两个学生账号分别打开 `/projects/{projectId}/overview` 与 `/projects/{projectId}/deliverables`，把一条成果提交后由教师退回，再用 `?feedbackId=` 链接打开详情，确认定位与历史反馈同时可见；最后用一个无关团队账号确认三个页面都返回 404 而不是 200。
