"use client";

import { useRef, useState } from "react";

import {
  createDeliverableDraftAction,
  updateDeliverableDraftAction,
} from "./actions";
import { DELIVERABLE_LABELS } from "@/lib/deliverable-labels";
import type { DeliverableType } from "@/db/schema";

type Content = {
  title: string;
  type: DeliverableType;
  url: string;
  description: string;
  milestoneId: string | null;
};

type FieldKey = "title" | "url" | "description";
type FieldErrors = Partial<Record<FieldKey, string>>;

/**
 * 与服务端同一套内容规则的前置校验（deliverable.ts 的 contentSchema）。
 * 只用来把字段错误就近显示；服务端仍旧是唯一权威，重复校验不是放宽。
 */
function validateContent(values: Content): FieldErrors {
  const errors: FieldErrors = {};

  const title = values.title.trim();
  if (!title) errors.title = "请填写成果标题";
  else if (title.length > 200) errors.title = "标题不能超过 200 字";

  if (values.description.trim().length > 10000) {
    errors.description = "说明不能超过 10000 字";
  }

  const url = values.url.trim();
  if (url) {
    const hasUnsafeChar = /[\u0000-\u0020\u007f]/.test(url);
    let valid = false;
    if (!hasUnsafeChar) {
      try {
        const parsed = new URL(url);
        valid =
          (parsed.protocol === "https:" || parsed.protocol === "http:") &&
          Boolean(parsed.hostname) &&
          !parsed.username &&
          !parsed.password;
      } catch {
        valid = false;
      }
    }
    if (!valid) {
      errors.url = "请填写完整的 HTTP 或 HTTPS 链接，不能包含账号密码或空格";
    }
  }

  return errors;
}

