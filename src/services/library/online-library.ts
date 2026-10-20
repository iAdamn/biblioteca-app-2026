import type { Repositories } from '@/db/repositories';
import type { ApiClient } from '@/services/api/client';
import { ApiRequestError, NetworkError } from '@/services/api/client';
import { parseBook, parseCatalog, parseLoanResult, parseLoans } from '@/services/api/contracts';
import type { Book, LoanAction, User } from '@/types';

/** D03: operaciones explícitas con red. Sin cola, cursor incremental ni reconexión automática. */
export function createOnlineLibrary({ api, repos, user, newId, isCurrent }: {
  api: ApiClient; repos: Repositories; user: User; newId: () => string; isCurrent: () => boolean;
}) {
  // Las escrituras/lecturas de snapshots no entrelazan transacciones expo-sqlite.
  let tail: Promise<unknown> = Promise.resolve();
  let closed = false;
  const assertCurrent = () => {
    if (closed || !isCurrent()) throw new ApiRequestError(401, 'UNAUTHENTICATED', 'La sesión cambió.');
  };
  function serial<T>(task: () => Promise<T>): Promise<T> {
    const next = tail.catch(() => {}).then(async () => { assertCurrent(); return task(); });
    tail = next;
    return next;
  }
  async function pull() {
    const [catalog, loans] = await Promise.all([api.get('/api/books'), api.get('/api/loans')]);
    const parsed = parseCatalog(catalog);
    const privateLoans = parseLoans(loans);
    if (user.role === 'student' && privateLoans.some(l => l.userId !== user.uid)) {
      throw new ApiRequestError(502, 'INVALID_RESPONSE', 'La API devolvió préstamos de otra cuenta.');
    }
    assertCurrent();
    await repos.books.upsertMany(parsed.books);
    await repos.loans.replaceFromServer(privateLoans);
    await repos.meta.set('download.serverTime', parsed.serverTime);
    await repos.meta.set('download.completedAt', new Date().toISOString());
  }
  return {
    refresh: () => serial(pull),
    requestLoan: (book: Book) => serial(async () => {
      if (user.role !== 'student') throw new ApiRequestError(403, 'FORBIDDEN', 'Solo estudiantes solicitan préstamos.');
      if (await repos.loans.hasActiveForBook(user.uid, book.id)) {
        throw new ApiRequestError(409, 'ALREADY_ACTIVE', 'Ya tienes una solicitud o préstamo activo de este libro.');
      }
      // Una intención online incierta conserva su UUID; no se envía automáticamente.
      const key = `intent.${book.id}`;
      const previous = await repos.meta.get(key);
      const latest = await repos.loans.latestForBook(user.uid, book.id);
      const clientRequestId = previous && latest?.clientRequestId !== previous ? previous : newId();
      await repos.meta.set(key, clientRequestId);
      try {
        assertCurrent();
        const loan = parseLoanResult(await api.post('/api/loans', { bookId: book.id, clientRequestId }));
        assertCurrent();
        if (loan.userId !== user.uid || loan.bookId !== book.id || loan.clientRequestId !== clientRequestId) {
          throw new ApiRequestError(502, 'INVALID_RESPONSE', 'La confirmación no corresponde a la solicitud.');
        }
        await repos.loans.upsertFromServer(loan);
        await repos.meta.remove(key);
        return { ...loan, syncState: 'synced' as const, syncError: null };
      } catch (error) {
        if (!(error instanceof NetworkError) && error instanceof ApiRequestError &&
            [400, 403, 404, 409].includes(error.status)) await repos.meta.remove(key);
        throw error;
      }
    }),
    transition: (id: string, action: LoanAction) => serial(async () => {
      if (user.role !== 'librarian') throw new ApiRequestError(403, 'FORBIDDEN', 'Acción de bibliotecario.');
      const loan = parseLoanResult(await api.patch(`/api/loans/${encodeURIComponent(id)}`, { action }));
      assertCurrent();
      await repos.loans.upsertFromServer(loan);
      // Actualizar stock después del efecto confirmado; si falla GET, la acción ya está guardada.
      const result = await api.get<{ book: unknown }>(`/api/books/${encodeURIComponent(loan.bookId)}`);
      const book = parseBook(result.book);
      assertCurrent();
      await repos.books.upsertMany([book]);
    }),
    async close() {
      closed = true;
      await tail.catch(() => {});
      await repos.clearPrivate();
    },
    resume() { closed = false; },
    dispose() { closed = true; },
  };
}
