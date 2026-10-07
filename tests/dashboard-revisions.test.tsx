import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import DashboardPage from "@/app/(app)/dashboard/page";
const mocks = vi.hoisted(() => ({ revisions: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: async () => ({ user: { id: "student", name: "同学" } }) }));
vi.mock("@/lib/dashboard", () => ({ getMyOpenTasks: async () => [], groupMyTasks: () => [], todayInShanghai: () => "2026-10-07" }));
vi.mock("@/lib/deliverable-reporting", () => ({ listMyRevisionRequiredDeliverables: mocks.revisions }));
const item = { id: "d", projectId: "p", projectName: "项目", title: "待修改成果", versionId: "v", versionNumber: 2, feedbackId: "f", reviewedAt: "2026-10-06T18:00:00Z", comment: "补充证据" };
describe("工作台待修改成果", () => {
  beforeEach(() => { mocks.revisions.mockReset(); });
  it("显示服务端总数、下一页及指定版本/反馈入口，用北京时间", async () => {
    mocks.revisions.mockResolvedValue({ items: [item], total: 51, nextOffset: 50 });
    const html = renderToStaticMarkup(await DashboardPage({ searchParams: Promise.resolve({}) }));
    expect(html).toContain("共 51 项");
    expect(html).toContain("revisionsOffset=50");
    expect(html).toContain("versionId=v&amp;feedbackId=f");
    expect(html).toContain("2026-10-07");
    expect(mocks.revisions).toHaveBeenCalledWith("student", { offset: 0, limit: 50 });
  });
  it("第二页传入 offset，并保留返回第一页入口", async () => {
    mocks.revisions.mockResolvedValue({ items: [item], total: 51, nextOffset: null });
    const html = renderToStaticMarkup(await DashboardPage({ searchParams: Promise.resolve({ revisionsOffset: "50" }) }));
    expect(mocks.revisions).toHaveBeenCalledWith("student", { offset: 50, limit: 50 });
    expect(html).toContain("revisionsOffset=0");
  });
  it("局部失败明确提示，不显示虚假的零成果数", async () => {
    mocks.revisions.mockRejectedValue(new Error("connection failed"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const html = renderToStaticMarkup(await DashboardPage({ searchParams: Promise.resolve({ revisionsOffset: "bad" }) }));
    expect(html).toContain("成果加载失败");
    expect(html).not.toContain("共 0 项");
    expect(html).not.toContain(">0</span>");
    vi.restoreAllMocks();
  });
});
