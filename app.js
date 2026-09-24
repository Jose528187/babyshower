import { firebaseConfig, FIREBASE_VERSION } from './firebase-config.js';

const CONFIGURED = firebaseConfig.apiKey && !firebaseConfig.apiKey.startsWith('TU_');
const MINE_KEY = 'liam-mis-reservas-v2';   // { [regaloId]: { token, pin } }
const DEVICE_KEY = 'liam-device-id';
const DEMO_KEY = 'liam-demo-reservas-v2';

const $ = id => document.getElementById(id);
const cards = [...document.querySelectorAll('.gift-card')];
const sections = [...document.querySelectorAll('.category')];
const search = $('search');
let filter = 'all';
let reservations = {};
let current = null;
let backend = null;

// ---------- utilidades ----------
const normalize = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const slug = s => normalize(s).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 100);
const giftName = c => c.querySelector('.gift-name').textContent.trim();
const isPin = p => /^[0-9]{4}$/.test(p);

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

const mine = () => store(MINE_KEY, {});
// Es "mía" solo si el token local coincide con la reserva vigente (si alguien la canceló y re-reservó, ya no).
const isMine = id => Boolean(reservations[id] && mine()[id]?.token === reservations[id].token);

function toast(msg, ms = 5000) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.remove('hidden');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => t.classList.add('hidden'), ms);
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

// ---------- backends ----------
// Colecciones:
//   reservas/{regaloId}                  público: { fecha, token }
//   reservas_privadas/{regaloId__token}  admin: nombre, pinHash, IP, dispositivo...
//   cancelaciones/{regaloId__token}      admin: quién/cuándo canceló (el PIN se valida en las reglas)
async function firebaseBackend() {
    const base = `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}`;
    const { initializeApp } = await import(`${base}/firebase-app.js`);
    const { getFirestore, collection, onSnapshot, doc, writeBatch, serverTimestamp } = await import(`${base}/firebase-firestore.js`);
    const db = getFirestore(initializeApp(firebaseConfig));
    return {
        subscribe(cb) {
            onSnapshot(collection(db, 'reservas'), snap => {
                const map = {};
                snap.forEach(d => { map[d.id] = d.data(); });
                cb(map);
            }, err => {
                console.error(err);
                showNotice('No se pudo conectar con la lista. Revisá tu conexión y recargá la página.');
            });
        },
        async reserve(id, token, privateData) {
            const batch = writeBatch(db);
            batch.set(doc(db, 'reservas', id), { fecha: serverTimestamp(), token });
            batch.set(doc(db, 'reservas_privadas', `${id}__${token}`), { ...privateData, regaloId: id, token, fecha: serverTimestamp() });
            await batch.commit();
        },
        async cancel(id, token, pin, info) {
            const batch = writeBatch(db);
            batch.delete(doc(db, 'reservas', id));
            batch.set(doc(db, 'cancelaciones', `${id}__${token}`), { ...info, regaloId: id, token, pin, porAdmin: false, fecha: serverTimestamp() });
            await batch.commit();
        }
    };
}

// Modo demo: imita las mismas reglas usando localStorage.
function demoBackend() {
    let listener = () => { };
    const read = () => store(DEMO_KEY, { reservas: {}, privadas: {}, cancelaciones: {} });
    const denied = () => Object.assign(new Error('denied'), { code: 'permission-denied' });
    window.addEventListener('storage', e => { if (e.key === DEMO_KEY) listener(read().reservas); });
    return {
        subscribe(cb) { listener = cb; cb(read().reservas); },
        async reserve(id, token, privateData) {
            const db = read();
            if (db.reservas[id]) throw denied();
            db.reservas[id] = { fecha: new Date().toISOString(), token };
            db.privadas[`${id}__${token}`] = { ...privateData, regaloId: id, token };
            save(DEMO_KEY, db);
            listener(db.reservas);
        },
        async cancel(id, token, pin, info) {
            const db = read();
            const priv = db.privadas[`${id}__${token}`];
            if (db.reservas[id]?.token !== token || !priv || priv.pinHash !== await pinHash(pin, token)) throw denied();
            delete db.reservas[id];
            db.cancelaciones[`${id}__${token}`] = { ...info, regaloId: id, token, fecha: new Date().toISOString() };
            save(DEMO_KEY, db);
            listener(db.reservas);
        }
    };
}

