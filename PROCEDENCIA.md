# Procedencia y alcance D03 y D04

Adaptación académica de https://github.com/justojaramillo/library-app,
revisión 3f241472e64475fbe58bef3ec9e9546fdf22d5d2, conservada en solo lectura.
D03 conservó los manifiestos originales. Se mantienen Expo57, React Native
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

Estado histórico al cierre D03: solo se incorporaron los módulos pertinentes a ese bloque. Las tablas outbox y activity_log
son estructura para D04. No se incorpora el motor de sincronización offline,
reconexión automática, conflictos, cámara ni galería. Las dependencias de imagen
permanecen en el lockfile original, pero no están activadas en plugins ni pantallas.
No existe publicación de la app en Vercel ni requisitos de APK/tiendas en esta fase.

## Adaptación D04 del21 de octubre

Se reutilizaron los conceptos y contratos del sincronizador, outbox, tarjetas,
perfil y selección de portada docentes. Se añadieron migración3, estados/resultados
persistidos, propietario explícito, serialización SQL, guarda de identidad,
recuperación de in_flight, backoff, límites/manual y pruebas de respuesta perdida.
La interfaz distingue confirmación local y servidor, conserva conflictos y trazas
sin cargas de imagen ni tokens. Se utiliza la API propia existente sin cambiarla.

Desviación necesaria: logout voluntario purga privados con aviso; invalidación
forzada de sesión conserva pendientes solo en el archivo del mismo uid/rol,
impidiendo enviarlos como otro usuario. Evita perder intenciones por401.
Migración de filas sin propietario: atención, jamás asignación automática.

Cambio mínimo de manifiesto/lock: dependencia directa expo-file-system~57.0.7
para limpieza de temporales generados; ya estaba resuelta en la referencia.
No se actualizaron otros paquetes ni los cinco parches recomendados. Plugins de
imagen habilitados sin micrófono. Cámara y permisos aún no probados físicamente.
No se redistribuyen fuentes privadas, credenciales, informes ni Word en este repo.
