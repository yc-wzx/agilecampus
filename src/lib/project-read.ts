import { sql } from "drizzle-orm";
import { db, type DbTx } from "@/db";
import { ForbiddenError } from "./errors";
import { z } from "zod";
export async function readProject<T>(
  actorId: string,
  projectId: string,
  run: (tx: DbTx) => Promise<T>,
) {
  z.uuid().parse(actorId);
  z.uuid().parse(projectId);
  return db.transaction(
    async (tx) => {
      const rows =
        await tx.execute(sql`select p.id from projects p join team_members m on m.team_id=p.team_id
      where p.id=${projectId} and m.user_id=${actorId} for share of p,m`);
      if (!rows.length) throw new ForbiddenError();
      return run(tx);
    },
    { isolationLevel: "repeatable read" },
  );
}
