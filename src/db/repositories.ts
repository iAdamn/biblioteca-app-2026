/**
 * Repositorios: toda la SQL de la app vive aquí. Las pantallas y servicios nunca arman consultas.
 * Reglas: consultas SIEMPRE parametrizadas (?), nunca concatenar datos del usuario en el SQL.
 */
import type { SQLiteDatabase } from 'expo-sqlite';

import { escapeLike, normalizeSearch } from '@/lib/text';
import type { Book, LocalLoan, Loan, LoanStatus, SyncState } from '@/types';
import { createOutboxRepo, createActivityRepo } from './outbox';

// ───────────────────────────── Libros ─────────────────────────────

interface BookRow {
  id: string;
  title: string;
  author: string;
  category: string;
  year: number;
  description: string;
  total_copies: number;
  available_copies: number;
  cover_url: string | null;
  updated_at: string;
}

const toBook = (r: BookRow): Book => ({
  id: r.id,
  title: r.title,
  author: r.author,
  category: r.category,
  year: r.year,
  description: r.description,
  totalCopies: r.total_copies,
  availableCopies: r.available_copies,
  coverUrl: r.cover_url,
  updatedAt: r.updated_at,
});

export interface BookFilters {
  q?: string;
  category?: string | null;
}

export function createBooksRepo(db: SQLiteDatabase) {
  return {
    /** Inserta o actualiza (upsert) en una sola transacción: o entran todos o ninguno. */
    async upsertMany(books: Book[]): Promise<void> {
      if (books.length === 0) return;
      await db.withTransactionAsync(async () => {
        for (const b of books) {
          await db.runAsync(
            `INSERT INTO books (id, title, author, category, year, description, total_copies,
                                available_copies, cover_url, updated_at, search_text)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET
               title = excluded.title, author = excluded.author, category = excluded.category,
               year = excluded.year, description = excluded.description,
               total_copies = excluded.total_copies, available_copies = excluded.available_copies,
               cover_url = excluded.cover_url, updated_at = excluded.updated_at,
               search_text = excluded.search_text`,
            b.id,
            b.title,
            b.author,
            b.category,
            b.year,
            b.description,
            b.totalCopies,
            b.availableCopies,
            b.coverUrl,
            b.updatedAt,
            normalizeSearch(`${b.title} ${b.author}`),
          );
        }
      });
    },

    async list({ q, category }: BookFilters = {}): Promise<Book[]> {
      const term = q ? normalizeSearch(q) : '';
      const rows = await db.getAllAsync<BookRow>(
        `SELECT * FROM books
          WHERE (? = '' OR search_text LIKE ? ESCAPE '\\')
            AND (? IS NULL OR category = ?)
          ORDER BY title COLLATE NOCASE`,
        term,
        `%${escapeLike(term)}%`,
        category ?? null,
        category ?? null,
      );
      return rows.map(toBook);
    },

    async getById(id: string): Promise<Book | null> {
      const row = await db.getFirstAsync<BookRow>('SELECT * FROM books WHERE id = ?', id);
      return row ? toBook(row) : null;
    },

    async categories(): Promise<string[]> {
      const rows = await db.getAllAsync<{ category: string }>(
        'SELECT DISTINCT category FROM books ORDER BY category COLLATE NOCASE',
      );
      return rows.map((r) => r.category);
    },

    async clear(): Promise<void> {
      await db.runAsync('DELETE FROM books');
    },
  };
}

// ───────────────────────────── Préstamos ─────────────────────────────

interface LoanRow {
  id: string;
  book_id: string;
  book_title: string;
  user_id: string;
  user_email: string;
  user_name: string;
  status: LoanStatus;
  client_request_id: string;
  requested_at: string;
  resolved_at: string | null;
  due_date: string | null;
  returned_at: string | null;
  updated_at: string;
  sync_state: SyncState;
  sync_error: string | null;
  operation_state?: LocalLoan['operationState'];
}

const toLoan = (r: LoanRow): LocalLoan => ({
  id: r.id,
  bookId: r.book_id,
  bookTitle: r.book_title,
  userId: r.user_id,
  userEmail: r.user_email,
  userName: r.user_name,
  status: r.status,
  clientRequestId: r.client_request_id,
  requestedAt: r.requested_at,
  resolvedAt: r.resolved_at,
  dueDate: r.due_date,
  returnedAt: r.returned_at,
  updatedAt: r.updated_at,
  syncState: r.sync_state,
  syncError: r.sync_error,
  operationState: r.operation_state,
});

