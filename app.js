'use strict';

/* ---------- utilitaires ---------- */
const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const norm = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const eur = n => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(n || 0);
const fmtDate = ts => new Date(ts).toLocaleDateString('fr-FR');
const fmtDateTime = ts => new Date(ts).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
const today = () => { const t = new Date(); return new Date(t.getTime() - t.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
const fmtDay = s => String(s).split('-').reverse().join('/');
const fixUrl = u => { u = String(u || '').trim(); return u && !/^https?:\/\//i.test(u) ? 'https://' + u : u; };

const ICON = {
  back: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>',
  plus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
  edit: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16v4Z"/></svg>',
  trash: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13"/></svg>'
};

/* ---------- base de données locale (IndexedDB) ---------- */
let db;
const openDB = () => new Promise((res, rej) => {
  const r = indexedDB.open('inventaire-logement', 3);
  r.onupgradeneeded = () => {
    const d = r.result;
    for (const n of ['items', 'categories', 'controls', 'rooms', 'wishes']) if (!d.objectStoreNames.contains(n)) d.createObjectStore(n, { keyPath: 'id' });
  };
  r.onsuccess = () => res(r.result);
  r.onerror = () => rej(r.error);
});
const store = (name, mode = 'readonly') => db.transaction(name, mode).objectStore(name);
const wrap = req => new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });
const getAll = n => wrap(store(n).getAll());
const put = (n, v) => wrap(store(n, 'readwrite').put(v));
const del = (n, id) => wrap(store(n, 'readwrite').delete(id));
const clearStore = n => wrap(store(n, 'readwrite').clear());

/* ---------- état ---------- */
const state = { q: '', cat: 'all', room: 'all', tab: 'inv', wq: '' };
let items = [], cats = [], controls = [], rooms = [], wishes = [];
const view = $('#view');
const sheet = $('#sheet');
const hayCache = new Map();

async function loadAll() {
  [items, cats, controls, rooms, wishes] = await Promise.all([getAll('items'), getAll('categories'), getAll('controls'), getAll('rooms'), getAll('wishes')]);
  cats.sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name, 'fr'));
  rooms.sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name, 'fr'));
  items.sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  hayCache.clear();
}

const DEFAULT_CATS = ['Mobilier', 'Décoration', 'Vaisselle', 'Ustensiles de cuisine', 'Linge de lit', 'Linge de bain', 'Électroménager', 'Robinetterie et sanitaires', 'Éclairage', 'Équipements divers'];
async function seed() {
  if (localStorage.getItem('seeded') || cats.length || items.length) return;
  for (let i = 0; i < DEFAULT_CATS.length; i++) await put('categories', { id: uid(), name: DEFAULT_CATS[i], order: i });
  localStorage.setItem('seeded', '1');
  await loadAll();
}

const DEFAULT_ROOMS = ['Entrée', 'Séjour', 'Cuisine', 'Chambre 1', 'Chambre 2', 'Chambre 3', 'Salle de bain', 'WC', 'Balcon'];
async function migrateRooms(force = false) {
  if (!force && localStorage.getItem('roomsMigrated')) return;
  const map = new Map(rooms.map(r => [norm(r.name), r]));
  for (const i of items) {
    const loc = (i.location || '').trim();
    if (!loc || roomsOf(i).length) continue;
    let r = map.get(norm(loc));
    if (!r) { r = { id: uid(), name: loc, order: rooms.length + map.size }; await put('rooms', r); map.set(norm(loc), r); }
    await put('items', { ...i, roomIds: [r.id], location: '' });
  }
  localStorage.setItem('roomsMigrated', '1');
  await loadAll();
}
async function seedRooms() {
  if (localStorage.getItem('seededRooms')) return;
  const have = new Set(rooms.map(r => norm(r.name)));
  let k = rooms.length;
  for (const name of DEFAULT_ROOMS) if (!have.has(norm(name))) await put('rooms', { id: uid(), name, order: k++ });
  localStorage.setItem('seededRooms', '1');
  await loadAll();
}

const roomName = id => (rooms.find(r => r.id === id) || {}).name || '';
const roomsOf = i => Array.isArray(i.roomIds) ? i.roomIds : (i.room ? [i.room] : []);
const validRooms = i => roomsOf(i).filter(id => rooms.some(r => r.id === id));
const roomNames = i => validRooms(i).map(roomName).join(' / ');
const roomOk = (i, sel) => sel === 'all' || (sel === 'none' ? !validRooms(i).length : roomsOf(i).includes(sel));
const metaOf = i => [catName(i.cat), roomNames(i), i.location].filter(Boolean).join(', ');
const catName = id => (cats.find(c => c.id === id) || {}).name || 'Sans catégorie';
const hayOf = i => {
  const k = i.id + ':' + (i.updated || 0) + ':' + i.cat;
  let h = hayCache.get(k);
  if (h === undefined) {
    h = norm([i.name, i.description, i.store, i.url, i.location, i.notes, catName(i.cat), roomNames(i)].join(' '));
    hayCache.set(k, h);
  }
  return h;
};

/* ---------- photos ---------- */
const urls = new WeakMap();
const urlOf = b => { if (!b) return ''; let u = urls.get(b); if (!u) { u = URL.createObjectURL(b); urls.set(b, u); } return u; };

async function loadBitmap(file) {
  try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); }
  catch (e) {
    return await new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => res(img);
      img.onerror = rej;
      img.src = URL.createObjectURL(file);
    });
  }
}
async function shrink(src, max, q) {
  const bmp = await loadBitmap(src);
  const w = bmp.width || bmp.naturalWidth, h = bmp.height || bmp.naturalHeight;
  const k = Math.min(1, max / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.round(w * k); c.height = Math.round(h * k);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  return new Promise(r => c.toBlob(r, 'image/jpeg', q));
}
const makePhoto = async file => ({ full: await shrink(file, 1400, .82), thumb: await shrink(file, 360, .75) });
const blobToData = b => new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(b); });

/* ---------- interface commune ---------- */
function toast(msg) {
  const host = sheet.open ? sheet : document.body;
  const old = $('#toast');
  if (old) old.remove();
  const t = document.createElement('div');
  t.id = 'toast';
  t.setAttribute('role', 'status');
  t.textContent = msg;
  host.appendChild(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 250); }, 2400);
}

function openSheet(html) {
  sheet.innerHTML = html;
  if (!sheet.open) { sheet.showModal(); history.pushState({ sheet: 1 }, ''); }
  const body = sheet.querySelector('.sh-body');
  if (body) body.scrollTop = 0;
  sheet.onclick = e => { if (e.target.closest('[data-close]')) closeSheet(); };
}
function closeSheet() {
  if (history.state && history.state.sheet) history.back();
  else if (sheet.open) sheet.close();
}
addEventListener('popstate', () => { if (sheet.open) sheet.close(); });
sheet.addEventListener('cancel', e => { e.preventDefault(); closeSheet(); });
sheet.addEventListener('close', () => { sheet.innerHTML = ''; refreshCurrent(); });

function lightbox(src) {
  const lb = document.createElement('div');
  lb.id = 'lightbox';
  lb.innerHTML = `<img src="${esc(src)}" alt="Photo en grand">`;
  lb.onclick = () => lb.remove();
  (sheet.open ? sheet : document.body).appendChild(lb);
}

const chip = (id, label, n, on) => `<button class="chip${on ? ' on' : ''}" data-cat="${esc(id)}">${esc(label)} <span>${n}</span></button>`;
const thumbHtml = i => {
  const p = (i.photos || [])[0];
  return p ? `<img class="thumb" src="${urlOf(p.thumb)}" alt="" loading="lazy">` : `<span class="ph" aria-hidden="true">${esc((i.name || '?').trim().charAt(0).toUpperCase())}</span>`;
};