// ---------- interfaz ----------
function showNotice(msg) {
    const n = $('notice');
    n.textContent = msg;
    n.classList.remove('hidden');
}

function render() {
    let reserved = 0;
    cards.forEach(c => {
        const id = c.dataset.id;
        const taken = Boolean(reservations[id]);
        const own = isMine(id);
        if (taken) reserved++;
        c.classList.toggle('reserved', taken && !own);
        c.classList.toggle('mine', own);
        const btn = c.querySelector('.reserve');
        btn.textContent = own ? 'Cancelar reserva' : taken ? '🔒 Reservado' : 'Reservar';
        btn.setAttribute('aria-label', own ? 'Cancelar mi reserva' : taken ? 'Reservado. ¿Es tuyo? Cancelar con PIN' : 'Reservar este regalo');
        btn.title = taken && !own ? '¿Lo reservaste vos? Tocá para cancelar con tu PIN' : '';
        c.querySelector('input[type=checkbox]').checked = taken;
        c.querySelector('.state').textContent = own ? '💙 Reservado por vos' : taken ? 'Reservado' : 'Disponible';
    });
    $('total').textContent = cards.length;
    $('available').textContent = cards.length - reserved;
    $('reserved').textContent = reserved;
    applyFilter();
}

function applyFilter() {
    const q = normalize(search.value);
    let visible = 0;
    cards.forEach(c => {
        const id = c.dataset.id;
        const ok = filter === 'all'
            || (filter === 'available' && !reservations[id])
            || (filter === 'mine' && isMine(id));
        const show = ok && c.dataset.search.includes(q);
        c.classList.toggle('hidden', !show);
        if (show) visible++;
    });
    sections.forEach(s => s.classList.toggle('hidden', !s.querySelector('.gift-card:not(.hidden)')));
    let empty = $('empty');
    if (!empty) {
        empty = Object.assign(document.createElement('p'), { id: 'empty', className: 'empty' });
        $('list').append(empty);
    }
    empty.textContent = filter === 'mine'
        ? 'No tenés reservas en este dispositivo. Si reservaste desde otro, tocá el regalo y cancelalo con tu PIN.'
        : 'No encontramos regalos con ese criterio.';
    empty.classList.toggle('hidden', visible > 0);
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

function openReserve(card) {
    current = card;
    $('modal-gift').textContent = giftName(card);
    $('form-error').textContent = '';
    $('f-name').value = store('liam-nombre', '') || '';
    $('f-pin').value = '';
    openModal('modal', $('f-name').value ? 'f-pin' : 'f-name');
}

function openCancel(card) {
    current = card;
    const own = isMine(card.dataset.id);
    $('cancel-gift').textContent = giftName(card);
    $('cancel-error').textContent = '';
    $('c-pin').value = '';
    $('cancel-pin-field').classList.toggle('hidden', own);
    $('cancel-text').textContent = own
        ? '¿Seguro que querés cancelar tu reserva? El regalo volverá a estar disponible para todos.'
        : 'Este regalo ya está reservado. Si lo reservaste vos (quizás desde otro dispositivo), ingresá el PIN que elegiste para cancelarlo.';
    openModal('cancel-modal', own ? 'cancel-submit' : 'c-pin');
}

function busy(btn, on, label) {
    btn.disabled = on;
    if (on) { btn.dataset.label = btn.textContent; btn.textContent = label; }
    else btn.textContent = btn.dataset.label || btn.textContent;
}

async function submitReserve(e) {
    e.preventDefault();
    const nombre = $('f-name').value.trim().replace(/\s+/g, ' ');
    const pin = $('f-pin').value.trim();
    if (nombre.length < 2) { $('form-error').textContent = 'Por favor escribí tu nombre.'; return $('f-name').focus(); }
    if (!isPin(pin)) { $('form-error').textContent = 'El PIN debe tener exactamente 4 números.'; return $('f-pin').focus(); }
    const card = current;
    const id = card.dataset.id;
    const token = randomHex(12);
    const btn = $('modal-submit');
    busy(btn, true, 'Reservando…');
    try {
        const net = await networkInfo();
        await backend.reserve(id, token, {
            regalo: giftName(card),
            categoria: card.dataset.category,
            nombre,
            contacto: $('f-contact').value.trim().slice(0, 80) || null,
            mensaje: $('f-message').value.trim().slice(0, 300) || null,
            pinHash: await pinHash(pin, token),
            ...net,
            ...deviceInfo()
        });
        save(MINE_KEY, { ...mine(), [id]: { token, pin } });
        save('liam-nombre', nombre);
        $('reserve-form').reset();
        closeModals();
        render();
        toast(`¡Gracias, ${nombre.split(' ')[0]}! Reservaste "${giftName(card)}" 💙 Recordá tu PIN ${pin} por si querés cancelar.`, 8000);
    } catch (err) {
        console.error(err);
        $('form-error').textContent = err.code === 'permission-denied'
            ? 'Ups, alguien acaba de reservar este regalo. Elegí otro 🤎'
            : 'No se pudo guardar la reserva. Revisá tu conexión e intentá de nuevo.';
    } finally {
        busy(btn, false);
    }
}

async function submitCancel(e) {
    e.preventDefault();
    const card = current;
    const id = card.dataset.id;
    const own = isMine(id);
    const pin = own ? mine()[id].pin : $('c-pin').value.trim();
    if (!isPin(pin)) { $('cancel-error').textContent = 'Ingresá tu PIN de 4 números.'; return $('c-pin').focus(); }
    const token = reservations[id]?.token;
    if (!token) { closeModals(); return render(); }
    const btn = $('cancel-submit');
    busy(btn, true, 'Cancelando…');
    try {
        await backend.cancel(id, token, pin, {
            regalo: giftName(card),
            desdeMismoDispositivo: own,
            ...(await networkInfo()),
            ...deviceInfo()
        });
        const m = mine();
        delete m[id];
        save(MINE_KEY, m);
        closeModals();
        render();
        toast(`Listo, cancelaste la reserva de "${giftName(card)}". Ya está disponible otra vez.`);
    } catch (err) {
        console.error(err);
        $('cancel-error').textContent = err.code === 'permission-denied'
            ? 'El PIN no es correcto. Si no lo recordás, escribiles a los papás 🤎'
            : 'No se pudo cancelar. Revisá tu conexión e intentá de nuevo.';
        $('c-pin').select();
    } finally {
        busy(btn, false);
    }
}

async function init() {
    cards.forEach(c => {
        c.dataset.id = slug(c.dataset.name);
        c.dataset.search = normalize(c.dataset.name + ' ' + c.dataset.category);
    });
    render();

    try {
        backend = CONFIGURED ? await firebaseBackend() : demoBackend();
    } catch (err) {
        console.error(err);
        showNotice('No se pudo cargar la base de datos. Recargá la página en unos segundos.');
        return;
    }
    if (!CONFIGURED) showNotice('Modo demo: Firebase aún no está configurado, las reservas solo se guardan en este navegador.');

    backend.subscribe(map => { reservations = map; render(); });

    cards.forEach(c => c.querySelector('.reserve').addEventListener('click', () => {
        reservations[c.dataset.id] ? openCancel(c) : openReserve(c);
    }));
    document.querySelectorAll('[data-filter]').forEach(b => b.addEventListener('click', () => {
        filter = b.dataset.filter;
        document.querySelectorAll('[data-filter]').forEach(x => x.classList.toggle('active', x === b));
        applyFilter();
    }));
    document.querySelectorAll('.pin-input').forEach(i => i.addEventListener('input', () => { i.value = i.value.replace(/\D/g, '').slice(0, 4); }));
    search.addEventListener('input', applyFilter);
    $('reserve-form').addEventListener('submit', submitReserve);
    $('cancel-form').addEventListener('submit', submitCancel);
    document.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', closeModals));
    document.querySelectorAll('.modal').forEach(m => m.addEventListener('click', e => { if (e.target === m) closeModals(); }));
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && current) closeModals(); });
}

init();
