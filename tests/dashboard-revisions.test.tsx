import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import DashboardPage from "@/app/(app)/dashboard/page";

// 页面只经过聚合入口取数，所以在这里挂载桩，
// 让真实的 getMyWorkspaceSummary 仍然跑到下游服务，覆盖整条接线。
const mocks = vi.hoisted(() => ({
  revisions: vi.fn(),
  iterations: vi.fn(),
  unread: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: async () => ({ user: { id: "student", name: "同学" } }) }));
vi.mock("@/lib/dashboard", () => ({ getMyOpenTasks: async () => [], groupMyTasks: () => [], todayInShanghai: () => "2026-10-07" }));
vi.mock("@/lib/deliverable-reporting", () => ({ listMyRevisionRequiredDeliverables: mocks.revisions }));
vi.mock("@/lib/iteration", () => ({ listMyActiveIterations: mocks.iterations }));
vi.mock("@/lib/notifications", () => ({ getUnreadNotificationCount: mocks.unread }));

const item = { id: "d", projectId: "p", projectName: "项目", title: "待修改成果", versionId: "v", versionNumber: 2, feedbackId: "f", reviewedAt: "2026-10-06T18:00:00Z", comment: "补充证据" };
const iteration = { id: "i", projectId: "p", projectName: "项目", name: "第一轮迭代", goal: "完成调研", startDate: "2026-10-06", endDate: "2026-10-13", status: "active", revision: 2, createdAt: "", updatedAt: "", startedAt: null, completedAt: null, taskTotal: 4, doneCount: 1, doneRatio: 0.25, scope: "main-tasks", asOf: "", sourceHref: "/projects/p/iterations/i" };

function pageOf(items: unknown[], total: number, nextOffset: number | null, offset = 0) {
  return { items, total, offset, limit: 50, nextOffset };
}

describe("工作台待修改成果", () => {
  beforeEach(() => {
    mocks.revisions.mockReset().mockResolvedValue(pageOf([], 0, null));
    mocks.iterations.mockReset().mockResolvedValue(pageOf([], 0, null));
    mocks.unread.mockReset().mockResolvedValue({ count: 0, asOf: "2026-10-07T00:00:00Z" });
  });

  it("显示服务端总数、下一页及指定版本/反馈入口，用北京时间", async () => {
    mocks.revisions.mockResolvedValue(pageOf([item], 51, 50));
    const html = renderToStaticMarkup(await DashboardPage({ searchParams: Promise.resolve({}) }));
    expect(html).toContain("共 51 项");
    expect(html).toContain("revisionsOffset=50");
    expect(html).toContain("versionId=v&amp;feedbackId=f");
    expect(html).toContain("2026-10-07");
    expect(mocks.revisions).toHaveBeenCalledWith("student", { offset: 0, limit: 50 });
  });

  it("第二页传入 offset，并保留返回第一页入口", async () => {
    mocks.revisions.mockResolvedValue(pageOf([item], 51, null, 50));
    const html = renderToStaticMarkup(await DashboardPage({ searchParams: Promise.resolve({ revisionsOffset: "50" }) }));
    expect(mocks.revisions).toHaveBeenCalledWith("student", { offset: 50, limit: 50 });
    expect(html).toContain("revisionsOffset=0");
  });

  it("局部失败明确提示，不显示虚假的零成果数", async () => {
    mocks.revisions.mockRejectedValue(new Error("connection failed"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const html = renderToStaticMarkup(await DashboardPage({ searchParams: Promise.resolve({ revisionsOffset: "bad" }) }));
    expect(html).toContain("成果加载失败");
    // 只在成果区块内检查：失败时既不显示总数，也不显示计数徽章
    const revisionsSection = html.slice(html.indexOf('id="revisions"'));
    expect(revisionsSection).not.toContain("共 0 项");
    expect(revisionsSection).not.toContain("ac-badge");
    vi.restoreAllMocks();
  });
});

describe("工作台当前迭代", () => {
  beforeEach(() => {
    mocks.revisions.mockReset().mockResolvedValue(pageOf([], 0, null));
    mocks.iterations.mockReset().mockResolvedValue(pageOf([], 0, null));
    mocks.unread.mockReset().mockResolvedValue({ count: 0, asOf: "2026-10-07T00:00:00Z" });
  });

  it("展示迭代名称、项目、起止日、主任务完成数与目标", async () => {
    mocks.iterations.mockResolvedValue(pageOf([iteration], 1, null));
    const html = renderToStaticMarkup(await DashboardPage({ searchParams: Promise.resolve({}) }));
    expect(html).toContain("当前迭代");
    expect(html).toContain("第一轮迭代");
    expect(html).toContain("/projects/p/iterations/i");
    expect(html).toContain("2026-10-06 ~ 2026-10-13");
    expect(html).toContain("主任务 1/4");
    expect(html).toContain("完成调研");
  });

  it("没有进行中的迭代时显示空状态", async () => {
    const html = renderToStaticMarkup(await DashboardPage({ searchParams: Promise.resolve({}) }));
    expect(html).toContain("暂无进行中的迭代");
  });

  it("迭代服务失败时说明原因，不冒充空数据", async () => {
    mocks.iterations.mockRejectedValue(new Error("connection failed"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const html = renderToStaticMarkup(await DashboardPage({ searchParams: Promise.resolve({}) }));
    expect(html).toContain("当前迭代加载失败");
    expect(html).not.toContain("暂无进行中的迭代");
    vi.restoreAllMocks();
  });
});

describe("工作台未读通知", () => {
  beforeEach(() => {
    mocks.revisions.mockReset().mockResolvedValue(pageOf([], 0, null));
    mocks.iterations.mockReset().mockResolvedValue(pageOf([], 0, null));
    mocks.unread.mockReset().mockResolvedValue({ count: 0, asOf: "2026-10-07T00:00:00Z" });
  });

  it("未读数服务失败不影响其余区块", async () => {
    mocks.unread.mockRejectedValue(new Error("connection failed"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const html = renderToStaticMarkup(await DashboardPage({ searchParams: Promise.resolve({}) }));
    expect(html).toContain("工作台");
    expect(html).toContain("我的任务");
    expect(html).toContain("当前迭代");
    vi.restoreAllMocks();
  });

  it("聚合以当前登录用户身份取未读数", async () => {
    mocks.unread.mockResolvedValue({ count: 3, asOf: "2026-10-07T00:00:00Z" });
    renderToStaticMarkup(await DashboardPage({ searchParams: Promise.resolve({}) }));
    expect(mocks.unread).toHaveBeenCalledWith("student");
  });
});
