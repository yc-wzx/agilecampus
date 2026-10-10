import ical from "node-ical";
import Papa from "papaparse";
import { z } from "zod";
import { ValidationError } from "@/lib/errors";
import {
  addDays,
  eventSchema,
  isoLocal,
  localInstant,
  type ScheduleEventInput,
} from "./types";

export const importSchema = z
  .strictObject({
    format: z.enum(["ics", "csv"]),
    content: z.string().min(1).max(200000),
    startDate: z.iso.date(),
    endDate: z.iso.date(),
  })
  .refine(
    (v) =>
      v.startDate <= v.endDate &&
      Date.parse(v.endDate) - Date.parse(v.startDate) <= 186 * 86400000,
    "一次导入范围最长 187 天",
  );
export type PreviewImportInput = z.infer<typeof importSchema>;
export const manualSchema = z.strictObject({
  title: z.string().trim().min(1).max(100),
  start: z.string(),
  end: z.string(),
  repeatWeeks: z.number().int().min(1).max(26).default(1),
  intervalWeeks: z.union([z.literal(1), z.literal(2)]).default(1),
  shareBusy: z.boolean().default(false),
});
export type ManualScheduleInput = z.input<typeof manualSchema>;
export function manualOccurrences(input: ManualScheduleInput) {
  const value = manualSchema.parse(input),
    start = Date.parse(isoLocal(value.start)),
    end = Date.parse(isoLocal(value.end));
  if (end <= start || end - start > 86400000)
    throw new ValidationError("手工日程结束应晚于开始，单次最长 24 小时");
  return Array.from({ length: value.repeatWeeks }, (_, n) =>
    eventSchema.parse({
      title: value.title,
      shareBusy: value.shareBusy,
      startAt: new Date(
        start + n * value.intervalWeeks * 7 * 86400000,
      ).toISOString(),
      endAt: new Date(
        end + n * value.intervalWeeks * 7 * 86400000,
      ).toISOString(),
    }),
  );
}
function scalar(value: unknown): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "val" in value)
    return String(value.val);
  return "";
}
// Never use the host timezone for floating ICS values. Dates mean Beijing calendar days.
function normalizeIcs(content: string) {
  const unfolded = content.replace(/^\uFEFF/, "").replace(/\r?\n[ \t]/g, "");
  if (
    !/^BEGIN:VCALENDAR\s*$/im.test(unfolded) ||
    !/^END:VCALENDAR\s*$/im.test(unfolded)
  )
    throw new ValidationError("文件不是完整的 ICS 日历");
  if ((unfolded.match(/^BEGIN:VEVENT\s*$/gim) || []).length > 500)
    throw new ValidationError("一次最多解析 500 条日程规则");
  if (/^(EXRULE|RDATE)[;:]/im.test(unfolded))
    throw new ValidationError(
      "当前不支持 EXRULE／RDATE，额外日期请用具体日期 CSV 或手动补充",
    );
  for (const match of unfolded.matchAll(/^(?:DTSTART|DTEND)[^:]*:(\d{4})/gim))
    if (Number(match[1]) < 2000 || Number(match[1]) > 2100)
      throw new ValidationError("ICS 日程年份应在 2000—2100 年之间");
  // Restrict expansion to the common finite-cost course patterns. No silent approximation.
  for (const match of unfolded.matchAll(/^RRULE:(.+)$/gim)) {
    const values = match[1].trim().split(";");
    if (match[1].length > 500)
      throw new ValidationError("重复规则过长，请改用具体日期 CSV");
    if (
      !values.some((v) => /^FREQ=(DAILY|WEEKLY)$/i.test(v)) ||
      values.some((v) =>
        /^(BYSECOND|BYMINUTE|BYHOUR|BYSETPOS|BYYEARDAY|BYWEEKNO|BYMONTHDAY|BYMONTH)=/i.test(
          v,
        ),
      )
    )
      throw new ValidationError(
        "当前仅支持普通按天／按周（含隔周）重复课表；复杂规则请转为具体日期的 CSV",
      );
    const interval = values.find((v) => /^INTERVAL=/i.test(v));
    if (interval && !/^INTERVAL=(?:[1-9]|[12]\d|30)$/i.test(interval))
      throw new ValidationError("重复间隔应为 1—30");
    const byday = values.find((v) => /^BYDAY=/i.test(v));
    if (
      byday &&
      (!/^BYDAY=(?:MO|TU|WE|TH|FR|SA|SU)(?:,(?:MO|TU|WE|TH|FR|SA|SU))*$/i.test(
        byday,
      ) ||
        byday.split(",").length > 7)
    )
      throw new ValidationError("重复星期规则不合法，请改用普通周课表");
  }
  return unfolded
    .split(/\r?\n/)
    .map((line) => {
      const match =
        /^(DTSTART|DTEND|RECURRENCE-ID|EXDATE|RDATE)([^:]*):(.+)$/i.exec(line);
      if (!match) return line;
      const [, kind, params, values] = match;
      const tz = /TZID=([^;]+)/i.exec(params)?.[1]?.replace(/^"|"$/g, "");
      if (tz) {
        try {
          new Intl.DateTimeFormat("en", { timeZone: tz });
        } catch {
          throw new ValidationError(
            `不支持时区 ${tz}，请转换为北京时间或 UTC 后导入`,
          );
        }
      }
      if (
        /VALUE=DATE(?:;|$)/i.test(params) ||
        /^\d{8}(?:,\d{8})*$/.test(values.trim())
      ) {
        if (kind.toUpperCase() === "EXDATE") return line;
        return `${kind};TZID=Asia/Shanghai:${values
          .trim()
          .split(",")
          .map((v) => v + "T000000")
          .join(",")}`;
      }
      if (!tz && /^\d{8}T\d{6}(?:,\d{8}T\d{6})*$/.test(values.trim()))
        return `${kind}${params};TZID=Asia/Shanghai:${values.trim()}`;
      return line;
    })
    .join("\r\n");
}
export async function previewScheduleImport(input: PreviewImportInput) {
  const value = importSchema.parse(input);
  if (Buffer.byteLength(value.content, "utf8") > 512000)
    throw new ValidationError("文件最多 500KB");
  const from = localInstant(value.startDate),
    to = localInstant(addDays(value.endDate, 1));
  const events: ScheduleEventInput[] = [],
    warnings: string[] = [];
  function add(event: ScheduleEventInput) {
    const parsed = eventSchema.parse(event);
    if (
      Date.parse(parsed.startAt) < to.getTime() &&
      Date.parse(parsed.endAt) > from.getTime()
    )
      events.push(parsed);
    if (events.length > 1000)
      throw new ValidationError("选定范围最多导入 1000 次日程，请缩小范围");
  }
  if (value.format === "csv") {
    const parsed = Papa.parse<Record<string, string>>(
      value.content.replace(/^\uFEFF/, ""),
      {
        header: true,
        skipEmptyLines: "greedy",
        preview: 1001,
        transformHeader: (h) => h.trim(),
      },
    );
    if (parsed.errors.length || parsed.data.length > 1000)
      throw new ValidationError("CSV 格式有误或行数超过 1000，请使用下载模板");
    const fields = parsed.meta.fields ?? [];
    if (
      !["名称", "title"].some((k) => fields.includes(k)) ||
      !["开始", "start"].some((k) => fields.includes(k)) ||
      !["结束", "end"].some((k) => fields.includes(k))
    )
      throw new ValidationError("CSV 必须包含名称、开始、结束三列");
    for (let i = 0; i < parsed.data.length; i++) {
      const row = parsed.data[i];
      try {
        const title = row["名称"] ?? row.title,
          start = row["开始"] ?? row.start,
          end = row["结束"] ?? row.end;
        const weeks = Number((row["重复周数"] ?? row.repeatWeeks) || 1),
          interval = Number((row["间隔周数"] ?? row.intervalWeeks) || 1);
        for (const event of manualOccurrences({
          title,
          start: start.trim().replace(" ", "T"),
          end: end.trim().replace(" ", "T"),
          repeatWeeks: weeks,
          intervalWeeks: interval as 1 | 2,
        }))
          add(event);
      } catch (error) {
        throw new ValidationError(
          `CSV 第 ${i + 2} 行：${error instanceof ValidationError ? error.message : "名称、日期或重复周数不合法"}`,
        );
      }
    }
  } else {
    let parsed;
    try {
      parsed = await ical.async.parseICS(normalizeIcs(value.content));
    } catch (error) {
      if (error instanceof ValidationError) throw error;
      throw new ValidationError("ICS 解析失败，请检查日期与重复规则");
    }
    const source = Object.values(parsed).filter((e) => e?.type === "VEVENT");
    if (!source.length)
      throw new ValidationError("日历没有可导入的 VEVENT 日程");
    for (const event of source) {
      if (!event || event.type !== "VEVENT") continue;
      if (
        event.status === "CANCELLED" ||
        event.transparency === "TRANSPARENT"
      ) {
        warnings.push("取消或标记为空闲的日程未导入。");
        continue;
      }
      try {
        if (
          !event.start ||
          !event.end ||
          !Number.isFinite(event.start.getTime()) ||
          !Number.isFinite(event.end.getTime())
        )
          throw new Error("Missing dates");
        for (const instance of ical.expandRecurringEvent(event, {
          from,
          to: new Date(to.getTime() - 1),
          expandOngoing: true,
        })) {
          if (instance.event.status === "CANCELLED") continue;
          add({
            title:
              scalar(instance.summary).trim().slice(0, 100) || "未命名日程",
            startAt: instance.start.toISOString(),
            endAt: instance.end.toISOString(),
          });
        }
      } catch (error) {
        if (error instanceof ValidationError) throw error;
        throw new ValidationError(
          "ICS 存在缺少结束时间或无效重复规则的日程，未保存任何数据",
        );
      }
    }
  }
  const unique = [
    ...new Map(events.map((e) => [JSON.stringify(e), e])).values(),
  ].sort((a, b) => a.startAt.localeCompare(b.startAt));
  if (!unique.length)
    throw new ValidationError("所选日期范围没有忙碌日程，请调整范围");
  return {
    events: unique,
    warnings: [...new Set(warnings)],
    timeZone: "Asia/Shanghai",
    rangeStart: value.startDate,
    rangeEnd: value.endDate,
  };
}
