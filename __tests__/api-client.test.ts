import {
  ApiRequestError,
  createApiClient,
  describeError,
  NetworkError,
} from '@/services/api/client';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('createApiClient', () => {
  it('conserva Retry-After del servidor para controlar reintentos', async () => {
    const response = json(429, { error: { code: 'RATE_LIMITED', message: 'Espera' } });
    response.headers.set('Retry-After', '60');
    const client = createApiClient({ baseUrl: 'http://api', timeoutMs: 1000,
      fetchImpl: jest.fn().mockResolvedValue(response) });
    await expect(client.get('/api/books')).rejects.toMatchObject({ status: 429, retryAfterMs: 60000 });
  });
  it('no reenvía una operación 401 de A autenticada como B tras cambiar cuenta', async () => {
    let key = 'cuenta-A';
    const fetchImpl = jest.fn().mockResolvedValue(json(401, { error: { code: 'UNAUTHENTICATED' } }));
    const client = createApiClient({ baseUrl: 'https://own-api', timeoutMs: 1000, fetchImpl,
      auth: { getSessionKey: () => key, getAccessToken: async () => 'token',
        refreshSession: async () => { key = 'cuenta-B'; return true; } } });
    await expect(client.post('/api/loans', { bookId: 'b1' })).rejects.toMatchObject({ status: 401 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  it('un 200 HTML no se confunde con datos válidos', async () => {
    const client = createApiClient({ baseUrl: 'http://api', timeoutMs: 1000,
      fetchImpl: jest.fn().mockResolvedValue(new Response('<html>Error</html>', { status: 200 })) });
    await expect(client.get('/api/books')).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });
  it('envía el Bearer token y parsea la respuesta JSON', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(json(200, { ok: true }));
    const client = createApiClient({
      baseUrl: 'http://api',
      timeoutMs: 1000,
      fetchImpl,
      auth: { getAccessToken: async () => 'tok', refreshSession: async () => false },
    });

    await expect(client.get('/api/books')).resolves.toEqual({ ok: true });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('http://api/api/books');
    expect(init.headers.Authorization).toBe('Bearer tok');
  });

  it('no envía Authorization en endpoints públicos (auth: false)', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(json(200, {}));
    const getAccessToken = jest.fn(async () => 'tok');
    const client = createApiClient({
      baseUrl: 'http://api',
      timeoutMs: 1000,
      fetchImpl,
      auth: { getAccessToken, refreshSession: async () => false },
    });
    await client.post('/api/auth/login', { a: 1 }, { auth: false });
    expect(fetchImpl.mock.calls[0][1].headers.Authorization).toBeUndefined();
    expect(getAccessToken).not.toHaveBeenCalled();
  });

  it('convierte errores del servidor en ApiRequestError con status y code', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValue(json(409, { error: { code: 'NO_COPIES', message: 'Sin ejemplares' } }));
    const client = createApiClient({ baseUrl: 'http://api', timeoutMs: 1000, fetchImpl });

    await expect(client.post('/api/loans', {})).rejects.toMatchObject({
      status: 409,
      code: 'NO_COPIES',
      message: 'Sin ejemplares',
    });
  });

  it('tolera respuestas de error sin JSON (ej. 502 de un proxy)', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValue(new Response('<html>Bad gateway</html>', { status: 502 }));
    const client = createApiClient({ baseUrl: 'http://api', timeoutMs: 1000, fetchImpl });
    await expect(client.get('/x')).rejects.toBeInstanceOf(ApiRequestError);
  });

  it('distingue "sin red" (NetworkError) de un error del servidor', async () => {
    const fetchImpl = jest.fn().mockRejectedValue(new TypeError('Network request failed'));
    const client = createApiClient({ baseUrl: 'http://api', timeoutMs: 1000, fetchImpl });
    await expect(client.get('/x')).rejects.toBeInstanceOf(NetworkError);
  });

  it('cancela la petición al superar el timeout', async () => {
    const fetchImpl = jest.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal!.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    );
    const client = createApiClient({
      baseUrl: 'http://api',
      timeoutMs: 20,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await expect(client.get('/x')).rejects.toBeInstanceOf(NetworkError);
  });

  it('ante 401 renueva la sesión y reintenta UNA vez con el token nuevo', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(json(401, { error: { code: 'UNAUTHENTICATED', message: 'expirado' } }))
      .mockResolvedValueOnce(json(200, { ok: true }));
    let token = 'viejo';
    const client = createApiClient({
      baseUrl: 'http://api',
      timeoutMs: 1000,
      fetchImpl,
      auth: {
        getAccessToken: async () => token,
        refreshSession: async () => {
          token = 'nuevo';
          return true;
        },
      },
    });

    await expect(client.get('/api/loans')).resolves.toEqual({ ok: true });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[1][1].headers.Authorization).toBe('Bearer nuevo');
  });

  it('si la renovación falla, devuelve el 401 sin reintentar en bucle', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValue(json(401, { error: { code: 'UNAUTHENTICATED', message: 'x' } }));
    const client = createApiClient({
      baseUrl: 'http://api',
      timeoutMs: 1000,
      fetchImpl,
      auth: { getAccessToken: async () => 't', refreshSession: async () => false },
    });
    await expect(client.get('/x')).rejects.toMatchObject({ status: 401 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe('describeError', () => {
  it('da mensajes legibles', () => {
    expect(describeError(new NetworkError())).toMatch(/conexión/i);
    expect(describeError(new ApiRequestError(400, 'VALIDATION_ERROR', 'Correo inválido'))).toBe(
      'Correo inválido',
    );
    expect(describeError(new Error('boom'))).toMatch(/inesperado/i);
  });
});
