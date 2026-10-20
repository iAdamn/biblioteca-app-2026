# Procedencia y alcance D03

Adaptación académica de https://github.com/justojaramillo/library-app,
revisión 3f241472e64475fbe58bef3ec9e9546fdf22d5d2, conservada en solo lectura.
Se mantienen package.json y package-lock.json originales, Expo 57, React Native
0.86.3 y React 19.2.3, sin actualización general. LICENSE conserva el aviso MIT
de Expo tal como aparece en la referencia; no atribuye todo el material docente
a Expo. Guía 2 y autor docente: Justo Jaramillo, material académico de biblioteca.

Reutilizados y adaptados: componentes visuales, tema, rutas de acceso y pestañas,
tipos, cliente HTTP, SessionManager, hooks locales, migraciones y repositorios SQL,
pruebas unitarias pertinentes y adaptador node:sqlite. Los avisos existentes se
conservan. API propia, identidades y configuración de esta entrega sustituyen los
destinos docentes. No hay credenciales de desarrollo en el bundle.

Cambios D03: descarga completa online con lectura SQLite; solicitudes online con
UUID conservado ante resultado incierto; sesión protegida frente a renovación
tardía; base y árbol de datos por identidad/rol; validación de contratos; errores
de lectura local y HTTP no JSON explícitos. Migraciones con versión atómica.

Solo se incorporan los módulos pertinentes a D03. Las tablas outbox y activity_log
son estructura para D04. No se incorpora el motor de sincronización offline,
reconexión automática, conflictos, cámara ni galería. Las dependencias de imagen
permanecen en el lockfile original, pero no están activadas en plugins ni pantallas.
No existe publicación de la app en Vercel ni requisitos de APK/tiendas en esta fase.
