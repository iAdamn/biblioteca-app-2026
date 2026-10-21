/** Escenarios de la Guía2 adaptados a repositorios SQLite reales y al aislamiento D03. */
import { createLibraryService } from '@/services/library/library-service';
import { createSyncService, MAX_ATTEMPTS } from '@/services/sync/sync-service';
import { createRepositories } from '@/db/repositories';
import { migrateDbIfNeeded } from '@/db/migrations';
import { ApiRequestError, NetworkError, type ApiClient } from '@/services/api/client';
import type { Loan, User } from '@/types';
import { createTestDb } from '../test-utils/node-sqlite';
import { makeBook, makeLoan } from '../test-utils/fakes';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { existsSync, unlinkSync } from 'node:fs';
const USER: User = { uid: 'u1', email: 'ana@example.invalid', name: 'Ana', role: 'student' };
const NOW = Date.parse('2026-10-21T12:00:00.000Z');
async function setup(filename?: string) {
  const db = createTestDb(filename); await migrateDbIfNeeded(db); const repos = createRepositories(db);
  const clock = { value: NOW }; const now = () => new Date(clock.value);
  const server = new Map<string, Loan>();
  const post = jest.fn(async (_path: string, body: { bookId: string; clientRequestId: string }) => {
    const loan = server.get(body.clientRequestId) ?? makeLoan({ id: `server-${server.size}`, bookId: body.bookId, clientRequestId: body.clientRequestId });
    server.set(body.clientRequestId, loan); return { loan };
  });
  const get = jest.fn(async (path: string) => path.startsWith('/api/books')
    ? { books: [makeBook()], serverTime: now().toISOString() } : { loans: [...server.values()] });
  const api = { post, get, patch: jest.fn(), put: jest.fn() } as unknown as ApiClient;
  const newId = jest.fn(() => randomUUID());
  const service = createLibraryService({ api, repos, user: USER, newId, now, isCurrent: () => true });
  await service.initialize();
  return { db, repos, post, get, api, service, server, clock, newId, now };
}
describe('cola persistente, sincronización y cuentas', () => {
  it('guarda local sin pedir red y diferencia pending de confirmado', async () => {
    const a = await setup(); const loan = await a.service.requestLoan(makeBook());
    expect(a.post).not.toHaveBeenCalled(); expect(a.get).not.toHaveBeenCalled();
    expect(loan.syncState).toBe('pending');
    expect((await a.repos.outbox.pending(USER.uid))[0]).toMatchObject({ ownerUid: USER.uid, state: 'queued', clientRequestId: loan.clientRequestId, attempts: 0 });
  });
  it('doble pulsación simultánea crea una intención y un UUID', async () => {
    const a = await setup(); const results = await Promise.allSettled([a.service.requestLoan(makeBook()), a.service.requestLoan(makeBook())]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect(await a.repos.outbox.count(USER.uid)).toBe(1); expect(a.newId).toHaveBeenCalledTimes(1);
  });
  it('outbox y préstamo son atómicos si falla un CHECK al insertar', async () => {
    const a = await setup();
    await expect(a.repos.outbox.enqueue(makeLoan({ status: 'invalido' as never }))).rejects.toThrow();
    expect(await a.repos.outbox.pending(USER.uid)).toEqual([]);
  });
  it('archivo cerrado/reabierto conserva UUID y recupera estado en vuelo', async () => {
    const file = join(tmpdir(), `biblioteca-d04-${randomUUID()}.db`);
    const a = await setup(file); const loan = await a.service.requestLoan(makeBook());
    const [item] = await a.repos.outbox.pending(USER.uid); await a.repos.outbox.sending(item, a.now().toISOString());
    await a.db.closeAsync(); const b = await setup(file);
    try {
      const [restored] = await b.repos.outbox.pending(USER.uid); expect(restored).toMatchObject({ clientRequestId: loan.clientRequestId, state: 'queued', sendCount: 1 });
      await b.service.refresh(); expect(await b.repos.outbox.count(USER.uid)).toBe(0);
      expect((await b.repos.loans.list(USER.uid))[0].id).not.toMatch(/^local-/);
    } finally { await b.db.closeAsync(); for (const s of ['', '-wal', '-shm']) if (existsSync(file+s)) unlinkSync(file+s); }
  });
  it('envía FIFO y confirma sin duplicar filas al repetir sync', async () => {
    const a = await setup(); const first = await a.service.requestLoan(makeBook());
    const second = await a.service.requestLoan(makeBook({ id: 'b2' }));
    await a.service.refresh(); await a.service.refresh();
    expect(a.post.mock.calls.map(c => c[1].clientRequestId)).toEqual([first.clientRequestId, second.clientRequestId]);
    expect(await a.repos.loans.list(USER.uid)).toHaveLength(2);
    expect((await a.repos.outbox.recent(USER.uid)).every(o => o.state === 'confirmed')).toBe(true);
  });
  it('respuesta perdida, reinicio del coordinador y reconexión reutilizan UUID', async () => {
    const a = await setup(); const local = await a.service.requestLoan(makeBook());
    a.post.mockImplementationOnce(async (_path, body) => {
      a.server.set(body.clientRequestId, makeLoan({ clientRequestId: body.clientRequestId })); throw new NetworkError();
    });
    await expect(a.service.refresh()).rejects.toBeInstanceOf(NetworkError);
    expect(await a.repos.outbox.count(USER.uid)).toBe(1);
    a.clock.value += 31_000;
    const sync = createSyncService({ api: a.api, repos: a.repos, user: USER, isCurrent: () => true, now: a.now });
    await sync.run();
    expect(a.post.mock.calls.every(c => c[1].clientRequestId === local.clientRequestId)).toBe(true);
    expect(a.server.size).toBe(1); expect(await a.repos.loans.list(USER.uid)).toHaveLength(1);
  });
  it.each([[409, 'NO_COPIES', 'conflict'], [409, 'ALREADY_ACTIVE', 'conflict'], [404, 'NOT_FOUND', 'conflict'], [403, 'FORBIDDEN', 'rejected'], [400, 'VALIDATION_ERROR', 'rejected']] as const)
  ('HTTP%s/%s conserva explicación %s y no bloquea la siguiente operación', async (status, code, state) => {
    const a = await setup(); await a.service.requestLoan(makeBook()); await a.service.requestLoan(makeBook({ id: 'b2' }));
    a.post.mockRejectedValueOnce(new ApiRequestError(status, code, 'No usar texto arbitrario en bitácora'));
    await a.service.refresh();
    expect((await a.repos.outbox.recent(USER.uid)).map(o => o.state)).toEqual(['confirmed', state]);
    expect((await a.repos.loans.list(USER.uid)).find(l => l.id.startsWith('local-'))).toMatchObject({ syncState: 'conflict', operationState: state });
    expect(await a.repos.outbox.count(USER.uid)).toBe(0);
  });
  it('401 conserva la cola y no lo marca como conflicto', async () => {
    const a = await setup(); await a.service.requestLoan(makeBook()); a.post.mockRejectedValueOnce(new ApiRequestError(401, 'UNAUTHENTICATED', 'x'));
    await expect(a.service.refresh()).rejects.toMatchObject({ status: 401 });
    expect((await a.repos.outbox.pending(USER.uid))[0]).toMatchObject({ state: 'queued', attempts: 0 });
  });
  it.each([429, 503])('HTTP%s respeta backoff y llega a atención tras cinco fallos', async status => {
    const a = await setup(); const loan = await a.service.requestLoan(makeBook());
    a.post.mockRejectedValue(new ApiRequestError(status, 'UNKNOWN', 'temporal', 60_000));
    for (let i = 0; i < MAX_ATTEMPTS; i++) { try { await a.service.refresh(); } catch {} a.clock.value += 301_000; }
    expect(a.post).toHaveBeenCalledTimes(5);
    expect((await a.repos.outbox.recent(USER.uid))[0]).toMatchObject({ state: 'attention', attempts: 5, clientRequestId: loan.clientRequestId });
    await expect(a.service.requestLoan(makeBook())).rejects.toMatchObject({ status: 409 });
    await a.service.refresh(); expect(a.post).toHaveBeenCalledTimes(5);
    await a.service.retryAttention(); expect((await a.repos.outbox.pending(USER.uid))[0].clientRequestId).toBe(loan.clientRequestId);
  });
  it('Retry-After no deja que una operación posterior adelante a la primera', async () => {
    const a = await setup(); await a.service.requestLoan(makeBook()); await a.service.requestLoan(makeBook({ id: 'b2' }));
    a.post.mockRejectedValueOnce(new ApiRequestError(429, 'RATE_LIMITED', 'x', 60_000));
    await expect(a.service.refresh()).rejects.toMatchObject({ status: 429 });
    await a.service.refresh(); expect(a.post).toHaveBeenCalledTimes(1); expect(await a.repos.outbox.count(USER.uid)).toBe(2);
  });
  it('varios disparadores comparten un único ciclo y envío', async () => {
    const a = await setup(); await a.service.requestLoan(makeBook());
    const sync = createSyncService({ api: a.api, repos: a.repos, user: USER, isCurrent: () => true });
    const one = sync.run(); const two = sync.run(); expect(one).toBe(two); await Promise.all([one,two]);
    expect(a.post).toHaveBeenCalledTimes(1);
  });
  it('no consulta/envía cola ajena; detecta propietario distinto de la base', async () => {
    const a = await setup(); await a.service.requestLoan(makeBook());
    const other = createLibraryService({ api: a.api, repos: a.repos, user: { ...USER, uid: 'u2' }, newId: randomUUID, isCurrent: () => true });
    await expect(other.initialize()).rejects.toMatchObject({ status: 403 });
    expect(await a.repos.outbox.pending('u2')).toEqual([]); expect(a.post).not.toHaveBeenCalled();
  });
  it('logout voluntario purga pendientes; expulsión conserva archivo aislado', async () => {
    const a = await setup(); await a.service.requestLoan(makeBook()); a.service.dispose();
    await expect(a.service.refresh()).rejects.toMatchObject({ status: 401 }); expect(await a.repos.outbox.count(USER.uid)).toBe(1);
    a.service.resume(); await a.service.close(); expect(await a.repos.outbox.count(USER.uid)).toBe(0); expect(await a.repos.loans.list(USER.uid)).toEqual([]);
  });
  it('cursor tiene solape de un segundo y actividad no incluye credenciales ni imágenes', async () => {
    const a = await setup(); await a.service.requestLoan(makeBook()); await a.service.refresh(); await a.service.refresh();
    expect(a.get.mock.calls.some(c => c[0].includes(encodeURIComponent(new Date(NOW-1000).toISOString())))).toBe(true);
    const text = JSON.stringify(await a.repos.activity.recent()); expect(text).not.toContain(USER.email); expect(text).not.toMatch(/base64|refreshToken|password/);
    for (let i=0;i<205;i++) await a.repos.activity.log('technical', `evento${i}`);
    expect(await a.repos.activity.recent(500)).toHaveLength(200);
  });
  it('migraciónv2→v3 preserva datos y no asigna operaciones antiguas a otra identidad', async () => {
    const db=createTestDb();
    await db.execAsync("CREATE TABLE books(id TEXT PRIMARY KEY,title TEXT); INSERT INTO books VALUES('conservado','Libro previo'); CREATE TABLE outbox(id INTEGER PRIMARY KEY,kind TEXT,payload TEXT,attempts INTEGER DEFAULT 0,last_error TEXT,created_at TEXT); INSERT INTO outbox VALUES(1,'request_loan','{}',0,NULL,'2026-10-20'); PRAGMA user_version=2;");
    await migrateDbIfNeeded(db);
    expect(await db.getFirstAsync('SELECT title FROM books')).toEqual({title:'Libro previo'});
    expect(await db.getFirstAsync('SELECT owner_uid,state FROM outbox')).toEqual({owner_uid:'',state:'attention'});await db.closeAsync();
  });
});
