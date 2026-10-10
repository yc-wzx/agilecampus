import { z } from "zod";

export const clockSchema = z
  .string()
  .regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/, "时间格式应为 HH:mm");
export const preferencesSchema = z
  .strictObject({
    workStart: clockSchema.default("18:00"),
    workEnd: clockSchema.default("22:00"),
    days: z
      .array(z.number().int().min(0).max(6))
      .min(1)
      .max(7)
      .default([1, 2, 3, 4, 5]),
    dailyMinutes: z.number().int().min(30).max(240).default(120),
    blockMinutes: z
      .union([z.literal(30), z.literal(45), z.literal(60)])
      .default(45),
    bufferMinutes: z.number().int().min(0).max(60).default(15),
  })
  .refine((p) => p.workStart < p.workEnd, "工作结束时间应晚于开始时间");
export type SchedulePreferences = z.infer<typeof preferencesSchema>;
export const DEFAULT_PREFERENCES = preferencesSchema.parse({});
export const eventSchema = z
  .strictObject({
    title: z.string().trim().min(1).max(100),
    startAt: z.iso.datetime({ offset: true }),
    endAt: z.iso.datetime({ offset: true }),
    shareBusy: z.boolean().default(false),
  })
  .refine(
    (v) =>
      new Date(v.endAt).getTime() > new Date(v.startAt).getTime() &&
      new Date(v.endAt).getTime() - new Date(v.startAt).getTime() <=
        7 * 86400000,
    "日程结束必须晚于开始，单次最长 7 天",
  );
export type ScheduleEventInput = z.input<typeof eventSchema>;
export type BusyPeriod = { startAt: string; endAt: string };
export type PlanTask = {
  id: string;
  title: string;
  status: string;
  priority: string;
  startDate: string | null;
  dueDate: string | null;
  effectiveDueDate: string | null;
  updatedAt: string;
  minutes: number;
  objective: string;
  reason: string;
};
export type WorkBlock = {
  taskId: string;
  title: string;
  objective: string;
  reason: string;
  startAt: string;
  endAt: string;
  minutes: number;
};
export type UnmetWork = {
  taskId: string;
  title: string;
  minutes: number;
  reason: string;
};
export const generatePlanSchema = z.strictObject({
  requestId: z.uuid(),
  startDate: z.iso.date(),
  days: z.union([z.literal(7), z.literal(14)]),
  mode: z.enum(["ai", "rules"]),
  replacePlanId: z.uuid().optional(),
  goal: z.string().trim().max(1000).default(""),
  selections: z
    .array(
      z.strictObject({
        taskId: z.uuid(),
        minutes: z.number().int().min(15).max(2400).multipleOf(15),
      }),
    )
    .min(1)
    .max(40),
});
export type GeneratePlanInput = z.infer<typeof generatePlanSchema>;

export function shanghaiDay(date = new Date()) {
  return new Date(date.getTime() + 8 * 3600000).toISOString().slice(0, 10);
}
export function addDays(day: string, n: number) {
  return new Date(Date.parse(day + "T00:00:00Z") + n * 86400000)
    .toISOString()
    .slice(0, 10);
}
export function localInstant(day: string, time = "00:00") {
  return new Date(`${day}T${time}:00+08:00`);
}
export function isoLocal(value: string) {
  const [day, time] = value.split("T");
  z.iso.date().parse(day);
  clockSchema.parse(time);
  return localInstant(day, time).toISOString();
}
