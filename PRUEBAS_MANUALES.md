# Comprobación nativa D03

Usar Android/iPhone con Expo Go compatible con SDK57, mismo Wi-Fi del PC y
`npx expo start --lan`. El QR/puerto son locales y pueden cambiar. No se necesita
iniciar sesión en Firebase/Vercel desde el teléfono. La cuenta de la aplicación
se escribe en el formulario; no se incorpora al .env.

1. Inicio sin sesión: ver formulario. Nombre/correo vacíos y contraseña vacía
   producen errores comprensibles. Registro crea exclusivamente student.
2. Entrar como student: diez libros desde API propia; buscar COLERA encuentra
   Cólera, buscar texto inexistente muestra vacío, limpiar restaura lista.
   Abrir detalle y volver con navegación del sistema.
3. Cerrar Expo Go por completo, reabrir proyecto: mantiene sesión en SecureStore
   y datos SQLite. Actualizar descarga desde API; anotar mensajes de error.
4. Solicitar un libro disponible sin préstamo activo: confirmación del servidor,
   Mis préstamos muestra Solicitado. No reducir stock en esa acción.
5. Perfil → Cerrar sesión: formulario protegido, volver atrás no abre catálogo.
   Entrar como librarian: pestaña Gestión, solicitud visible, Prestar y luego
   Registrar devolución; actualizar y comprobar disponibilidad inicial.
6. Cerrar sesión, volver como student y actualizar: solo sus préstamos y estado
   Devuelto. Otra cuenta student no ve los anteriores. No escribir secretos en
   capturas. El perfil muestra rol/nombre, no necesita correo para la evidencia.

Resultados físicos se registran fuera del repositorio, diferenciando observación
del agente de comunicación del usuario. `npm test` usa almacenamiento seguro
en memoria y SQLite Node: no acredita KeyStore ni navegación física.

Modo avión, cola de solicitudes, reconexión automática, conflictos, cámara y
galería requieren activación D04. Hoy no se certifican. La base incluye sus cinco
tablas, pero outbox/activity_log no tienen flujo operativo.