export function createLoansRepo(db: SQLiteDatabase) {
  async function insert(loan: Loan, syncState: SyncState, syncError: string | null) {
    await db.runAsync(
      `INSERT OR REPLACE INTO loans (id, book_id, book_title, user_id, user_email, user_name, status,
         client_request_id, requested_at, resolved_at, due_date, returned_at, updated_at, sync_state, sync_error)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      loan.id,
      loan.bookId,
      loan.bookTitle,
      loan.userId,
      loan.userEmail,
      loan.userName,
      loan.status,
      loan.clientRequestId,
      loan.requestedAt,
      loan.resolvedAt,
      loan.dueDate,
      loan.returnedAt,
      loan.updatedAt,
      syncState,
      syncError,
    );
  }

  return {
    /** Uso interno de repositorios para confirmar préstamo y outbox en la misma transacción. */
    writeInTransaction: insert,
    /** Préstamos del estudiante, o todos si userId es null (bibliotecario). */
    async list(userId: string | null): Promise<LocalLoan[]> {
      const rows = userId
        ? await db.getAllAsync<LoanRow>(
            'SELECT l.*, q.state AS operation_state FROM loans l LEFT JOIN outbox q ON q.client_request_id=l.client_request_id AND q.owner_uid=l.user_id WHERE user_id = ? ORDER BY requested_at DESC',
            userId,
          )
        : await db.getAllAsync<LoanRow>('SELECT l.*, q.state AS operation_state FROM loans l LEFT JOIN outbox q ON q.client_request_id=l.client_request_id AND q.owner_uid=l.user_id ORDER BY requested_at DESC');
      return rows.map(toLoan);
    },

    /**
     * Guarda la versión del servidor. Si existía una copia local creada offline con el mismo
     * clientRequestId (id "local-..."), se reemplaza: así nunca queda duplicada.
     */
    async upsertFromServer(loan: Loan): Promise<void> {
      await db.withTransactionAsync(async () => {
        await db.runAsync(
          'DELETE FROM loans WHERE client_request_id = ? AND id <> ?',
          loan.clientRequestId,
          loan.id,
        );
        await insert(loan, 'synced', null);
      });
    },

    async upsertManyFromServer(loans: Loan[]): Promise<void> {
      if (loans.length === 0) return;
      await db.withTransactionAsync(async () => {
        for (const loan of loans) {
          await db.runAsync(
            'DELETE FROM loans WHERE client_request_id = ? AND id <> ?',
            loan.clientRequestId,
            loan.id,
          );
          await insert(loan, 'synced', null);
        }
      });
    },

    /** Descarga completa online; publicación atómica del snapshot privado. */
    async replaceFromServer(loans: Loan[]): Promise<void> {
      await db.withTransactionAsync(async () => {
        await db.runAsync('DELETE FROM loans');
        for (const loan of loans) await insert(loan, 'synced', null);
      });
    },

    /** ¿Tiene el usuario una solicitud/préstamo vigente (incluida una aún sin enviar) de este libro? */
    async hasActiveForBook(userId: string, bookId: string): Promise<boolean> {
      const row = await db.getFirstAsync<{ n: number }>(
        `SELECT COUNT(*) AS n FROM loans
          WHERE user_id = ? AND book_id = ? AND status IN ('requested','approved') AND (sync_state <> 'conflict' OR client_request_id IN (SELECT client_request_id FROM outbox WHERE owner_uid=? AND state='attention'))`,
        userId,
        bookId,
        userId,
      );
      return (row?.n ?? 0) > 0;
    },

    async latestForBook(userId: string, bookId: string): Promise<LocalLoan | null> {
      const row = await db.getFirstAsync<LoanRow>(
        'SELECT l.*,q.state AS operation_state FROM loans l LEFT JOIN outbox q ON q.owner_uid=l.user_id AND q.client_request_id=l.client_request_id WHERE user_id = ? AND book_id = ? ORDER BY requested_at DESC LIMIT 1',
        userId,
        bookId,
      );
      return row ? toLoan(row) : null;
    },

    async clear(): Promise<void> {
      await db.runAsync('DELETE FROM loans');
    },
    async dismiss(id: string): Promise<void> {
      await db.runAsync("DELETE FROM loans WHERE id = ? AND sync_state = 'conflict'", id);
    },
  };
}

export function createMetaRepo(db: SQLiteDatabase) {
  return {
    async get(key: string): Promise<string | null> {
      const row = await db.getFirstAsync<{ value: string }>(
        'SELECT value FROM sync_meta WHERE key = ?',
        key,
      );
      return row?.value ?? null;
    },
    async set(key: string, value: string): Promise<void> {
      await db.runAsync(
        'INSERT INTO sync_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
        key,
        value,
      );
    },
    async clear(): Promise<void> {
      await db.runAsync('DELETE FROM sync_meta');
    },
    async remove(key: string): Promise<void> {
      await db.runAsync('DELETE FROM sync_meta WHERE key = ?', key);
    },
  };
}

export function createRepositories(db: SQLiteDatabase) {
  const loans = createLoansRepo(db);
  // Solo SQL dentro de esta exclusión. Una petición de red nunca bloquea guardar offline.
  let tail: Promise<unknown> = Promise.resolve();
  function serialized<T extends object>(repo: T): T {
    return Object.fromEntries(Object.entries(repo).map(([key, fn]) => [key, (...args: unknown[]) => {
      const next = tail.catch(() => {}).then(() => fn(...args));
      tail = next;
      return next;
    }])) as T;
  }
  return {
    books: serialized(createBooksRepo(db)),
    loans: serialized(loans),
    outbox: serialized(createOutboxRepo(db, loans.writeInTransaction)),
    activity: serialized(createActivityRepo(db)),
    meta: serialized(createMetaRepo(db)),
    clearPrivate: () => serialized({ async clear() {
      await db.withTransactionAsync(async () => {
        await db.execAsync('DELETE FROM loans; DELETE FROM outbox; DELETE FROM sync_meta; DELETE FROM activity_log;');
      });
    } }).clear(),
  };
}
export type Repositories = ReturnType<typeof createRepositories>;
