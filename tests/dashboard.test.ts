import { describe, it, expect } from "vitest";
import {
  addDays,
  todayInShanghai,
  groupMyTasks,
  type MyTask,
  type TaskGroupKey,
} from "@/lib/dashboard";

function task(over: Partial<MyTask> = {}): MyTask {
  return {
    id: "t1",
    title: "任务",
    status: "todo",
    priority: "medium",
    dueDate: null,
    projectId: "p1",
    projectName: "项目",
    teamName: "团队",
    ...over,
  };
}

function keysOf(groups: ReturnType<typeof groupMyTasks>, id: string): TaskGroupKey[] {
  return groups.filter((g) => g.tasks.some((t) => t.id === id)).map((g) => g.key);
}

describe("addDays", () => {
  it("跨月与跨年进位正确", () => {
    expect(addDays("2026-10-05", 7)).toBe("2026-10-12");
    expect(addDays("2026-10-28", 7)).toBe("2026-11-04");
    expect(addDays("2026-12-30", 7)).toBe("2027-01-06");
  });

  it("支持负数（用于回溯）", () => {
    expect(addDays("2026-10-05", -1)).toBe("2026-10-04");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });
});

describe("todayInShanghai", () => {
  it("输出 YYYY-MM-DD", () => {
    expect(todayInShanghai(new Date("2026-10-05T03:00:00Z"))).toBe("2026-10-05");
  });

  it("按上海时间跨日，不受服务器时区影响", () => {
    // UTC 仍是 10-04，但上海已是 10-05
    expect(todayInShanghai(new Date("2026-10-04T16:30:00Z"))).toBe("2026-10-05");
    // UTC 10-05 15:00，上海已是 10-05 23:00
    expect(todayInShanghai(new Date("2026-10-05T15:00:00Z"))).toBe("2026-10-05");
  });
});

describe("groupMyTasks", () => {
  const TODAY = "2026-10-05";

  it("空列表返回四个空组，顺序固定", () => {
    const groups = groupMyTasks([], TODAY);
    expect(groups.map((g) => g.key)).toEqual(["overdue", "today", "next7", "rest"]);
    expect(groups.every((g) => g.tasks.length === 0)).toBe(true);
  });

  it("四个分组互斥，同一任务只出现在一组", () => {
    const groups = groupMyTasks(
      [
        task({ id: "a", dueDate: "2026-10-01" }),
        task({ id: "b", dueDate: TODAY }),
        task({ id: "c", dueDate: "2026-10-08" }),
        task({ id: "d", dueDate: null }),
      ],
      TODAY,
    );
    expect(keysOf(groups, "a")).toEqual(["overdue"]);
    expect(keysOf(groups, "b")).toEqual(["today"]);
    expect(keysOf(groups, "c")).toEqual(["next7"]);
    expect(keysOf(groups, "d")).toEqual(["rest"]);
  });

  it("今天截止不算逾期", () => {
    const groups = groupMyTasks([task({ id: "x", dueDate: TODAY })], TODAY);
    expect(groups.find((g) => g.key === "overdue")!.tasks).toHaveLength(0);
    expect(groups.find((g) => g.key === "today")!.tasks.map((t) => t.id)).toEqual(["x"]);
  });

  it("未来 7 天含第 7 天、不含第 8 天", () => {
    const groups = groupMyTasks(
      [
        task({ id: "d7", dueDate: "2026-10-12" }),
        task({ id: "d8", dueDate: "2026-10-13" }),
      ],
      TODAY,
    );
    expect(groups.find((g) => g.key === "next7")!.tasks.map((t) => t.id)).toEqual(["d7"]);
    expect(groups.find((g) => g.key === "rest")!.tasks.map((t) => t.id)).toEqual(["d8"]);
  });

  it("无截止日的任务保留在其余分组", () => {
    const groups = groupMyTasks([task({ id: "n", dueDate: null })], TODAY);
    expect(groups.find((g) => g.key === "rest")!.tasks.map((t) => t.id)).toEqual(["n"]);
  });

  it("其余分组：进行中优先，无截止日排最后", () => {
    const groups = groupMyTasks(
      [
        task({ id: "noDate", dueDate: null, status: "doing" }),
        task({ id: "late", dueDate: "2026-11-01", status: "todo" }),
        task({ id: "doing", dueDate: "2026-10-20", status: "doing" }),
      ],
      TODAY,
    );
    expect(groups.find((g) => g.key === "rest")!.tasks.map((t) => t.id)).toEqual([
      "doing",
      "noDate",
      "late",
    ]);
  });

  it("有截止日的分组按截止日升序", () => {
    const groups = groupMyTasks(
      [
        task({ id: "newer", dueDate: "2026-10-03" }),
        task({ id: "older", dueDate: "2026-10-01" }),
      ],
      TODAY,
    );
    expect(groups.find((g) => g.key === "overdue")!.tasks.map((t) => t.id)).toEqual([
      "older",
      "newer",
    ]);
  });
});
