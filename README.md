# Biblioteca móvil

Base funcional D03, 20/10/2026. React Native/Expo, Expo Router, SecureStore y
SQLite. Consume exclusivamente [la API propia](https://biblioteca-api-2026.vercel.app)
del [proyecto API/web](https://github.com/iAdamn/biblioteca-api-2026).

## Ejecutar

Node24.15/npm11.12.1 comprobados en Windows. Manifest y package-lock originales
de la referencia: Expo57.0.28, ReactNative0.86.3, React19.2.3. Usar Expo Go compatible
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

## Funciones D03

Registro/login/logout, restauración y renovación coordinada de sesión; catálogo
local con búsqueda sin tildes y filtro, detalle/portada, préstamos personales y
gestión online del bibliotecario. Solicitar no descuenta, aprobar sí, devolver
repone: la API verifica las reglas. Una intención online con respuesta incierta
conserva clientRequestId para reintento manual; no hay envío automático.

`src/app` contiene las rutas; `services/api` el cliente y validadores de respuesta;
`services/auth` la sesión; `services/library/online-library.ts` descarga y préstamos;
`db` migraciones/repositorios; `providers/data-provider.tsx` coordina la lectura.
La interfaz lista desde SQLite. Las respuestas confirmadas actualizan la base y
su versión reactiva. Cada uid/rol tiene su archivo SQLite y su árbol de datos.
Logout elimina sus préstamos/metadatos; el catálogo puede conservarse. Tokens
solo en SecureStore, separados por llave. No se guardan contraseñas.

Tablas: books, loans, outbox, sync_meta, activity_log. Las dos últimas funciones
offline/dispositivo aún no operan: **cola FIFO, reconexión, conflictos, cámara y
galería pendientes D04**. No se han activado sus plugins. Dependencias de imagen
se conservan únicamente para mantener el manifiesto y lockfile de referencia.

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
Consulta [los pasos manuales](PRUEBAS_MANUALES.md) para el teléfono.

D03: integración propia22 controles/24HTTP pasados; el usuario confirmó en Android
el catálogo10, búsqueda/detalle, restauración al reabrir Expo Go y recorrido online
con ambos roles hasta devolución. Verificación manual comunicada por el usuario,
sin capturas del dispositivo. iOS aún no ejecutado; exportar no equivale a probarlo.

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
