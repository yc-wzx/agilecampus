import { sql } from "drizzle-orm";
import { z } from "zod";
import type { EvidenceItem, EvidenceFilters } from "@/contracts/p0-p2";
import { evidenceCte } from "./deliverable-reporting";
import { readProject } from "./project-read";
import { pageResult } from "./pagination";
import { ForbiddenError, ValidationError } from "./errors";

export const EVIDENCE_KINDS = [
  "task_activity",
  "iteration_history",
  "comment",
  "deliverable_submission",
  "deliverable_review",
  "milestone_feedback",
  "retrospective",
] as const;
const schema = z
  .strictObject({
    offset: z.number().int().min(0).max(100000).default(0),
    limit: z.number().int().min(1).max(100).default(50),
    fromDate: z.iso.date().optional(),
    toDate: z.iso.date().optional(),
    milestoneId: z.uuid().optional(),
    iterationId: z.uuid().optional(),
    memberId: z.uuid().optional(),
    memberRole: z
      .enum(["actor", "assignee", "submitter", "reviewer", "author"])
      .optional(),
    kinds: z.array(z.enum(EVIDENCE_KINDS)).max(7).optional(),
  })
  .refine((f) => !f.memberId || !!f.memberRole, "按成员筛选时必须指定参与身份")
  .refine(
    (f) => !f.fromDate || !f.toDate || f.fromDate < f.toDate,
    "结束日期必须晚于开始日期",
  );
function parse(input: unknown) {
  const r = schema.safeParse(input);
  if (!r.success) throw new ValidationError(r.error.issues[0].message);
  return r.data;
}

