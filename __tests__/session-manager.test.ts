import { ApiRequestError, NetworkError } from '@/services/api/client';
import { SessionManager, type SecureStorage } from '@/services/auth/session-manager';
import type { AuthResult } from '@/types';

class MemoryStorage implements SecureStorage {
  data = new Map<string, string>();
  async getItemAsync(k: string) {
    return this.data.get(k) ?? null;
  }
  async setItemAsync(k: string, v: string) {
    this.data.set(k, v);
  }
  async deleteItemAsync(k: string) {
    this.data.delete(k);
  }
}

const result = (idToken: string, expiresIn = 3600): AuthResult => ({
  tokens: { idToken, refreshToken: 'refresh-1', expiresIn },
  user: { uid: 'u1', email: 'a@b.co', name: 'Ana', role: 'student' },
});

describe('SessionManager', () => {
  it('una renovación tardía no resucita la sesión después del logout', async () => {
    let finish!: (value: AuthResult) => void;
    const post = jest.fn(() => new Promise<AuthResult>(resolve => { finish = resolve; }));
    const storage = new MemoryStorage();
    const session = new SessionManager(storage, { post: post as never });
    await session.save(result('viejo'));
    const pending = session.refresh();
    await session.clear();
    finish(result('tardio'));
    expect(await pending).toBe(false);
    expect(session.getUser()).toBeNull();
    expect(storage.data.size).toBe(0);
  });

  it('401 tardío de un token sustituido no dispara otra renovación', async () => {
    const post = jest.fn().mockResolvedValue(result('nuevo'));
    const session = new SessionManager(new MemoryStorage(), { post });
    await session.save(result('viejo'));
    await session.refresh('viejo');
    expect(await session.refresh('viejo')).toBe(true);
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('restauración corrupta limpia las cuatro llaves', async () => {
    const storage = new MemoryStorage();
    storage.data.set('auth.idToken', 't'); storage.data.set('auth.refreshToken', 'r');
    storage.data.set('auth.user', '{no es JSON');
    const session = new SessionManager(storage, { post: jest.fn() });
    expect(await session.restore()).toBeNull();
    expect(storage.data.size).toBe(0);
  });

  it('un 503 de renovación conserva la sesión y no guarda contraseña', async () => {
    const storage = new MemoryStorage();
    const post = jest.fn().mockRejectedValue(new ApiRequestError(503, 'UNKNOWN', 'Temporal'));
    const session = new SessionManager(storage, { post });
    await session.save(result('vigente'));
    expect(await session.refresh()).toBe(false);
    expect(session.getUser()?.uid).toBe('u1');
    expect([...storage.data.keys()].some(k => /password/i.test(k))).toBe(false);
  });
  it('guarda la sesión y la restaura tras reiniciar la app (sin red)', async () => {
    const storage = new MemoryStorage();
    await new SessionManager(storage, { post: jest.fn() }).save(result('tok-1'));

    const restarted = new SessionManager(storage, { post: jest.fn() });
    expect(await restarted.restore()).toMatchObject({ uid: 'u1', role: 'student' });
    expect(await restarted.getAccessToken()).toBe('tok-1');
  });

  it('guarda cada token en su propia llave (límite de tamaño de SecureStore en iOS)', async () => {
    const storage = new MemoryStorage();
    await new SessionManager(storage, { post: jest.fn() }).save(result('tok-1'));
    expect([...storage.data.keys()].sort()).toEqual([
      'auth.expiresAt',
      'auth.idToken',
      'auth.refreshToken',
      'auth.user',
    ]);
  });

  it('clear() borra todo y notifica a los suscriptores', async () => {
    const storage = new MemoryStorage();
    const session = new SessionManager(storage, { post: jest.fn() });
    const listener = jest.fn();
    session.subscribe(listener);
    await session.save(result('tok-1'));
    await session.clear();
    expect(storage.data.size).toBe(0);
    expect(listener).toHaveBeenLastCalledWith(null);
  });

  it('renueva proactivamente un token por vencer', async () => {
    let now = 1_000_000;
    const post = jest.fn().mockResolvedValue(result('tok-2'));
    const session = new SessionManager(new MemoryStorage(), { post }, () => now);
    await session.save(result('tok-1', 3600));

    now += 3600 * 1000 - 30_000; // faltan 30 s: dentro del margen de 60 s
    expect(await session.getAccessToken()).toBe('tok-2');
    expect(post).toHaveBeenCalledWith(
      '/api/auth/refresh',
      { refreshToken: 'refresh-1' },
      { auth: false },
    );
  });

  it('varias renovaciones simultáneas comparten una sola petición', async () => {
    const post = jest.fn().mockResolvedValue(result('tok-2'));
    const session = new SessionManager(new MemoryStorage(), { post });
    await session.save(result('tok-1'));
    await Promise.all([session.refresh(), session.refresh(), session.refresh()]);
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('sin red NO cierra la sesión (la app sigue usable offline)', async () => {
    const post = jest.fn().mockRejectedValue(new NetworkError());
    const session = new SessionManager(new MemoryStorage(), { post });
    await session.save(result('tok-1'));
    expect(await session.refresh()).toBe(false);
    expect(session.getUser()).not.toBeNull();
  });

  it('si el refreshToken es rechazado (401) cierra la sesión', async () => {
    const post = jest.fn().mockRejectedValue(new ApiRequestError(401, 'INVALID_CREDENTIALS', 'x'));
    const session = new SessionManager(new MemoryStorage(), { post });
    await session.save(result('tok-1'));
    expect(await session.refresh()).toBe(false);
    expect(session.getUser()).toBeNull();
  });
});
