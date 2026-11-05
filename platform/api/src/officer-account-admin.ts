import type { Pool, PoolClient } from 'pg';
import type { ManagedOfficerResponse, UpdateManagedOfficerInput, UpdateManagedOfficerResult } from './types.js';
import { WorkflowError } from './workflow.js';

interface OfficerRow {
  id: string;
  actor_type: string;
  display_name: string;
  phone: string | null;
  username: string;
  area_id: string | null;
  area_code: string | null;
  area_name: string | null;
}

const toResponse = (row: OfficerRow): ManagedOfficerResponse => ({
  id: row.id,
  username: row.username,
  displayName: row.display_name,
  phone: row.phone,
  serviceArea: row.area_code && row.area_name ? { code: row.area_code, name: row.area_name } : null,
});

const OFFICER_SELECT = `
  SELECT a.id, a.actor_type, a.display_name, a.phone, o.username,
         sa.id::text AS area_id, sa.code AS area_code, sa.name AS area_name
  FROM workflow_actors a
  JOIN officer_accounts o ON o.actor_id = a.id AND o.status = 'active'
  LEFT JOIN service_areas sa ON sa.id = a.service_area_id`;

/**
 * Chỉ huy quản lý tài khoản cán bộ cùng phường: đổi tên đăng nhập, đặt mật khẩu, đổi khu vực phụ trách.
 * Quyền này chỉ dành cho quản lý tài khoản; chỉ huy vẫn không xử lý được hồ sơ. Mỗi thay đổi ghi vào
 * officer_account_audit_events trong cùng giao dịch (không ghi mật khẩu).
 */
export class OfficerAccountAdminStore {
  constructor(private readonly pool: Pool) {}

  private async requireCommander(client: Pool | PoolClient, actorId: string): Promise<{ id: string; localityId: string }> {
    const result = await client.query<{ id: string; actor_type: string; locality_id: string }>(
      `SELECT id, actor_type, locality_id::text FROM workflow_actors
       WHERE id = $1 AND active = true AND actor_type IN ('officer', 'supervisor') AND locality_id IS NOT NULL`, [actorId],
    );
    const row = result.rows[0];
    if (!row) throw new WorkflowError('FORBIDDEN', 'Tài khoản không có quyền truy cập địa bàn.');
    if (row.actor_type !== 'supervisor') throw new WorkflowError('FORBIDDEN', 'Chỉ chỉ huy mới quản lý được tài khoản cán bộ.');
    return { id: row.id, localityId: row.locality_id };
  }

  async list(actorId: string): Promise<ManagedOfficerResponse[]> {
    const commander = await this.requireCommander(this.pool, actorId);
    const result = await this.pool.query<OfficerRow>(
      `${OFFICER_SELECT}
       WHERE a.locality_id = $1 AND a.actor_type = 'officer' AND a.active = true
       ORDER BY sa.code NULLS LAST, a.display_name`, [commander.localityId],
    );
    return result.rows.map(toResponse);
  }

  /** Khóa dòng cán bộ cần sửa; chỉ huy và cán bộ phường khác không sửa được. */
  private async lockTarget(client: PoolClient, localityId: string, targetId: string): Promise<OfficerRow> {
    const result = await client.query<OfficerRow & { locality_id: string }>(
      `${OFFICER_SELECT.replace('SELECT a.id,', 'SELECT a.locality_id::text AS locality_id, a.id,')}
       WHERE a.id = $1 AND a.active = true
       FOR UPDATE OF a, o`, [targetId],
    );
    const row = result.rows[0];
    if (!row || row.locality_id !== localityId) throw new WorkflowError('NOT_FOUND', 'Không tìm thấy cán bộ trong phường.');
    if (row.actor_type !== 'officer') throw new WorkflowError('FORBIDDEN', 'Không sửa được tài khoản chỉ huy.');
    return row;
  }

  private async audit(client: PoolClient, targetId: string, actorId: string, action: string, before: object | null, after: object | null): Promise<void> {
    await client.query(
      `INSERT INTO officer_account_audit_events (target_actor_id, actor_id, action, before_data, after_data)
       VALUES ($1, $2, $3, $4::jsonb, $5::jsonb)`,
      [targetId, actorId, action, before ? JSON.stringify(before) : null, after ? JSON.stringify(after) : null],
    );
  }

  private async inTransaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const value = await work(client);
      await client.query('COMMIT');
      return value;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  private async reload(client: PoolClient, targetId: string): Promise<ManagedOfficerResponse> {
    const result = await client.query<OfficerRow>(`${OFFICER_SELECT} WHERE a.id = $1`, [targetId]);
    return toResponse(result.rows[0] as OfficerRow);
  }

  async update(
    actorId: string, targetId: string, input: UpdateManagedOfficerInput, reservedUsernames: readonly string[],
  ): Promise<UpdateManagedOfficerResult> {
    return this.inTransaction(async (client) => {
      const commander = await this.requireCommander(client, actorId);
      const target = await this.lockTarget(client, commander.localityId, targetId);
      let usernameChanged = false;

      if (input.username !== undefined && input.username !== target.username) {
        if (reservedUsernames.includes(input.username)) throw new WorkflowError('CONFLICT', 'Tên đăng nhập này đã có người dùng.');
        const taken = await client.query(`SELECT 1 FROM officer_accounts WHERE username_normalized = $1 AND actor_id <> $2`, [input.username, targetId]);
        if (taken.rowCount) throw new WorkflowError('CONFLICT', 'Tên đăng nhập này đã có người dùng.');
        try {
          await client.query(
            `UPDATE officer_accounts SET username = $2, username_normalized = $2, updated_at = now() WHERE actor_id = $1`, [targetId, input.username],
          );
        } catch (error) {
          if ((error as { code?: unknown }).code === '23505') throw new WorkflowError('CONFLICT', 'Tên đăng nhập này đã có người dùng.');
          throw error;
        }
        await this.audit(client, targetId, commander.id, 'username_changed', { username: target.username }, { username: input.username });
        usernameChanged = true;
      }

      if (input.serviceAreaCode !== undefined && input.serviceAreaCode !== target.area_code) {
        let areaId: string | null = null;
        if (input.serviceAreaCode !== null) {
          const area = await client.query<{ id: string }>(
            `SELECT id::text FROM service_areas WHERE code = $1 AND locality_id = $2`, [input.serviceAreaCode, commander.localityId],
          );
          areaId = area.rows[0]?.id ?? null;
          if (!areaId) throw new WorkflowError('INVALID_INPUT', 'Khu vực không thuộc phường này.');
        }
        await client.query(`UPDATE workflow_actors SET service_area_id = $2::uuid, updated_at = now() WHERE id = $1`, [targetId, areaId]);
        await this.audit(client, targetId, commander.id, 'service_area_changed', { areaCode: target.area_code }, { areaCode: input.serviceAreaCode });
      }

      return { officer: await this.reload(client, targetId), usernameChanged };
    });
  }

  async setPassword(actorId: string, targetId: string, passwordHash: string): Promise<ManagedOfficerResponse> {
    return this.inTransaction(async (client) => {
      const commander = await this.requireCommander(client, actorId);
      await this.lockTarget(client, commander.localityId, targetId);
      await client.query(`UPDATE officer_accounts SET password_hash = $2, updated_at = now() WHERE actor_id = $1`, [targetId, passwordHash]);
      await this.audit(client, targetId, commander.id, 'password_set', null, null);
      return this.reload(client, targetId);
    });
  }
}