export function DeliverableEditor({
  projectId,
  requestId,
  initial,
  deliverableId,
  revision,
  milestones,
}: {
  projectId: string;
  requestId?: string;
  initial?: Content;
  deliverableId?: string;
  revision?: number;
  milestones: { id: string; title: string }[];
}) {
  const [values, setValues] = useState<Content>({
    title: initial?.title ?? "",
    type: initial?.type ?? "report",
    url: initial?.url ?? "",
    description: initial?.description ?? "",
    milestoneId: initial?.milestoneId ?? null,
  });
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState("");
  const [pending, setPending] = useState(false);
  // locked 防双击；request 保证同一次保存（含网络重试）复用同一 requestId
  const locked = useRef(false);
  const request = useRef(requestId);
  // Keep the editor mounted while its action returns; only our confirmed save advances the baseline.
  const savedRevision = useRef(revision);

  function update<K extends keyof Content>(key: K, value: Content[K]) {
    setValues((previous) => ({ ...previous, [key]: value }));
    if (key in fieldErrors) {
      setFieldErrors((previous) => ({ ...previous, [key]: undefined }));
    }
  }

  return (
    <form
      noValidate
      className="ac-card space-y-4 p-4 sm:p-6"
      onSubmit={(event) => {
        event.preventDefault();
        if (locked.current) return;

        const errors = validateContent(values);
        setFieldErrors(errors);
        if (Object.keys(errors).length > 0) {
          setFormError("请先修正标红的字段。");
          return;
        }

        locked.current = true;
        setFormError("");
        setPending(true);
        void (async () => {
          try {
            const result = deliverableId
              ? await updateDeliverableDraftAction(projectId, deliverableId, {
                  ...values,
                  expectedRevision: savedRevision.current!,
                })
              : await createDeliverableDraftAction(projectId, {
                  ...values,
                  requestId: request.current!,
                });

            if (!result.ok) {
              // 保留用户输入，只显示失败原因；冲突时提示刷新核对
              setFormError(result.error);
              return;
            }
            savedRevision.current = result.data.revision;
            // Action 已重新验证并返回当前页；只在新建时导航，避免重复刷新竞态。
            if (!deliverableId)
              window.location.assign(
                `/projects/${projectId}/deliverables/${result.data.id}`,
              );
            else window.location.reload();
          } catch {
            setFormError(
              "未能确认保存结果，请保持当前内容并重试；如提示冲突，请刷新核对。",
            );
          } finally {
            locked.current = false;
            setPending(false);
          }
        })();
      }}
    >
      <fieldset disabled={pending} className="space-y-4">
        <div className="space-y-1">
          <label htmlFor="deliverable-title" className="block text-sm">
            成果标题
          </label>
          <input
            id="deliverable-title"
            name="title"
            required
            maxLength={200}
            className="ac-field"
            value={values.title}
            aria-invalid={fieldErrors.title ? true : undefined}
            aria-describedby={
              fieldErrors.title ? "deliverable-title-error" : undefined
            }
            onChange={(event) => update("title", event.target.value)}
          />
          {fieldErrors.title && (
            <p id="deliverable-title-error" className="text-xs text-high">
              {fieldErrors.title}
            </p>
          )}
        </div>

        <div className="space-y-1">
          <label htmlFor="deliverable-type" className="block text-sm">
            成果类型
          </label>
          <select
            id="deliverable-type"
            name="type"
            className="ac-field"
            value={values.type}
            onChange={(event) =>
              update("type", event.target.value as DeliverableType)
            }
          >
            {Object.entries(DELIVERABLE_LABELS).map(([type, label]) => (
              <option key={type} value={type}>
                {label}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1">
          <label htmlFor="deliverable-url" className="block text-sm">
            成果链接（草稿可留空，正式提交前必须填写）
          </label>
          <input
            id="deliverable-url"
            name="url"
            type="url"
            inputMode="url"
            maxLength={2048}
            className="ac-field"
            placeholder="https://"
            value={values.url}
            aria-invalid={fieldErrors.url ? true : undefined}
            aria-describedby={
              fieldErrors.url ? "deliverable-url-error" : undefined
            }
            onChange={(event) => update("url", event.target.value)}
          />
          {fieldErrors.url && (
            <p id="deliverable-url-error" className="text-xs text-high">
              {fieldErrors.url}
            </p>
          )}
        </div>

        <div className="space-y-1">
          <label htmlFor="deliverable-description" className="block text-sm">
            成果说明
          </label>
          <textarea
            id="deliverable-description"
            name="description"
            rows={4}
            maxLength={10000}
            className="ac-field"
            value={values.description}
            aria-invalid={fieldErrors.description ? true : undefined}
            aria-describedby={
              fieldErrors.description
                ? "deliverable-description-error"
                : undefined
            }
            onChange={(event) => update("description", event.target.value)}
          />
          {fieldErrors.description && (
            <p id="deliverable-description-error" className="text-xs text-high">
              {fieldErrors.description}
            </p>
          )}
        </div>

        <div className="space-y-1">
          <label htmlFor="deliverable-milestone" className="block text-sm">
            关联里程碑
          </label>
          <select
            id="deliverable-milestone"
            name="milestoneId"
            className="ac-field"
            value={values.milestoneId ?? ""}
            onChange={(event) =>
              update("milestoneId", event.target.value || null)
            }
          >
            <option value="">不关联</option>
            {milestones.map((milestone) => (
              <option key={milestone.id} value={milestone.id}>
                {milestone.title}
              </option>
            ))}
          </select>
          {values.milestoneId &&
            !milestones.some((m) => m.id === values.milestoneId) && (
              <p className="text-xs text-high">
                原里程碑已不可用，请重新选择。
              </p>
            )}
        </div>

        <button className="ac-btn" disabled={pending}>
          {pending ? "保存中…" : "保存草稿"}
        </button>
      </fieldset>

      {formError && (
        <p role="alert" className="text-sm text-high">
          {formError}
        </p>
      )}

      <p className="text-xs text-ink-soft">
        保存草稿后，在成果详情确认内容并正式提交。这里仅保存外部链接。
      </p>
    </form>
  );
}
