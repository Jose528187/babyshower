# Lista de Regalos · Baby Shower de Liam José

Página estática (GitHub Pages) con la lista de regalos y las reservas en tiempo real en **Firebase Firestore**.

- Invitados: <https://jose528187.github.io/babyshower/>
- Admin: <https://jose528187.github.io/babyshower/admin.html>

| Archivo | Qué es |
|---|---|
| `index.html` | La lista pública para los invitados |
| `app.js` | Lógica pública: lista, filtros, reservar y cancelar con PIN |
| `admin.html` | Panel privado: administrar regalos/categorías y ver reservas (IP, ubicación, CSV, liberar) |
| `firebase.js` | Conexión a Firebase (y al emulador local para pruebas) |
| `firebase-config.js` | Claves de Firebase + email del admin |
| `firestore.rules` | Reglas de seguridad (hay que publicarlas en la consola cada vez que cambian) |
| `seed.json` | Lista inicial de 92 regalos, para el botón "Importar lista inicial" del admin |

## Administrar la lista (admin.html → pestaña Regalos)

- **Agregar** un regalo con nombre, detalle (talles, marca…), categoría y **cantidad**.
- **Cantidad:** si un regalo tiene cantidad 3, lo pueden reservar hasta 3 personas (una unidad cada una).
  No se puede bajar la cantidad por debajo de lo ya reservado.
- **Activo:** desmarcarlo oculta el regalo de la lista pública sin perder sus reservas.
- **Eliminar:** solo si no tiene reservas activas (si tiene, deshabilitalo o liberá sus reservas).
- **Orden:** número para ordenar dentro de la categoría. Las categorías también tienen ícono y orden.
- Todo se guarda automáticamente al salir del campo, y la página pública se actualiza al instante.

## Configuración de Firebase (ya hecha)

1. Firestore Database creado en modo producción.
2. **Authentication → Google** habilitado, y en **Configuración → Dominios autorizados** agregado `jose528187.github.io`.
3. **Firestore → Reglas:** pegar todo `firestore.rules` → **Publicar**. ⚠️ Repetirlo cada vez que cambie el archivo.
4. Si la lista está vacía: `admin.html` → **Importar lista inicial** (carga `seed.json` y migra reservas del formato anterior).

Publicar cambios: `git push` a `main`; GitHub Pages se actualiza solo en 1–2 minutos.

## Datos que se guardan

| Colección | Quién la lee | Contenido |
|---|---|---|
| `categorias/{id}` | todos | nombre, ícono, orden |
| `regalos/{id}` | todos | nombre, detalle, categoría, cantidad, activo, orden, reservados |
| `reservas/{regalo}__{token}` | todos | una por unidad reservada: fecha y token (no dice quién) |
| `reservas_privadas/{regalo}__{token}` | solo admin | nombre, contacto, mensaje, PIN cifrado (SHA-256), IP, ciudad/país/proveedor aprox. (ipwho.is / ipify), navegador, sistema, pantalla, idioma, zona horaria, ID del dispositivo. Queda como historial. |
| `cancelaciones/{regalo}__{token}` | solo admin | cuándo, desde qué IP/dispositivo y si canceló el invitado o el admin |

## Cancelar una reserva

Al reservar, cada invitado elige un **PIN de 4 números**.

- **Mismo dispositivo:** aparece "Cancelar reserva" / "Cancelar mi reserva" (el PIN ya está recordado).
- **Otro dispositivo:** "¿Ya lo reservaste? Cancelar con PIN" → ingresar el PIN.
- **Ustedes:** `admin.html` → pestaña Reservas → **Liberar**.

Las reglas de Firestore verifican el PIN y mantienen el contador de reservados consistente,
así que nada de esto se puede saltear desde el navegador.

Notas:
- Todos los que estén en el mismo WiFi comparten IP: sirve como dato, no para identificar personas.
- Un PIN de 4 números tiene 10.000 combinaciones: suficiente para un baby shower. Cualquier abuso queda en el historial.

## Probar localmente sin tocar la base real

```bash
python3 -m http.server 8765
```

Abrir <http://localhost:8765>. Esto usa la base **real**. Para usar el emulador de Firebase:

```bash
npx firebase-tools@13 emulators:start --only firestore,auth --project demo-babyshower
```

(usa `firebase.json`; requiere Java) y abrir <http://localhost:8765/?emulator> o <http://localhost:8765/admin.html?emulator>.
