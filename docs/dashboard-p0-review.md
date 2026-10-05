# A / P0 工作台：评审修复与接口核对

日期：2026-10-05。提交：[yc-wzx/agilecampus PR #1](https://github.com/yc-wzx/agilecampus/pull/1)，原作者 FaiNtmuli，原提交 ab7e219。

## 本次修复

- 工作台任务卡接已有 `/projects/{projectId}?task={taskId}` 深链，学生点击后直接打开现有任务详情弹窗。
- 成员资格与任务查询合并为一条 SQL，按当前团队成员身份过滤，去掉两次查询间成员退出后的权限窗口。
- 日常待办仅包括活跃项目，归档项目不再持续显示为逾期待办；重新启用后恢复。
- 保留指派给本人的子任务，在页面明确说明。父任务和子任务各自依据负责人、状态显示。
- 长用户名、任务标题和项目名称换行；头像菜单为长名称限宽，并补充“账户菜单”无障碍名称。
- 补充 6 项真实 PostgreSQL 查询测试和可复跑的浏览器验证脚本。

## 接口契约

`src/lib/dashboard.ts` 是站内服务模块，不是新建的 HTTP API。

| 导出 | 输入 | 返回 / 约束 |
|---|---|---|
| getMyOpenTasks | actorId，必须由已登录会话提供 | MyTask[]；只含当前成员有权访问的活跃项目中，指派给本人且未完成的任务 |
| groupMyTasks | MyTask[]、today（YYYY-MM-DD） | 固定四组：overdue、today、next7、rest；未来 7 天不含今天、含第 7 天，各组互斥 |
| todayInShanghai | 可选 Date | 按 Asia/Shanghai 返回 YYYY-MM-DD，与服务器时区无关 |
| addDays | YYYY-MM-DD、天数 | UTC 日期运算，跨月/跨年不漂移 |

MyTask 字段：id、title、status、priority、dueDate、projectId、projectName、teamName。dueDate 可为空。原任务状态、优先级、成员和项目字段直接复用现有 schema，没有增加数据表、改变任务写接口或添加迁移。

调用路径：`auth()` → `/dashboard` 服务端页面 → getMyOpenTasks → groupMyTasks → 现有项目/任务详情深链。未登录转 `/login`；登录与首页默认进入 `/dashboard`。头像菜单保留设置、个人令牌和退出，项目页继续保留原有业务入口。

教师当前沿用老师原项目的只读任务界面，工作台不会给教师新增任务编辑权限。

这次是 A / P0 的提交。当前迭代、本人待修改成果、未读通知和教师总览仍属于后续集成，不伪造占位服务。本地已有 D、P3 的成果、会议、日历入口继续保留。

## 已执行验证

| 检查 | 结果 |
|---|---|
| 工作台分组 + 数据库查询测试 | 17 项通过 |
| PR 独立分支全量测试 | 241 项通过，2 项 DeepSeek 测试跳过 |
| PR 生产构建 | Next.js / TypeScript 通过 |
| PR lint | 0 错误；1 条原有 agent-api.test.ts 未使用 joinTeam 警告 |
| 本地 D + P3 + 本 PR 全量测试 | 314 项通过，2 项跳过 |
| 本地集成生产构建 | 通过，保留成果、会议、日历等现有路由 |
| 实际 MS Edge 登录 | 四组边界、归档/已完成/他人任务过滤、任务详情深链、两个账号隔离、退出及未登录保护通过 |
| 窄屏和长文本 | 320 / 390 / 430 / 640px 无横向溢出，账户菜单可操作 |

数据库测试覆盖：本人未完成任务、退组后不可见、归档/恢复、跨团队聚合、指派子任务、未加入团队。

浏览器中“完成”和“退组”的状态用 SQL 构造后刷新验证，只证明工作台反映数据库真实状态，不冒充完成了 C 的状态机验证。没有调用外部 AI/飞书服务。

浏览器脚本：`scripts/verify-dashboard.mjs`。仅允许本机数据库与本机网站，建立独立合成账号和示例团队，不输出密码。使用已有本机 Edge，Playwright 可安装在独立工具目录，由 PLAYWRIGHT_MODULE 指向其 index.mjs。先启动生产或开发服务器，再设置 DASHBOARD_TEST_URL（默认 http://localhost:3002），运行 `node scripts/verify-dashboard.mjs`。截图和报告位于被 Git 忽略的 `.next/dashboard-verification/`。

本地接入前已备份导航、首页和登录动作，旧 D、P3 源码及数据库字段保留。PR 合并只发布此次工作台及评审修复，不把未提交的 D、P3 一并推到远程。
