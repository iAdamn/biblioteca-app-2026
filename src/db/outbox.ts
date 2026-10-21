/** Adaptación del repositorio docente: propietario explícito e historial, sin borrar resultados. */
import type { SQLiteDatabase } from 'expo-sqlite';
import type { Loan, OperationState, SyncState } from '@/types';
type WriteLoan = (loan: Loan, state: SyncState, error: string | null) => Promise<void>;
export interface OutboxItem {
  id: number; ownerUid: string; clientRequestId: string; kind: string;
  payload: { bookId: string; clientRequestId: string }; state: OperationState;
  attempts: number; sendCount: number; lastError: string | null; createdAt: string; nextRetryAt: string | null;
}
interface Row {
  id: number; owner_uid: string; client_request_id: string; kind: string; payload: string;
  state: OperationState; attempts: number; send_count: number; last_error: string | null;
  created_at: string; next_retry_at: string | null;
}
function payload(raw: string) {
  try { const p = JSON.parse(raw); return { bookId: typeof p?.bookId === 'string' ? p.bookId : '', clientRequestId: typeof p?.clientRequestId === 'string' ? p.clientRequestId : '' }; }
  catch { return { bookId: '', clientRequestId: '' }; }
}
const map = (r: Row): OutboxItem => ({ id: r.id, ownerUid: r.owner_uid, clientRequestId: r.client_request_id,
  kind: r.kind, payload: payload(r.payload), state: r.state, attempts: r.attempts,
  sendCount: r.send_count, lastError: r.last_error, createdAt: r.created_at, nextRetryAt: r.next_retry_at });
export function createOutboxRepo(db: SQLiteDatabase, write: WriteLoan) {
  return {
    async enqueue(loan: Loan) {
      await db.withTransactionAsync(async () => {
        await db.runAsync(`INSERT INTO outbox(kind,payload,created_at,owner_uid,client_request_id,state,updated_at)
          VALUES ('request_loan',?,?,?,?,'queued',?)`, JSON.stringify({ bookId: loan.bookId, clientRequestId: loan.clientRequestId }),
          loan.requestedAt, loan.userId, loan.clientRequestId, loan.requestedAt);
        await write(loan, 'pending', null);
      });
    },
    async pending(uid: string): Promise<OutboxItem[]> {
      return (await db.getAllAsync<Row>("SELECT * FROM outbox WHERE owner_uid=? AND state IN ('queued','in_flight') ORDER BY id", uid)).map(map);
    },
    async recent(uid: string): Promise<OutboxItem[]> {
      return (await db.getAllAsync<Row>('SELECT * FROM outbox WHERE owner_uid=? ORDER BY id DESC LIMIT 30', uid)).map(map);
    },
    async count(uid: string) {
      return (await db.getFirstAsync<{ n: number }>("SELECT COUNT(*) n FROM outbox WHERE owner_uid=? AND state IN ('queued','in_flight')", uid))?.n ?? 0;
    },
    async attention(uid: string) {
      return (await db.getFirstAsync<{ n: number }>("SELECT COUNT(*) n FROM outbox WHERE owner_uid=? AND acknowledged=0 AND state IN ('attention','conflict','rejected')", uid))?.n ?? 0;
    },
    async recover(uid: string) {
      await db.runAsync("UPDATE outbox SET state='queued' WHERE owner_uid=? AND state='in_flight'", uid);
    },
    async sending(item: OutboxItem, at: string) {
      await db.runAsync("UPDATE outbox SET state='in_flight',send_count=send_count+1,updated_at=? WHERE id=? AND owner_uid=?", at, item.id, item.ownerUid);
    },
    async defer(item: OutboxItem, message: string, retryAt: string | null, failure: boolean, at: string) {
      await db.runAsync("UPDATE outbox SET state='queued',last_error=?,attempts=attempts+?,next_retry_at=?,updated_at=? WHERE id=? AND owner_uid=?",
        message, failure ? 1 : 0, retryAt, at, item.id, item.ownerUid);
    },
    async finish(item: OutboxItem, state: 'conflict' | 'rejected' | 'attention', message: string, at: string, failure = false) {
      await db.withTransactionAsync(async () => {
        await db.runAsync('UPDATE outbox SET state=?,last_error=?,attempts=attempts+?,next_retry_at=NULL,updated_at=? WHERE id=? AND owner_uid=?', state, message, failure ? 1 : 0, at, item.id, item.ownerUid);
        await db.runAsync("UPDATE loans SET sync_state='conflict',sync_error=? WHERE user_id=? AND client_request_id=? AND sync_state<>'synced'", message, item.ownerUid, item.clientRequestId);
      });
    },
    async confirm(loan: Loan, at: string) {
      await db.withTransactionAsync(async () => {
        await db.runAsync('DELETE FROM loans WHERE user_id=? AND client_request_id=? AND id<>?', loan.userId, loan.clientRequestId, loan.id);
        await write(loan, 'synced', null);
        await db.runAsync("UPDATE outbox SET state='confirmed',last_error=NULL,next_retry_at=NULL,updated_at=? WHERE owner_uid=? AND client_request_id=?", at, loan.userId, loan.clientRequestId);
      });
    },
    async retryAttention(uid: string) {
      await db.withTransactionAsync(async () => {
        await db.runAsync("UPDATE loans SET sync_state='pending',sync_error=NULL WHERE user_id=? AND client_request_id IN (SELECT client_request_id FROM outbox WHERE owner_uid=? AND state='attention')", uid, uid);
        await db.runAsync("UPDATE outbox SET state='queued',attempts=0,next_retry_at=NULL,last_error=NULL WHERE owner_uid=? AND state='attention'", uid);
      });
    },
    async acknowledge(uid: string, requestId: string) {
      await db.runAsync("UPDATE outbox SET acknowledged=1 WHERE owner_uid=? AND client_request_id=? AND state IN ('conflict','rejected')", uid, requestId);
    },
  };
}
export interface ActivityEntry { id: number; kind: string; detail: string; createdAt: string }
export function createActivityRepo(db: SQLiteDatabase) {
  return {
    async log(kind: string, detail: string) {
      await db.runAsync('INSERT INTO activity_log(kind,detail,created_at) VALUES (?,?,?)', kind, detail, new Date().toISOString());
      await db.runAsync('DELETE FROM activity_log WHERE id NOT IN (SELECT id FROM activity_log ORDER BY id DESC LIMIT 200)');
    },
    async recent(limit = 20): Promise<ActivityEntry[]> {
      return (await db.getAllAsync<{ id: number; kind: string; detail: string; created_at: string }>('SELECT * FROM activity_log ORDER BY id DESC LIMIT ?', limit))
        .map(r => ({ id: r.id, kind: r.kind, detail: r.detail, createdAt: r.created_at }));
    },
  };
}