/* ---------- navigation ---------- */
const TITLES = { inv: 'Inventaire du logement', ctl: 'Contrôle de départ', wish: 'Liste d’envie', set: 'Réglages et sauvegarde' };
function setTab(t) {
  state.tab = t;
  document.querySelectorAll('.tabs button').forEach(b => { if (b.dataset.tab === t) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
  $('#title').textContent = TITLES[t];
  if (t === 'inv') renderInventory();
  else if (t === 'ctl') renderControlTab();
  else if (t === 'wish') renderWishlist();
  else renderSettings();
  view.scrollTop = 0;
}
document.querySelectorAll('.tabs button').forEach(b => b.onclick = () => setTab(b.dataset.tab));
function refreshCurrent() {
  if (state.tab === 'inv') { if ($('#list')) { refreshChips(); refreshList(); } else renderInventory(); }
  else if (state.tab === 'ctl') renderControlTab();
  else if (state.tab === 'wish') { if ($('#wlist')) refreshWish(); else renderWishlist(); }
  else renderSettings();
}

/* ---------- inventaire : liste et recherche ---------- */
function visible() {
  const terms = norm(state.q).split(/\s+/).filter(Boolean);
  return items.filter(i => {
    const okCat = state.cat === 'all' || (state.cat === 'none' ? !cats.some(c => c.id === i.cat) : i.cat === state.cat);
    return okCat && roomOk(i, state.room) && terms.every(t => hayOf(i).includes(t));
  });
}

function renderInventory() {
  view.innerHTML = `
    <div class="searchbar"><input id="q" type="search" enterkeyhint="search" autocomplete="off" aria-label="Rechercher" placeholder="Rechercher un article, un magasin, une pièce…" value="${esc(state.q)}"></div>
    <div class="roomrow"><select id="roomsel" aria-label="Filtrer par pièce"></select><button class="btn" id="roomman">Gérer les pièces</button></div>
    <div class="chips" id="chips"></div>
    <p class="summary" id="sum"></p>
    <ul class="list" id="list"></ul>
    <button class="fab" id="add">${ICON.plus}<span>Ajouter</span></button>`;
  $('#q').addEventListener('input', e => { state.q = e.target.value; refreshList(); });
  $('#add').onclick = () => openForm();
  $('#roomman').onclick = () => openRooms();
  $('#roomsel').onchange = e => { state.room = e.target.value; refreshChips(); refreshList(); };
  $('#chips').onclick = e => {
    if (e.target.closest('[data-manage]')) return openCats();
    const b = e.target.closest('[data-cat]');
    if (b) { state.cat = b.dataset.cat; refreshChips(); refreshList(); }
  };
  $('#list').onclick = e => { const b = e.target.closest('[data-id]'); if (b) openDetail(b.dataset.id); };
  refreshChips(); refreshList();
}

function refreshChips() {
  const pool = items.filter(i => roomOk(i, state.room));
  const n = id => pool.filter(i => i.cat === id).length;
  let h = chip('all', 'Toutes', pool.length, state.cat === 'all');
  for (const c of cats) h += chip(c.id, c.name, n(c.id), state.cat === c.id);
  const orphan = pool.filter(i => !cats.some(c => c.id === i.cat)).length;
  if (orphan) h += chip('none', 'Sans catégorie', orphan, state.cat === 'none');
  else if (state.cat === 'none') state.cat = 'all';
  if (state.cat !== 'all' && state.cat !== 'none' && !cats.some(c => c.id === state.cat)) state.cat = 'all';
  h += '<button class="chip ghost" data-manage>Gérer les catégories</button>';
  $('#chips').innerHTML = h;
  refreshRooms();
}

function refreshRooms() {
  const sel = $('#roomsel');
  if (!sel) return;
  const orphan = items.filter(i => !validRooms(i).length).length;
  if (state.room !== 'all' && !(state.room === 'none' && orphan) && !rooms.some(r => r.id === state.room)) state.room = 'all';
  sel.innerHTML = `<option value="all">Toutes les pièces (${items.length})</option>` +
    rooms.map(r => `<option value="${esc(r.id)}">${esc(r.name)} (${items.filter(i => roomsOf(i).includes(r.id)).length})</option>`).join('') +
    (orphan ? `<option value="none">Sans pièce (${orphan})</option>` : '');
  sel.value = state.room;
}

function refreshList() {
  const list = visible();
  const pieces = list.reduce((s, i) => s + (i.qty || 1), 0);
  const total = list.reduce((s, i) => s + (i.price || 0) * (i.qty || 1), 0);
  $('#sum').textContent = items.length ? `${list.length} article${list.length > 1 ? 's' : ''}, ${pieces} pièce${pieces > 1 ? 's' : ''}, valeur d’achat ${eur(total)}` : '';
  if (!items.length) { $('#list').innerHTML = '<li class="empty">Aucun article pour l’instant.<br>Touchez « Ajouter » pour enregistrer le premier.</li>'; return; }
  if (!list.length) { $('#list').innerHTML = `<li class="empty">Aucun résultat${state.q ? ' pour « ' + esc(state.q) + ' »' : ''}.</li>`; return; }
  $('#list').innerHTML = list.map(i => `
    <li><button class="card" data-id="${i.id}">${thumbHtml(i)}
      <span class="body"><strong>${esc(i.name)}</strong><span class="meta">${esc(metaOf(i))}</span></span>
      <span class="right"><span class="qty">× ${i.qty || 1}</span><span class="price">${i.price != null ? eur(i.price) : ''}</span></span>
    </button></li>`).join('');
}

/* ---------- fiche article ---------- */
function openDetail(id) {
  const i = items.find(x => x.id === id);
  if (!i) return;
  const ph = i.photos || [];
  const row = (k, v) => v ? `<dt>${k}</dt><dd>${esc(v)}</dd>` : '';
  openSheet(`
    <header class="sh-head"><button class="icon" data-close aria-label="Fermer">${ICON.back}</button><h2>${esc(i.name)}</h2></header>
    <div class="sh-body">
      ${ph.length ? `<div class="gallery${ph.length > 1 ? ' multi' : ''}">${ph.map((p, k) => `<img src="${urlOf(p.full)}" data-k="${k}" alt="Photo ${k + 1} de ${esc(i.name)}">`).join('')}</div>` : ''}
      <dl class="facts">
        ${row('Catégorie', catName(i.cat))}
        ${row('Quantité', String(i.qty || 1))}
        ${i.price != null ? row('Prix d’achat (unité)', eur(i.price)) + row('Total', eur(i.price * (i.qty || 1))) : ''}
        ${row('Date d’achat', i.date ? fmtDay(i.date) : '')}
        ${row('Lieu d’achat', i.store)}
        ${row(validRooms(i).length > 1 ? 'Pièces' : 'Pièce', roomNames(i))}
        ${row('Emplacement précis', i.location)}
      </dl>
      ${i.description ? `<h3>Descriptif du commerçant</h3><p class="prose">${esc(i.description)}</p>` : ''}
      ${i.notes ? `<h3>Notes</h3><p class="prose">${esc(i.notes)}</p>` : ''}
      ${i.url ? `<a class="btn primary wide" href="${esc(i.url)}" target="_blank" rel="noopener noreferrer">Ouvrir la fiche en ligne</a>` : ''}
    </div>
    <footer class="sh-foot"><button class="btn" id="dup">Dupliquer</button><button class="btn" id="edit">Modifier</button><button class="btn danger" id="rm">Supprimer</button></footer>`);
  $('#edit', sheet).onclick = () => openForm(i);
  $('#dup', sheet).onclick = () => openForm(i, true);
  $('#rm', sheet).onclick = async () => {
    if (!confirm(`Supprimer « ${i.name} » ?`)) return;
    await del('items', i.id); await loadAll(); closeSheet(); setTimeout(() => toast('Article supprimé.'), 200);
  };
  const g = $('.gallery', sheet);
  if (g) g.onclick = e => { const im = e.target.closest('img'); if (im) lightbox(im.src); };
}

/* ---------- remplissage automatique depuis un lien ---------- */
const relayUrl = () => (localStorage.getItem('relayLogement') || localStorage.getItem('relayOutils') || '').trim().replace(/\/+$/, '');
const firstLink = (...parts) => { const m = parts.filter(Boolean).join(' ').match(/https?:\/\/[^\s<>"']+/i); return m ? m[0].replace(/[).,;]+$/, '') : ''; };

// mots-clés (sans accents) -> nom de catégorie par défaut
const CAT_RULES = [
  ['Électroménager', ['aspirateur', 'lave-linge', 'lave linge', 'lave-vaisselle', 'four', 'micro-ondes', 'micro ondes', 'refrigerateur', 'frigo', 'congelateur', 'cafetiere', 'bouilloire', 'grille-pain', 'fer a repasser', 'seche-cheveux', 'seche cheveux', 'ventilateur', 'climatiseur', 'radiateur', 'plaque de cuisson', 'hotte', 'robot', 'machine a cafe', 'seche-linge', 'televiseur', 'television', 'tv', 'blender', 'mixeur', 'friteuse', 'air fryer', 'centrale vapeur']],
  ['Éclairage', ['lampe', 'lampadaire', 'suspension', 'applique', 'ampoule', 'plafonnier', 'spot', 'guirlande lumineuse', 'abat-jour', 'luminaire', 'lustre', 'veilleuse', 'led']],
  ['Robinetterie et sanitaires', ['robinet', 'mitigeur', 'douche', 'douchette', 'pommeau', 'lavabo', 'vasque', 'wc', 'toilette', 'abattant', 'siphon', 'receveur', 'paroi', 'colonne de douche', 'evier', 'bonde']],
  ['Linge de lit', ['drap', 'housse de couette', 'couette', 'oreiller', 'taie', 'alese', 'protege-matelas', 'protege matelas', 'couvre-lit', 'traversin', 'parure', 'couverture', 'surmatelas']],
  ['Linge de bain', ['serviette', 'drap de bain', 'peignoir', 'tapis de bain', 'gant de toilette', 'linge de bain']],
  ['Ustensiles de cuisine', ['poele', 'casserole', 'cocotte', 'spatule', 'louche', 'fouet', 'passoire', 'planche a decouper', 'ouvre-boite', 'tire-bouchon', 'econome', 'rape', 'moule', 'faitout', 'wok', 'couteau de cuisine', 'minuteur', 'balance de cuisine', 'ustensile', 'egouttoir', 'presse-agrume']],
  ['Vaisselle', ['assiette', 'verre', 'tasse', 'mug', 'bol', 'couvert', 'fourchette', 'couteau', 'cuillere', 'plat', 'saladier', 'carafe', 'service', 'theiere', 'ramequin', 'plateau', 'coupelle', 'flute', 'vaisselle']],
  ['Décoration', ['cadre', 'tableau', 'miroir', 'vase', 'coussin', 'plaid', 'rideau', 'voilage', 'tapis', 'bougie', 'affiche', 'plante', 'horloge', 'deco', 'statue', 'photophore', 'panier', 'sticker', 'guirlande', 'cache-pot', 'cache pot', 'tringle']],
  ['Mobilier', ['canape', 'fauteuil', 'chaise', 'table', 'lit', 'matelas', 'sommier', 'commode', 'armoire', 'etagere', 'bureau', 'bibliotheque', 'buffet', 'meuble', 'tabouret', 'banc', 'console', 'chevet', 'tete de lit', 'penderie', 'porte-manteau', 'vitrine', 'banquette', 'pouf', 'cadre de lit', 'dressing', 'bout de canape', 'clic-clac', 'convertible']],
  ['Équipements divers', ['poubelle', 'etendoir', 'cintre', 'balai', 'seau', 'verrou', 'detecteur', 'extincteur', 'boite a cles', 'serrure', 'valise', 'panier a linge', 'rangement', 'escabeau', 'tapis de sol', 'moustiquaire']],
];
function guessCat(name) {
  const n = ' ' + norm(name) + ' ';
  let best = null, bestScore = 0;
  for (const [label, words] of CAT_RULES) {
    let sc = 0;
    for (const w of words) if (new RegExp('[^a-z0-9]' + w.replace(/[-\s]/g, '[- ]') + 's?(?![a-z0-9])').test(n)) sc++;
    if (sc > bestScore) { best = label; bestScore = sc; }
  }
  if (!best) return '';
  const c = cats.find(x => norm(x.name) === norm(best));
  return c ? c.id : '';
}

async function relayGet(path, asBlob) {
  const base = relayUrl();
  if (!base) throw new Error('no-relay');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 25000);
  try {
    const r = await fetch(base + '/' + path, { signal: ctrl.signal });
    if (asBlob) { if (!r.ok) throw new Error('no-image'); return await r.blob(); }
    return await r.json();
  } finally { clearTimeout(timer); }
}

/* ---------- sélecteur de photos (inventaire et liste d'envie) ---------- */
function photoPickerHtml(pre) {
  return `<div class="photos" id="${pre}-ph"></div>
      <p class="hint">Touchez une photo pour en faire la vignette (bordure colorée).</p>
      <div class="two pickrow">
        <label class="btn pick">Prendre une photo<input id="${pre}-cam" type="file" accept="image/*" capture="environment" hidden></label>
        <label class="btn pick">Choisir dans la galerie<input id="${pre}-files" type="file" accept="image/*" multiple hidden></label>
      </div>`;
}
function bindPhotoPicker(pre, d) {
  const phBox = $('#' + pre + '-ph', sheet);
  const draw = () => {
    phBox.innerHTML = d.photos.map((p, k) => `<div class="pt"><img src="${urlOf(p.thumb)}" data-k="${k}" alt="Photo ${k + 1}"><button type="button" data-rm="${k}" aria-label="Retirer la photo ${k + 1}">×</button></div>`).join('');
  };
  draw();
  phBox.onclick = e => {
    const rm = e.target.closest('[data-rm]');
    if (rm) { d.photos.splice(+rm.dataset.rm, 1); draw(); return; }
    const im = e.target.closest('img');
    if (im) { const k = +im.dataset.k; d.photos.unshift(d.photos.splice(k, 1)[0]); draw(); }
  };
  const addFiles = async e => {
    const files = [...e.target.files];
    if (!files.length) return;
    toast('Traitement des photos…');
    for (const f of files) {
      try { d.photos.push(await makePhoto(f)); draw(); }
      catch (err) { toast('Une photo n’a pas pu être lue.'); }
    }
    e.target.value = '';
  };
  $('#' + pre + '-files', sheet).onchange = addFiles;
  $('#' + pre + '-cam', sheet).onchange = addFiles;
  return draw;
}

function bindCatSelect(sel, value) {
  const draw = v => {
    sel.innerHTML = cats.map(c => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('') + '<option value="__new">+ Nouvelle catégorie…</option>';
    sel.value = cats.some(c => c.id === v) ? v : (cats[0] ? cats[0].id : '__new');
  };
  draw(value);
  let last = sel.value;
  sel.onchange = async () => {
    if (sel.value !== '__new') { last = sel.value; return; }
    const name = (prompt('Nom de la nouvelle catégorie') || '').trim();
    if (!name) { sel.value = last; return; }
    const c = { id: uid(), name, order: cats.length };
    await put('categories', c); await loadAll();
    draw(c.id); last = c.id;
  };
}

// Repli quand la page ne peut pas être lue : on déduit ce qu'on peut du lien et du titre du partage
const STORE_NAMES = {
  'leroymerlin.fr': 'Leroy Merlin', 'castorama.fr': 'Castorama', 'bricodepot.fr': 'Brico Dépôt', 'bricomarche.com': 'Bricomarché',
  'mr-bricolage.fr': 'Mr Bricolage', 'bricoman.fr': 'Bricoman', 'amazon.fr': 'Amazon', 'amazon.com': 'Amazon', 'amzn.eu': 'Amazon',
  'amzn.to': 'Amazon', 'a.co': 'Amazon', 'manomano.fr': 'ManoMano', 'cdiscount.com': 'Cdiscount', 'ikea.com': 'Ikea',
  'maisonsdumonde.com': 'Maisons du Monde', 'conforama.fr': 'Conforama', 'but.fr': 'But', 'darty.com': 'Darty',
  'boulanger.com': 'Boulanger', 'fnac.com': 'Fnac', 'lapeyre.fr': 'Lapeyre', 'point-p.fr': 'Point.P', 'lidl.fr': 'Lidl',
  'action.com': 'Action', 'gifi.fr': 'Gifi', 'leclercbricolage.fr': 'E.Leclerc', 'toolstation.fr': 'Toolstation', 'ubaldi.com': 'Ubaldi',
};
function storeFromUrl(link) {
  try {
    const h = new URL(link).hostname.replace(/^www\./, '').toLowerCase();
    for (const k of Object.keys(STORE_NAMES)) if (h === k || h.endsWith('.' + k)) return STORE_NAMES[k];
    const base = h.split('.').slice(-2, -1)[0] || '';
    return base ? base.charAt(0).toUpperCase() + base.slice(1) : '';
  } catch (e) { return ''; }
}
function nameFromUrl(link) {
  let u;
  try { u = new URL(link); } catch (e) { return ''; }
  const segs = u.pathname.split('/').map(s => { try { return decodeURIComponent(s); } catch (e) { return s; } }).filter(Boolean);
  const SKIP = /^(dp|gp|product|produit|produits|p|ref|prd|pd|article|item|fr|html|detail|pdp)$/i;
  let best = '', bestN = 0;
  for (const seg of segs) {
    const words = seg.replace(/\.(html?|php|aspx?|prd)$/i, '').split(/[-_+\s]+/)
      .filter(w => w && !/^\d{5,}$/.test(w) && !(/\d/.test(w) && /[a-z]/i.test(w) && w.length >= 8) && !SKIP.test(w));
    const alpha = words.filter(w => /[a-zà-ÿ]{3,}/i.test(w)).length;
    if (alpha >= 2 && alpha > bestN) { best = words.join(' '); bestN = alpha; }
  }
  return best ? best.charAt(0).toUpperCase() + best.slice(1) : '';
}
// titre transmis par le menu « Partager » (Chrome : titre de la page ; applis de magasin : texte d'accroche)
function shareTitle(title, text) {
  const strip = s => String(s || '').replace(/https?:\/\/\S+/gi, ' ').replace(/\s+/g, ' ').trim();
  let t = strip(title);
  if (t.length < 4) t = strip(text).replace(/^(découvrez|decouvrez|regardez ça|regarde ça|regardez|regarde|check out|jetez un œil à|voici)\s*:?\s*/i, '');
  t = t.replace(/\s*[:|–—-]\s*$/, '').replace(/\s+sur\s+[\w.\-]+$/i, '').replace(/^amazon(\.fr)?\s*[:|–—-]\s*/i, '');
  t = t.replace(/\s*[|–—-]\s*(leroy merlin|castorama|brico d[ée]p[oô]t|bricomarch[ée]|ikea|amazon[\w.]*|manomano|cdiscount|conforama|but|darty|maisons du monde)\s*$/i, '');
  if (/^[\w.-]+\.(fr|com|eu|net)$/i.test(t)) return '';
  return t.length >= 4 && t.length <= 200 ? t : '';
}

// Branche le bouton « Remplir automatiquement » d'un formulaire ; hint = titre reçu par « Partager »
function bindAutofill(pre, sel, photos, hint) {
  const g = id => $('#' + pre + '-' + id, sheet);
  const urlEl = g('url'), btn = g('auto'), msg = g('automsg');
  let busy = false;
  const setIf = (id, v) => { const el = g(id); if (el && v && !el.value.trim()) { el.value = v; return true; } return false; };
  const applyStore = name => {
    const st = g('store');
    if (!st || !name) return false;
    if (!st.value.trim()) { st.value = name; return true; }
    return false;
  };
  const applyCat = name => {
    const gc = guessCat(name);
    if (!gc) return false;
    sel.value = gc; sel.dispatchEvent(new Event('change'));
    return true;
  };
  // repli : nom (titre du partage ou adresse), magasin et catégorie, sans lire la page
  const fallback = link => {
    const got = [];
    const nameWasEmpty = !g('name').value.trim();
    const guess = hint || nameFromUrl(link);
    if (setIf('name', guess)) got.push('nom');
    if (applyStore(storeFromUrl(link))) got.push('magasin');
    if (nameWasEmpty && got.includes('nom') && applyCat(guess)) got.push('catégorie');
    return got;
  };
  const run = async () => {
    if (busy) return;
    const link = firstLink(urlEl.value);
    if (!link) { toast('Collez d’abord le lien de l’article.'); urlEl.focus(); return; }
    busy = true; btn.disabled = true;
    try {
      let p = null, err = '';
      if (relayUrl()) {
        msg.textContent = 'Lecture de la page en cours…';
        try {
          p = await relayGet('?url=' + encodeURIComponent(link));
          if (!p || !p.ok) { err = (p && p.error) || 'fail'; p = null; }
        } catch (e) { err = 'network'; }
      } else err = 'no-relay';
      if (!p) {
        const why = err === 'no-relay' ? 'Le relais n’est pas réglé (Réglages > Remplissage automatique).'
          : err === 'blocked' ? 'Ce site refuse la lecture automatique.'
          : err === 'empty' ? 'Aucune information lisible sur cette page.'
          : err === 'network' ? 'Le relais ne répond pas.'
          : 'La page n’a pas pu être lue.';
        const got = fallback(link);
        msg.textContent = got.length ? `${why} J’ai rempli d’après le lien : ${got.join(', ')}. Complétez le prix et la photo.` : `${why} Remplissez à la main : le lien est conservé.`;
        return;
      }
      urlEl.value = p.finalUrl || link;
      const got = [];
      const nameWasEmpty = !g('name').value.trim();
      const name = p.name || hint || nameFromUrl(link);
      if (setIf('name', name)) got.push('nom');
      if (p.price != null && setIf('price', p.price.toFixed(2).replace('.', ','))) got.push('prix');
      if (g('desc') && setIf('desc', p.description)) got.push('descriptif');
      if (setIf('notes', [p.brand && 'Marque : ' + p.brand, p.sku && 'Réf. : ' + p.sku].filter(Boolean).join(' – '))) got.push('référence');
      if (applyStore(p.store || storeFromUrl(link))) got.push('magasin');
      if (nameWasEmpty && got.includes('nom') && applyCat(name)) got.push('catégorie');
      let photoMsg = '';
      if (photos && p.image && photos.count() === 0) {
        try {
          const blob = await relayGet('?img=' + encodeURIComponent(p.image) + '&ref=' + encodeURIComponent(link), true);
          await photos.add(await makePhoto(blob));
          got.push('photo');
        } catch (e) { photoMsg = ' La photo n’a pas pu être récupérée.'; }
      }
      msg.textContent = (got.length ? 'Rempli : ' + got.join(', ') + '. Vérifiez puis enregistrez.' : 'Les champs étaient déjà remplis, rien n’a été changé.') + photoMsg;
    } finally { busy = false; btn.disabled = false; }
  };
  btn.onclick = run;
  urlEl.addEventListener('paste', () => setTimeout(() => { if (firstLink(urlEl.value)) run(); }, 80));
  return run;
}

/* ---------- formulaire article ---------- */
function openForm(item, asCopy = false, opts = {}) {
  const isNew = !item || asCopy || !!opts.fresh;
  const d = item
    ? { ...item, photos: [...(item.photos || [])] }
    : { id: uid(), name: '', cat: (state.cat !== 'all' && state.cat !== 'none') ? state.cat : (cats[0] && cats[0].id) || '', qty: 1, price: null, date: today(), roomIds: (state.room !== 'all' && state.room !== 'none') ? [state.room] : [], store: '', url: opts.link || '', description: '', location: '', notes: '', photos: [] };
  d.roomIds = roomsOf(d); delete d.room;
  if (asCopy) { d.id = uid(); d.name = d.name + ' (copie)'; delete d.created; }

  openSheet(`
    <header class="sh-head"><button class="icon" data-close aria-label="Annuler">${ICON.back}</button><h2>${isNew ? 'Nouvel article' : 'Modifier l’article'}</h2></header>
    <div class="sh-body form">
      ${photoPickerHtml('f')}
      <label>Nom de l’article<input id="f-name" class="field" autocomplete="off" value="${esc(d.name)}"></label>
      <label>Catégorie<select id="f-cat"></select></label>
      <div class="lbl">Pièces où se trouve cet article</div>
      <details class="multi" id="f-rooms"><summary></summary><div class="multi-panel"></div></details>
      <div class="two">
        <label>Quantité<input id="f-qty" class="field" type="number" min="1" inputmode="numeric" value="${d.qty || 1}"></label>
        <label>Prix d’achat par unité (€)<input id="f-price" class="field" inputmode="decimal" value="${d.price != null ? String(d.price).replace('.', ',') : ''}"></label>
      </div>
      <label>Date d’achat<input id="f-date" class="field" type="date" value="${esc(d.date || '')}"></label>
      <label>Lieu d’achat<input id="f-store" class="field" placeholder="Ikea Nice, Leroy Merlin, Amazon…" value="${esc(d.store)}"></label>
      <label>Lien vers l’article<input id="f-url" class="field" inputmode="url" autocapitalize="off" placeholder="https://" value="${esc(d.url)}"></label>
      <button type="button" class="btn wide" id="f-auto">Remplir automatiquement depuis ce lien</button>
      <p class="hint" id="f-automsg" role="status" aria-live="polite"></p>
      <label>Emplacement précis (facultatif)<input id="f-loc" class="field" placeholder="Placard de gauche, tiroir du haut…" value="${esc(d.location)}"></label>
      <label>Descriptif du commerçant<textarea id="f-desc" rows="5">${esc(d.description)}</textarea></label>
      <label>Notes personnelles (référence, dimensions, couleur)<textarea id="f-notes" rows="3">${esc(d.notes)}</textarea></label>
    </div>
    <footer class="sh-foot"><button class="btn" data-close>Annuler</button><button class="btn primary" id="f-save">Enregistrer</button></footer>`);

  const sel = $('#f-cat', sheet);
  const drawCats = value => {
    sel.innerHTML = cats.map(c => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('') + '<option value="__new">+ Nouvelle catégorie…</option>';
    sel.value = cats.some(c => c.id === value) ? value : (cats[0] ? cats[0].id : '__new');
  };
  drawCats(d.cat);
  let lastCat = sel.value;
  sel.onchange = async () => {
    if (sel.value !== '__new') { lastCat = sel.value; return; }
    const name = (prompt('Nom de la nouvelle catégorie') || '').trim();
    if (!name) { sel.value = lastCat; return; }
    const c = { id: uid(), name, order: cats.length };
    await put('categories', c); await loadAll();
    drawCats(c.id); lastCat = c.id;
  };

  const getRooms = bindRoomChecks($('#f-rooms', sheet), d.roomIds);

  const drawPhotos = bindPhotoPicker('f', d);
  const runAuto = bindAutofill('f', sel, { count: () => d.photos.length, add: async p => { d.photos.push(p); drawPhotos(); } }, opts.title);
  if (opts.auto && d.url) runAuto();

  $('#f-save', sheet).onclick = async () => {
    const name = $('#f-name', sheet).value.trim();
    if (!name) { toast('Indiquez le nom de l’article.'); $('#f-name', sheet).focus(); return; }
    const pr = parseFloat(String($('#f-price', sheet).value).replace(/\s/g, '').replace(',', '.'));
    d.name = name;
    d.cat = sel.value === '__new' ? '' : sel.value;
    d.roomIds = getRooms();
    delete d.room;
    d.qty = Math.max(1, parseInt($('#f-qty', sheet).value, 10) || 1);
    d.price = isNaN(pr) ? null : pr;
    d.date = $('#f-date', sheet).value;
    d.store = $('#f-store', sheet).value.trim();
    d.url = fixUrl($('#f-url', sheet).value);
    d.location = $('#f-loc', sheet).value.trim();
    d.description = $('#f-desc', sheet).value.trim();
    d.notes = $('#f-notes', sheet).value.trim();
    d.updated = Date.now();
    if (isNew) d.created = Date.now();
    try { await put('items', d); }
    catch (err) { toast('Enregistrement impossible : espace de stockage plein ?'); return; }
    if (opts.fromWish) await del('wishes', opts.fromWish);
    await loadAll();
    refreshCurrent();
    openDetail(d.id);
    toast(opts.fromWish ? 'Ajouté à l’inventaire.' : 'Article enregistré.');
  };
}

/* ---------- pièces ---------- */
function bindRoomChecks(box, selected) {
  const sel = new Set(selected || []);
  const sum = box.querySelector('summary'), panel = box.querySelector('.multi-panel');
  const label = () => {
    const n = rooms.filter(r => sel.has(r.id)).map(r => r.name);
    sum.textContent = n.length ? n.join(', ') : 'Choisir une ou plusieurs pièces';
  };
  const draw = () => {
    panel.innerHTML = (rooms.map(r => `<label class="opt"><input type="checkbox" value="${esc(r.id)}"${sel.has(r.id) ? ' checked' : ''}><span>${esc(r.name)}</span></label>`).join('') || '<p class="hint">Aucune pièce : ajoutez-en une.</p>')
      + '<button type="button" class="link" data-newroom>+ Nouvelle pièce</button>';
    label();
  };
  draw();
  panel.onchange = e => {
    if (!e.target.matches('input[type=checkbox]')) return;
    if (e.target.checked) sel.add(e.target.value); else sel.delete(e.target.value);
    label();
  };
  panel.onclick = async e => {
    if (!e.target.closest('[data-newroom]')) return;
    const name = (prompt('Nom de la nouvelle pièce') || '').trim();
    if (!name) return;
    const r = { id: uid(), name, order: rooms.length };
    await put('rooms', r); await loadAll();
    sel.add(r.id); draw();
  };
  return () => rooms.map(r => r.id).filter(id => sel.has(id));
}

function openRooms() {
  const draw = () => {
    $('#room-list', sheet).innerHTML = rooms.map(r => {
      const n = items.filter(i => roomsOf(i).includes(r.id)).length;
      return `<div class="catrow"><span class="body"><strong>${esc(r.name)}</strong><span class="meta">${n} article${n > 1 ? 's' : ''}</span></span>
        <button class="icon" data-ren="${r.id}" aria-label="Renommer ${esc(r.name)}">${ICON.edit}</button>
        <button class="icon" data-del="${r.id}" aria-label="Supprimer ${esc(r.name)}">${ICON.trash}</button></div>`;
    }).join('') || '<p class="empty">Aucune pièce.</p>';
  };
  openSheet(`
    <header class="sh-head"><button class="icon" data-close aria-label="Fermer">${ICON.back}</button><h2>Pièces</h2></header>
    <div class="sh-body">
      <div class="addcat"><input id="rn" class="field" placeholder="Nouvelle pièce (ex. Cellier, Buanderie)" autocomplete="off"><button class="btn primary" id="rn-add">Ajouter</button></div>
      <div id="room-list"></div>
    </div>`);
  draw();
  const add = async () => {
    const name = $('#rn', sheet).value.trim();
    if (!name) return;
    await put('rooms', { id: uid(), name, order: rooms.length });
    await loadAll(); $('#rn', sheet).value = ''; draw();
  };
  $('#rn-add', sheet).onclick = add;
  $('#rn', sheet).onkeydown = e => { if (e.key === 'Enter') add(); };
  $('#room-list', sheet).onclick = async e => {
    const re = e.target.closest('[data-ren]'), x = e.target.closest('[data-del]');
    if (re) {
      const r = rooms.find(r => r.id === re.dataset.ren);
      const name = (prompt('Nouveau nom de la pièce', r.name) || '').trim();
      if (name) { await put('rooms', { ...r, name }); await loadAll(); draw(); }
    } else if (x) {
      const r = rooms.find(r => r.id === x.dataset.del);
      const n = items.filter(i => roomsOf(i).includes(r.id)).length;
      if (!confirm(n ? `Supprimer « ${r.name} » ? Ses ${n} article(s) passeront en « Sans pièce ».` : `Supprimer « ${r.name} » ?`)) return;
      for (const i of items.filter(i => roomsOf(i).includes(r.id))) await put('items', { ...i, roomIds: roomsOf(i).filter(id => id !== r.id), updated: Date.now() });
      await del('rooms', r.id); await loadAll(); draw();
    }
  };
}

/* ---------- catégories ---------- */
function openCats() {
  const draw = () => {
    $('#cat-list', sheet).innerHTML = cats.map(c => {
      const n = items.filter(i => i.cat === c.id).length;
      return `<div class="catrow"><span class="body"><strong>${esc(c.name)}</strong><span class="meta">${n} article${n > 1 ? 's' : ''}</span></span>
        <button class="icon" data-ren="${c.id}" aria-label="Renommer ${esc(c.name)}">${ICON.edit}</button>
        <button class="icon" data-del="${c.id}" aria-label="Supprimer ${esc(c.name)}">${ICON.trash}</button></div>`;
    }).join('') || '<p class="empty">Aucune catégorie.</p>';
  };
  openSheet(`
    <header class="sh-head"><button class="icon" data-close aria-label="Fermer">${ICON.back}</button><h2>Catégories</h2></header>
    <div class="sh-body">
      <div class="addcat"><input id="nc" class="field" placeholder="Nouvelle catégorie (ex. Jardin, Jeux)" autocomplete="off"><button class="btn primary" id="nc-add">Ajouter</button></div>
      <div id="cat-list"></div>
    </div>`);
  draw();
  const add = async () => {
    const name = $('#nc', sheet).value.trim();
    if (!name) return;
    await put('categories', { id: uid(), name, order: cats.length });
    await loadAll(); $('#nc', sheet).value = ''; draw();
  };
  $('#nc-add', sheet).onclick = add;
  $('#nc', sheet).onkeydown = e => { if (e.key === 'Enter') add(); };
  $('#cat-list', sheet).onclick = async e => {
    const r = e.target.closest('[data-ren]'), x = e.target.closest('[data-del]');
    if (r) {
      const c = cats.find(c => c.id === r.dataset.ren);
      const name = (prompt('Nouveau nom de la catégorie', c.name) || '').trim();
      if (name) { await put('categories', { ...c, name }); await loadAll(); draw(); }
    } else if (x) {
      const c = cats.find(c => c.id === x.dataset.del);
      const n = items.filter(i => i.cat === c.id).length;
      if (!confirm(n ? `Supprimer « ${c.name} » ? Ses ${n} article(s) passeront en « Sans catégorie ».` : `Supprimer « ${c.name} » ?`)) return;
      for (const i of items.filter(i => i.cat === c.id)) await put('items', { ...i, cat: '', updated: Date.now() });
      await del('categories', c.id); await loadAll(); draw();
    }
  };
}

/* ---------- liste d'envie ---------- */
const catRank = id => { const k = cats.findIndex(c => c.id === id); return k < 0 ? 999 : k; };
const wishSorted = () => [...wishes].sort((a, b) => catRank(a.cat) - catRank(b.cat) || a.name.localeCompare(b.name, 'fr'));
const wishTotal = list => list.reduce((s, x) => s + (x.price || 0) * (x.qty || 1), 0);

const wishRow = w => `<li class="srow${w.done ? ' done' : ''}" data-id="${w.id}">
  <button class="tick" data-tick aria-pressed="${!!w.done}" aria-label="${w.done ? 'Remettre à acheter' : 'Marquer comme acheté'} : ${esc(w.name)}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5 10 17.5 19 7"/></svg></button>
  ${(w.photos || [])[0] ? `<img class="thumb" src="${urlOf(w.photos[0].thumb)}" alt="" loading="lazy">` : ''}
  <button class="body sbody" data-open><strong>${esc(w.name)}</strong><span class="meta">${esc([w.store, roomNames(w), w.notes].filter(Boolean).join(', '))}</span></button>
  <span class="right"><span class="qty">× ${w.qty || 1}</span><span class="price">${w.price != null ? eur(w.price * (w.qty || 1)) : ''}</span></span>
  ${w.done ? '<button class="btn small" data-inv>À l’inventaire</button>' : ''}</li>`;

function renderWishlist() {
  view.innerHTML = `
    <div class="searchbar"><input id="wq" type="search" enterkeyhint="search" autocomplete="off" aria-label="Rechercher dans la liste d’envie" placeholder="Rechercher dans la liste d’envie…" value="${esc(state.wq)}"></div>
    <p class="summary" id="wsum"></p>
    <div class="shopbar"><button class="btn" id="wcopy">Copier la liste</button>${navigator.share ? '<button class="btn" id="wshare">Partager</button>' : ''}</div>
    <ul class="list" id="wlist"></ul>
    <button class="fab" id="wadd">${ICON.plus}<span>Ajouter</span></button>`;
  $('#wq').addEventListener('input', e => { state.wq = e.target.value; refreshWish(); });
  $('#wadd').onclick = () => openWishForm();
  $('#wcopy').onclick = async () => {
    if (!wishes.some(w => !w.done)) return toast('Rien à acheter pour l’instant.');
    try { await navigator.clipboard.writeText(wishText()); toast('Liste copiée.'); } catch (e) { toast('Copie impossible sur cet appareil.'); }
  };
  const sh = $('#wshare');
  if (sh) sh.onclick = () => { if (!wishes.some(w => !w.done)) return toast('Rien à acheter pour l’instant.'); navigator.share({ title: 'Liste d’envie', text: wishText() }).catch(() => {}); };
  $('#wlist').onclick = async e => {
    const li = e.target.closest('[data-id]');
    if (!li) return;
    const w = wishes.find(x => x.id === li.dataset.id);
    if (!w) return;
    if (e.target.closest('[data-tick]')) {
      w.done = !w.done;
      await put('wishes', w); await loadAll(); refreshWish();
    } else if (e.target.closest('[data-inv]')) wishToInventory(w);
    else openWishForm(w);
  };
  refreshWish();
}

function refreshWish() {
  const t = norm(state.wq).split(/\s+/).filter(Boolean);
  const all = wishSorted().filter(w => { const h = norm([w.name, w.description, w.notes, w.store, w.url, catName(w.cat), roomNames(w)].join(' ')); return t.every(x => h.includes(x)); });
  const todo = all.filter(w => !w.done), bought = all.filter(w => w.done);
  $('#wsum').textContent = wishes.length ? `${todo.length} à acheter, estimation ${eur(wishTotal(todo))}${bought.length ? `, ${bought.length} déjà acheté${bought.length > 1 ? 's' : ''}` : ''}` : '';
  if (!wishes.length) { $('#wlist').innerHTML = '<li class="empty">Votre liste d’envie est vide.<br>Touchez « Ajouter » pour noter un article que vous aimeriez acheter.</li>'; return; }
  if (!all.length) { $('#wlist').innerHTML = `<li class="empty">Aucun résultat pour « ${esc(state.wq)} ».</li>`; return; }
  let h = '', last = null;
  for (const w of todo) {
    const cn = catName(w.cat);
    if (cn !== last) { h += `<li class="grp">${esc(cn)}</li>`; last = cn; }
    h += wishRow(w);
  }
  if (bought.length) h += '<li class="grp">Déjà achetés</li>' + bought.map(wishRow).join('');
  $('#wlist').innerHTML = h;
}

function wishText() {
  const todo = wishSorted().filter(w => !w.done);
  const lines = [`Liste d’envie du ${fmtDate(Date.now())}`];
  let last = null;
  for (const w of todo) {
    const cn = catName(w.cat);
    if (cn !== last) { lines.push('', cn.toUpperCase()); last = cn; }
    lines.push(`- ${w.name} × ${w.qty || 1}${w.price != null ? ' (environ ' + eur(w.price * (w.qty || 1)) + ')' : ''}${roomNames(w) ? ', ' + roomNames(w) : ''}${w.store ? ', ' + w.store : ''}${w.url ? ', ' + w.url : ''}`);
  }
  lines.push('', `Total estimé : ${eur(wishTotal(todo))}`);
  return lines.join('\n');
}

function wishToInventory(w) {
  openForm({ id: uid(), name: w.name, cat: w.cat, qty: w.qty || 1, price: w.price, date: today(), roomIds: roomsOf(w), store: w.store, url: w.url, description: w.description || '', location: '', notes: w.notes || '', photos: [...(w.photos || [])] }, false, { fromWish: w.id, fresh: true });
}

function openWishForm(w, opts = {}) {
  const isNew = !w;
  const d = w
    ? { ...w, photos: [...(w.photos || [])], roomIds: roomsOf(w) }
    : { id: uid(), name: '', cat: cats[0] ? cats[0].id : '', qty: 1, price: null, store: '', url: opts.link || '', description: '', notes: '', roomIds: [], done: false, photos: [] };
  delete d.room;
  openSheet(`
    <header class="sh-head"><button class="icon" data-close aria-label="Annuler">${ICON.back}</button><h2>${isNew ? 'Nouvelle envie' : 'Modifier l’envie'}</h2></header>
    <div class="sh-body form">
      ${photoPickerHtml('w')}
      <label>Nom de l’article<input id="w-name" class="field" autocomplete="off" value="${esc(d.name)}"></label>
      <label>Catégorie<select id="w-cat"></select></label>
      <div class="lbl">Pièces où il irait</div>
      <details class="multi" id="w-rooms"><summary></summary><div class="multi-panel"></div></details>
      <div class="two">
        <label>Quantité<input id="w-qty" class="field" type="number" min="1" inputmode="numeric" value="${d.qty || 1}"></label>
        <label>Prix estimé par unité (€)<input id="w-price" class="field" inputmode="decimal" value="${d.price != null ? String(d.price).replace('.', ',') : ''}"></label>
      </div>
      <label>Où l’acheter<input id="w-store" class="field" placeholder="Ikea Nice, Maisons du Monde, Amazon…" value="${esc(d.store)}"></label>
      <label>Lien vers l’article<input id="w-url" class="field" inputmode="url" autocapitalize="off" placeholder="https://" value="${esc(d.url)}"></label>
      <button type="button" class="btn wide" id="w-auto">Remplir automatiquement depuis ce lien</button>
      <p class="hint" id="w-automsg" role="status" aria-live="polite"></p>
      <label>Descriptif du commerçant<textarea id="w-desc" rows="4">${esc(d.description || '')}</textarea></label>
      <label>Notes (référence, dimensions, couleur, pourquoi)<textarea id="w-notes" rows="3">${esc(d.notes)}</textarea></label>
      ${d.url ? `<a class="btn wide" href="${esc(d.url)}" target="_blank" rel="noopener noreferrer">Ouvrir la fiche en ligne</a>` : ''}
      ${isNew ? '' : '<button class="btn wide" id="w-inv">Acheté : l’ajouter à l’inventaire</button><button class="btn wide danger" id="w-del">Supprimer de la liste</button>'}
    </div>
    <footer class="sh-foot"><button class="btn" data-close>Annuler</button><button class="btn primary" id="w-save">Enregistrer</button></footer>`);
  const sel = $('#w-cat', sheet);
  bindCatSelect(sel, d.cat);
  const getRooms = bindRoomChecks($('#w-rooms', sheet), d.roomIds);
  const drawWishPhotos = bindPhotoPicker('w', d);
  const runAutoW = bindAutofill('w', sel, { count: () => d.photos.length, add: async p => { d.photos.push(p); drawWishPhotos(); } }, opts.title);
  if (opts.auto && d.url) runAutoW();
  const collect = () => {
    const name = $('#w-name', sheet).value.trim();
    if (!name) { toast('Indiquez le nom de l’article.'); $('#w-name', sheet).focus(); return false; }
    const pr = parseFloat(String($('#w-price', sheet).value).replace(/\s/g, '').replace(',', '.'));
    d.name = name;
    d.cat = sel.value === '__new' ? '' : sel.value;
    d.roomIds = getRooms();
    d.qty = Math.max(1, parseInt($('#w-qty', sheet).value, 10) || 1);
    d.price = isNaN(pr) ? null : pr;
    d.store = $('#w-store', sheet).value.trim();
    d.url = fixUrl($('#w-url', sheet).value);
    d.description = $('#w-desc', sheet).value.trim();
    d.notes = $('#w-notes', sheet).value.trim();
    d.updated = Date.now();
    if (isNew && !d.created) d.created = Date.now();
    return true;
  };
  $('#w-save', sheet).onclick = async () => {
    if (!collect()) return;
    try { await put('wishes', d); }
    catch (err) { toast('Enregistrement impossible : espace de stockage plein ?'); return; }
    await loadAll();
    closeSheet();
    setTimeout(() => toast('Ajouté à la liste d’envie.'), 200);
  };
  const inv = $('#w-inv', sheet);
  if (inv) inv.onclick = () => { if (collect()) wishToInventory(d); };
  const rm = $('#w-del', sheet);
  if (rm) rm.onclick = async () => {
    if (!confirm(`Supprimer « ${d.name} » de la liste ?`)) return;
    await del('wishes', d.id); await loadAll(); closeSheet();
  };
}

/* ---------- contrôle de départ ---------- */
function renderControlTab() {
  const open = controls.find(c => c.status === 'en cours');
  const done = controls.filter(c => c.status === 'terminé').sort((a, b) => b.date - a.date);
  view.innerHTML = `<section class="pad">
    <h2>Contrôle de départ</h2>
    <p class="muted">Après chaque départ, parcourez les articles : le rapport liste ce qui manque, avec le prix et le lien pour le racheter.</p>
    ${open ? '<button class="btn primary wide" id="resume">Reprendre le contrôle en cours</button><button class="btn wide" id="discard">Abandonner ce contrôle</button>' : '<button class="btn primary wide" id="start">Nouveau contrôle</button>'}
    <h3>Historique</h3>
    ${done.length ? `<ul class="list hist" style="padding:0">${done.map(c => `<li><button data-rep="${c.id}"><span><strong>${fmtDate(c.date)}</strong><br><span class="meta">${esc(c.label || 'Sans libellé')}</span></span><span style="text-align:right">${c.missing.length ? `<span class="badge bad">${c.missing.length} manquant${c.missing.length > 1 ? 's' : ''}</span><br><span class="meta">${eur(c.missing.reduce((s, m) => s + (m.price || 0) * m.missing, 0))}</span>` : '<span class="badge ok">Complet</span>'}</span></button></li>`).join('')}</ul>` : '<p class="muted">Aucun contrôle enregistré.</p>'}
  </section>`;
  const s = $('#start');
  if (s) s.onclick = async () => {
    if (!items.length) { toast('Ajoutez d’abord des articles à l’inventaire.'); return; }
    const c = { id: uid(), date: Date.now(), label: '', status: 'en cours', found: {} };
    await put('controls', c); await loadAll(); openControl(c);
  };
  if (open) {
    $('#resume').onclick = () => openControl(open);
    $('#discard').onclick = async () => { if (confirm('Abandonner le contrôle en cours ?')) { await del('controls', open.id); await loadAll(); renderControlTab(); } };
  }
  const h = $('.hist');
  if (h) h.onclick = e => { const b = e.target.closest('[data-rep]'); if (b) openReport(controls.find(c => c.id === b.dataset.rep)); };
}

function openControl(ctrl) {
  const cf = { cat: 'all', q: '', room: 'all' };
  const status = i => { const f = ctrl.found[i.id]; return f === undefined ? 'todo' : (f >= (i.qty || 1) ? 'ok' : 'miss'); };
  const rowHtml = i => {
    const st = status(i), f = ctrl.found[i.id], q = i.qty || 1;
    let act;
    if (st === 'todo') act = '<div class="row"><button class="btn ok" data-a="ok">Présent</button><button class="btn bad" data-a="no">Manque</button></div>';
    else if (q > 1) act = `<div class="stepper"><button data-a="dec" aria-label="Moins">−</button><span>${f}/${q}</span><button data-a="inc" aria-label="Plus">+</button></div><button class="link" data-a="reset">Annuler</button>`;
    else act = `<span class="badge ${st === 'ok' ? 'ok' : 'bad'}">${st === 'ok' ? 'Présent' : 'Manque'}</span><button class="link" data-a="reset">Annuler</button>`;
    return `<li class="crow ${st}" data-id="${i.id}">${thumbHtml(i)}
      <div class="body"><strong>${esc(i.name)}</strong><span class="meta">${esc(metaOf(i))}</span>${q > 1 ? `<span class="meta">Attendu : ${q}</span>` : ''}</div>
      <div class="act">${act}</div></li>`;
  };
  const progress = () => {
    const n = items.filter(i => ctrl.found[i.id] !== undefined).length;
    const scope = items.filter(i => roomOk(i, cf.room));
    const nr = scope.filter(i => ctrl.found[i.id] !== undefined).length;
    $('#c-prog', sheet).textContent = cf.room === 'all'
      ? `${n} article${n > 1 ? 's' : ''} vérifié${n > 1 ? 's' : ''} sur ${items.length}`
      : `Dans cette pièce : ${nr} vérifié${nr > 1 ? 's' : ''} sur ${scope.length}. Au total : ${n} sur ${items.length}.`;
    $('#c-bar', sheet).style.width = (items.length ? n / items.length * 100 : 0) + '%';
  };
  const chips = () => {
    const pool = items.filter(i => roomOk(i, cf.room));
    const todo = pool.filter(i => status(i) === 'todo').length;
    let h = chip('all', 'Tout', pool.length, cf.cat === 'all') + chip('__todo', 'À vérifier', todo, cf.cat === '__todo');
    for (const c of cats) { const n = pool.filter(i => i.cat === c.id).length; if (n) h += chip(c.id, c.name, n, cf.cat === c.id); }
    $('#c-chips', sheet).innerHTML = h;
  };
  const list = () => {
    const t = norm(cf.q).split(/\s+/).filter(Boolean);
    const rows = items.filter(i => roomOk(i, cf.room) && (cf.cat === 'all' || (cf.cat === '__todo' ? status(i) === 'todo' : i.cat === cf.cat)) && t.every(x => hayOf(i).includes(x)));
    $('#c-list', sheet).innerHTML = rows.map(rowHtml).join('') || '<li class="empty">Rien à afficher.</li>';
  };

  openSheet(`
    <header class="sh-head"><button class="icon" data-close aria-label="Fermer (le contrôle est sauvegardé)">${ICON.back}</button><h2>Contrôle de départ</h2></header>
    <div class="sh-body">
      <input id="c-label" class="field" placeholder="Réservation ou nom du locataire (facultatif)" value="${esc(ctrl.label || '')}">
      <div class="progress" style="margin-top:12px"><div id="c-bar"></div></div>
      <p id="c-prog" class="muted" style="margin-top:0"></p>
      <select id="c-room" class="field" aria-label="Filtrer par pièce"></select>
      <input id="c-q" type="search" class="field" placeholder="Filtrer les articles" autocomplete="off" style="margin-top:8px">
      <div class="chips" id="c-chips" style="padding-left:0;padding-right:0"></div>
      <ul class="list" id="c-list" style="padding:0"></ul>
    </div>
    <footer class="sh-foot"><button class="btn primary wide" id="c-end">Terminer et voir le rapport</button></footer>`);
  const fillRoom = () => {
    const sel = $('#c-room', sheet);
    const done = list => list.filter(i => ctrl.found[i.id] !== undefined).length;
    const orphan = items.filter(i => !validRooms(i).length);
    sel.innerHTML = `<option value="all">Toutes les pièces (${done(items)}/${items.length})</option>` +
      rooms.map(r => { const l = items.filter(i => roomsOf(i).includes(r.id)); return `<option value="${esc(r.id)}">${esc(r.name)} (${done(l)}/${l.length})</option>`; }).join('') +
      (orphan.length ? `<option value="none">Sans pièce (${done(orphan)}/${orphan.length})</option>` : '');
    sel.value = cf.room;
  };
  chips(); list(); progress(); fillRoom();
  $('#c-room', sheet).onchange = e => { cf.room = e.target.value; chips(); list(); progress(); };

  $('#c-label', sheet).oninput = e => { ctrl.label = e.target.value; put('controls', ctrl); };
  $('#c-q', sheet).oninput = e => { cf.q = e.target.value; list(); };
  $('#c-chips', sheet).onclick = e => { const b = e.target.closest('[data-cat]'); if (b) { cf.cat = b.dataset.cat; chips(); list(); } };
  $('#c-list', sheet).onclick = async e => {
    const b = e.target.closest('[data-a]');
    if (!b) return;
    const li = b.closest('[data-id]');
    const i = items.find(x => x.id === li.dataset.id);
    const q = i.qty || 1, f = ctrl.found[i.id];
    switch (b.dataset.a) {
      case 'ok': ctrl.found[i.id] = q; break;
      case 'no': ctrl.found[i.id] = 0; break;
      case 'inc': ctrl.found[i.id] = Math.min(q, (f || 0) + 1); break;
      case 'dec': ctrl.found[i.id] = Math.max(0, (f || 0) - 1); break;
      case 'reset': delete ctrl.found[i.id]; break;
    }
    li.outerHTML = rowHtml(i);
    progress(); chips(); fillRoom();
    await put('controls', ctrl);
  };
  $('#c-end', sheet).onclick = async () => {
    const unchecked = items.filter(i => ctrl.found[i.id] === undefined);
    if (unchecked.length && !confirm(`${unchecked.length} article(s) pas encore vérifié(s). Terminer quand même ?`)) return;
    ctrl.status = 'terminé';
    ctrl.finished = Date.now();
    ctrl.total = items.length;
    ctrl.missing = items.filter(i => ctrl.found[i.id] !== undefined && ctrl.found[i.id] < (i.qty || 1))
      .map(i => ({ id: i.id, name: i.name, cat: catName(i.cat), room: roomNames(i), location: i.location, qty: i.qty || 1, missing: (i.qty || 1) - ctrl.found[i.id], price: i.price, store: i.store, url: i.url }));
    ctrl.unchecked = unchecked.map(i => ({ name: i.name, qty: i.qty || 1 }));
    await put('controls', ctrl); await loadAll();
    openReport(ctrl);
  };
}

function reportText(c) {
  const lines = [`Contrôle du ${fmtDate(c.date)}${c.label ? ' : ' + c.label : ''}`];
  if (!c.missing.length) lines.push('Tous les articles vérifiés sont présents.');
  else {
    lines.push(`Articles manquants (${c.missing.length}) :`);
    for (const m of c.missing) lines.push(`- ${m.name} × ${m.missing}${(m.room || m.location) ? ' (' + [m.room, m.location].filter(Boolean).join(', ') + ')' : ''}${m.price != null ? ', ' + eur(m.price) + ' l’unité' : ''}${m.store ? ', ' + m.store : ''}${m.url ? ', ' + m.url : ''}`);
    lines.push(`Coût de remplacement estimé : ${eur(c.missing.reduce((s, m) => s + (m.price || 0) * m.missing, 0))}`);
  }
  if (c.unchecked && c.unchecked.length) lines.push(`Non vérifiés (${c.unchecked.length}) : ${c.unchecked.map(u => u.name).join(', ')}`);
  return lines.join('\n');
}

function openReport(c) {
  const cost = c.missing.reduce((s, m) => s + (m.price || 0) * m.missing, 0);
  openSheet(`
    <header class="sh-head"><button class="icon" data-close aria-label="Fermer">${ICON.back}</button><h2>Rapport du ${fmtDate(c.date)}</h2></header>
    <div class="sh-body">
      ${c.label ? `<p class="muted">${esc(c.label)}</p>` : ''}
      <p class="big">${c.missing.length ? `${c.missing.length} article${c.missing.length > 1 ? 's' : ''} manquant${c.missing.length > 1 ? 's' : ''}, remplacement estimé ${eur(cost)}` : 'Tous les articles vérifiés sont présents.'}</p>
      ${c.missing.map(m => `<div class="rep"><div class="top-line"><span>${esc(m.name)}</span><span>× ${m.missing}</span></div>
        <div class="meta">${esc([m.cat, m.room, m.location].filter(Boolean).join(', '))}</div>
        <div class="meta">${m.price != null ? eur(m.price) + ' l’unité' : 'Prix non renseigné'}${m.store ? ', ' + esc(m.store) : ''}</div>
        ${m.url ? `<a class="btn" href="${esc(m.url)}" target="_blank" rel="noopener noreferrer">Racheter en ligne</a>` : ''}</div>`).join('')}
      ${c.unchecked && c.unchecked.length ? `<h3>Non vérifiés (${c.unchecked.length})</h3><p class="prose">${esc(c.unchecked.map(u => u.name).join(', '))}</p>` : ''}
    </div>
    <footer class="sh-foot"><button class="btn" id="r-copy">Copier</button>${navigator.share ? '<button class="btn" id="r-share">Partager</button>' : ''}<button class="btn danger" id="r-del">Supprimer</button></footer>`);
  $('#r-copy', sheet).onclick = async () => {
    try { await navigator.clipboard.writeText(reportText(c)); toast('Rapport copié.'); }
    catch (e) { toast('Copie impossible sur cet appareil.'); }
  };
  const sh = $('#r-share', sheet);
  if (sh) sh.onclick = () => navigator.share({ title: 'Contrôle de départ', text: reportText(c) }).catch(() => {});
  $('#r-del', sheet).onclick = async () => {
    if (!confirm('Supprimer ce rapport ?')) return;
    await del('controls', c.id); await loadAll(); closeSheet();
  };
}

/* ---------- réglages, sauvegarde ---------- */
let installEvt = null;
addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; if (state.tab === 'set' && !sheet.open) renderSettings(); });
addEventListener('appinstalled', () => { installEvt = null; toast('Application installée.'); if (state.tab === 'set' && !sheet.open) renderSettings(); });
const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

function showInstallHelp() {
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  openSheet(`
    <header class="sh-head"><button class="icon" data-close aria-label="Fermer">${ICON.back}</button><h2>Installer l’application</h2></header>
    <div class="sh-body">
      ${ios ? `<ol>
        <li>Ouvrez cette page dans <strong>Safari</strong>.</li>
        <li>Touchez le bouton <strong>Partager</strong> (carré avec une flèche).</li>
        <li>Choisissez <strong>Sur l’écran d’accueil</strong>, puis <strong>Ajouter</strong>.</li>
      </ol>` : `<ol>
        <li>Ouvrez cette page dans <strong>Chrome</strong> (pas dans une fenêtre intégrée à une autre application).</li>
        <li>Touchez le menu <strong>⋮</strong> en haut à droite.</li>
        <li>Choisissez <strong>Installer l’application</strong> (ou <strong>Ajouter à l’écran d’accueil</strong>), puis confirmez.</li>
      </ol>
      <p class="muted">Si l’option n’apparaît pas : attendez quelques secondes sur la page, rechargez-la une fois, puis rouvrez le menu. L’adresse doit commencer par https://.</p>`}
    </div>`);
}

function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

async function exportJSON() {
  toast('Préparation de la sauvegarde…');
  const out = { app: 'inventaire-logement', version: 3, exported: new Date().toISOString(), categories: cats, rooms, controls, items: [], wishes: [] };
  for (const i of items) out.items.push({ ...i, photos: await Promise.all((i.photos || []).map(p => blobToData(p.full))) });
  for (const w of wishes) out.wishes.push({ ...w, photos: await Promise.all((w.photos || []).map(p => blobToData(p.full))) });
  download(new Blob([JSON.stringify(out)], { type: 'application/json' }), `inventaire-${today()}.json`);
  localStorage.setItem('lastBackup', String(Date.now()));
  renderSettings();
}

function exportCSV() {
  const q = v => '"' + String(v ?? '').replace(/"/g, '""').replace(/\r?\n/g, ' ') + '"';
  const head = ['Catégorie', 'Nom', 'Quantité', 'Prix unitaire', 'Total', 'Date d’achat', 'Lieu d’achat', 'Pièce', 'Emplacement précis', 'Lien', 'Descriptif', 'Notes'];
  const rows = items.map(i => [catName(i.cat), i.name, i.qty || 1, i.price != null ? String(i.price).replace('.', ',') : '', i.price != null ? String(i.price * (i.qty || 1)).replace('.', ',') : '', i.date ? fmtDay(i.date) : '', i.store, roomNames(i), i.location, i.url, i.description, i.notes].map(q).join(';'));
  download(new Blob(['\ufeff' + [head.map(q).join(';'), ...rows].join('\r\n')], { type: 'text/csv;charset=utf-8' }), `inventaire-${today()}.csv`);
}

async function importJSON(file, replace) {
  try {
    const data = JSON.parse(await file.text());
    if (data.app !== 'inventaire-logement') throw new Error('format');
    if (replace) for (const n of ['items', 'categories', 'controls', 'rooms', 'wishes']) await clearStore(n);
    for (const c of data.categories || []) await put('categories', c);
    for (const r of data.rooms || []) await put('rooms', r);
    for (const c of data.controls || []) await put('controls', c);
    toast('Import en cours…');
    for (const i of data.items || []) {
      const photos = [];
      for (const dUrl of i.photos || []) {
        const blob = await (await fetch(dUrl)).blob();
        photos.push({ full: blob, thumb: await shrink(blob, 360, .75) });
      }
      await put('items', { ...i, photos });
    }
    for (const w of data.wishes || []) {
      const photos = [];
      for (const dUrl of w.photos || []) {
        if (typeof dUrl !== 'string') continue;
        const blob = await (await fetch(dUrl)).blob();
        photos.push({ full: blob, thumb: await shrink(blob, 360, .75) });
      }
      await put('wishes', { ...w, photos });
    }
    await loadAll();
    if (!data.rooms) await migrateRooms(true);
    toast(`${(data.items || []).length} article(s) importé(s).`);
    renderSettings();
  } catch (e) {
    toast('Fichier non reconnu : choisissez une sauvegarde de cette application.');
  }
}

async function renderSettings() {
  const nPhotos = [...items, ...wishes].reduce((n, i) => n + (i.photos || []).length, 0);
  let usage = '';
  try {
    const est = await navigator.storage.estimate();
    usage = `${(est.usage / 1048576).toFixed(1)} Mo utilisés sur l’appareil`;
  } catch (e) { /* indisponible */ }
  const persisted = navigator.storage && navigator.storage.persisted ? await navigator.storage.persisted() : false;
  const last = localStorage.getItem('lastBackup');
  if (state.tab !== 'set') return;
  view.innerHTML = `<section class="pad">
    <h2>Vos données</h2>
    <p class="muted">${items.length} article${items.length > 1 ? 's' : ''}, ${nPhotos} photo${nPhotos > 1 ? 's' : ''}${usage ? ', ' + usage : ''}.<br>
    Elles sont enregistrées sur cet appareil, pas sur GitHub. Faites une sauvegarde régulière.</p>
    <p class="muted">${last ? 'Dernière sauvegarde : ' + fmtDateTime(+last) : 'Aucune sauvegarde faite depuis ce téléphone.'}</p>
    <button class="btn primary wide" id="exp">Sauvegarder (fichier avec photos)</button>
    <label class="btn wide">Restaurer en ajoutant à l’existant<input id="imp1" type="file" accept="application/json,.json" hidden></label>
    <label class="btn wide danger">Restaurer en remplaçant tout<input id="imp2" type="file" accept="application/json,.json" hidden></label>
    <button class="btn wide" id="csv">Exporter en tableur (CSV, sans photos)</button>
    <h3>Remplissage automatique</h3>
    <p class="muted">Adresse du relais Cloudflare qui lit les pages des magasins (voir le guide).</p>
    <input id="relay" class="field" inputmode="url" autocapitalize="off" placeholder="https://mes-outils-relais.xxx.workers.dev" value="${esc(relayUrl())}">
    <button class="btn wide" id="relay-save">Enregistrer et tester</button>
    <p class="muted" id="relay-msg" role="status" aria-live="polite"></p>
    <h3>Application</h3>
    ${isStandalone() ? '<p class="muted">Application déjà installée sur cet appareil.</p>' : '<button class="btn wide" id="inst">Installer sur l’écran d’accueil</button>'}
    ${persisted ? '<p class="muted">Stockage protégé contre le nettoyage automatique.</p>' : '<button class="btn wide" id="pers">Protéger les données contre le nettoyage automatique</button>'}
  </section>`;
  $('#exp').onclick = exportJSON;
  $('#relay-save').onclick = async () => {
    const v = fixUrl($('#relay').value).replace(/\/+$/, '');
    const out = $('#relay-msg');
    if (!v) { localStorage.removeItem('relayLogement'); localStorage.removeItem('relayOutils'); out.textContent = 'Adresse effacée.'; return; }
    localStorage.setItem('relayLogement', v);
    out.textContent = 'Test en cours…';
    try { const r = await relayGet('?ping=1'); out.textContent = r && r.pong ? 'Le relais répond : tout est prêt.' : 'Cette adresse ne ressemble pas au relais.'; }
    catch (e) { out.textContent = 'Le relais ne répond pas. Vérifiez l’adresse.'; }
  };
  $('#csv').onclick = exportCSV;
  $('#imp1').onchange = e => { const f = e.target.files[0]; if (f) importJSON(f, false); e.target.value = ''; };
  $('#imp2').onchange = e => { const f = e.target.files[0]; if (f && confirm('Remplacer tout l’inventaire actuel par cette sauvegarde ?')) importJSON(f, true); e.target.value = ''; };
  const inst = $('#inst');
  if (inst) inst.onclick = async () => {
    if (!installEvt) return showInstallHelp();
    try {
      installEvt.prompt();
      await installEvt.userChoice;
    } catch (e) { installEvt = null; return showInstallHelp(); }
    installEvt = null;
    renderSettings();
  };
  const pers = $('#pers');
  if (pers) pers.onclick = async () => { const ok = await navigator.storage.persist(); toast(ok ? 'Stockage protégé.' : 'Le navigateur a refusé : installez d’abord l’application.'); renderSettings(); };
}

/* ---------- lien reçu par le menu « Partager » du téléphone ---------- */
function handleShare() {
  const q = new URLSearchParams(location.search);
  if (!q.has('url') && !q.has('text') && !q.has('title')) return;
  const link = firstLink(q.get('url'), q.get('text'), q.get('title'));
  const title = shareTitle(q.get('title'), q.get('text'));
  history.replaceState(null, '', location.pathname);
  if (!link) { toast('Aucun lien trouvé dans ce partage.'); return; }
  openSheet(`
    <header class="sh-head"><button class="icon" data-close aria-label="Annuler">${ICON.back}</button><h2>Ajouter cet article</h2></header>
    <div class="sh-body form">
      <p class="muted" style="overflow-wrap:anywhere">${esc(link)}</p>
      <button class="btn primary wide" id="sh-inv">Je l’ai déjà : l’ajouter à l’inventaire</button>
      <button class="btn wide" id="sh-wish">Je le veux : liste d’envie</button>
    </div>`);
  $('#sh-inv', sheet).onclick = () => openForm(null, false, { link, auto: true, title });
  $('#sh-wish', sheet).onclick = () => { setTab('wish'); openWishForm(null, { link, auto: true, title }); };
}

/* ---------- démarrage ---------- */
(async function init() {
  try {
    db = await openDB();
    await loadAll();
    await seed();
    await migrateRooms();
    await seedRooms();
  } catch (e) {
    view.innerHTML = '<p class="empty">Le stockage local est indisponible (navigation privée ?). Ouvrez l’application dans une fenêtre normale.</p>';
    return;
  }
  history.replaceState(null, '');
  setTab('inv');
  handleShare();
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
})();
