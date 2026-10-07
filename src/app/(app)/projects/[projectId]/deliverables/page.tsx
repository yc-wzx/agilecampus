import Link from "next/link";
import { StatusBadge } from "@/components/ui/StatusBadge";

export default async function DeliverablesPage() {
  // 开发样例：等 D 同学提交 src/lib/deliverable.ts 后替换为真实查询
  const mockDeliverables = [
    {
      id: "mock-1",
      title: "用户调研报告",
      type: "报告",
      status: "submitted",
      authorId: "me",
    },
    {
      id: "mock-2",
      title: "需求分析 PPT",
      type: "PPT",
      status: "approved",
      authorId: "me",
    },
    {
      id: "mock-3",
      title: "高保真原型",
      type: "原型",
      status: "changes_requested",
      authorId: "me",
    },
  ];

  return (
    <div className="mx-auto max-w-4xl space-y-6 py-8">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl font-semibold text-ink">
          阶段成果
        </h1>
        <button className="ac-btn-primary">新建成果</button>
      </div>

      {mockDeliverables.length === 0 ? (
        <div className="ac-card p-12 text-center">
          <p className="text-sm text-ink-soft">暂无成果</p>
        </div>
      ) : (
        <div className="ac-card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-sunken text-left text-xs text-ink-soft">
              <tr>
                <th className="px-4 py-3 font-medium">标题</th>
                <th className="px-4 py-3 font-medium">类型</th>
                <th className="px-4 py-3 font-medium">状态</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-sunken">
              {mockDeliverables.map((item) => (
                <tr key={item.id} className="hover:bg-sunken/50">
                  <td className="px-4 py-3">
                    <Link
                      href={`#`}
                      className="font-medium text-ink hover:text-primary"
                    >
                      {item.title}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-ink-soft">{item.type}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={item.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-center text-xs text-ink-faint">
        当前为开发样例，等待 D 同学接入真实成果接口后替换。
      </p>
    </div>
  );
}
