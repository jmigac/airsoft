import "server-only";
import { AdminAuditEntry } from "./admin-types";
import { fetchRows, insertRows } from "./admin-db";

type AuditRow = {
  id: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  game_code: string | null;
  message: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

export async function recordAdminAction(input: {
  action: string;
  entityType: string;
  entityId?: string | null;
  gameCode?: string | null;
  message: string;
  metadata?: Record<string, unknown>;
}) {
  try {
    await insertRows("admin_audit_log", [
      {
        id: crypto.randomUUID(),
        action: input.action,
        entity_type: input.entityType,
        entity_id: input.entityId ?? null,
        game_code: input.gameCode ?? null,
        message: input.message,
        metadata: input.metadata ?? {},
        created_at: new Date().toISOString()
      }
    ]);
  } catch {
    // Audit logging is best-effort to avoid blocking admin workflows if the table is not migrated yet.
  }
}

export async function listAdminAudit(limit = 40): Promise<AdminAuditEntry[]> {
  try {
    const rows = await fetchRows<AuditRow>(
      "admin_audit_log",
      new URLSearchParams({
        select: "id,action,entity_type,entity_id,game_code,message,metadata,created_at",
        order: "created_at.desc",
        limit: String(limit)
      })
    );

    return rows.map((row) => ({
      id: row.id,
      action: row.action,
      entityType: row.entity_type,
      entityId: row.entity_id,
      gameCode: row.game_code,
      message: row.message,
      metadata: row.metadata ?? {},
      createdAt: row.created_at
    }));
  } catch {
    return [];
  }
}
