import type {
  BusyPeriod,
  PlanTask,
  SchedulePreferences,
  WorkBlock,
  UnmetWork,
} from "./types";
import { addDays, localInstant, shanghaiDay } from "./types";

// AI determines objectives/order. Time placement always obeys local, testable constraints.
export function allocateWork(input: {
  startDate: string;
  days: number;
  preferences: SchedulePreferences;
  busy: BusyPeriod[];
  committedWork?: BusyPeriod[];
  tasks: PlanTask[];
  now: Date;
}) {
  const { preferences: p, tasks, now } = input;
  const busy = input.busy.map((b) => [
    Date.parse(b.startAt) - p.bufferMinutes * 60000,
    Date.parse(b.endAt) + p.bufferMinutes * 60000,
  ]);
  const free: { start: number; end: number; day: string }[] = [];
  for (let n = 0; n < input.days; n++) {
    const day = addDays(input.startDate, n);
    if (!p.days.includes(new Date(day + "T00:00:00Z").getUTCDay())) continue;
    const from = Math.max(
        localInstant(day, p.workStart).getTime(),
        now.getTime(),
      ),
      to = localInstant(day, p.workEnd).getTime();
    for (
      let start = Math.ceil(from / 900000) * 900000;
      start + 900000 <= to;
      start += 900000
    ) {
      if (!busy.some(([a, b]) => start < b && start + 900000 > a))
        free.push({ start, end: start + 900000, day });
    }
  }
  const used = new Set<number>(),
    dayMinutes = new Map<string, number>();
  for (let n = 0; n < input.days; n++) {
    const day = addDays(input.startDate, n),
      from = localInstant(day).getTime(),
      to = localInstant(addDays(day, 1)).getTime();
    dayMinutes.set(
      day,
      (input.committedWork ?? []).reduce(
        (total, b) =>
          total +
          Math.max(
            0,
            Math.min(to, Date.parse(b.endAt)) -
              Math.max(from, Date.parse(b.startAt)),
          ) /
            60000,
        0,
      ),
    );
  }
  const capacityMinutes = Array.from(new Set(free.map((s) => s.day))).reduce(
    (total, day) =>
      total +
      Math.min(
        free.filter((s) => s.day === day).length * 15,
        Math.max(0, p.dailyMinutes - (dayMinutes.get(day) ?? 0)),
      ),
    0,
  );
  const items: WorkBlock[] = [],
    unmet: UnmetWork[] = [],
    warnings: string[] = [];
  for (const task of tasks) {
    let remaining = task.minutes;
    const overdue =
      !!task.effectiveDueDate && task.effectiveDueDate < shanghaiDay(now);
    if (overdue)
      warnings.push(
        `“${task.title}”期限已过，安排为补救工作，不能保证按期完成。`,
      );
    const deadline =
      task.effectiveDueDate && !overdue
        ? localInstant(addDays(task.effectiveDueDate, 1)).getTime()
        : Infinity;
    const earliest = task.startDate
      ? localInstant(task.startDate).getTime()
      : 0;
    for (let i = 0; i < free.length && remaining > 0; i++) {
      const slot = free[i];
      if (used.has(slot.start) || slot.start < earliest || slot.end > deadline)
        continue;
      const capacity = p.dailyMinutes - (dayMinutes.get(slot.day) ?? 0);
      if (capacity < 15) continue;
      const desired =
          Math.floor(Math.min(p.blockMinutes, remaining, capacity) / 15) * 15,
        chunk: number[] = [];
      for (let j = i; j < free.length && chunk.length * 15 < desired; j++) {
        const next = free[j];
        if (
          next.day !== slot.day ||
          next.start !== slot.start + chunk.length * 900000 ||
          used.has(next.start) ||
          next.end > deadline
        )
          break;
        chunk.push(next.start);
      }
      if (!chunk.length) continue;
      const minutes = chunk.length * 15,
        end = slot.start + minutes * 60000;
      items.push({
        taskId: task.id,
        title: task.title,
        objective: task.objective,
        reason: task.reason,
        startAt: new Date(slot.start).toISOString(),
        endAt: new Date(end).toISOString(),
        minutes,
      });
      for (const start of chunk) used.add(start);
      // Later-priority tasks may fill earlier dates: reserve both sides so they
      // cannot end immediately before a block already allocated to another task.
      for (const next of free)
        if (
          (next.start >= end && next.start < end + p.bufferMinutes * 60000) ||
          (next.end <= slot.start &&
            next.end > slot.start - p.bufferMinutes * 60000)
        )
          used.add(next.start);
      dayMinutes.set(slot.day, (dayMinutes.get(slot.day) ?? 0) + minutes);
      remaining -= minutes;
    }
    if (remaining)
      unmet.push({
        taskId: task.id,
        title: task.title,
        minutes: remaining,
        reason:
          "在截止日期、可工作时段及每日上限内，剩余时间不足；请调整目标、工时或与组长协调。",
      });
  }
  return {
    items: items.sort((a, b) => a.startAt.localeCompare(b.startAt)),
    unmet,
    warnings,
    availableMinutes: free.length * 15,
    capacityMinutes,
    scheduledMinutes: items.reduce((s, b) => s + b.minutes, 0),
  };
}