// D's immutable formal evidence CTE is reused; no working-copy columns enter this union.
function entries(projectId: string) {
  return sql`${evidenceCte(projectId)}, entries as (
    select jsonb_build_object('evidenceKey','activity:'||a.id,'kind','task_activity','projectId',a.project_id,'objectId',a.object_id,
      'iterationId',a.metadata->>'iterationId','milestoneId',a.metadata->>'milestoneId','title',a.summary,'summary',a.summary,'occurredAt',a.occurred_at,
      'identities',jsonb_build_array(jsonb_build_object('userId',a.actor_id,'role','actor')) || case when a.metadata->>'assigneeId' is not null then jsonb_build_array(jsonb_build_object('userId',a.metadata->>'assigneeId','role','assignee')) else '[]'::jsonb end,
      'sourceRef',jsonb_build_object('sourceKind','activity','sourceId',a.id,'projectId',a.project_id,'evidenceKey','activity:'||a.id,'availability',case when t.id is null then 'deleted' else 'available' end,'sourceHref',case when t.id is not null then '/projects/'||a.project_id||'?task='||a.object_id end)) item
    from project_activities a left join tasks t on t.id=a.object_id and t.project_id=a.project_id where a.project_id=${projectId} and a.object_type='task'
    union all
    select jsonb_build_object('evidenceKey','iteration-history:'||h.id,'kind','iteration_history','projectId',h.project_id,'objectId',h.iteration_id,'iterationId',h.iteration_id,
      'title',coalesce(h.iteration_snapshot->>'name','迭代结束快照'),'summary','主任务完成 '||(h.stats->>'doneCount')||'/'||(h.stats->>'taskTotal'),'occurredAt',h.closed_at,
      'identities',coalesce((select jsonb_agg(distinct v) from (
        select jsonb_build_object('userId',a.actor_id,'role','actor') v from project_activities a where a.project_id=h.project_id and a.type='iteration.completed' and a.metadata->>'historyId'=h.id::text
        union all select jsonb_build_object('userId',s->>'assigneeId','role','assignee') from jsonb_array_elements(h.task_snapshots) s where s->>'assigneeId' is not null
      ) people),'[]'::jsonb),
      'sourceRef',jsonb_build_object('sourceKind','iteration','sourceId',h.iteration_id,'projectId',h.project_id,'evidenceKey','iteration-history:'||h.id,'availability','available','sourceHref','/projects/'||h.project_id||'/iterations/'||h.iteration_id))
    from iteration_histories h where h.project_id=${projectId}
    union all
    select jsonb_build_object('evidenceKey','comment:'||c.id,'kind','comment','projectId',c.project_id,'objectId',c.id,'title','任务评论','summary',c.body,'occurredAt',c.updated_at,
      'iterationId',a.metadata->>'iterationId','milestoneId',a.metadata->>'milestoneId','identities',jsonb_build_array(jsonb_build_object('userId',c.author_id,'role','author')),
      'sourceRef',jsonb_build_object('sourceKind','comment','sourceId',c.id,'projectId',c.project_id,'evidenceKey','comment:'||c.id,'availability','available','sourceHref','/projects/'||c.project_id||'?task='||c.task_id||'&comment='||c.id))
    from task_comments c left join project_activities a on a.event_key='comment.created:'||c.id where c.project_id=${projectId} and c.deleted_at is null
    union all
    select jsonb_build_object('evidenceKey','retrospective:'||r.id,'kind','retrospective','projectId',r.project_id,'objectId',r.id,'iterationId',r.iteration_id,'title','迭代复盘','summary',concat_ws(E'\n',r.went_well,r.problems,r.next_actions),'occurredAt',r.updated_at,
      'identities',jsonb_build_array(jsonb_build_object('userId',r.author_id,'role','author')),
      'sourceRef',jsonb_build_object('sourceKind','retrospective','sourceId',r.id,'projectId',r.project_id,'evidenceKey','retrospective:'||r.id,'availability','available','sourceHref','/projects/'||r.project_id||'/iterations/'||r.iteration_id))
    from retrospectives r where r.project_id=${projectId}
    union all
    select jsonb_build_object('evidenceKey',e.kind||':'||e.id,'kind',case e.kind when 'submission' then 'deliverable_submission' when 'review' then 'deliverable_review' else 'milestone_feedback' end,
      'projectId',e."projectId",'objectId',e.id,'milestoneId',e."milestoneId",'title',coalesce(e.title,'阶段反馈'),'summary',coalesce(e.comment,e.description,''),'occurredAt',e."occurredAt",
      'identities',jsonb_build_array(jsonb_build_object('userId',e."actorId",'role',case when e.kind='submission' then 'submitter' else 'reviewer' end)) || case when e."authorId" is not null then jsonb_build_array(jsonb_build_object('userId',e."authorId",'role','author')) else '[]'::jsonb end,
      'sourceRef',jsonb_build_object('sourceKind',case when e.kind='submission' then 'deliverable' else 'feedback' end,'sourceId',case when e.kind='submission' then e."deliverableId" else e.id end,'projectId',e."projectId",'evidenceKey',e.kind||':'||e.id,'availability','available',
        'sourceHref',case when e."deliverableId" is not null then '/projects/'||e."projectId"||'/deliverables/'||e."deliverableId"||'?versionId='||e."versionId"||case when e.kind<>'submission' then '&feedbackId='||e.id else '' end else '/projects/'||e."projectId"||'/overview' end))
    from evidence e
  )`;
}
function filter(
  f: ReturnType<typeof parse>,
  generatedAt: string,
  evidenceKey?: string,
) {
  return sql`where (item->>'occurredAt')::timestamptz <= ${generatedAt}::timestamptz
    ${f.fromDate ? sql`and (item->>'occurredAt')::timestamptz >= ${f.fromDate + "T00:00:00+08:00"}::timestamptz` : sql``}
    ${f.toDate ? sql`and (item->>'occurredAt')::timestamptz < ${f.toDate + "T00:00:00+08:00"}::timestamptz` : sql``}
    ${f.milestoneId ? sql`and item->>'milestoneId'=${f.milestoneId}` : sql``}
    ${f.iterationId ? sql`and item->>'iterationId'=${f.iterationId}` : sql``}
    ${f.memberId ? sql`and item->'identities' @> ${JSON.stringify([{ userId: f.memberId, role: f.memberRole }])}::jsonb` : sql``}
    ${
      f.kinds
        ? sql`and item->>'kind' in (${
            f.kinds.length
              ? sql.join(
                  f.kinds.map((kind) => sql`${kind}`),
                  sql`,`,
                )
              : sql`NULL`
          })`
        : sql``
    }
    ${evidenceKey ? sql`and item->>'evidenceKey'=${evidenceKey}` : sql``}`;
}
function summary(f: ReturnType<typeof parse>) {
  return Object.entries(f)
    .filter(
      ([key, value]) =>
        !["offset", "limit"].includes(key) && value !== undefined,
    )
    .map(
      ([key, value]) =>
        `${key}: ${Array.isArray(value) ? value.join(", ") : value}`,
    );
}
function view(item: EvidenceItem): EvidenceItem {
  return { ...item, occurredAt: new Date(item.occurredAt).toISOString() };
}
async function query(
  actorId: string,
  projectId: string,
  f: ReturnType<typeof parse>,
  max?: number,
  key?: string,
) {
  return readProject(actorId, projectId, async (tx) => {
    const [clock] = await tx.execute<{ asOf: string }>(
      sql`select clock_timestamp()::text as "asOf"`,
    );
    const generatedAt = new Date(clock.asOf).toISOString(),
      where = filter(f, generatedAt, key),
      cte = entries(projectId);
    const [count] = await tx.execute<{ total: number }>(
      sql`${cte} select count(*)::int total from entries ${where}`,
    );
    const rows = await tx.execute<{ item: EvidenceItem }>(
      sql`${cte} select item from entries ${where} order by (item->>'occurredAt')::timestamptz desc,item->>'evidenceKey' limit ${max ?? f.limit} offset ${max ? 0 : f.offset}`,
    );
    const [bounds] = await tx.execute<{ first: string | null }>(
      sql`select min(occurred_at)::text first from project_activities where project_id=${projectId}`,
    );
    return {
      ...pageResult(
        rows.map((r) => view(r.item)),
        count.total,
        max ? 0 : f.offset,
        max ?? f.limit,
      ),
      filterSummary: summary(f),
      generatedAt,
      coverage: {
        availableFrom: bounds.first
          ? new Date(bounds.first).toISOString()
          : null,
        complete: false,
        note: "旧操作未回填；任务按事件当时归属，评论和复盘为当前可读版本。生成时间之后的记录不在本次导出内。",
      },
    };
  });
}
export async function listProjectEvidence(
  actorId: string,
  projectId: string,
  filters: EvidenceFilters = {},
) {
  return query(actorId, projectId, parse(filters));
}
export async function getProjectEvidenceItem(
  actorId: string,
  projectId: string,
  evidenceKey: string,
) {
  z.string().min(1).max(300).parse(evidenceKey);
  const page = await query(
    actorId,
    projectId,
    parse({ limit: 1 }),
    undefined,
    evidenceKey,
  );
  if (!page.items[0] && /^comment:[0-9a-f-]{36}$/.test(evidenceKey)) {
    const tombstone = await readProject(actorId, projectId, async (tx) => {
      const [row] = await tx.execute<{
        id: string;
        authorId: string;
        updatedAt: string;
      }>(
        sql`select id,author_id as "authorId",updated_at::text as "updatedAt" from task_comments where id=${evidenceKey.slice(8)}::uuid and project_id=${projectId} and deleted_at is not null`,
      );
      return row;
    });
    if (tombstone)
      return {
        evidenceKey,
        kind: "comment",
        projectId,
        objectId: tombstone.id,
        title: "已删除的评论",
        summary: "来源已删除，正文不可读取",
        occurredAt: new Date(tombstone.updatedAt).toISOString(),
        identities: [{ userId: tombstone.authorId, role: "author" }],
        sourceRef: {
          sourceKind: "comment",
          sourceId: tombstone.id,
          projectId,
          evidenceKey,
          sourceHref: null,
          availability: "deleted",
        },
      } as EvidenceItem;
  }
  if (!page.items[0])
    throw new ForbiddenError("证据来源不存在、已删除或无权访问");
  return page.items[0];
}
export function escapeMarkdown(text: string) {
  return text.replace(/[\r\n]+/g, " ").replace(/[\\`*_{}\[\]()<>|#]/g, "\\$&");
}
export async function exportProjectEvidenceMarkdown(
  actorId: string,
  projectId: string,
  filters: Omit<EvidenceFilters, "offset" | "limit"> & { limit?: number } = {},
) {
  const { limit = 1000, ...rest } = filters;
  z.number().int().min(1).max(5000).parse(limit);
  const page = await query(actorId, projectId, parse(rest), limit);
  const truncated = page.total > page.items.length;
  const lines = [
    "# 项目过程证据清单",
    `项目：${projectId}`,
    `生成时间：${page.generatedAt}`,
    `筛选：${page.filterSummary.join("；") || "全部"}`,
    `符合条件 ${page.total} 条，导出 ${page.items.length} 条${truncated ? "（已截断）" : ""}`,
    page.coverage.note!,
    "身份仅说明参与方式，不代表独立贡献。",
    "",
  ];
  for (const item of page.items) {
    lines.push(
      `## ${escapeMarkdown(item.title)}`,
      `${item.kind} · ${item.occurredAt}`,
      escapeMarkdown(item.summary),
      `参与身份：${item.identities.map((i) => `${i.role}:${i.userId}`).join("、")}`,
      item.sourceRef.sourceHref
        ? `[查看来源](${new URL(item.sourceRef.sourceHref, process.env.AGILECAMPUS_URL || "http://localhost:3000").href})`
        : "来源已删除或不可用",
      "",
    );
  }
  return {
    filename: `project-evidence-${projectId}.md`,
    markdown: lines.join("\n"),
    total: page.total,
    exportedCount: page.items.length,
    truncated,
    generatedAt: page.generatedAt,
    filterSummary: page.filterSummary,
    coverage: page.coverage,
  };
}
