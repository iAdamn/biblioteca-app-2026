import { createApiClient, ApiRequestError, NetworkError } from '@/services/api/client';
import { createOnlineLibrary } from '@/services/library/online-library';
import { migrateDbIfNeeded } from '@/db/migrations';
import { createRepositories } from '@/db/repositories';
import { makeBook, makeLoan } from '../test-utils/fakes';
import { createTestDb } from '../test-utils/node-sqlite';
const user = { uid: 'u1', email: 'a@b.co', name: 'Ana', role: 'student' as const };
async function installation(fetchImpl: typeof fetch, isCurrent = () => true) {
  const db = createTestDb(); await migrateDbIfNeeded(db);
  const repos = createRepositories(db);
  const api = createApiClient({ baseUrl: 'https://own-api', timeoutMs: 1000, fetchImpl });
  return { repos, service: createOnlineLibrary({ api, repos, user, newId: () => 'uuid-nuevo-0001', isCurrent }) };
}
const json = (x: unknown) => new Response(JSON.stringify(x), { status: 200 });
describe('frontera API → SQLite D03', () => {
  it('descarga libros/préstamos y la búsqueda lee SQLite, no la red', async () => {
    const fetchImpl = jest.fn().mockImplementation(async (url: string) =>
      json(url.endsWith('/books') ? { books: [makeBook({ title: 'Cólera' })], serverTime: '2026-10-20T12:00:00Z' } : { loans: [makeLoan()] }));
    const { repos, service } = await installation(fetchImpl);
    await service.refresh(); fetchImpl.mockClear();
    expect((await repos.books.list({ q: 'COLERA' }))[0].id).toBe('b1');
    expect((await repos.loans.list('u1'))[0].syncState).toBe('synced');
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it('una respuesta incompleta no sustituye el catálogo conservado', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(json({ books: [{ id: 'incompleto' }], loans: [], serverTime: '2026-10-20T12:00:00Z' }));
    const { repos, service } = await installation(fetchImpl);
    await repos.books.upsertMany([makeBook()]);
    await expect(service.refresh()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    expect(await repos.books.list()).toHaveLength(1);
  });
  it('rechaza préstamos ajenos antes de persistirlos para estudiante', async () => {
    const fetchImpl = jest.fn().mockImplementation(async (url: string) => json(url.endsWith('/books')
      ? { books: [makeBook()], serverTime: '2026-10-20T12:00:00Z' } : { loans: [makeLoan({ userId: 'otro' })] }));
    const { repos, service } = await installation(fetchImpl);
    await expect(service.refresh()).rejects.toBeInstanceOf(ApiRequestError);
    expect(await repos.loans.list(null)).toEqual([]);
  });
  it('una respuesta de la cuenta anterior no se guarda al cambiar sesión', async () => {
    let current = true;
    const fetchImpl = jest.fn().mockImplementation(async (url: string) => {
      current = false;
      return json(url.endsWith('/books') ? { books: [makeBook()], serverTime: '2026-10-20T12:00:00Z' } : { loans: [makeLoan()] });
    });
    const { repos, service } = await installation(fetchImpl, () => current);
    await expect(service.refresh()).rejects.toMatchObject({ status: 401 });
    expect(await repos.books.list()).toEqual([]);
    expect(await repos.loans.list(null)).toEqual([]);
  });
  it('tras perder respuesta conserva UUID y el reintento confirmado produce una sola fila', async () => {
    const fetchImpl = jest.fn().mockRejectedValueOnce(new NetworkError()).mockResolvedValueOnce(json({ loan: makeLoan({ clientRequestId: 'uuid-nuevo-0001' }) }));
    const { repos, service } = await installation(fetchImpl);
    await expect(service.requestLoan(makeBook())).rejects.toBeInstanceOf(NetworkError);
    expect(await repos.loans.list('u1')).toEqual([]); // sin confirmación no se inventa un préstamo
    expect(await repos.meta.get('intent.b1')).toBe('uuid-nuevo-0001');
    await service.requestLoan(makeBook());
    const bodies = fetchImpl.mock.calls.map(call => JSON.parse(call[1].body));
    expect(bodies[0].clientRequestId).toBe(bodies[1].clientRequestId);
    expect(await repos.loans.list('u1')).toHaveLength(1);
    expect(await repos.meta.get('intent.b1')).toBeNull();
  });
  it('un student no gestiona préstamos y logout purga lo privado', async () => {
    const { repos, service } = await installation(jest.fn());
    await repos.books.upsertMany([makeBook()]); await repos.loans.upsertFromServer(makeLoan());
    await expect(service.transition('srv-1', 'approve')).rejects.toMatchObject({ status: 403 });
    await service.close();
    expect(await repos.loans.list(null)).toEqual([]);
    expect(await repos.books.list()).toHaveLength(1);
    await expect(service.refresh()).rejects.toMatchObject({ status: 401 });
  });
});
