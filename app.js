const MINE_KEY = 'liam-mis-reservas-v3';   // { [reservaId]: { regaloId, token, pin } }
const DEVICE_KEY = 'liam-device-id';

const $ = id => document.getElementById(id);
const search = $('search');
let filter = 'all';
let gifts = {};          // regalos/{id}
let categories = {};     // categorias/{id}
let reservations = {};   // reservas/{regaloId__token}
let loaded = { gifts: false, categories: false, reservations: false };
let current = null;      // regalo abierto en un modal
let fb = null;

// ---------- utilidades ----------
const normalize = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const isPin = p => /^[0-9]{4}$/.test(p);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function store(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}
function save(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* modo privado */ }
}
function randomHex(bytes) {
    return [...crypto.getRandomValues(new Uint8Array(bytes))].map(b => b.toString(16).padStart(2, '0')).join('');
}
function deviceId() {
    let id = store(DEVICE_KEY, null);
    if (!id) { id = randomHex(16); save(DEVICE_KEY, id); }
    return id;
}
// Debe coincidir con firestore.rules: sha256(pin + ':' + token) en hexadecimal.
async function pinHash(pin, token) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${pin}:${token}`));
    return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

// Reservas vigentes hechas desde este dispositivo para un regalo.
function myReservations(giftId) {
    const mine = store(MINE_KEY, {});
    return Object.entries(mine)
        .filter(([rid, r]) => r.regaloId === giftId && reservations[rid])
        .map(([rid, r]) => ({ rid, ...r }));
}
function activeReservations(giftId) {
    return Object.entries(reservations)
        .filter(([, r]) => r.regaloId === giftId)
        .sort(([, a], [, b]) => (b.fecha?.toMillis?.() || 0) - (a.fecha?.toMillis?.() || 0))
        .map(([rid, r]) => ({ rid, ...r }));
}
function giftStatus(g) {
    const left = Math.max(0, g.cantidad - (g.reservados || 0));
    return { left, mine: myReservations(g.id).length };
}

function toast(msg, ms = 5000) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.remove('hidden');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => t.classList.add('hidden'), ms);
}
function showNotice(msg) {
    const n = $('notice');
    n.textContent = msg;
    n.classList.remove('hidden');
}

async function fetchJson(url, ms = 3500) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ms);
    try {
        const r = await fetch(url, { signal: ctrl.signal });
        return r.ok ? await r.json() : null;
    } catch { return null; } finally { clearTimeout(timer); }
}

// IP + ubicación aproximada. Si un servicio falla se intenta el siguiente; nunca bloquea la reserva.
async function networkInfo() {
    const w = await fetchJson('https://ipwho.is/');
    if (w && w.success !== false && w.ip) {
        return { ip: w.ip, ciudad: w.city || null, region: w.region || null, pais: w.country || null, proveedor: w.connection?.isp || null };
    }
    const f = await fetchJson('https://api.ipify.org?format=json');
    return { ip: f?.ip || null, ciudad: null, region: null, pais: null, proveedor: null };
}

function deviceInfo() {
    return {
        dispositivoId: deviceId(),
        navegador: navigator.userAgent.slice(0, 400),
        idioma: navigator.language || null,
        plataforma: navigator.userAgentData?.platform || navigator.platform || null,
        zonaHoraria: Intl.DateTimeFormat().resolvedOptions().timeZone || null,
        pantalla: `${screen.width}x${screen.height}`,
        referencia: document.referrer.slice(0, 300) || null,
        fechaLocal: new Date().toString().slice(0, 100)
    };
}

// ---------- base de datos ----------
// Colecciones:
//   categorias/{id}                    público: { nombre, icono, orden }
//   regalos/{id}                       público: { nombre, detalle, categoria, cantidad, activo, orden, reservados, ultimoToken }
//   reservas/{regaloId__token}         público: { regaloId, token, fecha }  (una por unidad reservada)
//   reservas_privadas/{regaloId__token} admin: nombre, pinHash, IP, dispositivo...
//   cancelaciones/{regaloId__token}    admin: quién/cuándo canceló (el PIN se valida en las reglas)
function subscribe() {
    const { collection, onSnapshot } = fb.fs;
    const onErr = err => {
        console.error(err);
        showNotice('No se pudo conectar con la lista. Revisá tu conexión y recargá la página.');
    };
    const listen = (name, key, assign) => onSnapshot(collection(fb.db, name), snap => {
        const map = {};
        snap.forEach(d => { map[d.id] = { id: d.id, ...d.data() }; });
        assign(map);
        loaded[key] = true;
        render();
    }, onErr);
    listen('regalos', 'gifts', m => { gifts = m; });
    listen('categorias', 'categories', m => { categories = m; });
    // Se ignoran documentos con el formato anterior (sin "__").
    listen('reservas', 'reservations', m => { reservations = Object.fromEntries(Object.entries(m).filter(([id]) => id.includes('__'))); });
}

async function reserveGift(giftId, token, privateData) {
    const { doc, runTransaction, serverTimestamp } = fb.fs;
    const rid = `${giftId}__${token}`;
    await runTransaction(fb.db, async tx => {
        const ref = doc(fb.db, 'regalos', giftId);
        const snap = await tx.get(ref);
        const g = snap.data();
        if (!snap.exists() || !g.activo || (g.reservados || 0) >= g.cantidad) {
            throw Object.assign(new Error('agotado'), { code: 'agotado' });
        }
        tx.update(ref, { reservados: (g.reservados || 0) + 1, ultimoToken: token });
        tx.set(doc(fb.db, 'reservas', rid), { regaloId: giftId, token, fecha: serverTimestamp() });
        tx.set(doc(fb.db, 'reservas_privadas', rid), { ...privateData, regaloId: giftId, token, fecha: serverTimestamp() });
    });
    return rid;
}

async function cancelReservation(giftId, token, pin, info) {
    const { doc, runTransaction, serverTimestamp } = fb.fs;
    const rid = `${giftId}__${token}`;
    await runTransaction(fb.db, async tx => {
        const ref = doc(fb.db, 'regalos', giftId);
        const g = (await tx.get(ref)).data();
        tx.update(ref, { reservados: g.reservados - 1, ultimoToken: token });
        tx.delete(doc(fb.db, 'reservas', rid));
        tx.set(doc(fb.db, 'cancelaciones', rid), { ...info, regaloId: giftId, token, pin, porAdmin: false, fecha: serverTimestamp() });
    });
}

// ---------- interfaz ----------
function sortedCategories() {
    const list = Object.values(categories).sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0) || a.nombre.localeCompare(b.nombre));
    const known = new Set(list.map(c => c.id));
    if (Object.values(gifts).some(g => !known.has(g.categoria))) list.push({ id: '__otros', nombre: 'Otros', icono: '🎁' });
    return list;
}

function cardHtml(g) {
    const { left, mine } = giftStatus(g);
    const full = left === 0;
    const multi = g.cantidad > 1;
    const taken = (g.reservados || 0) > 0;
    const btn = !full
        ? { text: mine ? 'Reservar otro' : 'Reservar', cls: '', action: 'reserve' }
        : mine ? { text: 'Cancelar reserva', cls: 'cancel', action: 'cancel' } : { text: '🔒 Reservado', cls: '', action: 'cancel' };
    const state = mine
        ? ['💙 Reservaste' + (mine > 1 ? ` ${mine}` : ''), !full && `quedan ${left}`].filter(Boolean).join(' · ')
        : full ? 'Reservado' : multi ? `Quedan ${left} de ${g.cantidad}` : 'Disponible';
    // Enlace secundario para cancelar cuando el botón principal no lo hace.
    const link = btn.action === 'cancel' || !taken ? ''
        : `<button class="cancel-link" type="button" data-action="cancel">${mine ? 'Cancelar mi reserva' : '¿Ya lo reservaste? Cancelar con PIN'}</button>`;
    return `
        <article class="gift-card ${full && !mine ? 'reserved' : ''} ${mine ? 'mine' : ''}" data-id="${esc(g.id)}">
            <div class="gift-main">
                <div class="gift-name">${esc(g.nombre)}</div>
                ${g.detalle ? `<div class="ref">📏 ${esc(g.detalle)}</div>` : ''}
                ${multi ? `<div class="ref">🎁 Cantidad deseada: ${g.cantidad}</div>` : ''}
                ${link}
            </div>
            <button class="reserve ${btn.cls}" type="button" data-action="${btn.action}">${btn.text}</button>
            <span class="state">${state}</span>
        </article>`;
}

function render() {
    if (!loaded.gifts || !loaded.categories || !loaded.reservations) return;
    const active = Object.values(gifts).filter(g => g.activo);
    const q = normalize(search.value);
    const known = new Set(Object.keys(categories));
    let units = 0, free = 0, visible = 0;
    const html = sortedCategories().map(c => {
        const items = active
            .filter(g => (known.has(g.categoria) ? g.categoria : '__otros') === c.id)
            .sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0) || a.nombre.localeCompare(b.nombre));
        items.forEach(g => { units += g.cantidad; free += giftStatus(g).left; });
        const shown = items.filter(g => {
            const { left, mine } = giftStatus(g);
            const ok = filter === 'all' || (filter === 'available' && left > 0) || (filter === 'mine' && mine > 0);
            return ok && normalize(`${g.nombre} ${g.detalle || ''} ${c.nombre}`).includes(q);
        });
        visible += shown.length;
        if (!shown.length) return '';
        return `
            <section class="category">
                <h2><span class="cat-icon">${esc(c.icono || '🎁')}</span>${esc(c.nombre)}</h2>
                <div class="grid">${shown.map(cardHtml).join('')}</div>
            </section>`;
    }).join('');
    const empty = !active.length ? 'La lista de regalos todavía no está cargada.'
        : filter === 'mine' ? 'No tenés reservas en este dispositivo. Si reservaste desde otro, buscá el regalo y cancelalo con tu PIN.'
            : 'No encontramos regalos con ese criterio.';
    $('list').innerHTML = html + (visible ? '' : `<p class="empty">${empty}</p>`);
    $('total').textContent = units;
    $('available').textContent = free;
    $('reserved').textContent = units - free;
}

function openModal(modalId, focusId) {
    document.querySelectorAll('.modal').forEach(m => m.classList.add('hidden'));
    $(modalId).classList.remove('hidden');
    setTimeout(() => $(focusId)?.focus(), 50);
}
function closeModals() {
    document.querySelectorAll('.modal').forEach(m => m.classList.add('hidden'));
    current = null;
}

function giftTitle(g) {
    return g.detalle ? `${g.nombre} (${g.detalle})` : g.nombre;
}

// Datos de quien ya reservó desde este dispositivo: no se vuelven a pedir en la siguiente reserva.
const PROFILE_KEY = 'liam-perfil';
function profile() {
    const p = store(PROFILE_KEY, null);
    return p && p.nombre?.length >= 2 && isPin(p.pin) ? p : null;
}
function showProfileFields(show) {
    $('profile-fields').classList.toggle('hidden', !show);
    $('profile-known').classList.toggle('hidden', show);
}

function openReserve(g) {
    current = g.id;
    const p = profile();
    $('modal-gift').textContent = giftTitle(g);
    $('form-error').textContent = '';
    $('f-message').value = '';
    $('f-pin').value = '';
    $('f-name').value = p?.nombre || '';
    $('f-contact').value = p?.contacto || '';
    $('known-name').textContent = p?.nombre || '';
    showProfileFields(!p);
    openModal('modal', p ? 'modal-submit' : 'f-name');
}

function openCancel(g) {
    current = g.id;
    const own = myReservations(g.id).length > 0;
    $('cancel-gift').textContent = giftTitle(g);
    $('cancel-error').textContent = '';
    $('c-pin').value = '';
    $('cancel-pin-field').classList.toggle('hidden', own);
    $('cancel-text').textContent = own
        ? '¿Seguro que querés cancelar tu reserva? El regalo volverá a estar disponible para todos.'
        : 'Si reservaste este regalo (quizás desde otro dispositivo), ingresá el PIN que elegiste para cancelarlo.';
    openModal('cancel-modal', own ? 'cancel-submit' : 'c-pin');
}

function busy(btn, on, label) {
    btn.disabled = on;
    if (on) { btn.dataset.label = btn.textContent; btn.textContent = label; }
    else btn.textContent = btn.dataset.label || btn.textContent;
}

async function submitReserve(e) {
    e.preventDefault();
    const known = $('profile-fields').classList.contains('hidden') && profile();
    const nombre = known ? known.nombre : $('f-name').value.trim().replace(/\s+/g, ' ');
    const contacto = known ? known.contacto : $('f-contact').value.trim().slice(0, 80) || null;
    const pin = known ? known.pin : $('f-pin').value.trim();
    if (nombre.length < 2) { $('form-error').textContent = 'Por favor escribí tu nombre.'; return $('f-name').focus(); }
    if (!isPin(pin)) { $('form-error').textContent = 'El PIN debe tener exactamente 4 números.'; return $('f-pin').focus(); }
    const g = gifts[current];
    const token = randomHex(12);
    const btn = $('modal-submit');
    busy(btn, true, 'Reservando…');
    try {
        const net = await networkInfo();
        const rid = await reserveGift(g.id, token, {
            regalo: g.nombre,
            categoria: categories[g.categoria]?.nombre || g.categoria,
            nombre,
            contacto,
            mensaje: $('f-message').value.trim().slice(0, 300) || null,
            pinHash: await pinHash(pin, token),
            ...net,
            ...deviceInfo()
        });
        save(MINE_KEY, { ...store(MINE_KEY, {}), [rid]: { regaloId: g.id, token, pin } });
        save(PROFILE_KEY, { nombre, contacto, pin });
        $('reserve-form').reset();
        closeModals();
        render();
        toast(known
            ? `¡Gracias, ${nombre.split(' ')[0]}! También reservaste "${g.nombre}" 💙`
            : `¡Gracias, ${nombre.split(' ')[0]}! Reservaste "${g.nombre}" 💙 Recordá tu PIN ${pin}: sirve para cancelar cualquiera de tus reservas.`, 8000);
    } catch (err) {
        console.error(err);
        $('form-error').textContent = ['agotado', 'permission-denied'].includes(err.code)
            ? 'Ups, alguien acaba de reservar la última unidad de este regalo. Elegí otro 🤎'
            : 'No se pudo guardar la reserva. Revisá tu conexión e intentá de nuevo.';
    } finally {
        busy(btn, false);
    }
}

async function submitCancel(e) {
    e.preventDefault();
    const g = gifts[current];
    const own = myReservations(g.id);
    const pin = own.length ? own[0].pin : $('c-pin').value.trim();
    if (!isPin(pin)) { $('cancel-error').textContent = 'Ingresá tu PIN de 4 números.'; return $('c-pin').focus(); }
    // Con el mismo dispositivo sabemos cuál es; con PIN se prueba contra cada reserva activa del regalo.
    const candidates = own.length ? [own[0]] : activeReservations(g.id);
    if (!candidates.length) { closeModals(); return render(); }
    const btn = $('cancel-submit');
    busy(btn, true, 'Cancelando…');
    try {
        const info = { regalo: g.nombre, desdeMismoDispositivo: own.length > 0, ...(await networkInfo()), ...deviceInfo() };
        let done = null, lastErr = null;
        for (const r of candidates) {
            try { await cancelReservation(g.id, r.token, pin, info); done = r; break; }
            catch (err) { lastErr = err; if (err.code !== 'permission-denied') break; }
        }
        if (!done) throw lastErr;
        const mine = store(MINE_KEY, {});
        delete mine[done.rid];
        save(MINE_KEY, mine);
        closeModals();
        render();
        toast(`Listo, cancelaste tu reserva de "${g.nombre}". Ya está disponible otra vez.`);
    } catch (err) {
        console.error(err);
        $('cancel-error').textContent = err?.code === 'permission-denied'
            ? 'El PIN no es correcto. Si no lo recordás, escribiles a los papás 🤎'
            : 'No se pudo cancelar. Revisá tu conexión e intentá de nuevo.';
        $('c-pin').select();
    } finally {
        busy(btn, false);
    }
}

async function init() {
    document.querySelectorAll('[data-filter]').forEach(b => b.addEventListener('click', () => {
        filter = b.dataset.filter;
        document.querySelectorAll('[data-filter]').forEach(x => x.classList.toggle('active', x === b));
        render();
    }));
    search.addEventListener('input', render);
    $('list').addEventListener('click', e => {
        const el = e.target.closest('[data-action]');
        const g = el && gifts[el.closest('.gift-card')?.dataset.id];
        if (!g) return;
        el.dataset.action === 'reserve' ? openReserve(g) : openCancel(g);
    });
    document.querySelectorAll('.pin-input').forEach(i => i.addEventListener('input', () => { i.value = i.value.replace(/\D/g, '').slice(0, 4); }));
    $('reserve-form').addEventListener('submit', submitReserve);
    $('change-profile').addEventListener('click', () => {
        $('f-name').value = '';
        $('f-contact').value = '';
        showProfileFields(true);
        $('f-name').focus();
    });
    $('cancel-form').addEventListener('submit', submitCancel);
    document.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', closeModals));
    document.querySelectorAll('.modal').forEach(m => m.addEventListener('click', e => { if (e.target === m) closeModals(); }));
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && current) closeModals(); });

    try {
        fb = await import('./firebase.js');
    } catch (err) {
        console.error(err);
        showNotice('No se pudo cargar la base de datos. Recargá la página en unos segundos.');
        return;
    }
    if (fb.isEmulator) showNotice('Modo prueba: conectado al emulador local de Firebase.');
    subscribe();
}

init();
