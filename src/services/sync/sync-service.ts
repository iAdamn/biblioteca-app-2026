/** Basado en el sincronizador docente; conserva propietario, resultado y UUID de cada intención. */
import type { Repositories } from '@/db/repositories';
import { ApiRequestError, NetworkError, type ApiClient } from '@/services/api/client';
import { parseCatalog, parseLoanResult, parseLoans } from '@/services/api/contracts';
import type { User } from '@/types';
export const MAX_ATTEMPTS = 5;
export const CURSOR_OVERLAP_MS = 1000;
export function conflictMessage(error: ApiRequestError) {
  if (error.code === 'NO_COPIES') return 'Cuando se envió la solicitud ya no quedaban ejemplares disponibles.';
  if (error.code === 'ALREADY_ACTIVE') return 'Ya existía otra solicitud o préstamo activo de este libro.';
  if (error.status === 404) return 'El libro ya no existe en el catálogo.';
  if (error.status === 403) return 'Tu cuenta no tiene permiso para solicitar este préstamo.';
  return `La solicitud fue rechazada por el servidor (${error.status}).`;
}
export interface SyncResult { pushed: number; conflicts: number; booksPulled: number; loansPulled: number }
export function createSyncService({ api, repos, user, isCurrent, now = () => new Date(), changed = () => {} }: {
  api: Pick<ApiClient, 'get' | 'post'>; repos: Repositories; user: User;
  isCurrent: () => boolean; now?: () => Date; changed?: () => void;
}) {
  let flight: Promise<SyncResult> | null = null;
  const guard = () => {
    if (!isCurrent()) throw new ApiRequestError(401, 'UNAUTHENTICATED', 'La sesión cambió. Pendientes conservados para su propietario.');
  };
  async function cycle(): Promise<SyncResult> {
    guard();
    let pushed = 0; let conflicts = 0;
    for (const item of await repos.outbox.pending(user.uid)) {
      guard();
      if (user.role !== 'student' || item.ownerUid !== user.uid) throw new ApiRequestError(403, 'FORBIDDEN', 'La cola no pertenece a esta sesión de estudiante.');
      if (item.nextRetryAt && Date.parse(item.nextRetryAt) > now().getTime()) break;
      const at = now().toISOString();
      // Validar antes de emitir: una fila dañada no puede dirigir una petición arbitraria.
      if (item.kind !== 'request_loan' || item.payload.clientRequestId !== item.clientRequestId ||
          !/^[\w-]{8,100}$/.test(item.clientRequestId) || !/^[\w-]{1,120}$/.test(item.payload.bookId)) {
        await repos.outbox.finish(item, 'rejected', 'Operación local inválida; no enviada.', at); conflicts++; continue;
      }
      await repos.outbox.sending(item, at); changed();
      try {
        guard();
        const loan = parseLoanResult(await api.post('/api/loans', item.payload));
        guard();
        if (loan.userId !== user.uid || loan.bookId !== item.payload.bookId || loan.clientRequestId !== item.clientRequestId) {
          throw new ApiRequestError(502, 'INVALID_RESPONSE', 'Confirmación incompatible.');
        }
        await repos.outbox.confirm(loan, now().toISOString());
        await repos.meta.remove(`intent.${loan.bookId}`);
        await repos.activity.log('sync.confirmed', 'Solicitud confirmada por API'); pushed++;
      } catch (error) {
        guard();
        if (error instanceof NetworkError) {
          await repos.outbox.defer(item, 'Sin respuesta: se conserva el mismo identificador.', new Date(now().getTime() + 30_000).toISOString(), false, at);
          throw error;
        }
        if (!(error instanceof ApiRequestError)) {
          await repos.outbox.defer(item, 'No se pudo confirmar el envío.', null, false, at); throw error;
        }
        if (error.status === 401) {
          await repos.outbox.defer(item, 'Sesión no válida; pendientes conservados.', null, false, at); throw error;
        }
        if (error.status >= 500 || error.status === 429) {
          if (item.attempts + 1 >= MAX_ATTEMPTS) {
            await repos.outbox.finish(item, 'attention', 'Cinco fallos temporales. Reintenta manualmente conservando el identificador.', at, true);
            await repos.activity.log('sync.attention', 'Límite de cinco fallos temporales'); conflicts++; continue;
          }
          const wait = Math.max(error.retryAfterMs ?? 0, Math.min(300_000, 5_000 * 2 ** item.attempts));
          await repos.outbox.defer(item, `Fallo temporal HTTP${error.status}; reintento limitado.`, new Date(now().getTime() + wait).toISOString(), true, at);
          throw error;
        }
        await repos.outbox.finish(item, error.status === 409 || error.status === 404 ? 'conflict' : 'rejected', conflictMessage(error), at);
        await repos.activity.log('sync.conflict', `Resultado no confirmado: HTTP${error.status}`); conflicts++;
      } finally { changed(); }
    }
    const cursor = await repos.meta.get('books.cursor');
    guard();
    const catalog = parseCatalog(await api.get(`/api/books${cursor ? `?updatedSince=${encodeURIComponent(cursor)}` : ''}`));
    guard();
    await repos.books.upsertMany(catalog.books);
    await repos.meta.set('books.cursor', new Date(Date.parse(catalog.serverTime) - CURSOR_OVERLAP_MS).toISOString());
    const loans = parseLoans(await api.get('/api/loans'));
    guard();
    if (user.role === 'student' && loans.some(l => l.userId !== user.uid)) throw new ApiRequestError(502, 'INVALID_RESPONSE', 'Préstamos de otra cuenta en respuesta.');
    // Upsert conserva solicitudes locales pendientes/conflicto; reconoce envíos ya procesados.
    for (const loan of loans) { guard(); await repos.outbox.confirm(loan, now().toISOString()); }
    await repos.meta.set('sync.lastSyncAt', now().toISOString());
    return { pushed, conflicts, booksPulled: catalog.books.length, loansPulled: loans.length };
  }
  return {
    run(): Promise<SyncResult> {
      flight ??= cycle().finally(() => { flight = null; });
      return flight;
    },
  };
}
