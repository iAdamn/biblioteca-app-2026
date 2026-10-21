import type { Repositories } from '@/db/repositories';
import { ApiRequestError, type ApiClient } from '@/services/api/client';
import { createSyncService } from '@/services/sync/sync-service';
import { createOnlineLibrary } from './online-library';
import type { Book, Loan, User } from '@/types';

export function createLibraryService({ api, repos, user, newId, isCurrent, changed = () => {}, now = () => new Date() }: {
  api: ApiClient; repos: Repositories; user: User; newId: () => string;
  isCurrent: () => boolean; changed?: () => void; now?: () => Date;
}) {
  let active = true;
  let requests: Promise<unknown> = Promise.resolve();
  const tasks = new Set<Promise<unknown>>();
  const current = () => active && isCurrent();
  const guard = () => { if (!current()) throw new ApiRequestError(401, 'UNAUTHENTICATED', 'La sesión cambió.'); };
  const online = createOnlineLibrary({ api, repos, user, newId, isCurrent: current });
  const sync = createSyncService({ api, repos, user, isCurrent: current, changed, now });
  function track<T>(promise: Promise<T>): Promise<T> {
    tasks.add(promise); promise.then(() => tasks.delete(promise), () => tasks.delete(promise)); return promise;
  }
  return {
    async initialize() {
      guard();
      const owner = await repos.meta.get('owner.uid');
      if (owner && owner !== user.uid) throw new ApiRequestError(403, 'FORBIDDEN', 'La base pertenece a otra cuenta.');
      await repos.meta.set('owner.uid', user.uid);
      await repos.outbox.recover(user.uid);
    },
    refresh: () => track(sync.run()),
    requestLoan(book: Book) {
      const run = requests.catch(() => {}).then(async () => {
        guard();
        if (user.role !== 'student') throw new ApiRequestError(403, 'FORBIDDEN', 'Solo estudiantes solicitan préstamos.');
        if (await repos.loans.hasActiveForBook(user.uid, book.id)) throw new ApiRequestError(409, 'ALREADY_ACTIVE', 'Ya tienes una solicitud o préstamo activo de este libro.');
        if (book.availableCopies <= 0) throw new ApiRequestError(409, 'NO_COPIES', 'No hay ejemplares en la copia local. Actualiza el catálogo.');
        const previous = await repos.meta.get(`intent.${book.id}`);
        const latest = await repos.loans.latestForBook(user.uid, book.id);
        const id = previous && latest?.clientRequestId !== previous ? previous : newId();
        const time = now().toISOString();
        const loan: Loan = { id: `local-${id}`, bookId: book.id, bookTitle: book.title, userId: user.uid,
          userEmail: user.email, userName: user.name, status: 'requested', clientRequestId: id,
          requestedAt: time, resolvedAt: null, dueDate: null, returnedAt: null, updatedAt: time };
        guard(); await repos.outbox.enqueue(loan);
        await repos.activity.log('loan.queued', 'Solicitud guardada en SQLite, sin confirmación del servidor');
        return { ...loan, syncState: 'pending' as const, syncError: null, operationState: 'queued' as const };
      });
      requests = run; return track(run);
    },
    transition: (id: string, action: Parameters<typeof online.transition>[1]) => track(online.transition(id, action)),
    async dismiss(id: string) {
      guard();
      const loan = (await repos.loans.list(user.uid)).find(l => l.id === id);
      if (loan?.syncState === 'conflict') { await repos.outbox.acknowledge(user.uid, loan.clientRequestId); await repos.loans.dismiss(id); }
    },
    async retryAttention() { guard(); await repos.outbox.retryAttention(user.uid); },
    setCover(upload: () => Promise<Book>) { return track((async () => {
      guard(); if (user.role !== 'librarian') throw new ApiRequestError(403, 'FORBIDDEN', 'Solo bibliotecario cambia portadas.');
      const book = await upload(); guard(); await repos.books.upsertMany([book]);
    })()); },
    async close() { active = false; online.dispose(); await Promise.allSettled([...tasks]); await repos.clearPrivate(); },
    resume() { active = true; online.resume(); },
    dispose() { active = false; online.dispose(); },
  };
}
