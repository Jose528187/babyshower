# Lista de Regalos · Baby Shower de Liam José

Página estática (GitHub Pages) con reservas en tiempo real guardadas en **Firebase Firestore**.

| Archivo | Qué es |
|---|---|
| `index.html` | La lista pública para los invitados |
| `app.js` | Lógica de reservas (tiempo real, filtros, formulario) |
| `firebase-config.js` | Tus claves de Firebase + email del admin |
| `admin.html` | Panel privado: quién reservó qué, IP, ubicación, CSV, liberar reservas |
| `firestore.rules` | Reglas de seguridad (evitan reservas dobles y protegen los datos privados) |

Mientras `firebase-config.js` tenga los valores `TU_...`, la página funciona en **modo demo** (solo guarda en el navegador).

## 1. Crear el proyecto en Firebase (gratis)

1. Entrá a <https://console.firebase.google.com> → **Agregar proyecto** (podés desactivar Analytics).
2. **Compilación → Firestore Database → Crear base de datos** → modo **producción** → ubicación `southamerica-east1` (São Paulo).
3. **Compilación → Authentication → Comenzar → Google** → habilitar (sirve para entrar a `admin.html`).
4. **Authentication → Configuración → Dominios autorizados** → agregar `TU_USUARIO.github.io`.
5. **Configuración del proyecto (⚙️) → Tus apps → Web (`</>`)** → registrar la app y copiar el objeto `firebaseConfig`.

## 2. Configurar los archivos

- Pegá los valores en `firebase-config.js` y poné tu Gmail en `ADMIN_EMAILS`.
- En `firestore.rules`, reemplazá `TU_CORREO@gmail.com` por el mismo email.
- En la consola: **Firestore → Reglas** → pegá todo el contenido de `firestore.rules` → **Publicar**.

## 3. Publicar en GitHub Pages

```bash
git init && git add . && git commit -m "Lista de regalos"
git branch -M main
git remote add origin https://github.com/TU_USUARIO/babyshower.git
git push -u origin main
```

En GitHub: **Settings → Pages → Source: Deploy from a branch → `main` / root**. En un minuto queda en
`https://TU_USUARIO.github.io/babyshower/` y el panel en `.../babyshower/admin.html`.

## Qué se guarda en cada reserva

- **Público** (`reservas/{regalo}`): fecha y un token aleatorio → todos ven que está reservado, no quién.
- **Privado** (`reservas_privadas/{regalo}__{token}`, solo admin): nombre, contacto y mensaje opcionales,
  el PIN **cifrado** (SHA-256), IP, ciudad/región/país y proveedor aproximados (vía ipwho.is, con respaldo en ipify),
  navegador, sistema, pantalla, idioma, zona horaria, un ID anónimo del dispositivo y fecha del servidor.
  Estos documentos no se borran al cancelar: quedan como historial.
- **Cancelaciones** (`cancelaciones/{regalo}__{token}`, solo admin): cuándo, desde qué IP/dispositivo
  y si fue el invitado o el admin.

## Cancelar una reserva

Al reservar, cada invitado elige un **PIN de 4 números**.

- **Desde el mismo dispositivo:** el regalo muestra "Cancelar reserva" (el PIN ya está recordado).
- **Desde otro dispositivo:** tocar el regalo reservado → ingresar el PIN.
- **Ustedes:** `admin.html` → **Liberar** (por ejemplo si alguien olvidó su PIN).

El PIN se verifica en las reglas de Firestore, no en el navegador, así que no se puede saltear.

Notas:
- La IP la obtiene el navegador del invitado, así que alguien con conocimientos técnicos podría falsearla.
  Además, todos los que estén en el mismo WiFi comparten IP, así que no sirve para identificar personas.
  La protección real contra reservas dobles son las reglas de Firestore.
- Un PIN de 4 números tiene 10.000 combinaciones: suficiente para un baby shower, pero alguien muy decidido
  podría probarlas con un script. Si pasara, se ve en el historial del admin y se puede volver a reservar.
- Para probar localmente: `python3 -m http.server 8765` y abrir <http://localhost:8765> (los módulos JS no funcionan con `file://`).
