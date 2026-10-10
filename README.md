# AgileCampus 敏捷校园 · 唯笃队

面向高校课程团队的轻量项目管理网站。在[老师原始项目](https://github.com/sdiver/agilecampus)基础上增量开发，保留团队、看板、任务、甘特、AI 助手和资源登记，完善“规划任务 → 迭代开发 → 提交成果 → 教师反馈 → 修改重交 → 复盘与证据导出”。

本轮补齐原规划 P0–P2 的代码及部署方案。服务器尚未购买，应用未公网部署；腾讯文档团队项目主页独立保留。真实同学试用、真实飞书／AI、阿里云容器与公网验收仍需实际条件，不能将本地通过写成已经上线。

## 团队新增功能

| 功能 | 用户可以做什么 |
|---|---|
| 个人工作台 | 看本人任务、当前迭代及教师要求修改的成果，分页进入任务和指定反馈 |
| 教师项目总览【本轮补齐】 | 集中看任教团队项目的任务、迭代、成果、活动和风险 |
| 项目概览 | 目标／周期／里程碑／起步引导、双进展、动态、项目内待办 |
| 任务详情、任务池与迭代 | 验收标准、指派／日期／标签／依赖／子任务／阻塞；排序入轮、开始、结束结转、历史与复盘 |
| 任务评论与 @【本轮补齐】 | 发／改／删评论，选择成员通知，点击定位来源，权限与重复请求有校验 |
| 项目公告【本轮补齐】 | 教师／管理员发布、修改、置顶替换、撤下、重发；概览展示置顶，学生只读 |
| 成果与教师验收 | 登记报告／PPT／视频／代码链接，私有草稿、正式不可变版本、验收／退回／重交 |
| 教师反馈转任务 | 明确确认后建立修改任务，任务与原反馈相互定位 |
| 规则周报【本轮补齐】 | 按周整理真实任务事件、成果提交和审核；当前阻塞／逾期单列，Markdown 下载 |
| 透明风险【本轮补齐】 | 四条明确规则，显示来源、阈值、计算时间和数据不足条件；不自动评分 |
| 统一过程证据【本轮补齐】 | 汇总任务、评论、迭代、复盘、正式成果与反馈，按成员／阶段／日期等筛选导出 |
| AI 连续上下文【本轮补齐】 | 项目共享／本人个人会话、有界历史与分页、新业务只读工具，不泄露私有草稿或他人聊天 |
| AI 迭代草案【本轮补齐】 | 只选已有任务，生成／调整／取消／预览／明确确认后创建计划迭代；24 小时有效，版本变化拒绝旧方案 |
| 站内与外部通知【本轮补齐】 | 原指派／成果／迭代通知保留；补到期、完成、@、公告、外部发送队列与退避重试、渠道状态 |
| 部署与恢复【本轮补齐】 | 版本化迁移、健康检查、内部定时提醒、HTTPS 配置、备份／独立恢复／代码回退工具 |

任务完成率按主任务计算，成果通过率按当前正式成果计算，两者独立展示。无正式成果显示“暂无正式提交”；查询失败显示不可用，不用零条冒充成功。旧活动没有记录就不补造；已删除评论正文不导出。成果目前登记外部链接，不是内置网盘。

原有团队与角色、跨项目列表、拖拽看板、标签／依赖、甘特、AI 两段确认、Personal API Token、Agent 写入 API、资源占用登记继续保留。原 plan_sprint 语义保持兼容。

完整入口与接口交接见 [P0–P2 补齐说明](docs/p0-p2-completion.md)；32 项逐条状态见 [六人最新进度](docs/team-progress-20261009.md)；固定接口以 [契约 v2.0](docs/team-interface-contract.md) 为准。负责人本地 P3 试验没有混入本轮。

## 主要入口

| 路由 | 说明 |
|---|---|
| /dashboard | 本人任务、当前迭代、需修改成果 |
| /teacher | 教师／管理员多项目总览 |
| /notifications | 通知分页、未读筛选、已读与来源 |
| /projects/{id}/overview | 概览、公告、动态、双进展和风险 |
| /projects/{id} | 任务看板、详情侧栏／评论、原 AI 助手 |
| /projects/{id}/iterations | 任务池、迭代；详情含结束预览、历史和复盘 |
| /projects/{id}/deliverables | 成果列表／创建；详情含版本、审核、重交和反馈任务 |
| /projects/{id}/announcements | 公告列表和管理 |
| /projects/{id}/reports | 规则周报与下载 |
| /projects/{id}/evidence | 原成果证据筛选／导出 |
| /projects/{id}/evidence/process | 统一过程证据筛选／导出 |
| /projects/{id}/ai-drafts | 共享／个人会话和迭代草案 |
| /projects/{id}/timeline | 甘特时间线 |
| /teams | 团队、成员角色、项目、资源与标签 |
| /settings | 飞书绑定与渠道状态；/settings/tokens 管理个人令牌 |

## 本地启动与测试

技术栈：Next.js 16.2 · React 19 · TypeScript · PostgreSQL 16 · Drizzle · Auth.js v5 · AI SDK v5 · Tailwind v4 · Vitest。使用 Node.js 22 或以上。

```bash
docker compose up -d
cp .env.example .env
# 编辑 .env：配置开发 DATABASE_URL、AUTH_SECRET 和本地地址
npm ci
npm run db:migrate
npm run dev
```

测试使用独立数据库。在 .env.test 配置测试 DATABASE_URL，不能指向开发／真实业务库，然后执行：

```bash
npm run db:push:test
npm test
npm run lint
npm run build
```

新建空库及已有完整迁移账本的库使用 db:migrate。没有账本的旧库先核对基线，不能直接重放初始化迁移。不要通过删除数据卷解决升级问题。

可重复本地验收脚本：

- scripts/verify-ef-integration.mjs：原成果、迭代、活动与通知串联。
- scripts/verify-p0-p2-browser.mjs：公告／评论／@／周报／证据／草案／教师页／手机宽度；需要 Playwright、Edge 和本地服务。
- scripts/verify-local-recovery.mjs：需要 PostgreSQL 客户端，可用 PG_BIN 指定路径；只在本地创建独立源库与恢复库，不覆盖已有库。

浏览器脚本通过 B_TEST_URL 指定本地站点，通过 PLAYWRIGHT_MODULE 指定已安装 Playwright；cron 验收的 EF_TEST_CRON_SECRET 必须与本地服务一致。脚本使用合成账号，草案夹具和模拟模型不代表真实 AI 调用。

## 阿里云部署

服务器尚未购买。已经提供生产 Compose、Caddy、内部提醒调度和操作脚本；完整步骤见 [阿里云部署与恢复方案](docs/aliyun-deployment.md)。

购买后复制 deploy/production.env.example 为 .env，填写三个不同随机密钥和真实域名，安装 Docker Compose v2 与 Node.js：

```bash
npm ci
node scripts/ops.mjs preflight
node scripts/ops.mjs release
node scripts/ops.mjs status
node scripts/ops.mjs smoke
node scripts/ops.mjs backup
```

生产用 db:migrate 增量升级；PostgreSQL 不开放公网端口，网站经 HTTPS 反向代理。备份包含业务和迁移账本，恢复只进入独立库。代码回退不能代替数据库恢复；不要运行 down -v。飞书／AI 未配置时其他协作功能仍可使用。

## 验证状态

本轮最终测试数字见 [最新进度的验证记录](docs/team-progress-20261009.md)。已完成本地旧库升级和真实 pg_dump／pg_restore 独立恢复：15 张业务表内容一致、恢复后可写、重复迁移正常。

真实同学试用按 [匿名模板](docs/usability-trial-template.md) 记录。阿里云容器／HTTPS／公网／镜像回退，以及飞书／AI 真实条件，仍须后续补验。


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
