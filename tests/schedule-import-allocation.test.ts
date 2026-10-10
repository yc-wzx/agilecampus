import { describe, expect, it } from "vitest";
import {
  previewScheduleImport,
  manualOccurrences,
} from "@/lib/schedule/importer";
import { allocateWork } from "@/lib/schedule/allocator";
import { DEFAULT_PREFERENCES, type PlanTask } from "@/lib/schedule/types";
const calendar = (body: string) =>
  `BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${body}\r\nEND:VCALENDAR`;
const event = (
  extra = "",
  start = "DTSTART;TZID=Asia/Shanghai:20261012T080000",
  end = "DTEND;TZID=Asia/Shanghai:20261012T094000",
) =>
  `BEGIN:VEVENT\r\nUID:course@test\r\nSUMMARY:软件工程\r\n${start}\r\n${end}\r\n${extra}\r\nEND:VEVENT`;
const parse = (content: string) =>
  previewScheduleImport({
    format: "ics",
    content,
    startDate: "2026-10-12",
    endDate: "2026-11-12",
  });
describe("课表格式、时区与例外", () => {
  it("整日停课 EXDATE 不变成仅排除午夜", async () => {
    const result = await parse(
      calendar(
        event("RRULE:FREQ=WEEKLY;COUNT=2\r\nEXDATE;VALUE=DATE:20261019"),
      ),
    );
    expect(result.events).toHaveLength(1);
  });
  it("北京时间周课表展开，EXDATE 排除停课", async () => {
    const result = await parse(
      calendar(
        event(
          "RRULE:FREQ=WEEKLY;COUNT=4\r\nEXDATE;TZID=Asia/Shanghai:20261019T080000",
        ),
      ),
    );
    expect(result.events.map((e) => e.startAt)).toEqual([
      "2026-10-12T00:00:00.000Z",
      "2026-10-26T00:00:00.000Z",
      "2026-11-02T00:00:00.000Z",
    ]);
  });
  it("隔周课程只展开真实周次", async () => {
    const result = await parse(
      calendar(event("RRULE:FREQ=WEEKLY;INTERVAL=2;COUNT=3")),
    );
    expect(result.events.map((e) => e.startAt.slice(0, 10))).toEqual([
      "2026-10-12",
      "2026-10-26",
      "2026-11-09",
    ]);
  });
  it("floating 时间按北京解释，UTC 时间保留准确时刻", async () => {
    const floating = await parse(
      calendar(event("", "DTSTART:20261012T080000", "DTEND:20261012T094000")),
    );
    expect(floating.events[0].startAt).toBe("2026-10-12T00:00:00.000Z");
    const utc = await parse(
      calendar(event("", "DTSTART:20261012T080000Z", "DTEND:20261012T094000Z")),
    );
    expect(utc.events[0].startAt).toBe("2026-10-12T08:00:00.000Z");
  });
  it("全天考试按北京日界阻塞整天", async () => {
    const result = await parse(
      calendar(
        event("", "DTSTART;VALUE=DATE:20261012", "DTEND;VALUE=DATE:20261013"),
      ),
    );
    expect(result.events[0].startAt).toBe("2026-10-11T16:00:00.000Z");
    expect(result.events[0].endAt).toBe("2026-10-12T16:00:00.000Z");
  });
  it("改课 RECURRENCE-ID 使用新时间并不保留原课", async () => {
    const override = `BEGIN:VEVENT\r\nUID:course@test\r\nRECURRENCE-ID;TZID=Asia/Shanghai:20261019T080000\r\nDTSTART;TZID=Asia/Shanghai:20261019T140000\r\nDTEND;TZID=Asia/Shanghai:20261019T154000\r\nSUMMARY:调课\r\nEND:VEVENT`;
    const result = await parse(
      calendar(event("RRULE:FREQ=WEEKLY;COUNT=2") + "\r\n" + override),
    );
    expect(result.events).toHaveLength(2);
    expect(result.events[1].startAt).toBe("2026-10-19T06:00:00.000Z");
  });
  it("CSV 引号与中文、重复课次处理正确", async () => {
    const result = await previewScheduleImport({
      format: "csv",
      content:
        '名称,开始,结束,重复周数,间隔周数\n"软件工程,实验",2026-10-12 08:00,2026-10-12 09:40,3,2',
      startDate: "2026-10-12",
      endDate: "2026-11-12",
    });
    expect(result.events).toHaveLength(3);
    expect(result.events[0].title).toBe("软件工程,实验");
  });
  it("坏 CSV 或重复次数为零拒绝整次预览", async () => {
    await expect(
      previewScheduleImport({
        format: "csv",
        content: "名称,开始,结束\n课程,2026-10-12 09:00,2026-10-12 08:00",
        startDate: "2026-10-12",
        endDate: "2026-11-12",
      }),
    ).rejects.toThrow("第 2 行");
    await expect(
      previewScheduleImport({
        format: "csv",
        content:
          "名称,开始,结束,重复周数\n课程,2026-10-12 08:00,2026-10-12 09:00,0",
        startDate: "2026-10-12",
        endDate: "2026-11-12",
      }),
    ).rejects.toThrow();
  });
  it("高频、未知时区、不支持额外日期拒绝，不能静默忽略", async () => {
    await expect(parse(calendar(event("RRULE:FREQ=SECONDLY")))).rejects.toThrow(
      "按天／按周",
    );
    await expect(
      parse(calendar(event("", "DTSTART;TZID=Imaginary/Zone:20261012T080000"))),
    ).rejects.toThrow("时区");
    await expect(
      parse(calendar(event("RDATE:20261020T080000Z"))),
    ).rejects.toThrow("RDATE");
  });
  it("超范围或没有有效事件不伪造空闲", async () => {
    await expect(
      previewScheduleImport({
        format: "ics",
        content: calendar(event()),
        startDate: "2027-10-12",
        endDate: "2027-11-12",
      }),
    ).rejects.toThrow("没有忙碌日程");
    await expect(parse("bad file")).rejects.toThrow();
  });
  it("手工隔周日程和跨午夜事件", () => {
    const list = manualOccurrences({
      title: "实验",
      start: "2026-10-12T23:30",
      end: "2026-10-13T00:30",
      repeatWeeks: 2,
      intervalWeeks: 2,
    });
    expect(list).toHaveLength(2);
    expect(list[1].startAt).toBe("2026-10-26T15:30:00.000Z");
  });
});
const task = (id: string, minutes = 120): PlanTask => ({
  id,
  title: id,
  status: "todo",
  priority: "high",
  startDate: null,
  dueDate: null,
  effectiveDueDate: null,
  updatedAt: "2026-10-12T00:00:00Z",
  minutes,
  objective: "完成接口",
  reason: "前置目标",
});
const now = new Date("2026-10-12T00:00:00Z");
describe("有限时间的硬约束排程", () => {
  it("每日上限不是 15 的倍数时也不能向上取整超额", () => {
    const result = allocateWork({
      startDate: "2026-10-12",
      days: 1,
      now,
      preferences: { ...DEFAULT_PREFERENCES, dailyMinutes: 31 },
      busy: [],
      tasks: [task("limited", 60)],
    });
    expect(result.scheduledMinutes).toBe(30);
    expect(result.unmet[0].minutes).toBe(30);
  });
  it("低优先工作回填更早日期时，也保留已排工作前的休息", () => {
    const result = allocateWork({
      startDate: "2026-10-12",
      days: 2,
      now: new Date("2026-10-12T23:00:00+08:00"),
      preferences: {
        ...DEFAULT_PREFERENCES,
        days: [1, 2],
        workStart: "00:00",
        workEnd: "23:45",
        bufferMinutes: 60,
        blockMinutes: 30,
      },
      busy: [],
      tasks: [
        { ...task("priority", 30), startDate: "2026-10-13" },
        task("later", 30),
      ],
    });
    expect(result.scheduledMinutes).toBe(60);
    expect(result.items[0].taskId).toBe("priority");
    expect(
      Date.parse(result.items[1].startAt) - Date.parse(result.items[0].endAt),
    ).toBeGreaterThanOrEqual(60 * 60000);
  });
  it("其他项目已确认的工作也计入全日总上限", () => {
    const committed = [
      { startAt: "2026-10-12T00:00:00Z", endAt: "2026-10-12T02:00:00Z" },
    ];
    const result = allocateWork({
      startDate: "2026-10-12",
      days: 1,
      now,
      preferences: { ...DEFAULT_PREFERENCES, dailyMinutes: 120 },
      busy: committed,
      committedWork: committed,
      tasks: [task("b", 60)],
    });
    expect(result.scheduledMinutes).toBe(0);
    expect(result.capacityMinutes).toBe(0);
  });
  it("避开课程和缓冲，按工作时段和每日上限安排", () => {
    const result = allocateWork({
      startDate: "2026-10-12",
      days: 1,
      now,
      preferences: {
        ...DEFAULT_PREFERENCES,
        workStart: "08:00",
        workEnd: "12:00",
        dailyMinutes: 60,
      },
      busy: [
        { startAt: "2026-10-12T00:00:00Z", endAt: "2026-10-12T02:00:00Z" },
      ],
      tasks: [task("a", 120)],
    });
    expect(result.scheduledMinutes).toBe(60);
    expect(result.items[0].startAt).toBe("2026-10-12T02:15:00.000Z");
    expect(result.unmet[0].minutes).toBe(60);
  });
  it("已确认其他计划也是忙碌时间，不产生重叠", () => {
    const result = allocateWork({
      startDate: "2026-10-12",
      days: 1,
      now,
      preferences: {
        ...DEFAULT_PREFERENCES,
        workStart: "08:00",
        workEnd: "10:00",
        bufferMinutes: 0,
      },
      busy: [
        { startAt: "2026-10-12T00:00:00Z", endAt: "2026-10-12T01:00:00Z" },
      ],
      tasks: [task("a", 60), task("b", 60)],
    });
    expect(result.scheduledMinutes).toBe(60);
    expect(result.unmet[0].taskId).toBe("b");
  });
  it("尊重星期、不安排过去时段或任务开始日之前", () => {
    const result = allocateWork({
      startDate: "2026-10-12",
      days: 2,
      now: new Date("2026-10-12T12:30:00Z"),
      preferences: { ...DEFAULT_PREFERENCES, days: [1] },
      busy: [],
      tasks: [task("a", 240)],
    });
    expect(
      result.items.every(
        (b) => Date.parse(b.startAt) >= Date.parse("2026-10-12T12:30:00Z"),
      ),
    ).toBe(true);
    expect(result.scheduledMinutes).toBeLessThan(120);
    const later = allocateWork({
      startDate: "2026-10-12",
      days: 1,
      now,
      preferences: DEFAULT_PREFERENCES,
      busy: [],
      tasks: [{ ...task("b"), startDate: "2026-10-13" }],
    });
    expect(later.items).toEqual([]);
  });
  it("期限前没有容量列出缺口，不把剩余塞到期限后", () => {
    const result = allocateWork({
      startDate: "2026-10-12",
      days: 7,
      now,
      preferences: { ...DEFAULT_PREFERENCES, days: [2, 3] },
      busy: [],
      tasks: [{ ...task("a"), effectiveDueDate: "2026-10-12" }],
    });
    expect(result.items).toEqual([]);
    expect(result.unmet[0].minutes).toBe(120);
  });
  it("逾期工作可补救但明确警告，不声称按期完成", () => {
    const result = allocateWork({
      startDate: "2026-10-12",
      days: 1,
      now,
      preferences: DEFAULT_PREFERENCES,
      busy: [],
      tasks: [{ ...task("a", 30), effectiveDueDate: "2026-10-11" }],
    });
    expect(result.items).toHaveLength(1);
    expect(result.warnings.join()).toContain("补救");
  });
});
