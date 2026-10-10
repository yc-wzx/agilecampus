"use client";

import { setLeaderAction } from "./actions";
import { useExtraSubmit } from "./use-extra-submit";
export function LeaderForm({
  projectId,
  leaderId,
  revision,
  members,
  requestId,
}: {
  projectId: string;
  leaderId: string | null;
  revision: number;
  members: { id: string; name: string }[];
  requestId: string;
}) {
  const { state, pending, onSubmit } = useExtraSubmit(
    setLeaderAction.bind(null, projectId),
  );
  const active = members.some((m) => m.id === leaderId);
  return (
    <form onSubmit={onSubmit} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="requestId" value={requestId} />
      <input type="hidden" name="expectedRevision" value={revision} />
      <label className="min-w-40 flex-1 text-sm text-ink-soft">
        指定负责人
        <select
          name="leaderId"
          defaultValue={active ? leaderId! : ""}
          className="ac-field"
        >
          <option value="">未指定</option>
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      </label>
      <button className="ac-btn" disabled={pending}>
        {pending ? "保存中…" : "保存负责人"}
      </button>
      {state && (
        <p
          role="status"
          className={"w-full text-sm " + (state.ok ? "text-done" : "text-high")}
        >
          {state.message}
        </p>
      )}
    </form>
  );
}
