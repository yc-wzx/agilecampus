"use client";
import { useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import type { Result } from "@/contracts/p0-p2";
import {
  previewScheduleAction,
  importScheduleAction,
  addManualScheduleAction,
  saveSchedulePreferencesAction,
  changeScheduleEventAction,
  addEmergencyScheduleAction,
  saveScheduleSharingAction,
} from "@/app/(app)/schedule/actions";
import type {
  ScheduleEventInput,
  SchedulePreferences,
} from "@/lib/schedule/types";

const subscribeHydration = () => () => {};
function useHydrated() {
  return useSyncExternalStore(
    subscribeHydration,
    () => true,
    () => false,
  );
}

export function useScheduleWrite<T>(
  execute: (form: FormData) => Promise<Result<T>>,
  successPath?: string,
) {
  const ready = useHydrated();
  const locked = useRef(false),
    [pending, setPending] = useState(false),
    [error, setError] = useState("");
  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (locked.current) return;
    const form = new FormData(
      event.currentTarget,
      (event.nativeEvent as SubmitEvent).submitter,
    );
    locked.current = true;
    setPending(true);
    setError("");
    try {
      const result = await execute(form);
      if (result.ok) {
        if (successPath) window.location.assign(successPath);
        else window.location.reload();
      } else setError(result.error);
    } catch {
      setError("未能确认结果，请刷新核对或重试。重试使用原请求标识。");
    } finally {
      locked.current = false;
      setPending(false);
    }
  }
  return { pending: pending || !ready, error, onSubmit };
}
export function Feedback({ error }: { error: string }) {
  return error ? (
    <p role="status" className="text-sm text-high">
      {error}
    </p>
  ) : null;
}
const dayNames = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
export function PreferencesForm({
  preferences: p,
  revision,
  requestId,
}: {
  preferences: SchedulePreferences;
  revision: number;
  requestId: string;
}) {
  const { pending, error, onSubmit } = useScheduleWrite((form) =>
    saveSchedulePreferencesAction({
      requestId,
      expectedRevision: revision,
      preferences: {
        workStart: String(form.get("workStart")),
        workEnd: String(form.get("workEnd")),
        days: form.getAll("days").map(Number),
        dailyMinutes: Number(form.get("dailyMinutes")),
        blockMinutes: Number(form.get("blockMinutes")),
        bufferMinutes: Number(form.get("bufferMinutes")),
      },
    }),
  );
  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm">
          可工作开始时间
          <input
            type="time"
            name="workStart"
            defaultValue={p.workStart}
            required
            className="ac-field"
          />
        </label>
        <label className="text-sm">
          可工作结束时间
          <input
            type="time"
            name="workEnd"
            defaultValue={p.workEnd}
            required
            className="ac-field"
          />
        </label>
      </div>
      <fieldset>
        <legend className="mb-2 text-sm">可工作的星期</legend>
        <div className="flex flex-wrap gap-3">
          {dayNames.map((label, i) => (
            <label key={label} className="text-sm">
              <input
                type="checkbox"
                name="days"
                value={i}
                defaultChecked={p.days.includes(i)}
              />{" "}
              {label}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="text-sm">
          每天最多投入（分钟）
          <input
            type="number"
            name="dailyMinutes"
            min={30}
            max={240}
            defaultValue={p.dailyMinutes}
            required
            className="ac-field"
          />
        </label>
        <label className="text-sm">
          每段工作最长（分钟）
          <select
            name="blockMinutes"
            defaultValue={p.blockMinutes}
            className="ac-field"
          >
            <option value={30}>30</option>
            <option value={45}>45</option>
            <option value={60}>60</option>
          </select>
        </label>
        <label className="text-sm">
          日程前后／工作段间休息（分钟）
          <input
            type="number"
            name="bufferMinutes"
            min={0}
            max={60}
            defaultValue={p.bufferMinutes}
            required
            className="ac-field"
          />
        </label>
      </div>
      <Feedback error={error} />
      <button disabled={pending} className="ac-btn">
        {pending ? "保存中…" : "保存可投入时间"}
      </button>
    </form>
  );
}
export function ImportForm({
  startDate,
  endDate,
  requestId,
}: {
  startDate: string;
  endDate: string;
  requestId: string;
}) {
  const ready = useHydrated();
  const [preview, setPreview] =
      useState<
        Awaited<ReturnType<typeof previewScheduleAction>> extends Result<
          infer T
        >
          ? T | null
          : never
      >(null),
    [source, setSource] = useState<"ics" | "csv">("ics"),
    [selected, setSelected] = useState<Set<number>>(new Set()),
    [error, setError] = useState(""),
    [pending, setPending] = useState(false),
    lock = useRef(false);
  async function previewFile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (lock.current) return;
    const form = new FormData(event.currentTarget),
      file = form.get("file");
    setError("");
    setPreview(null);
    if (!(file instanceof File) || !file.size || file.size > 512000) {
      setError("请选择 500KB 以内的 ICS 或 UTF-8 CSV 文件");
      return;
    }
    const format = file.name.toLowerCase().endsWith(".ics")
      ? "ics"
      : file.name.toLowerCase().endsWith(".csv")
        ? "csv"
        : null;
    if (!format) {
      setError("当前支持 .ics 和 .csv；Excel 可另存为 UTF-8 CSV");
      return;
    }
    lock.current = true;
    setPending(true);
    try {
      const result = await previewScheduleAction({
        format,
        content: await file.text(),
        startDate: String(form.get("startDate")),
        endDate: String(form.get("endDate")),
      });
      if (result.ok) {
        setSource(format);
        setPreview(result.data);
        setSelected(new Set(result.data.events.map((_, i) => i)));
      } else setError(result.error);
    } catch {
      setError("预览失败，请重新选择文件后重试");
    } finally {
      lock.current = false;
      setPending(false);
    }
  }
  async function confirm() {
    if (!preview || lock.current) return;
    lock.current = true;
    setPending(true);
    setError("");
    try {
      const result = await importScheduleAction({
        requestId,
        source,
        events: preview.events.filter((_, i) => selected.has(i)),
      });
      if (result.ok) window.location.reload();
      else setError(result.error);
    } catch {
      setError("未能确认导入结果，请刷新核对或重试");
    } finally {
      lock.current = false;
      setPending(false);
    }
  }
  return (
    <div className="space-y-3">
      <form onSubmit={previewFile} className="space-y-3">
        <label className="block text-sm">
          课表／日历文件
          <input
            type="file"
            name="file"
            accept=".ics,.csv"
            required
            className="ac-field"
          />
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm">
            导入范围开始
            <input
              type="date"
              name="startDate"
              defaultValue={startDate}
              required
              className="ac-field"
            />
          </label>
          <label className="text-sm">
            导入范围结束
            <input
              type="date"
              name="endDate"
              defaultValue={endDate}
              required
              className="ac-field"
            />
          </label>
        </div>
        <p className="text-xs text-ink-soft">
          支持按天／按周及隔周课程、例外日期。没有时区的日期按北京时间。原文件不会保存。
        </p>
        <a
          className="text-sm text-primary underline"
          href="/templates/personal-schedule.csv"
          download
        >
          下载 CSV 模板
        </a>
        <button disabled={pending || !ready} className="ac-btn ml-3">
          {pending ? "处理中…" : "预览导入"}
        </button>
      </form>
      <Feedback error={error} />
      {preview && (
        <section className="space-y-3 rounded-lg border border-line p-3">
          <h3 className="font-medium">
            导入预览：{preview.events.length} 次日程
          </h3>
          {preview.warnings.map((w) => (
            <p key={w} className="text-sm text-ink-soft">
              {w}
            </p>
          ))}
          <div className="max-h-80 space-y-2 overflow-auto">
            {preview.events.map((e, i) => (
              <label key={i} className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={selected.has(i)}
                  onChange={(event) =>
                    setSelected((old) => {
                      const next = new Set(old);
                      if (event.target.checked) next.add(i);
                      else next.delete(i);
                      return next;
                    })
                  }
                />
                <span className="min-w-0 break-words">
                  {e.title} · {formatTime(e.startAt)}—{formatTime(e.endAt)}
                </span>
              </label>
            ))}
          </div>
          <button
            type="button"
            onClick={confirm}
            disabled={pending || !selected.size}
            className="ac-btn"
          >
            {pending ? "导入中…" : `确认导入 ${selected.size} 次日程`}
          </button>
          <p className="text-xs text-ink-soft">
            完全相同的日程自动跳过；再次导入不会删除原有课程。
          </p>
        </section>
      )}
    </div>
  );
}
export function formatTime(iso: string) {
  return new Date(iso).toLocaleString("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}
export function ManualForm({ requestId }: { requestId: string }) {
  const { pending, error, onSubmit } = useScheduleWrite((form) =>
    addManualScheduleAction({
      requestId,
      title: String(form.get("title")),
      start: String(form.get("start")),
      end: String(form.get("end")),
      repeatWeeks: Number(form.get("repeatWeeks")),
      intervalWeeks: Number(form.get("intervalWeeks")) as 1 | 2,
      shareBusy: form.has("shareBusy"),
    }),
  );
  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <label className="block text-sm">
        日程名称
        <input
          name="title"
          required
          maxLength={100}
          placeholder="课程、考试或其他占用时间"
          className="ac-field"
        />
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm">
          开始（北京时间）
          <input
            type="datetime-local"
            name="start"
            required
            className="ac-field min-w-0"
          />
        </label>
        <label className="text-sm">
          结束（北京时间）
          <input
            type="datetime-local"
            name="end"
            required
            className="ac-field min-w-0"
          />
        </label>
        <label className="text-sm">
          重复次数
          <input
            type="number"
            name="repeatWeeks"
            min={1}
            max={26}
            defaultValue={1}
            required
            className="ac-field"
          />
        </label>
        <label className="text-sm">
          重复间隔
          <select name="intervalWeeks" className="ac-field">
            <option value={1}>每周（次数为 1 时仅一次）</option>
            <option value={2}>每两周</option>
          </select>
        </label>
      </div>
      <Feedback error={error} />
      <button disabled={pending} className="ac-btn">
        {pending ? "添加中…" : "添加个人日程"}
      </button>
      <BusySharingCheckbox />
    </form>
  );
}
export function EventControls({
  event,
  requestId,
}: {
  event: ScheduleEventInput & { id: string; revision: number };
  requestId: string;
}) {
  const mutation = useScheduleWrite((form) =>
    changeScheduleEventAction(event.id, {
      requestId,
      expectedRevision: event.revision,
      event:
        form.get("operation") === "delete"
          ? undefined
          : {
              title: String(form.get("title")),
              startAt: fromLocal(String(form.get("start"))),
              endAt: fromLocal(String(form.get("end"))),
              shareBusy: form.has("shareBusy"),
            },
    }),
  );
  return (
    <details>
      <summary className="cursor-pointer text-sm text-primary">
        修改／删除这次日程
      </summary>
      <form onSubmit={mutation.onSubmit} className="mt-3 space-y-2">
        <label className="block text-sm">
          名称
          <input
            name="title"
            defaultValue={event.title}
            maxLength={100}
            required
            className="ac-field"
          />
        </label>
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="text-sm">
            开始
            <input
              name="start"
              type="datetime-local"
              defaultValue={toLocal(event.startAt)}
              required
              className="ac-field"
            />
          </label>
          <label className="text-sm">
            结束
            <input
              name="end"
              type="datetime-local"
              defaultValue={toLocal(event.endAt)}
              required
              className="ac-field"
            />
          </label>
        </div>
        <BusySharingCheckbox checked={event.shareBusy ?? false} />
        <Feedback error={mutation.error} />
        <div className="flex flex-wrap gap-3">
          <button
            name="operation"
            value="save"
            disabled={mutation.pending}
            className="ac-btn"
          >
            保存这次日程
          </button>
          <button
            name="operation"
            value="delete"
            disabled={mutation.pending}
            formNoValidate
            className="text-sm text-high"
            onClick={(e) => {
              if (!window.confirm("仅删除这一次个人日程？")) e.preventDefault();
            }}
          >
            删除这次日程
          </button>
        </div>
      </form>
    </details>
  );
}
function toLocal(iso: string) {
  return new Date(Date.parse(iso) + 8 * 3600000).toISOString().slice(0, 16);
}
function fromLocal(value: string) {
  return new Date(value + ":00+08:00").toISOString();
}

function BusySharingCheckbox({ checked = false }: { checked?: boolean }) {
  return (
    <label className="flex items-start gap-2 text-sm">
      <input type="checkbox" name="shareBusy" defaultChecked={checked} />
      <span>
        允许向已选择的团队显示这次忙碌时间（隐藏名称，按半小时模糊显示）
      </span>
    </label>
  );
}
export function EmergencyForm({ requestId }: { requestId: string }) {
  const mutation = useScheduleWrite((form) =>
    addEmergencyScheduleAction({
      requestId,
      title: String(form.get("title") || ""),
      start: String(form.get("start")),
      end: String(form.get("end")),
      shareBusy: form.has("shareBusy"),
    }),
  );
  return (
    <form onSubmit={mutation.onSubmit} className="space-y-3">
      <p className="text-sm text-ink-soft">
        临时有事时登记占用时间，最长 7
        天；无需说明原因。保存后可重新规划，原安排在你确认新草案前保持有效。
      </p>
      <label className="block text-sm">
        本人备注（可不填）
        <input
          name="title"
          maxLength={100}
          placeholder="临时安排，仅本人能看到此名称"
          className="ac-field"
        />
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm">
          临时事件开始（北京时间）
          <input
            type="datetime-local"
            name="start"
            required
            className="ac-field min-w-0"
          />
        </label>
        <label className="text-sm">
          临时事件结束（北京时间）
          <input
            type="datetime-local"
            name="end"
            required
            className="ac-field min-w-0"
          />
        </label>
      </div>
      <BusySharingCheckbox />
      <Feedback error={mutation.error} />
      <button disabled={mutation.pending} className="ac-btn">
        {mutation.pending ? "保存中…" : "补充临时事件"}
      </button>
    </form>
  );
}
export function SharingForm({
  teams,
  teamIds,
  shareWorkPlans,
  revision,
  requestId,
}: {
  teams: { id: string; name: string }[];
  teamIds: string[];
  shareWorkPlans: boolean;
  revision: number;
  requestId: string;
}) {
  const mutation = useScheduleWrite((form) =>
    saveScheduleSharingAction({
      requestId,
      expectedRevision: revision,
      teamIds: form.getAll("teamIds").map(String),
      shareWorkPlans: form.has("shareWorkPlans"),
    }),
  );
  return (
    <form onSubmit={mutation.onSubmit} className="space-y-3">
      <p className="text-sm text-ink-soft">
        默认私有。只向下方选中的团队显示你允许共享的忙碌时间；老师和组员均看不到名称、备注或具体事情。可随时撤回。
      </p>
      <fieldset className="space-y-2">
        <legend className="mb-2 text-sm font-medium">允许查看的团队</legend>
        {!teams.length && (
          <p className="text-sm text-ink-soft">尚未加入团队。</p>
        )}
        {teams.map((t) => (
          <label key={t.id} className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              name="teamIds"
              value={t.id}
              defaultChecked={teamIds.includes(t.id)}
            />
            <span className="break-words">{t.name}</span>
          </label>
        ))}
      </fieldset>
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          name="shareWorkPlans"
          defaultChecked={shareWorkPlans}
        />
        <span>
          同时显示已确认的项目工作时段为“忙碌”（仅对应项目所在团队，隐藏任务和目标）
        </span>
      </label>
      <p className="text-xs text-ink-soft">
        导入的课表默认不共享，请在下方逐项修改需要公开的日程。未共享的时段不能作为空闲证明。
      </p>
      <Feedback error={mutation.error} />
      <button disabled={mutation.pending} className="ac-btn">
        保存日程共享设置
      </button>
    </form>
  );
}
