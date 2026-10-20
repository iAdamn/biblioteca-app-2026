import { DATABASE_VERSION, migrateDbIfNeeded } from '@/db/migrations';
import { createRepositories, type Repositories } from '@/db/repositories';

import { createTestDb } from '../test-utils/node-sqlite';
import { makeBook, makeLoan } from '../test-utils/fakes';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { unlinkSync, existsSync } from 'node:fs';

async function freshDb() {
  const db = createTestDb();
  await migrateDbIfNeeded(db);
  return { db, repos: createRepositories(db) };
}

describe('migraciones', () => {
  it('persiste en archivo real tras cerrar y reabrir la conexión SQLite', async () => {
    const filename = join(tmpdir(), `biblioteca-d03-${randomUUID()}.db`);
    let db = createTestDb(filename);
    try {
      await migrateDbIfNeeded(db);
      await createRepositories(db).books.upsertMany([makeBook({ title: 'Persistencia real' })]);
      await db.closeAsync();
      db = createTestDb(filename);
      await migrateDbIfNeeded(db);
      expect((await createRepositories(db).books.list())[0].title).toBe('Persistencia real');
    } finally {
      await db.closeAsync();
      for (const suffix of ['', '-wal', '-shm']) if (existsSync(filename + suffix)) unlinkSync(filename + suffix);
    }
  });
  it('crea el esquema y fija user_version', async () => {
    const { db } = await freshDb();
    const v = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
    expect(v?.user_version).toBe(DATABASE_VERSION);
    const tables = await db.getAllAsync<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type = 'table'`,
    );
    expect(tables.map((t) => t.name)).toEqual(
      expect.arrayContaining(['books', 'loans', 'outbox', 'sync_meta', 'activity_log']),
    );
  });

  it('es idempotente: ejecutarla otra vez no falla ni pierde datos', async () => {
    const { db, repos } = await freshDb();
    await repos.books.upsertMany([makeBook()]);
    await migrateDbIfNeeded(db);
    expect(await repos.books.list()).toHaveLength(1);
  });

  it('aplica solo la migración que falta (v1 → v2)', async () => {
    const db = createTestDb();
    // Simula un teléfono que ya tenía la app en la versión 1: esquema v1 sin índices ni activity_log.
    await db.execAsync(`
      CREATE TABLE books (id TEXT PRIMARY KEY NOT NULL, title TEXT NOT NULL,
        author TEXT NOT NULL, category TEXT NOT NULL, year INTEGER NOT NULL,
        description TEXT NOT NULL, total_copies INTEGER NOT NULL,
        available_copies INTEGER NOT NULL, cover_url TEXT, updated_at TEXT NOT NULL,
        search_text TEXT NOT NULL);
      CREATE TABLE loans (id TEXT PRIMARY KEY NOT NULL, book_id TEXT NOT NULL,
        book_title TEXT NOT NULL, user_id TEXT NOT NULL, user_email TEXT NOT NULL,
        user_name TEXT NOT NULL, status TEXT NOT NULL,
        client_request_id TEXT NOT NULL UNIQUE, requested_at TEXT NOT NULL,
        resolved_at TEXT, due_date TEXT, returned_at TEXT, updated_at TEXT NOT NULL,
        sync_state TEXT NOT NULL DEFAULT 'synced', sync_error TEXT);
      CREATE TABLE outbox (id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL,
        payload TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT,
        created_at TEXT NOT NULL);
      CREATE TABLE sync_meta (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);
      INSERT INTO books VALUES ('b1', 'Rayuela', 'Julio Cortázar', 'Novela', 1963, 'd',
        1, 1, NULL, '2026-01-01T00:00:00.000Z', 'rayuela julio cortazar');
      PRAGMA user_version = 1;
    `);

    await migrateDbIfNeeded(db);

    const v = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
    expect(v?.user_version).toBe(DATABASE_VERSION);
    expect(await db.getAllAsync('SELECT * FROM books')).toHaveLength(1); // los datos existentes sobreviven
    expect(await db.getFirstAsync("SELECT name FROM sqlite_master WHERE name = 'activity_log'")).toBeTruthy();
  });
});

describe('libros', () => {
  let repos: Repositories;
  beforeEach(async () => {
    ({ repos } = await freshDb());
    await repos.books.upsertMany([
      makeBook({
        id: 'cholera',
        title: 'El amor en los tiempos del cólera',
        author: 'Gabriel García Márquez',
        category: 'Novela',
      }),
      makeBook({ id: 'rayuela', title: 'Rayuela', author: 'Julio Cortázar', category: 'Novela' }),
      makeBook({
        id: 'clean',
        title: 'Clean Code',
        author: 'Robert C. Martin',
        category: 'Tecnología',
      }),
    ]);
  });

  it('lista ordenada por título', async () => {
    expect((await repos.books.list()).map((b) => b.id)).toEqual(['clean', 'cholera', 'rayuela']);
  });

  it('busca sin importar tildes ni mayúsculas, en título y autor', async () => {
    expect((await repos.books.list({ q: 'COLERA' })).map((b) => b.id)).toEqual(['cholera']);
    expect((await repos.books.list({ q: 'cortazar' })).map((b) => b.id)).toEqual(['rayuela']);
    expect((await repos.books.list({ q: 'garcia marquez' })).map((b) => b.id)).toEqual(['cholera']);
  });

  it('los comodines del usuario se tratan como texto (no como LIKE)', async () => {
    expect(await repos.books.list({ q: '%' })).toHaveLength(0);
    expect(await repos.books.list({ q: '_' })).toHaveLength(0);
  });

  it('una consulta con comilla no rompe el SQL (parametrizada)', async () => {
    expect(await repos.books.list({ q: "'; DROP TABLE books; --" })).toHaveLength(0);
    expect(await repos.books.list()).toHaveLength(3);
  });

  it('filtra por categoría y combina con la búsqueda', async () => {
    expect(await repos.books.list({ category: 'Novela' })).toHaveLength(2);
    expect(await repos.books.list({ category: 'Novela', q: 'rayuela' })).toHaveLength(1);
    expect(await repos.books.list({ category: 'Tecnología', q: 'rayuela' })).toHaveLength(0);
  });

  it('upsert actualiza un libro existente sin duplicarlo', async () => {
    await repos.books.upsertMany([
      makeBook({
        id: 'rayuela',
        title: 'Rayuela',
        availableCopies: 0,
        coverUrl: '/api/books/rayuela/cover?v=1',
      }),
    ]);
    const all = await repos.books.list();
    expect(all).toHaveLength(3);
    const rayuela = await repos.books.getById('rayuela');
    expect(rayuela).toMatchObject({ availableCopies: 0, coverUrl: '/api/books/rayuela/cover?v=1' });
  });

  it('categorías sin repetir', async () => {
    expect(await repos.books.categories()).toEqual(['Novela', 'Tecnología']);
  });

  it('getById de un libro inexistente → null', async () => {
    expect(await repos.books.getById('nada')).toBeNull();
  });
});

describe('préstamos y cola', () => {
  let repos: Repositories;
  beforeEach(async () => {
    ({ repos } = await freshDb());
  });

  it('list(null) devuelve todos (bibliotecario); list(uid) solo los del usuario; más recientes primero', async () => {
    await repos.loans.upsertManyFromServer([
      makeLoan({
        id: 'a',
        clientRequestId: 'req-aaaaaaaa',
        userId: 'u1',
        requestedAt: '2026-10-01T00:00:00.000Z',
      }),
      makeLoan({
        id: 'b',
        clientRequestId: 'req-bbbbbbbb',
        userId: 'u2',
        requestedAt: '2026-10-03T00:00:00.000Z',
      }),
      makeLoan({
        id: 'c',
        clientRequestId: 'req-cccccccc',
        userId: 'u1',
        requestedAt: '2026-10-02T00:00:00.000Z',
      }),
    ]);
    expect((await repos.loans.list(null)).map((l) => l.id)).toEqual(['b', 'c', 'a']);
    expect((await repos.loans.list('u1')).map((l) => l.id)).toEqual(['c', 'a']);
  });

  it('la base de datos rechaza estados inválidos (CHECK)', async () => {
    await expect(
      repos.loans.upsertFromServer(makeLoan({ status: 'hackeado' as never })),
    ).rejects.toThrow();
  });

  it('logout elimina datos privados y conserva el catálogo', async () => {
    await repos.books.upsertMany([makeBook()]);
    await repos.loans.upsertFromServer(makeLoan());
    await repos.meta.set('owner.uid', 'u1');
    await repos.clearPrivate();
    expect(await repos.loans.list(null)).toEqual([]);
    expect(await repos.meta.get('owner.uid')).toBeNull();
    expect(await repos.books.list()).toHaveLength(1);
  });
});
