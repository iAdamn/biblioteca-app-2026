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

## D04 preparado pero pendiente de prueba física

El21/10 el usuario decidió no participar en comprobaciones físicas. No hay
capturas o pruebas de cámara, permisos, modo avión o reconexión nativa D04.
Estas instrucciones se dejaron preparadas en D04; las pruebas Node/adaptadores no las sustituyen. En D05 (22/10) el usuario comunicó que realizó las pruebas y funcionaron bien; el agente no capturó el dispositivo ni observó escrituras adicionales en el servidor tras D03.

1. Student: sincronizar con red, abrir catálogo y detalle, activar modo avión,
   solicitar un libro disponible sin préstamo activo. Debe aparecer Pendiente de
   envío, sin confirmación servidor. Cerrar/reabrir la app y comprobar misma intención.
2. Recuperar internet: esperar sincronización o pulsar indicador. Debe sustituirse
   pendiente por Solicitado confirmado, contador cero y un solo préstamo servidor.
   Dos pulsaciones no deben generar dos intenciones. Bibliotecario rechaza o completa
   devolución para dejar el inventario conforme a reglas, sin reset.
3. Conflicto: con dos estudiantes y un libro de prueba exclusivo, A guarda offline;
   B solicita online y librarian aprueba último ejemplar. A reconecta: conflicto409
   comprensible en Mis préstamos y registro en Perfil. Descartar reconoce el mensaje;
   no fuerza stock ni elimina evidencia histórica. No usar libros ajenos para fixtures.
4. Pendientes A: logout exige aviso y confirmación. Cancelar conserva; confirmar
   purga sus datos privados. Entrar B no muestra ni envía operaciones A. Caducidad
   forzada conserva base A aislada, recuperable solo tras autenticar mismo uid/rol.
5. Librarian online en detalle: Cámara pide permiso al pulsar. Probar aceptar,
   denegar y denegar definitivamente, mensaje/Ajustes; cancelar captura sin subir.
   Galería usa selector del sistema; cancelar conserva la portada. Seleccionar imagen,
   revisar vista previa, cancelar y repetir con Subir portada. Otro cliente debe
   recibir la nueva versión. Student no ve gestión; sin API no se encolan imágenes.
6. Comprobar errores de imagen inválida/tamaño y trazas sin base64/tokens. Documentar
   modelo Android, versión, Expo Go/SDK, pasos y resultados reales, sin credenciales.

El arranque frío sin red depende también de que Expo Go disponga del bundle de
desarrollo. No confundir abrir una app ya cargada offline con poder descargarla
desde Metro sin red. Si Expo Go no conserva ese bundle, la prueba de arranque frío
requiere un build nativo adecuado; hoy no hay APK ni ese resultado verificado.
iOS solo exportado; permisos y sandbox nativos requieren prueba en su plataforma.
