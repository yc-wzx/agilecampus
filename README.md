# AgileCampus 敏捷校园 · 唯笃队

面向高校课程团队的轻量项目管理网站。唯笃队在[老师的原始项目](https://github.com/sdiver/agilecampus)基础上继续开发，保留任务看板、团队管理、AI 助手等基础能力，新增迭代管理和阶段成果验收流程。

> 下面按当前主分支实际代码说明进度。P0、P1、P2 是开发阶段；有某阶段功能，不等于该成员整个阶段已经完成。服务器尚未部署，暂无对外试用网址。

## 团队新增了什么

| 新功能 | 用户可以做什么 | 入口与实际状态 |
|---|---|---|
| 我的任务工作台 | 查看本人在活跃项目中的任务，按逾期、今天、未来七天及其他任务分组，点击打开具体任务 | /dashboard，已接入真实数据，包含已指派的子任务 |
| 待修改成果提醒 | 查看教师退回的成果、对应版本和修改意见，分页浏览，跳到具体反馈 | /dashboard，已接入 D 的成果服务；通知已读不消除修改事项 |
| 项目概览 | 查看项目目标、周期、里程碑、当前迭代，以及任务完成和成果验收两种进展 | /projects/{项目ID}/overview，统计来自真实服务；单项故障单独提示 |
| 项目起步引导 | 根据目标、里程碑、任务、成员及活跃迭代的真实数据提示下一步，可暂时跳过 | 项目概览；缺失数据不会自动标成完成 |
| 任务详情侧栏 | 在看板打开详情，查看和修改描述、验收标准、负责人、日期、标签、依赖、完成说明及子任务进度 | 任务看板，保留 ?task= 深链接；评论入口等待 E 接入 |
| 任务池与迭代 | 拖动任务池排序，将未完成主任务排入迭代或移回任务池；设置本轮目标与日期 | /projects/{项目ID}/iterations；同项目最多一轮正在进行 |
| 结束迭代与复盘 | 结束前预览，为未完成主任务选择退回任务池或转入下一轮；保存历史快照并填写复盘 | 迭代详情；快照不会因任务后来修改或删除而重算 |
| 阻塞标记 | 说明任务为什么暂时推进不了，记录首次阻塞时间，问题解决后解除阻塞 | 任务详情；主任务统计可查询逾期和阻塞清单 |
| 阶段成果与版本 | 提交报告、PPT、视频、代码等成果链接，关联里程碑；私有草稿保存后再明确提交正式版本 | /projects/{项目ID}/deliverables；当前提供链接登记，不是内置文件网盘 |
| 教师验收与修改重交 | 教师对当前版本选择通过或要求修改；学生保存新版本草稿后重交，旧版本及当时意见保留 | 成果详情，已接入 D 的真实权限与版本服务 |
| 反馈转修改任务 | 由学生或管理员确认标题、负责人、截止日，把教师意见关联到任务；从任务反查来源反馈 | 同一反馈最多关联一个修改任务，已删除时明确提示 |
| 成果证据与 Markdown 导出 | 按类别、成果类型、作者、里程碑、日期筛选正式提交与审核记录，下载带来源链接的清单 | /projects/{项目ID}/evidence；当前仅包含 D 的成果证据，单次最多 1000 条，截断会说明 |
| AI 迭代草案确认接口 | 对已存储草案核验任务、版本、有效期与权限，人工确认后一次性创建计划迭代 | C 的预览/确认服务已实现；E 的草案生成、修改、取消与完整交互尚待接入 |

任务完成率按主任务计算，成果通过率按当前正式成果计算，两者分别展示；没有正式成果时显示“暂无正式提交”。这些数字不用于自动给学生评分或排名。

## 当前分工进度

| 成员模块 | 已进入主分支的交付 | 仍需完成或联调 |
|---|---|---|
| A：工作台与全局页面 | P0 工作台、P1 待修改成果列表 | 活跃迭代工作台、教师多项目总览、通知及风险聚合、真实新用户试用记录等 |
| B：项目页面与交互 | 成果创建/提交/审核/重交页面、反馈转任务、项目概览、成果证据导出、共用教师/风险卡片 | 卡片不能代表聚合页面完成；公告、活动、统一证据和完整手机/新用户验收依赖 A/E/F |
| C：任务与迭代 | 任务 V1 接口、侧栏、任务池、迭代生命周期、历史/复盘、阻塞与统计、草案确认服务 | E/F 的通用活动与通知接入、E 草案生成流程、部署环境的迁移联调 |
| D：成果与验收后端 | P0–P2 成果、不可变版本、教师反馈、修改重交、反馈任务、统计、证据查询与可靠事件交付入口 | 与 E/F 的组合事件消费者、真实提醒渠道及上线环境联调 |
| E：评论、活动、证据与 AI 扩展 | 暂无可核验并已合并的对应交付 | 评论/@、通用活动、完整过程证据、周报/风险、AI 上下文及草案管理 |
| F：通知、公告与部署 | 暂无可核验并已合并的对应交付 | 站内通知、公告、事件消费者、服务器部署、备份恢复演练 |

负责人本地尝试的 P3 模板、会议资料链接、日历订阅、负责人调整和版本对比，尚未进入本次主分支。不能据此向老师展示为已上线功能。

## 本次整合做了哪些修复

- 工作台使用成果服务返回的总数与分页信息，错误时不显示虚假的零条；日期按北京时间，链接定位版本和反馈。
- 新任务/迭代接口统一五种错误码，拒绝额外写入字段，复盘返回值按既定接口标准调整。
- 请求重试仍检查当前团队角色；撤销写权限后不能重放旧请求取回原结果。相同请求标识改内容返回冲突。
- 结束迭代在事务内锁定任务并核对版本；子任务变更也要求重新预览，历史快照保留结束时的内容。
- AI 草案只允许创建者读取和确认；任务在草案生成后变化会拒绝过时方案，确认重放返回首次结果。
- 教师可以查看反馈关联任务，但页面不会给教师显示学生的任务创建操作；导出内容中的用户文本做转义，来源可使用部署网址。

协作统一标准：[P0–P2 接口契约](docs/team-interface-contract.md)。后续同学以此为准，保留既有字段、导入路径与权限规则。

## 如何演示当前新增流程

1. 管理员创建团队和项目，让学生、教师加入并设置角色。
2. 学生创建任务并填写验收标准，进入任务池，创建和开始一轮迭代。
3. 学生登记成果链接，保存草稿，再提交正式版本。
4. 教师查看成果，填写修改意见并退回。
5. 学生在工作台找到需修改成果，打开反馈，确认创建修改任务，修改并提交新版本。
6. 教师确认通过；团队结束迭代、安排未完成任务去向、填写复盘，并在证据页导出成果记录。

上述流程不需要新增 AI 模型调用。原有 AI / 飞书功能需要真实配置；没有配置时不要将外部调用说成已验证。

## 原项目保留的功能

- **团队与角色**：创建/加入团队，admin / teacher / student 三级权限
- **项目看板**：里程碑 + 拖拽看板 + 任务增强（描述/完成情况/起止日/后置任务）+ 标签筛选与四维度分组（状态/指派人/优先级/里程碑，各分组下拖拽皆生效）
- **跨项目总览**：`/projects` 聚合我所在全部团队的项目与任务进度
- **AI 项目助手**：对话式拆解任务，两段式确认后落库（读工具 + 四写兵器草案）
- **资源占用登记**：团队共享资源（服务器/算力等）的占用登记与时长汇总，纯登记无审批
- **Personal API Token**：生成/撤销令牌，供外部程序以本人身份写入
- **Agent 写入 API**：Claude Code 等携令牌直接添加任务、填写完成情况、登记资源占用
- **时间线甘特**：项目内任务按里程碑分组的甘特视图，逾期标红、今日竖线

## 技术栈

Next.js 16 (App Router, Turbopack) · React 19 · TypeScript · PostgreSQL 16 + Drizzle ORM · Auth.js v5 (JWT) · Vercel AI SDK v5 (DeepSeek / openai-compatible) · Tailwind CSS v4 · Vitest

## 本地启动

```bash
docker compose up -d          # 启动 Postgres（首次自动建 dev 与 test 两库）
cp .env.example .env          # 填入 AUTH_SECRET（openssl rand -base64 32）与 DATABASE_URL
npm ci
npm run db:migrate            # 仅空库/已有迁移账本的开发库按迁移链升级
npm run db:push:test          # 推送 schema 到测试库
npm run dev
```

> `scripts/init-test-db.sql` 仅在 Postgres 数据卷**首次初始化**时执行。若改过 init 脚本或测试库缺失，需 `docker compose down -v` 重建数据卷再 `up`（会清空本地开发数据）。
> 本机若用 colima 提供 Docker：先 `colima start`。

测试：`npm test`

## 原有 Docker 部署方案（上线演练待完成）

目前尚未完成阿里云实际部署和备份恢复演练。现有 compose 的迁移服务仍使用 db:push；正式部署前，F 应与 C 按接口标准中的数据库升级规则在副本上验证，备份后再升级。

`docker-compose.prod.yml` 编排 `db` + `migrate`（自动建表）+ `app` 三服务，同网络起，无需手动推 schema。

```bash
cp .env.example .env
# 填齐生产密钥：
#   AUTH_SECRET=$(openssl rand -base64 32)
#   POSTGRES_PASSWORD=<强密码>          # db 密码，compose 变量插值单一来源
#   AGILECAMPUS_URL=https://<对外域名>   # 飞书 OAuth 回调据此拼跳转
#   DEEPSEEK_API_KEY / FEISHU_APP_ID / FEISHU_APP_SECRET=<真值>
#   FEISHU_REDIRECT_URI=https://<对外域名>/api/auth/feishu/callback
#   CRON_SECRET=$(openssl rand -hex 32)
nano .env

docker compose -f docker-compose.prod.yml up -d --build
```

`migrate` 服务待 `db` healthcheck 通过后跑 `db:push` 建表，成功退出后 `app` 方启动。`app` 内 `DATABASE_URL` 由 compose 指向服务名 `db`，覆盖 `.env` 的 localhost 值（无需改 `.env`）。

**定时提醒**（临期/逾期私信）须由宿主 crontab 每日打一次 cron 端点：

```bash
( crontab -l 2>/dev/null; \
  echo '0 9 * * * curl -fsS -X POST http://localhost:3000/api/cron/reminders -H "Authorization: Bearer <CRON_SECRET>" >/dev/null 2>&1' \
) | crontab -
```

> NAS 部署：本机 `rsync -az --delete --exclude node_modules --exclude .next --exclude .git ./ root@<nas>:/volume1/docker/agilecampus/`，再 ssh 上去于该目录执行上述 `up` 命令。
> 飞书应用后台须将 `FEISHU_REDIRECT_URI` 加入重定向白名单，绑定方能成。

## 主要路由

| 路由 | 说明 |
|---|---|
| `/dashboard` | 我的任务与待修改成果 |
| `/projects/[projectId]/overview` | 项目概览与起步引导 |
| `/projects/[projectId]/iterations` | 任务池与迭代列表 |
| `/projects/[projectId]/iterations/[iterationId]` | 迭代任务、结束预览、历史快照与复盘 |
| `/projects/[projectId]/deliverables` | 成果列表与新建 |
| `/projects/[projectId]/deliverables/[deliverableId]` | 版本、教师验收、修改重交与反馈任务 |
| `/projects/[projectId]/evidence` | 成果证据筛选与 Markdown 导出 |
| `/teams` | 我的团队（创建/加入） |
| `/teams/[teamId]/members` | 成员管理（admin 改角色） |
| `/teams/[teamId]/projects` | 项目列表（admin 创建） |
| `/teams/[teamId]/resources` | 资源占用登记 + 时长统计 |
| `/teams/[teamId]/labels` | 团队标签管理（admin 增删改，成员只读） |
| `/projects` | 所有项目总览（跨团队聚合 + 任务统计） |
| `/projects/[projectId]` | 项目详情：里程碑 + 看板 + 任务 + AI 助手 |
| `/projects/[projectId]/timeline` | 项目时间线甘特 |
| `/settings/tokens` | 个人访问令牌（生成/撤销） |

---

## Agent 写入 API

供 Claude Code 等浏览器之外的程序，以用户身份写入 AgileCampus。

### 认证

所有 `/api/agent/*` 端点用 **Personal API Token** 认证（区别于浏览器 session）：

```
Authorization: Bearer <token>
```

在网页「设置 → 个人访问令牌」生成，明文只显示一次；库中仅存 sha256 hash。令牌权限等同本人：只能操作有权限的团队/项目，越权返回 `403`。约定两个环境变量：

- `AGILECAMPUS_URL` — 站点地址，如 `http://localhost:3000`
- `AGILECAMPUS_TOKEN` — 令牌明文

### `POST /api/agent/tasks` — 新建任务

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `projectId` | uuid | 是 | 目标项目 |
| `title` | string | 是 | 任务标题 |
| `description` | string | 否 | 描述 |
| `assigneeId` | uuid | 否 | 负责人（须为团队成员） |
| `startDate` | string | 否 | 起始日 `YYYY-MM-DD`（供时间线排期） |
| `dueDate` | string | 否 | 截止日 `YYYY-MM-DD` |
| `milestoneId` | uuid | 否 | 里程碑（须属该项目） |
| `priority` | `low`\|`medium`\|`high` | 否 | 默认 `medium` |

```bash
curl -X POST "$AGILECAMPUS_URL/api/agent/tasks" \
  -H "Authorization: Bearer $AGILECAMPUS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"projectId":"<uuid>","title":"撰写调研问卷","startDate":"2026-07-01","dueDate":"2026-07-08","priority":"high"}'
# → { "id": "...", "title": "撰写调研问卷", "status": "todo" }
```

### `POST /api/agent/tasks/complete` — 填写完成情况

将任务标记为 `done` 并附完成说明。

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `taskId` | uuid | 是 | 目标任务 |
| `completionNote` | string | 是 | 完成说明 |

```bash
curl -X POST "$AGILECAMPUS_URL/api/agent/tasks/complete" \
  -H "Authorization: Bearer $AGILECAMPUS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"taskId":"<uuid>","completionNote":"已跑通全部演武"}'
# → { "id": "...", "status": "done" }
```

### `POST /api/agent/resource-usage` — 登记资源占用

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `teamId` | uuid | 是 | 目标团队 |
| `resourceName` | string | 是 | 资源名，如 `GPU-01` |
| `purpose` | string | 否 | 用途 |
| `startTime` | ISO 8601 | 是 | 开始时间，如 `2026-07-22T14:00:00Z` |
| `endTime` | ISO 8601 | 否 | 结束时间；省略 = 占用中 |

```bash
curl -X POST "$AGILECAMPUS_URL/api/agent/resource-usage" \
  -H "Authorization: Bearer $AGILECAMPUS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"teamId":"<uuid>","resourceName":"GPU-01","purpose":"训练模型","startTime":"2026-07-22T14:00:00Z"}'
# → { "id": "...", "resourceName": "GPU-01", "active": true }
```

### 响应与错误

| 状态 | 含义 |
|---|---|
| `200` | 成功，返回创建/更新后的精简对象（含 `id`） |
| `400` | 请求格式无效（缺字段、类型错、时间非法） |
| `401` | 令牌缺失、畸形、伪造或已撤销 |
| `403` | 越权——令牌主人对目标项目/团队无权限 |
| `500` | 服务器错误，可重试 |

### 安全说明

- 令牌库中只存 sha256 hash，明文只在生成时返回一次，泄露即在设置页撤销。
- 外部写入一律不被信任：`token → userId → lib 权限校验`，越权由业务层拒绝。

### Claude Code 集成

项目内置 `.claude/skills/agilecampus/` skill，封装上述端点调用——配置好 `AGILECAMPUS_TOKEN` 与 `AGILECAMPUS_URL` 后，即可在 Claude Code 里用自然语言「给项目 X 加任务 Y」「把任务 Z 标记完成」「登记我占用了 GPU-01」。完整契约另见 [`docs/agent-api.md`](docs/agent-api.md)。

---

## 文档

- 设计与作战图：`docs/superpowers/`
- Agent 写入 API：`docs/agent-api.md`
- 技术债备案：`docs/BACKLOG.md`
