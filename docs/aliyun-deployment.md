# 唯笃队 AgileCampus：阿里云部署与恢复方案

当前交付对象是 **AgileCampus 应用网站**。腾讯文档团队项目主页继续独立使用。服务器尚未购买，本文件提供部署代码和操作步骤，公网可达性、容器运行、飞书真实送达及真实 AI 调用均须在目标环境补验。

## 1. 租什么、准备什么

建议初期使用一台 Linux 服务器：Ubuntu 24.04 LTS、至少 2 核 4 GiB、40 GiB SSD、公网 IP。该规格是本项目部署预算建议，不是经过压力测试的容量承诺；人数增加后以 CPU、内存和请求耗时决定扩容。轻量应用服务器或 ECS 均可，购买时核对带宽、流量额度、续费价和备案资格，不必同时购买云数据库。本版 PostgreSQL 16 与网站放在同一台机器。

阿里云的 Docker 部署说明支持 Ubuntu 24.04，详见 [ECS 部署业务代码](https://help.aliyun.com/zh/ecs/user-guide/deploy-applications)。大陆服务器通过域名对外提供网站服务时，先完成域名实名和备案，详见 [阿里云备案流程](https://help.aliyun.com/zh/icp-filing/basic-icp-service/user-guide/icp-filing-application-overview)。公网访问结果须实际从老师和同学的普通网络验证。

服务器安装 Git、Node.js 22 或以上、Docker Engine、Compose v2 插件。按 [Docker 的 Ubuntu 安装说明](https://docs.docker.com/engine/install/ubuntu/)安装，使用 SSH 密钥登录。安全组开放 80、443，SSH 22 限制为维护人员 IP；不开放 PostgreSQL 5432。3080 只绑定服务器本机。

## 2. 首次发布

在服务器中执行，使用有 Docker 权限的部署账号：

```bash
git clone https://github.com/yc-wzx/agilecampus.git
cd agilecampus
git checkout master
npm ci
cp deploy/production.env.example .env
chmod 600 .env
```

分别运行三次下面的命令，获得三个不同随机值，填入 `.env` 的 `POSTGRES_PASSWORD`、`AUTH_SECRET`、`CRON_SECRET`。不要把结果发群、提交 Git 或写入报告：

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

数据库密码同时填入 `DATABASE_URL`，数据库名和 `POSTGRES_DB` 保持一致，主机为 `db`。`AGILECAMPUS_URL`、`AUTH_URL` 设置为实际 `https://域名`，`DOMAIN` 只填域名。DNS 指向服务器，域名访问准备好后执行：

```bash
node scripts/ops.mjs preflight
node scripts/ops.mjs release
node scripts/ops.mjs status
node scripts/ops.mjs smoke
```

发布脚本按顺序构建网站/迁移镜像、等待数据库健康、备份、执行 `db:migrate`、启动网站和提醒进程、检查数据库健康及登录页、启动 Caddy HTTPS。首次启动的备份是迁移前空库，后续发布前备份才包含已产生的业务数据。健康等待使用 [Compose 的 `--wait`](https://docs.docker.com/reference/cli/docker/compose/up/)。Caddy 根据真实域名申请证书和转发请求，见 [自动 HTTPS](https://caddyserver.com/docs/automatic-https)与[反向代理](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy)。

网页在 `/register` 注册新账号，再创建团队、邀请同学加入。不放公开默认管理员密码。首次公网验收：登录 → 创建项目 → 建任务并指派 → 入轮 → 开始/结束迭代 → 提交成果 → 教师反馈 → 修改重交；另用项目外账号检查无权访问。

如果暂时没有可用域名，只做本机验证：`.env` 地址设为 `http://localhost:3080`，通过 SSH 隧道 `ssh -L 3080:127.0.0.1:3080 部署账号@服务器IP` 访问。这不算老师可直接访问的公网交付。

## 3. 升级与旧数据库

本轮新增 `0010_comments_announcements`、`0011_scoped_ai_notification_delivery`。必须提交 SQL、snapshot、journal 三者；生产只运行版本化迁移，不运行 `db:push`。有完整账本的旧库先做备份和副本验证，再升级。本轮已验证从 `0007` 升级到 `0011`，保留原用户、团队、角色、项目、任务和成果。

老师早期用 `db:push` 建立且没有 `drizzle.__drizzle_migrations` 账本的库，不能直接重放 `0000`。先在独立副本核对 schema 与基线迁移，再初始化匹配的账本；禁止在实际库清表重建。全新租用服务器的空库不涉及此问题。

新增连接统一使用 UTC；业务日、周报和到期提醒按北京时间。旧 timestamp 字段如果历史上按数据库本地时区写入，不能凭新时区设置自动修复；迁移前抽查原任务日期和创建时间，记录真实来源后再决定是否需要专项校正。

## 4. 提醒、外部条件

`reminders` 容器默认每 5 分钟调用内部受保护的 cron，不在宿主命令行带密钥。调度依次消费成果 outbox、记录到期站内通知、尝试外部发送。同一天同任务、同负责人、同截止日去重；改派/改日期属于新的业务条件，归档、完成、退组不继续发送。

通知先写入数据库。飞书配置或绑定缺失时保留待发意图；明确拒绝采用退避重试；成功记录为 sent。网络超时、响应不可判定、发送进程中断记录为 uncertain，避免盲目重发。设置页显示渠道状态，“配置就绪”不等于已送达。

```bash
docker compose -p agilecampus -f docker-compose.prod.yml logs --tail 100 reminders
docker compose -p agilecampus -f docker-compose.prod.yml logs --tail 100 app
```

填写真实飞书应用 ID、Secret、回调域名后，由一个已绑定成员实测通知；填写 `DEEPSEEK_API_KEY`、可用模型名后实测项目问答及草案。未配置 AI 时可使用手动迭代、周报、风险和证据功能。测试中的模型回放和模拟飞书服务仅验证程序，不当作外部送达证据。

## 5. 备份与独立恢复

```bash
node scripts/ops.mjs backup
node scripts/ops.mjs restore-drill /绝对路径/agilecampus/backups/实际备份.dump
```

备份是 PostgreSQL 自定义格式全库备份，包含业务表和迁移账本；生成 `.dump.json` 校验值与提交号、`.restore.json` 恢复记录。恢复脚本仅创建新的 `agilecampus_restore_时间戳` 数据库，不覆盖原库、不删除卷。核对用户/项目/任务/评论/公告/成果版本数量，并用对应代码验证来源记录和写入。自动数量核对不能替代业务抽查。

建议每天备份、展示前和发布前额外备份；保留最近 7 份日备份及最近 4 份周备份。将备份与校验文件复制到另外一台可信设备或私有存储，限制下载权限。脚本不会自动删除旧备份；实际留存清理由负责人确认，不能只在原服务器上保留唯一副本。

需要恢复实际业务时：停止网站和 reminders，先再备份当前库；用独立恢复脚本还原历史备份并核对。随后修改 `.env` 的 `POSTGRES_DB` 和 `DATABASE_URL` 指向已验证的恢复库，启动匹配的旧代码镜像，使用 `--no-deps` 启动 app/reminders，不把迁移自动施加到历史恢复库。原库保留供排查；核对登录与业务写入后再开放访问。备份后新产生的数据是否需要补回，由负责人根据业务记录决定。

## 6. 代码回退

成功发布在 `.release.json` 记录当前及上一版镜像和提交号，镜像标签为 `agilecampus:release-提交号前12位`。发布直接构建新的版本标签，避免覆盖上一版镜像；构建失败时保留运行中的应用和上次成功记录。

```bash
node scripts/ops.mjs rollback agilecampus:release-实际旧提交号
```

脚本仅允许回到已记录的成功镜像，停止新 app/reminders 后使用旧镜像启动并做健康检查，成功后更新运行版本记录。**回退代码不等于回退数据库。** 本轮迁移增加列和表，旧应用可忽略新字段；将来若删列、改枚举或修改业务语义，必须先确认旧代码与新数据库兼容，否则使用独立恢复方案。发布、回退统一用 ops 脚本；手动 `compose up app` 时必须指定对应 `APP_IMAGE`，否则可能选到默认镜像。

严禁把 `docker compose down -v` 当作重启、回退或恢复步骤。

## 7. 展示前记录

填写实际版本、服务器系统、域名、发布时间、上次可用镜像、迁移账本、备份 SHA-256、恢复耗时、核心流程结果，以及飞书/AI真实条件和失败/跳过项。当前没有服务器，公网、Linux 容器和代码镜像回退验证暂未完成；本机实际数据库升级、pg_dump/pg_restore 独立恢复已有验证。
