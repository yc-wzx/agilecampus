# F / P0 通知模块整合交接

日期：2026-10-09。原交付分支 `feat/f-p0-notifications` 的 12 个提交已保留；整合修复在独立评审分支中完成，未改写同学分支历史。

## 做出了什么

- `/notifications` 登录后查看本人通知，未读筛选、分页、单条/全部已读和真实来源跳转。
- 全局导航显示真实未读数。读取失败显示不可用提示，不把服务错误显示为零条。
- 任务指派（含改派）、迭代结束在业务事务内记录站内通知。
- D 成果提交/审核/阶段反馈/反馈转任务由唯一组合消费者写 E 活动和 F 通知。
- 当前退组或失去审核权限后，旧通知不再可读/计入未读。来源删除显示占位。
- 操作者不通知自己；非当前成员过滤；同一事件重复投递不重复，新的改派事件仍生成通知。

## 同学和 AI 怎么接入

固定入口 **`@/lib/notification`**（统一标准 §9.2）；实现文件是 `notifications.ts`，保留复数路径兼容已提交调用。不要另建第二套模型或更换公共名称。

```ts
import { listMyNotifications, getUnreadNotificationCount, recordNotificationIntent } from "@/lib/notification";
import { markNotificationReadAction, markAllNotificationsReadAction } from "@/app/(app)/notifications/actions";

// actorId 从服务端 session 取，不从浏览器参数取。
await listMyNotifications(actorId, { offset: 0, limit: 50, unreadOnly: true, projectId });
const { count, asOf } = await getUnreadNotificationCount(actorId);
// Action 返回固定 Result；失败检查 code/error。
await markAllNotificationsReadAction({ requestId, beforeCreatedAt: asOf, projectId });
```

`listMyNotifications` 返回固定 `PageResult<NotificationItem>`；`getUnreadNotificationCount` 返回 `{count,asOf}`；单条已读返回 `{id,readAt}`；全部已读返回 `{markedCount,asOf}`。全部已读界线使用服务器返回的完整时间字符串，不截断微秒，不自行生成未来时间。相同请求 ID 改内容会冲突。

内部 `recordNotificationIntent(tx,input)` 只供已授权业务事务使用，返回 `{createdCount}`，字段按 `src/contracts/p0-p2.ts`。通知失败应抛错并回滚业务事务；外部网络发送另在 P1 做持久化队列，不能在事务内请求飞书。浏览器不要直接传接收人去调用内部写入函数。

D 成果只复用 `handleDeliverableEvent`，由 `/api/cron/reminders` 调用 `dispatchDeliverableEvents`。不能另建第二个 dispatcher；未配置 `CRON_SECRET` 或令牌错误返回 401。部署后需实际配置调度并验证延迟，目前仅本地手动触发验证。

## 数据库与部署

- E 使用 `0008_e_activities_p0.sql`，F 使用 **`0009_f_notifications_p0.sql`**；journal 与 snapshot 已同步。
- 两张新增表：`notifications`、`notification_read_requests`。统一从 `@/db/schema` 导出；旧子文件只重导出，不产生另一套定义。
- `notifications` 有项目/用户外键、事件/接收者/渠道唯一索引；已读请求账本保证重放结果一致。
- 空库/已有正常迁移账本的库执行 `npm run db:migrate`。本地验证了 0007→0009 数据保留。
- 已经手工建过同名表或用 `db:push` 建库且没有迁移账本的服务器，需要先在备份副本核对实际结构和账本，不能为了迁移成功删库或重置。

## 本次没有完成的功能

项目公告、@ 评论通知来源、站内到期规则扫描、外部发送重试与渠道状态、阿里云部署、独立备份恢复和回滚交接仍待交付。后续新增评论/公告通知时，须扩展通知来源授权/存在性映射并验证真实跳转；目前只支持任务、迭代、成果和反馈来源，不冒充 P1 服务已实现。

测试与页面验证见 [E/F 整合评审](integration-review-2026-10-09.md)，全组进度见 [P0–P2 当前进度](team-progress-20261009.md)。
