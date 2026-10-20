/** Opt-in: cliente y servicios reales; SQLite Node y almacenamiento seguro sustituido en memoria.
 * No acredita ejecución física, cámara ni offline. No reset ni borrado de datos del catálogo.
 */
import { writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createApiClient } from '@/services/api/client';
import { createAuthService } from '@/services/auth/auth-service';
import { SessionManager, type SecureStorage } from '@/services/auth/session-manager';
import { createOnlineLibrary } from '@/services/library/online-library';
import { createRepositories } from '@/db/repositories';
import { migrateDbIfNeeded } from '@/db/migrations';
import { createTestDb } from '../test-utils/node-sqlite';
import { nodeFetch } from '../test-utils/node-fetch';
import type { AuthResult, Book, Loan } from '@/types';
const enabled = process.env.E2E_D03 === '1';
const suite = enabled ? describe : describe.skip;
class MemoryStorage implements SecureStorage {
  data = new Map<string, string>();
  async getItemAsync(k: string) { return this.data.get(k) ?? null; }
  async setItemAsync(k: string, v: string) { this.data.set(k, v); }
  async deleteItemAsync(k: string) { this.data.delete(k); }
}
suite('D03 cliente móvil ⇄ API propia real', () => {
  jest.setTimeout(120_000);
  it('autentica ambos roles, persiste, solicita, aprueba, devuelve y aísla cuentas', async () => {
    const baseUrl = process.env.E2E_API_URL;
    if (baseUrl !== 'https://biblioteca-api-2026.vercel.app') throw new Error('Destino propio obligatorio');
    const requests: { method: string; path: string; status: number }[] = [];
    const checks: string[] = [];
    const trackedFetch = (async (url: string, init: RequestInit) => {
      const response = await nodeFetch(url, init);
      requests.push({ method: init.method ?? 'GET', path: new URL(url).pathname.replace(/\/api\/loans\/.+/, '/api/loans/[id]'), status: response.status });
      return response;
    }) as typeof fetch;
    async function install(role: 'STUDENT' | 'LIBRARIAN') {
      const publicApi = createApiClient({ baseUrl: baseUrl!, timeoutMs: 20000, fetchImpl: trackedFetch });
      const storage = new MemoryStorage(); const session = new SessionManager(storage, publicApi);
      const api = createApiClient({ baseUrl: baseUrl!, timeoutMs: 20000, fetchImpl: trackedFetch, auth: {
        getSessionKey: () => session.getUser()?.uid ?? null,
        getAccessToken: () => session.getAccessToken(), refreshSession: token => session.refresh(token),
      } });
      const user = await createAuthService(publicApi, session).signIn(process.env[`E2E_${role}_EMAIL`]!, process.env[`E2E_${role}_PASSWORD`]!);
      const db = createTestDb(); await migrateDbIfNeeded(db); const repos = createRepositories(db);
      const service = createOnlineLibrary({ api, repos, user, newId: randomUUID, isCurrent: () => session.getUser()?.uid === user.uid });
      return { publicApi, session, storage, api, user, db, repos, service };
    }
    const student = await install('STUDENT'); const librarian = await install('LIBRARIAN');
    let created: Loan | null = null; let returned = false;
    try {
      expect(student.user.role).toBe('student'); expect(librarian.user.role).toBe('librarian'); checks.push('Login real de ambos roles mediante auth-service');
      await student.service.refresh();
      const books = await student.repos.books.list(); expect(books).toHaveLength(10); checks.push('Catálogo real de diez libros guardado y leído en SQLite');
      expect((await student.repos.books.list({ q: 'COLERA' })).map(b => b.id)).toContain('amor-en-los-tiempos-del-colera'); checks.push('Búsqueda local sin tildes');
      const me = await student.api.get<{ user: { uid: string } }>('/api/auth/me'); expect(me.user.uid).toBe(student.user.uid); checks.push('Bearer del cliente contra /me');
      expect(await student.session.refresh()).toBe(true); checks.push('Renovación real mediante SessionManager');
      const restarted = new SessionManager(student.storage, student.publicApi); expect((await restarted.restore())?.uid).toBe(student.user.uid); checks.push('Restauración de sesión con adaptador seguro en memoria');
      await expect(student.publicApi.post('/api/auth/login', { email: process.env.E2E_STUDENT_EMAIL, password: randomUUID() }, { auth: false })).rejects.toMatchObject({ status: 401 }); checks.push('Credenciales incorrectas 401');
      const active = await student.repos.loans.list(student.user.uid);
      const book = [...books].reverse().find(b => b.availableCopies > 0 && !active.some(l => l.bookId === b.id && ['requested', 'approved'].includes(l.status)));
      if (!book) throw new Error('No existe libro libre para el recorrido D03');
      created = await student.service.requestLoan(book);
      expect(created.status).toBe('requested'); checks.push('Solicitud online confirmada y persistida');
      const replay = await student.api.post<{ loan: Loan }>('/api/loans', { bookId: book.id, clientRequestId: created.clientRequestId });
      expect(replay.loan.id).toBe(created.id); expect((await student.repos.loans.list(student.user.uid)).filter(l => l.id === created!.id)).toHaveLength(1); checks.push('UUID real idempotente sin duplicar fila local');
      const afterRequest = await student.api.get<{ book: Book }>(`/api/books/${book.id}`); expect(afterRequest.book.availableCopies).toBe(book.availableCopies); checks.push('Solicitar conserva disponibilidad');
      await expect(student.api.patch(`/api/loans/${created.id}`, { action: 'approve' })).rejects.toMatchObject({ status: 403 }); checks.push('Servidor deniega gestión al estudiante');
      await librarian.service.refresh(); expect((await librarian.repos.loans.list(null)).some(l => l.id === created!.id)).toBe(true); checks.push('Bibliotecario descarga solicitud desde su propia instalación');
      await librarian.service.transition(created.id, 'approve'); expect((await librarian.repos.books.getById(book.id))?.availableCopies).toBe(book.availableCopies - 1); checks.push('Aprobación real actualiza stock local');
      await student.service.refresh(); expect((await student.repos.loans.list(student.user.uid)).find(l => l.id === created!.id)?.status).toBe('approved'); checks.push('Estudiante ve estado aprobado tras descarga');
      await librarian.service.transition(created.id, 'return'); returned = true;
      expect((await librarian.repos.books.getById(book.id))?.availableCopies).toBe(book.availableCopies); checks.push('Devolución repone disponibilidad en API y SQLite');
      await student.service.refresh(); expect((await student.repos.loans.list(student.user.uid)).find(l => l.id === created!.id)?.status).toBe('returned'); checks.push('Estado returned persistido del estudiante');
      const aux = { email: process.env.E2E_REGISTER_EMAIL, password: process.env.E2E_REGISTER_PASSWORD, displayName: 'Prueba movil D03', role: 'librarian' };
      let registered: AuthResult;
      try { registered = await student.publicApi.post<AuthResult>('/api/auth/register', aux, { auth: false }); checks.push('Registro HTTP real de cuenta auxiliar'); }
      catch (e) { if ((e as { status?: number }).status !== 409) throw e; registered = await student.publicApi.post<AuthResult>('/api/auth/login', aux, { auth: false }); checks.push('Cuenta auxiliar previamente registrada: login real'); }
      expect(registered.user.role).toBe('student'); checks.push('Intento de role=librarian conserva student en registro público');
      const auxApi = createApiClient({ baseUrl, timeoutMs: 20000, fetchImpl: trackedFetch, auth: { getAccessToken: async () => registered.tokens.idToken, refreshSession: async () => false } });
      await expect(auxApi.get(`/api/loans/${created.id}`)).rejects.toMatchObject({ status: 404 }); checks.push('Otro estudiante recibe 404 del préstamo ajeno');
      expect((await auxApi.get<{ loans: Loan[] }>('/api/loans')).loans).toEqual([]); checks.push('Lista real de auxiliar sin préstamos de la principal');
      await student.service.close(); await student.session.clear();
      expect(await student.repos.loans.list(null)).toEqual([]); expect(await student.repos.meta.get('download.completedAt')).toBeNull(); expect(await student.repos.books.list()).toHaveLength(10); checks.push('Logout elimina préstamos/metadatos y conserva libros');
      expect(student.storage.data.size).toBe(0); checks.push('Logout elimina las cuatro llaves del adaptador seguro');
    } finally {
      if (created && !returned) {
        const current = await librarian.api.get<{ loan: Loan }>(`/api/loans/${created.id}`);
        if (current.loan.status === 'approved') await librarian.service.transition(created.id, 'return');
        if (current.loan.status === 'requested') await librarian.service.transition(created.id, 'reject');
      }
      if (process.env.E2E_EVIDENCE) writeFileSync(process.env.E2E_EVIDENCE, JSON.stringify({ date: '2026-10-20', target: baseUrl, scope: 'Código móvil en Node/Jest; SQLite real Node; SecureStore sustituido, no teléfono', checks, requests, httpCount: requests.length, passedControls: checks.length, createdLoanFinalState: returned ? 'returned' : 'consultar resultado', catalogReset: false }, null, 2));
      await student.db.closeAsync(); await librarian.db.closeAsync();
    }
  });
});
