import type {
  ActivityItem,
  ActivityObjectType,
  QueryCoverage,
} from "@/contracts/p0-p2";

// E / P0：项目动态（定稿 §9.4 E-A02 的视图层）。
//
// 服务端组件，不发请求、不持状态。为什么不在这里查负责人姓名：ActivityItem 的形状是定稿
// 定死的，只有 actorId；姓名由页面拿现成的团队成员表补进来，服务端不为此多查一次库。
//
// 覆盖说明（coverage.note）一定要显示：活动是记录功能上线后才有的，此前的操作没有留痕。
// 一个空列表不能等同于「这个项目什么都没发生过」。

const TIME_FORMAT = new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Asia/Shanghai",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

const OBJECT_LABEL: Record<ActivityObjectType, string> = {
  task: "任务",
  iteration: "迭代",
  deliverable: "成果",
  feedback: "反馈",
  comment: "评论",
  announcement: "公告",
};

export function ActivityFeed({
  items,
  coverage,
  actorNames,
  title = "项目动态",
}: {
  items: ActivityItem[];
  coverage: QueryCoverage;
  /** actorId -> 显示名。由页面的团队成员表构建；查不到的成员就不显示名字，不编一个。 */
  actorNames?: Record<string, string>;
  title?: string;
}) {
  return (
    <section className="ac-card p-5">
      <h2 className="text-sm text-ink-soft">{title}</h2>

      {items.length === 0 ? (
        <p className="mt-2 text-sm text-ink-faint">
          这个项目还没有动态。任务与迭代的改动会记录在这里。
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-sunken">
          {items.map((item) => {
            const actorName = actorNames?.[item.actorId];
            return (
              <li
                key={item.id}
                className="flex flex-wrap items-baseline gap-x-2 gap-y-1 py-2.5"
              >
                <span className="ac-badge shrink-0 bg-sunken text-ink-soft">
                  {OBJECT_LABEL[item.objectType] ?? item.objectType}
                </span>
                <span className="min-w-0 flex-1 [overflow-wrap:anywhere] text-sm text-ink">
                  {actorName ? (
                    <>
                      <span className="font-medium">{actorName}</span>{" "}
                    </>
                  ) : null}
                  {item.summary}
                </span>
                <time
                  className="shrink-0 text-xs text-ink-faint"
                  dateTime={item.occurredAt}
                >
                  {TIME_FORMAT.format(new Date(item.occurredAt))}
                </time>
              </li>
            );
          })}
        </ul>
      )}

      <p className="mt-3 text-xs text-ink-faint">{coverage.note}</p>
    </section>
  );
}
