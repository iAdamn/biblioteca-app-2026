# Biblioteca móvil

Base funcional D04, 21/10/2026. React Native/Expo, Expo Router, SecureStore y
SQLite. Consume exclusivamente [la API propia](https://biblioteca-api-2026.vercel.app)
del [proyecto API/web](https://github.com/iAdamn/biblioteca-api-2026).

## Ejecutar

Node24.15/npm11.12.1 comprobados en Windows. Base y versiones conservadas de la referencia: Expo57.0.28, ReactNative0.86.3, React19.2.3. Usar Expo Go compatible
con SDK57 en Android/iPhone y la misma red Wi-Fi del PC.

```powershell
npm ci
Copy-Item .env.example .env
npx expo start --lan
```

Escanear el QR en Expo Go. Si la red local bloquea el acceso, comprobar Wi-Fi y el
permiso de red privada de Windows; no cambiar la URL de la API a localhost.
La única variable pública es:

```dotenv
EXPO_PUBLIC_API_URL=https://biblioteca-api-2026.vercel.app
```

Las cuentas se escriben en el formulario. El registro público crea estudiantes.
Los accesos de revisión se distribuyen de forma privada. No se necesitan claves
Firebase en esta app ni una cuenta Vercel para usarla. iOS no se ejecuta en un
simulador de Windows; puede usarse un iPhone compatible. No se requiere EAS para
probar esta base con Expo Go.

## Funciones D03 y D04

Registro/login/logout, restauración y renovación coordinada de sesión; catálogo
local con búsqueda sin tildes y filtro, detalle/portada, préstamos personales y
gestión online del bibliotecario. Solicitar no descuenta, aprobar sí, devolver
repone: la API verifica las reglas. Cada solicitud se guarda primero en SQLite como pendiente, con UUID y propietario.
El sincronizador conserva clientRequestId al reintentar: una respuesta perdida
no crea una nueva intención. La interfaz distingue pendiente, enviando sin
confirmación, confirmada por API, conflicto, rechazo y atención requerida.

`src/app` contiene rutas; `services/api` el cliente/validadores;
`services/auth` la sesión; `services/library/library-service.ts` coordina solicitudes;
`services/sync/sync-service.ts` procesa la cola; `db/outbox.ts` persiste resultados;
`providers/data-provider.tsx` coordina red, primer plano, acciones y lectura local.
Las cinco tablas son books, loans, outbox, sync_meta y activity_log. Migración3
conserva datos previos y detiene filas antiguas sin propietario antes de emitirlas.

Hay un envío simultáneo como máximo, FIFO por usuario, backoff para429/5xx y
máximo cinco fallos temporales antes de exigir reintento manual en Perfil. Un
fallo de transporte conserva la intención con espera30s; no se cuenta como rechazo.
404/409 quedan como conflicto explicable; otros4xx permanentes, como rechazo.
La descarga incremental solapa1s del serverTime para no saltar actualizaciones.
Disparadores: login, solicitud, reconexión, primer plano, manual y comprobación
periódica30s mientras la app está activa. Wi-Fi no demuestra disponibilidad API.

Cada uid/rol tiene archivo SQLite y árbol de datos independientes. Logout
voluntario avisa de pendientes y purga préstamos, cola, metadatos y trazas privadas;
puede conservar catálogo. Expiración forzada conserva la cola en la base exclusiva
del propietario para recuperar tras autenticar la misma identidad; otra cuenta
no puede reclamarla ni enviarla. Tokens solo SecureStore, nunca contraseñas SQLite.

Bibliotecario con conexión: cámara/galería, vista previa y subida explícita por
PUT /api/books/:id/cover existente. JPEG hasta600px de ancho y700000 caracteres
base64; calidad adaptativa y limpieza de temporales generados. No hay cola de
imágenes. Se pide permiso de cámara al pulsar; el selector de galería del sistema
no exige permiso general sobre todas las fotos. Cancelar no sube nada.

## Verificación

```powershell
npm run typecheck
npm run lint
npm test -- --runInBand
npx expo export --platform all
npx expo install --check
```

Exporta Android/iOS; el resultado Hermes en dist no es un APK ni una publicación
en tienda. La app está destinada a ejecución nativa. SecureStore no tiene una
alternativa insegura para navegador.

Las pruebas locales usan SQLite real de Node y un adaptador SecureStore en memoria;
no certifican KeyStore físico. `integracion-real.test.ts` se omite por defecto:
requiere E2E_D03=1 y las variables E2E_API_URL, E2E_STUDENT_EMAIL/PASSWORD,
E2E_LIBRARIAN_EMAIL/PASSWORD, E2E_REGISTER_EMAIL/PASSWORD y opcional E2E_EVIDENCE.
El destino está restringido a la API propia. Su recorrido deja el préstamo propio
devuelto y no borra ni reinicia libros. No ejecutar resets de la referencia.
`e2e-d04.test.ts` también se omite por defecto. Solo se ejecuta con E2E_D04=1,
credenciales propias, IDs de fixtures aisladas y variables documentadas al inicio
del archivo. El runner de integración del paquete académico, fuera del repositorio,
prepara dos libros temporales y limpia únicamente sus fixtures tras comprobarlos.
No lanzar este test sobre libros conservados ni introducir credenciales en código.
Consulta [los pasos manuales](PRUEBAS_MANUALES.md) para el teléfono.

D03: integración propia22 controles/24HTTP pasados; el usuario confirmó en Android
el catálogo10, búsqueda/detalle, restauración al reabrir Expo Go y recorrido online
con ambos roles hasta devolución. Verificación manual comunicada por el usuario,
sin capturas del dispositivo. iOS aún no ejecutado; exportar no equivale a probarlo.

D04:98 pruebas locales pasadas y2 integraciones opt-in omitidas en la suite normal.
La integración D04 se ejecutó aparte:25 controles/25HTTP con SQLite Node y API propia
reales; red perdida simulada en transporte, no modo avión. Tipos/lint/export correctos.
El usuario decidió no realizar pruebas físicas D04. Cámara, galería, permisos y
reconexión del dispositivo siguen pendientes; los adaptadores simulados no los validan.
Android D03 conserva su evidencia histórica; iOS solo exportado.

Solo se declaró directamente expo-file-system~57.0.7, ya presente transitivamente,
para eliminar temporales propios. No cambiaron versiones resueltas previas.
La instalación congelada y exportación funcionan. Expo recomienda cinco parches:
@expo/ui57.0.25, expo57.0.30, expo-constants57.0.22, expo-linking57.0.13 y
expo-router57.0.28. `expo install --check` devuelve1 por esas recomendaciones;
no se han aplicado automáticamente ni ocultado como comprobación correcta.

## Procedencia

Adaptación de [library-app de Justo Jasmany Jaramillo Olarte](https://github.com/justojaramillo/library-app),
SHA3f241472e64475fbe58bef3ec9e9546fdf22d5d2. Ver [PROCEDENCIA.md](PROCEDENCIA.md)
y LICENSE. Referencia conservada sin cambios. Documentación consultada:
[SQLite SDK57](https://docs.expo.dev/versions/v57.0.0/sdk/sqlite/),
[rutas protegidas](https://docs.expo.dev/router/advanced/protected/).

No publicar .env, bases privadas, claves, tokens, credenciales ni contexto académico
privado. Las variables EXPO_PUBLIC_* se incorporan al bundle y nunca son secretas.

## Dependencias y límites de seguridad

El análisis npm omit-dev del21/10 informa56 avisos propagados (45high/11moderate,
0critical), originados en cinco paquetes: braces, decode-uri-component, node-forge,
sprintf-js y uuid. Incluye herramientas CLI transitivas; el recuento no equivale a
56 fallos explotables de la app. El alcance ejecutable de cada aviso aún requiere
triage. Varias sugerencias cambian versiones mayores o son incompatibles con SDK57;
no se ejecutó audit fix --force. Se conserva lockfile y se deja revisión acotada
pendiente para entrega. No se certifica ausencia universal de vulnerabilidades.

Documentación SDK57 consultada para [selector de imágenes](https://docs.expo.dev/versions/v57.0.0/sdk/imagepicker/),
[manipulación](https://docs.expo.dev/versions/v57.0.0/sdk/imagemanipulator/) y
[archivos temporales](https://docs.expo.dev/versions/v57.0.0/sdk/filesystem/).
