'use strict';
/* Suivi véhicules & équipements — étape 0.1 (socle)
   Stockage local IndexedDB (nom propre à cette appli), véhicules, relevés kilométriques, export / import. */

var APP_VERSION = '0.15.0';
var APP_DATE = '14 novembre 2026';
var DB_NAME = 'veh_equip_db';
var FORMAT = 'suivi-vehicules-equipements';

/* ---------- Outils ---------- */
function $(s, r) { return (r || document).querySelector(s); }
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
function todayStr() {
  var d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function fmtDate(s) { if (!s) return '–'; var p = s.split('-'); return p[2] + '/' + p[1] + '/' + p[0]; }
var NF = new Intl.NumberFormat('fr-FR');
function fmtKm(n) { return (n == null || n === '') ? '–' : NF.format(n) + ' km'; }
function fmtEur(n) {
  return (n == null || n === '') ? '–' : new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(n);
}
function num(v) {
  if (v == null) return null;
  var s = String(v).trim().replace(/\s/g, '').replace(',', '.');
  if (s === '') return null;
  var n = Number(s);
  return isFinite(n) ? n : null;
}
function toast(msg) {
  var t = document.createElement('div');
  t.className = 'toast'; t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(function () { t.remove(); }, 2600);
}

/* ---------- Base locale ---------- */
var db = null;
var data = { vehicles: [], readings: [], fills: [], prices: [], maints: [], expenses: [], tariffs: [], charges: [], insur: [], atts: [], deleted: [], lastExport: null };

function openDB() {
  return new Promise(function (res, rej) {
    var r = indexedDB.open(DB_NAME, 6);
    r.onupgradeneeded = function () {
      var d = r.result, has = function (n) { return d.objectStoreNames.contains(n); };
      if (!has('vehicles')) d.createObjectStore('vehicles', { keyPath: 'id' });
      if (!has('readings')) { var rd = d.createObjectStore('readings', { keyPath: 'id' }); rd.createIndex('vehicleId', 'vehicleId'); }
      if (!has('deleted')) d.createObjectStore('deleted', { keyPath: 'id' }); // suppressions, pour la synchro
      if (!has('meta')) d.createObjectStore('meta', { keyPath: 'key' });
      if (!has('fills')) d.createObjectStore('fills', { keyPath: 'id' });   // pleins (0.3)
      if (!has('maints')) d.createObjectStore('maints', { keyPath: 'id' });     // entretiens (0.4)
      if (!has('expenses')) d.createObjectStore('expenses', { keyPath: 'id' }); // achats annexes et autres dépenses (0.4)
      if (!has('tariffs')) d.createObjectStore('tariffs', { keyPath: 'id' });   // tarifs électricité maison par période (0.7)
      if (!has('charges')) d.createObjectStore('charges', { keyPath: 'id' });   // recharges électriques (0.7)
      if (!has('insur')) d.createObjectStore('insur', { keyPath: 'id' });       // périodes de contrat d'assurance (0.9)
      if (!has('atts')) d.createObjectStore('atts', { keyPath: 'id' });         // fiches des pièces jointes (synchronisées)
      if (!has('blobs')) d.createObjectStore('blobs', { keyPath: 'id' });       // fichiers des pièces jointes (cet appareil seulement)
      if (!has('prices')) d.createObjectStore('prices', { keyPath: 'id' }); // prix moyens mensuels (0.3)
    };
    r.onsuccess = function () { res(r.result); };
    r.onerror = function () { rej(r.error); };
  });
}
function rq(r) { return new Promise(function (res, rej) { r.onsuccess = function () { res(r.result); }; r.onerror = function () { rej(r.error); }; }); }
function st(name, mode) { return db.transaction(name, mode || 'readonly').objectStore(name); }
function dbPut(name, v) { return rq(st(name, 'readwrite').put(v)); }
function done(t) {
  return new Promise(function (res, rej) {
    t.oncomplete = res; t.onerror = function () { rej(t.error); }; t.onabort = function () { rej(t.error); };
  });
}
async function reload() {
  data.vehicles = await rq(st('vehicles').getAll());
  data.readings = await rq(st('readings').getAll());
  data.deleted = await rq(st('deleted').getAll());
  data.fills = await rq(st('fills').getAll());
  data.prices = await rq(st('prices').getAll());
  data.maints = await rq(st('maints').getAll());
  data.expenses = await rq(st('expenses').getAll());
  data.tariffs = await rq(st('tariffs').getAll());
  data.charges = await rq(st('charges').getAll());
  data.insur = await rq(st('insur').getAll());
  data.atts = await rq(st('atts').getAll());
  var m = await rq(st('meta').get('lastExport'));
  data.lastExport = m ? m.value : null;
}

/* ---------- Calculs ---------- */
function vehReadings(id) {
  return data.readings.filter(function (r) { return r.vehicleId === id; })
    .sort(function (a, b) { return a.date.localeCompare(b.date) || a.km - b.km; });
}
function currentKm(v) {
  var rs = vehReadings(v.id);
  if (rs.length) return rs[rs.length - 1].km;
  return v.purchase && v.purchase.km != null ? v.purchase.km : null;
}
function lastReadingDate(v) {
  var rs = vehReadings(v.id);
  return rs.length ? rs[rs.length - 1].date : null;
}
// Points de repère kilométriques connus d'un véhicule (achat, relevés, sortie)
function kmPoints(v, ignoreId) {
  var pts = vehReadings(v.id).filter(function (r) { return r.id !== ignoreId; })
    .map(function (r) { return { date: r.date, km: r.km, label: 'relevé' }; });
  if (v.purchase && v.purchase.date && v.purchase.km != null) pts.push({ date: v.purchase.date, km: v.purchase.km, label: 'achat' });
  if (v.exit && v.exit.date && v.exit.km != null) pts.push({ date: v.exit.date, km: v.exit.km, label: 'sortie' });
  return pts;
}
// Renvoie la liste des incohérences (kilométrage décroissant) pour un relevé
function kmWarnings(v, date, km, ignoreId) {
  var pts = kmPoints(v, ignoreId), out = [];
  var before = pts.filter(function (p) { return p.date <= date; });
  var after = pts.filter(function (p) { return p.date > date; });
  if (before.length) {
    var b = before.reduce(function (m, p) { return p.km > m.km ? p : m; });
    if (b.km > km) out.push('un ' + b.label + ' du ' + fmtDate(b.date) + ' indique ' + fmtKm(b.km) + ' (plus haut)');
  }
  if (after.length) {
    var a = after.reduce(function (m, p) { return p.km < m.km ? p : m; });
    if (a.km < km) out.push('un ' + a.label + ' du ' + fmtDate(a.date) + ' indique ' + fmtKm(a.km) + ' (plus bas)');
  }
  return out;
}
function sortedVehicles(status) {
  return data.vehicles.filter(function (v) { return !v.equip && (v.status || 'actuel') === status; })
    .sort(function (a, b) { return (a.name || '').localeCompare(b.name || '', 'fr'); });
}
function exportReminder() {
  if (!data.vehicles.length) return false;
  var ref = data.lastExport;
  if (!ref) ref = Math.min.apply(null, data.vehicles.map(function (v) { return v.createdAt || Date.now(); }));
  return Date.now() - ref > 30 * 86400000;
}

/* ---------- État de l'interface ---------- */
var state = { tab: 'home', vehicleId: null };

function render() {
  var main = $('#main'), html = '';
  var cv = state.tab === 'vehicle' ? data.vehicles.filter(function (x) { return x.id === state.vehicleId; })[0] : null;
  var navTab = state.tab === 'compare' ? 'vehicles' : state.tab === 'vehicle' ? (cv && cv.equip ? 'equips' : 'vehicles') : state.tab;
  document.querySelectorAll('#nav button').forEach(function (b) {
    b.classList.toggle('on', b.getAttribute('data-tab') === navTab);
  });
  if (state.tab === 'home') html = viewHome();
  else if (state.tab === 'vehicles') html = viewVehicles();
  else if (state.tab === 'equips') html = viewEquips();
  else if (state.tab === 'compare') html = viewCompare();
  else if (state.tab === 'vehicle') html = viewVehicle(state.vehicleId);
  else if (state.tab === 'energy') html = viewEnergy();
  else if (state.tab === 'maint') html = viewMaint();
  else if (state.tab === 'data') html = viewData();
  main.innerHTML = html;
  if (window.afterRender) window.afterRender();
}
function go(tab, id) { state.tab = tab; state.vehicleId = id || null; render(); window.scrollTo(0, 0); }

/* ---------- Vues ---------- */
function vehCard(v) {
  var sub = [v.make, v.model, v.year].filter(Boolean).join(' ');
  var old = (v.status || 'actuel') === 'ancien';
  return '<div class="card tap" data-act="open" data-id="' + esc(v.id) + '"><div class="row"><div>' +
    '<div class="big">' + esc(v.name) + (old ? '<span class="tag old">ancien</span>' : '') + '</div>' +
    '<div class="muted">' + esc([sub, v.energy].filter(Boolean).join(' · ') || '—') + '</div></div>' +
    '<div style="text-align:right"><div class="big">' + fmtKm(old && v.exit && v.exit.km != null ? v.exit.km : currentKm(v)) + '</div>' +
    '<div class="muted">' + (lastReadingDate(v) ? 'au ' + fmtDate(lastReadingDate(v)) : '') + '</div></div></div></div>';
}
function viewHome() {
  var h = '<h1>Suivi véhicules &amp; équipements</h1>';
  if (exportReminder()) {
    h += '<div class="card warn"><b>Pensez à sauvegarder.</b><div class="muted">Dernier export il y a plus de 30 jours (ou jamais). ' +
      'Pensez aussi à synchroniser avec Google Drive (onglet Données).</div>' +
      '<div class="actions"><button class="primary" data-act="tab" data-tab="data">Aller à Données</button></div></div>';
  }
  h += '<div class="grid2">' +
    '<button class="primary" data-act="addReading">＋ Kilométrage</button>' +
    '<button data-act="addVehicle">＋ Véhicule</button>' +
    '<button data-act="addFill">＋ Plein</button>' +
    '<button data-act="addMaint">＋ Entretien</button></div>';
  var cur = sortedVehicles('actuel');
  h += '<h2>Mes véhicules</h2>';
  if (!cur.length) h += '<div class="card empty">Aucun véhicule pour l\'instant.<div class="actions"><button class="primary" data-act="addVehicle">Ajouter mon premier véhicule</button></div></div>';
  else h += cur.map(vehCard).join('');
  var eq = equipList('actuel'); if (eq.length) h += '<h2>Mes équipements</h2>' + eq.map(equipCard).join('');
  return h;
}
function viewVehicles() {
  var cur = sortedVehicles('actuel'), old = sortedVehicles('ancien');
  var h = '<h1>Véhicules</h1><div class="actions"><button class="primary" data-act="addVehicle">＋ Ajouter un véhicule</button><button data-act="tab" data-tab="compare">📊 Analyse et comparatif</button></div>';
  h += '<h2>Actuels</h2>' + (cur.length ? cur.map(vehCard).join('') : '<div class="card empty">Aucun véhicule actuel.</div>');
  h += '<h2>Anciens</h2>' + (old.length ? old.map(vehCard).join('') : '<div class="card empty">Aucun ancien véhicule. Les fiches des véhicules vendus restent ici pour la comparaison.</div>');
  return h;
}
function kv(rows) {
  var r = rows.filter(function (x) { return x[1] != null && x[1] !== ''; });
  if (!r.length) return '<div class="muted">Rien de renseigné.</div>';
  return '<dl class="kv">' + r.map(function (x) { return '<dt>' + esc(x[0]) + '</dt><dd>' + esc(x[1]) + '</dd>'; }).join('') + '</dl>';
}
function powerText(v) {
  var parts = [];
  if (v.powerCh) parts.push(v.powerCh + ' ch');
  if (v.powerCv) parts.push(v.powerCv + ' CV');
  if (!parts.length && v.power) parts.push(v.power); // anciennes fiches (0.1 / 0.1.1 / 0.1.2)
  return parts.join(' · ');
}
function viewVehicle(id) {
  var v = data.vehicles.filter(function (x) { return x.id === id; })[0];
  if (v && v.equip) return viewEquip(v);
  if (!v) return '<div class="card empty">Véhicule introuvable.<div class="actions"><button data-act="tab" data-tab="vehicles">Retour</button></div></div>';
  var old = (v.status || 'actuel') === 'ancien', p = v.purchase || {}, x = v.exit || {};
  var rs = vehReadings(id).slice().reverse();
  var km = currentKm(v);
  var h = '<div class="actions"><button class="link" data-act="tab" data-tab="vehicles">‹ Véhicules</button></div>' +
    '<h1>' + esc(v.name) + (old ? '<span class="tag old">ancien</span>' : '<span class="tag">actuel</span>') + '</h1>';
  h += '<div class="card"><div class="muted">Kilométrage ' + (old && x.km != null ? 'à la sortie' : 'actuel') + '</div><div class="big">' +
    fmtKm(old && x.km != null ? x.km : km) + '</div>' +
    (p.km != null && km != null ? '<div class="muted">' + fmtKm(km - p.km) + ' depuis l\'achat</div>' : '') + '</div>';
  h += summaryCard(v);
  h += '<div class="actions"><button class="primary" data-act="addReading" data-id="' + esc(id) + '">＋ Kilométrage</button>' +
    '<button data-act="editVehicle" data-id="' + esc(id) + '">Modifier la fiche</button></div>';
  h += '<h2>Fiche technique</h2><div class="card">' + kv([
    ['Type', v.type], ['Énergie', v.energy], ['Marque', v.make], ['Modèle', v.model], ['Version', v.version],
    ['Motorisation', v.engine], ['Puissance', powerText(v)], ['Année', v.year], ['Boîte', v.gearbox],
    ['Réservoir / batterie', v.capacity], ['Pneus', v.tires], ['Plaque', v.plate], ['VIN', v.vin]
  ].concat((v.extra || []).map(function (e) { return [e.k, e.v]; }))) + '</div>';
  h += regSection(v);
  h += '<h2>Achat</h2><div class="card">' + kv([
    ['État', p.condition], ['Date', p.date ? fmtDate(p.date) : ''], ['Kilométrage', p.km != null ? fmtKm(p.km) : ''],
    ['Prix', p.price != null ? fmtEur(p.price) : '']]) + '</div>';
  if (old || x.date || x.km != null || x.price != null) {
    h += '<h2>Sortie</h2><div class="card">' + kv([
      ['Date', x.date ? fmtDate(x.date) : ''], ['Kilométrage', x.km != null ? fmtKm(x.km) : ''],
      ['Prix de revente', x.price != null ? fmtEur(x.price) : '']]) + '</div>';
  }
  if (v.notes) h += '<h2>Remarques</h2><div class="card" style="white-space:pre-wrap">' + esc(v.notes) + '</div>';
  h += '<h2>Relevés kilométriques (' + rs.length + ')</h2><div class="card list">';
  if (!rs.length) h += '<div class="muted">Aucun relevé. Ajoutez-en un avec « ＋ Kilométrage ».</div>';
  rs.forEach(function (r) {
    h += '<div class="item"><div><b>' + fmtKm(r.km) + '</b><div class="muted">' + fmtDate(r.date) + '</div></div>' +
      '<div><button class="link" data-act="editReading" data-id="' + esc(r.id) + '">Modifier</button></div></div>';
  });
  h += '</div>' + energyVehicleSection(v) + insVehicleSection(v) + maintVehicleSection(v);
  h += '<h2>Zone sensible</h2><div class="actions"><button class="danger" data-act="delVehicle" data-id="' + esc(id) + '">Supprimer ce véhicule</button></div>';
  return h;
}
function viewSoon(title, text) {
  return '<h1>' + esc(title) + '</h1><div class="card empty">' + esc(text) + '</div>';
}
function viewData() {
  var h = '<h1>Données</h1>';
  h += '<div class="card"><div class="row"><div><div class="big">Version ' + esc(APP_VERSION) + '</div><div class="muted">' + esc(APP_DATE) + '</div></div></div></div>';
  h += '<h2>Synchronisation Google Drive</h2><div class="card" id="gbox"></div>';
  h += '<h2>Sauvegarde</h2><div class="card"><div class="muted">' + data.vehicles.length + ' véhicule(s), ' + data.readings.length + ' relevé(s). ' +
    (data.lastExport ? 'Dernier export : ' + new Date(data.lastExport).toLocaleDateString('fr-FR') + '.' : 'Jamais exporté.') + '</div>' +
    '<div class="actions"><button class="primary" data-act="export">Exporter (fichier)</button>' +
    '<button data-act="copyExport">Copier la sauvegarde</button></div>' +
    '<div class="actions"><button data-act="import">Importer un fichier…</button></div>' +
    '<input type="file" id="importFile" accept=".json,application/json" hidden>' +
    '<label for="pasteBox">Ou coller une sauvegarde (secours)</label><textarea id="pasteBox" placeholder="Collez ici le texte exporté"></textarea>' +
    '<div class="actions"><button data-act="importPaste">Importer le texte collé</button></div></div>';
  h += '<h2>Zone sensible</h2><div class="actions"><button class="danger" data-act="wipe">Effacer toutes les données de cet appareil</button></div>';
  return h;
}

/* ---------- Formulaires (feuille plein écran) ---------- */
function openSheet(html) { var s = $('#sheet'); s.innerHTML = '<div class="inner">' + html + '</div>'; s.hidden = false; s.scrollTop = 0; enhanceDates(s); }
function closeSheet() { var s = $('#sheet'); s.hidden = true; s.innerHTML = ''; }

var TYPES = ['Voiture', 'Utilitaire', 'Moto', 'Scooter', 'Camping-car', 'Remorque'];
var FUELS = ['Gazole', 'SP95', 'SP95-E10', 'SP98', 'E85', 'GPL', 'Fioul'];
var ENERGIES = ['Essence', 'Diesel', 'Électrique', 'Hybride', 'Hybride rechargeable', 'GPL', 'E85 (superéthanol)'];
function opts(list) { return list.map(function (o) { return '<option value="' + esc(o) + '">'; }).join(''); }
function fld(label, name, val, o) {
  o = o || {};
  return '<label for="f_' + name + '">' + esc(label) + '</label><input id="f_' + name + '" name="' + name + '" type="' + (o.type || 'text') + '"' +
    (o.inputmode ? ' inputmode="' + o.inputmode + '"' : '') + (o.list ? ' list="' + o.list + '"' : '') +
    (o.req ? ' required' : '') + (o.ph ? ' placeholder="' + esc(o.ph) + '"' : '') + ' value="' + esc(val == null ? '' : val) + '" autocomplete="off">';
}
function extraRow(k, v) {
  return '<div class="xrow"><input name="xk" placeholder="Nom du champ" value="' + esc(k || '') + '"><input name="xv" placeholder="Valeur" value="' + esc(v || '') + '">' +
    '<button type="button" data-act="rmExtra" aria-label="Retirer">✕</button></div>';
}
function vehicleForm(id) {
  var v = id ? data.vehicles.filter(function (x) { return x.id === id; })[0] : null;
  v = v || { status: 'actuel', purchase: {}, exit: {}, extra: [] };
  var p = v.purchase || {}, x = v.exit || {}, status = v.status || 'actuel';
  var pCh = v.powerCh || (v.power && !v.powerCv ? (String(v.power).match(/\d+([.,]\d+)?/) || [''])[0] : '');
  var types = TYPES.concat(data.vehicles.map(function (a) { return a.type; }).filter(Boolean));
  var energies = ENERGIES.concat(data.vehicles.map(function (a) { return a.energy; }).filter(Boolean));
  var h = '<h1>' + (id ? 'Modifier la fiche' : 'Nouveau véhicule') + '</h1><form id="vform" data-id="' + esc(id || '') + '">' +
    fld('Nom', 'name', v.name, { req: true, ph: 'ex. Tesla Model 3' }) +
    fld('Type', 'type', v.type, { list: 'dl_types', ph: 'Voiture, moto… (libre)' }) +
    fld('Énergie', 'energy', v.energy, { list: 'dl_energies', ph: 'Essence, électrique… (libre)' }) +
    '<datalist id="dl_types">' + opts(Array.from(new Set(types))) + '</datalist><datalist id="dl_energies">' + opts(Array.from(new Set(energies))) + '</datalist>' +
    '<label>Statut</label><div class="seg"><label><input type="radio" name="status" value="actuel"' + (status === 'actuel' ? ' checked' : '') + '><span>Actuel</span></label>' +
    '<label><input type="radio" name="status" value="ancien"' + (status === 'ancien' ? ' checked' : '') + '><span>Ancien</span></label></div>' +
    '<fieldset><legend>Fiche technique</legend>' +
    fld('Marque', 'make', v.make) + fld('Modèle', 'model', v.model) + fld('Version', 'version', v.version) +
    fld('Motorisation', 'engine', v.engine) +
    '<div class="pair"><div>' + fld('Puissance (ch)', 'powerCh', pCh, { inputmode: 'decimal', ph: 'ex. 110' }) + '</div><div>' +
    fld('Puissance fiscale (CV)', 'powerCv', v.powerCv, { inputmode: 'numeric', ph: 'ex. 6' }) + '</div></div>' +
    fld('Année', 'year', v.year, { inputmode: 'numeric' }) + fld('Boîte', 'gearbox', v.gearbox, { ph: 'manuelle, auto…' }) +
    fld('Réservoir ou batterie', 'capacity', v.capacity, { ph: 'ex. 45 L ou 60 kWh' }) + fld('Pneus', 'tires', v.tires) +
    '<label>Autres champs</label><div id="extras">' + (v.extra || []).map(function (e) { return extraRow(e.k, e.v); }).join('') + '</div>' +
    '<div class="actions"><button type="button" data-act="addExtra">＋ Ajouter un champ</button></div></fieldset>' +
    '<fieldset><legend>Identification (facultatif)</legend>' + fld('Plaque d\'immatriculation', 'plate', v.plate) + fld('VIN', 'vin', v.vin) +
    '<div class="muted">Ces données restent dans l\'appli, jamais dans le dépôt ni dans les documents du projet.</div></fieldset>' +
    '<fieldset><legend>Suivi de la consommation</legend><label for="f_fuel">Carburant (pour la table des prix)</label><select id="f_fuel" name="fuel">' +
    [''].concat(FUELS).map(function (o) { return '<option value="' + o + '"' + ((v.fuel || '') === o ? ' selected' : '') + '>' + (o || '— (selon l\'énergie)') + '</option>'; }).join('') + '</select>' +
    '<label>Mode de suivi</label><div class="seg"><label><input type="radio" name="mode" value="fills"' + (v.mode !== 'manual' ? ' checked' : '') + '><span>Plein à plein</span></label>' +
    '<label><input type="radio" name="mode" value="manual"' + (v.mode === 'manual' ? ' checked' : '') + '><span>Conso moyenne</span></label></div>' +
    fld('Conso moyenne connue (L/100 km, ou kWh/100 km en électrique)', 'manualConso', v.manualConso, { inputmode: 'decimal', ph: 'ex. 6,5' }) +
    fld('Prix moyen du litre ou du kWh si pas dans la table (€)', 'manualPrice', v.manualPrice, { inputmode: 'decimal', ph: 'ex. 1,75' }) +
    '<div class="muted">Le mode « Conso moyenne » sert aux véhicules sans tickets : le coût est estimé à partir des kilomètres entre deux relevés. En électrique, la conso moyenne sert au coût d\'utilisation ; le coût réel vient toujours des recharges.</div></fieldset>' +
    '<details class="card" id="regDet"><summary><b>Carte grise</b> <span class="muted">(toutes les rubriques, photos, lecture par IA)</span></summary>' + regFieldsHtml(v) +
    '<h3>Photos de la carte grise</h3><div id="attBox"></div><div id="aiBox"></div></details>' +
    '<fieldset><legend>Achat</legend><label for="f_condition">Neuf ou occasion</label><select id="f_condition" name="condition">' +
    ['', 'Neuf', 'Occasion'].map(function (o) { return '<option value="' + o + '"' + (p.condition === o ? ' selected' : '') + '>' + (o || '—') + '</option>'; }).join('') + '</select>' +
    fld('Kilométrage à l\'achat (0 pour un neuf)', 'pkm', p.km, { inputmode: 'numeric' }) +
    fld('Date d\'achat', 'pdate', p.date, { type: 'date' }) + fld('Prix d\'achat (€)', 'pprice', p.price, { inputmode: 'decimal' }) + '</fieldset>' +
    '<fieldset><legend>Sortie (si je ne l\'ai plus)</legend>' + fld('Date de sortie', 'xdate', x.date, { type: 'date' }) +
    fld('Kilométrage à la sortie', 'xkm', x.km, { inputmode: 'numeric' }) + fld('Prix de revente (€)', 'xprice', x.price, { inputmode: 'decimal' }) + '</fieldset>' +
    '<label for="f_notes">Remarques</label><textarea id="f_notes" name="notes">' + esc(v.notes || '') + '</textarea>' +
    '<div class="formbar"><button type="button" data-act="closeSheet">Annuler</button><button class="primary" type="submit">Enregistrer</button></div></form>';
  openSheet(h); attInit('vehicle', id || ''); invInit('reg');
}
async function saveVehicle(form) {
  var fd = new FormData(form), id = form.getAttribute('data-id');
  var g = function (k) { return (fd.get(k) || '').toString().trim(); };
  var old = id ? data.vehicles.filter(function (x) { return x.id === id; })[0] : null;
  var xk = fd.getAll('xk'), xv = fd.getAll('xv'), extra = [];
  xk.forEach(function (k, i) { k = String(k).trim(); var val = String(xv[i] || '').trim(); if (k || val) extra.push({ k: k || '—', v: val }); });
  var v = old ? Object.assign({}, old) : { id: uid(), createdAt: Date.now() };
  v.name = g('name'); v.type = g('type'); v.energy = g('energy'); v.status = g('status') || 'actuel';
  ['make', 'model', 'version', 'engine', 'powerCh', 'powerCv', 'year', 'gearbox', 'capacity', 'tires', 'plate', 'vin', 'notes'].forEach(function (k) { v[k] = g(k); });
  delete v.power;
  v.fuel = g('fuel'); v.mode = g('mode') === 'manual' ? 'manual' : 'fills'; v.manualConso = num(g('manualConso')); v.manualPrice = num(g('manualPrice'));
  v.extra = extra; v.reg = regRead(g);
  v.purchase = { condition: g('condition'), km: num(g('pkm')), date: g('pdate'), price: num(g('pprice')) };
  v.exit = { date: g('xdate'), km: num(g('xkm')), price: num(g('xprice')) };
  v.updatedAt = Date.now();
  await dbPut('vehicles', v);
  var nAtt = await attCommit('vehicle', v.id, v.id, 'Carte grise ' + v.name);
  await reload();
  closeSheet();
  if (state.tab === 'vehicle' || !old) go('vehicle', v.id); else render();
  toast('Fiche enregistrée' + (nAtt ? ' (' + nAtt + ' pièce(s) jointe(s) ajoutée(s))' : ''));
}

function readingForm(vehicleId, readingId) {
  var r = readingId ? data.readings.filter(function (x) { return x.id === readingId; })[0] : null;
  var vid = r ? r.vehicleId : (vehicleId || (sortedVehicles('actuel')[0] || data.vehicles.filter(function (v) { return !v.equip; })[0] || {}).id);
  if (!data.vehicles.length) { toast('Ajoutez d\'abord un véhicule'); return; }
  var h = '<h1>' + (r ? 'Modifier le relevé' : 'Nouveau kilométrage') + '</h1><form id="rform" data-id="' + esc(r ? r.id : '') + '">' +
    '<label for="f_vid">Véhicule</label><select id="f_vid" name="vehicleId">' +
    data.vehicles.filter(function (v) { return !v.equip; }).map(function (v) { return '<option value="' + esc(v.id) + '"' + (v.id === vid ? ' selected' : '') + '>' + esc(v.name) + '</option>'; }).join('') + '</select>' +
    fld('Date', 'date', r ? r.date : todayStr(), { type: 'date', req: true }) +
    fld('Kilométrage', 'km', r ? r.km : '', { inputmode: 'numeric', req: true }) +
    (r ? '<div class="actions"><button type="button" class="danger" data-act="delReading" data-id="' + esc(r.id) + '">Supprimer ce relevé</button></div>' : '') +
    '<div class="formbar"><button type="button" data-act="closeSheet">Annuler</button><button class="primary" type="submit">Enregistrer</button></div></form>';
  openSheet(h);
  var k = $('#f_km'); if (k && !r) k.focus();
}
async function saveReading(form) {
  var fd = new FormData(form), id = form.getAttribute('data-id');
  var vid = fd.get('vehicleId'), date = (fd.get('date') || '').toString(), km = num(fd.get('km'));
  if (!date || km == null || km < 0) { toast('Date et kilométrage requis'); return; }
  km = Math.round(km);
  var v = data.vehicles.filter(function (x) { return x.id === vid; })[0];
  var w = kmWarnings(v, date, km, id || null);
  if (w.length && !confirm('Kilométrage incohérent : ' + w.join(' ; ') + '.\n\nEnregistrer quand même ?')) return;
  var old = id ? data.readings.filter(function (x) { return x.id === id; })[0] : null;
  var r = old ? Object.assign({}, old) : { id: uid(), createdAt: Date.now() };
  r.vehicleId = vid; r.date = date; r.km = km; r.updatedAt = Date.now();
  await dbPut('readings', r);
  await reload();
  closeSheet();
  go('vehicle', vid);
  toast('Relevé enregistré');
}
async function deleteReading(id) {
  var r = data.readings.filter(function (x) { return x.id === id; })[0];
  if (!r || !confirm('Supprimer ce relevé (' + fmtKm(r.km) + ' au ' + fmtDate(r.date) + ') ?')) return;
  var t = db.transaction(['readings', 'deleted'], 'readwrite');
  t.objectStore('readings').delete(id);
  t.objectStore('deleted').put({ id: id, kind: 'reading', deletedAt: Date.now() });
  await done(t); await reload(); closeSheet(); go('vehicle', r.vehicleId);
}
async function deleteVehicle(id) {
  var v = data.vehicles.filter(function (x) { return x.id === id; })[0];
  if (!v) return;
  var rs = data.readings.filter(function (r) { return r.vehicleId === id; });
  var fs = data.fills.filter(function (r) { return r.vehicleId === id; });
  if (!confirm('Supprimer « ' + v.name + ' », ses ' + rs.length + ' relevé(s) et ses ' + fs.length + (v.equip ? ' remplissage(s) de cuve' : ' plein(s)') + ' ? Cette action est définitive.')) return;
  var ms = data.maints.filter(function (r) { return r.vehicleId === id; }), es = data.expenses.filter(function (r) { return r.vehicleId === id; });
  if ((ms.length || es.length) && !confirm('Cela supprime aussi ' + ms.length + ' entretien(s) et ' + es.length + ' dépense(s) / achat(s) annexe(s). Continuer ?')) return;
  var cs = data.charges.filter(function (r) { return r.vehicleId === id; });
  if (cs.length && !confirm('Cela supprime aussi ' + cs.length + ' recharge(s). Continuer ?')) return;
  var is = data.insur.filter(function (r) { return r.vehicleId === id; });
  if (is.length && !confirm('Cela supprime aussi ' + is.length + ' période(s) d\'assurance. Continuer ?')) return;
  var as = data.atts.filter(function (r) { return r.vehicleId === id; });
  if (as.length && !confirm('Cela supprime aussi ' + as.length + ' pièce(s) jointe(s) (y compris dans le Drive). Continuer ?')) return;
  var t = db.transaction(['vehicles', 'readings', 'fills', 'maints', 'expenses', 'charges', 'insur', 'atts', 'blobs', 'deleted'], 'readwrite'), now = Date.now();
  as.forEach(function (r) { queueDriveDelete(r.driveId); t.objectStore('atts').delete(r.id); t.objectStore('blobs').delete(r.id); t.objectStore('deleted').put({ id: r.id, kind: 'attachment', deletedAt: now }); });
  is.forEach(function (r) { t.objectStore('insur').delete(r.id); t.objectStore('deleted').put({ id: r.id, kind: 'insurance', deletedAt: now }); });
  cs.forEach(function (r) { t.objectStore('charges').delete(r.id); t.objectStore('deleted').put({ id: r.id, kind: 'charge', deletedAt: now }); });
  ms.forEach(function (r) { t.objectStore('maints').delete(r.id); t.objectStore('deleted').put({ id: r.id, kind: 'maint', deletedAt: now }); });
  es.forEach(function (r) { t.objectStore('expenses').delete(r.id); t.objectStore('deleted').put({ id: r.id, kind: 'expense', deletedAt: now }); });
  fs.forEach(function (r) { t.objectStore('fills').delete(r.id); t.objectStore('deleted').put({ id: r.id, kind: 'fill', deletedAt: now }); });
  t.objectStore('vehicles').delete(id);
  t.objectStore('deleted').put({ id: id, kind: 'vehicle', deletedAt: now });
  rs.forEach(function (r) { t.objectStore('readings').delete(r.id); t.objectStore('deleted').put({ id: r.id, kind: 'reading', deletedAt: now }); });
  await done(t); await reload(); go('vehicles');
}

/* ---------- Export / import ---------- */
function buildExport() {
  return JSON.stringify({
    format: FORMAT, formatVersion: 1, appVersion: APP_VERSION, exportedAt: new Date().toISOString(),
    vehicles: data.vehicles, readings: data.readings, fills: data.fills, prices: data.prices, maints: data.maints, expenses: data.expenses, tariffs: data.tariffs, charges: data.charges, insur: data.insur
  }, null, 1);
}
async function markExported() { await dbPut('meta', { key: 'lastExport', value: Date.now() }); await reload(); }
async function doExport() {
  var blob = new Blob([buildExport()], { type: 'application/json' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = FORMAT + '-' + todayStr() + '.json';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000);
  await markExported(); render(); toast('Export créé');
}
async function copyExport() {
  try { await navigator.clipboard.writeText(buildExport()); await markExported(); render(); toast('Sauvegarde copiée'); }
  catch (e) { toast('Copie impossible : utilisez le fichier'); }
}
async function importText(text) {
  var j;
  try { j = JSON.parse(text); } catch (e) { toast('Fichier illisible'); return; }
  if (!j || j.format !== FORMAT || !Array.isArray(j.vehicles)) { toast('Ce n\'est pas une sauvegarde de cette appli'); return; }
  var vs = j.vehicles, rs = Array.isArray(j.readings) ? j.readings : [];
  var fl = Array.isArray(j.fills) ? j.fills : [], pr = Array.isArray(j.prices) ? j.prices : [];
  var ml = Array.isArray(j.maints) ? j.maints : [], el = Array.isArray(j.expenses) ? j.expenses : [], byM = {}, byE = {};
  data.maints.forEach(function (x) { byM[x.id] = x; }); data.expenses.forEach(function (x) { byE[x.id] = x; });
  var tl = Array.isArray(j.tariffs) ? j.tariffs : [], cl = Array.isArray(j.charges) ? j.charges : [], byT = {}, byC = {};
  data.tariffs.forEach(function (x) { byT[x.id] = x; }); data.charges.forEach(function (x) { byC[x.id] = x; });
  var il = Array.isArray(j.insur) ? j.insur : [], byI = {};
  data.insur.forEach(function (x) { byI[x.id] = x; });
  var byV = {}, byR = {}, byF = {}, byP = {};
  data.vehicles.forEach(function (x) { byV[x.id] = x; });
  data.readings.forEach(function (x) { byR[x.id] = x; });
  data.fills.forEach(function (x) { byF[x.id] = x; });
  data.prices.forEach(function (x) { byP[x.id] = x; });
  var newer = function (inc, cur) { return !cur || (inc.updatedAt || 0) > (cur.updatedAt || 0); };
  var addV = vs.filter(function (x) { return x && x.id && newer(x, byV[x.id]); });
  var addR = rs.filter(function (x) { return x && x.id && x.vehicleId && newer(x, byR[x.id]); });
  var addF = fl.filter(function (x) { return x && x.id && x.vehicleId && newer(x, byF[x.id]); });
  var addP = pr.filter(function (x) { return x && x.id && x.fuel && x.month && newer(x, byP[x.id]); });
  var addM = ml.filter(function (x) { return x && x.id && x.vehicleId && newer(x, byM[x.id]); });
  var addE = el.filter(function (x) { return x && x.id && x.vehicleId && newer(x, byE[x.id]); });
  var addT = tl.filter(function (x) { return x && x.id && newer(x, byT[x.id]); });
  var addC = cl.filter(function (x) { return x && x.id && x.vehicleId && newer(x, byC[x.id]); });
  var addI = il.filter(function (x) { return x && x.id && x.vehicleId && newer(x, byI[x.id]); });
  if (!addV.length && !addI.length && !addR.length && !addF.length && !addP.length && !addM.length && !addE.length && !addT.length && !addC.length) { toast('Rien de nouveau à importer'); return; }
  if (!confirm('Importer ' + addV.length + ' véhicule(s), ' + addR.length + ' relevé(s), ' + addF.length + ' plein(s) et ' + addP.length + ' prix, ' + addM.length + ' entretien(s) et ' + addE.length + ' dépense(s), ' + addT.length + ' tarif(s) et ' + addC.length + ' recharge(s), ' + addI.length + ' période(s) d\'assurance (nouveaux ou plus récents que ceux de cet appareil) ?')) return;
  var t = db.transaction(['vehicles', 'readings', 'fills', 'prices', 'maints', 'expenses', 'tariffs', 'charges', 'insur', 'deleted'], 'readwrite');
  addI.forEach(function (x) { t.objectStore('insur').put(x); t.objectStore('deleted').delete(x.id); });
  addT.forEach(function (x) { t.objectStore('tariffs').put(x); t.objectStore('deleted').delete(x.id); });
  addC.forEach(function (x) { t.objectStore('charges').put(x); t.objectStore('deleted').delete(x.id); });
  addM.forEach(function (x) { t.objectStore('maints').put(x); t.objectStore('deleted').delete(x.id); });
  addE.forEach(function (x) { t.objectStore('expenses').put(x); t.objectStore('deleted').delete(x.id); });
  addF.forEach(function (x) { t.objectStore('fills').put(x); t.objectStore('deleted').delete(x.id); });
  addP.forEach(function (x) { t.objectStore('prices').put(x); t.objectStore('deleted').delete(x.id); });
  addV.forEach(function (x) { t.objectStore('vehicles').put(x); t.objectStore('deleted').delete(x.id); });
  addR.forEach(function (x) { t.objectStore('readings').put(x); t.objectStore('deleted').delete(x.id); });
  await done(t); await reload(); render(); toast('Import terminé');
}
async function wipe() {
  if (!confirm('Effacer TOUTES les données de cet appareil ?')) return;
  if (!confirm('Dernière confirmation : véhicules, relevés, pleins, prix, entretiens, dépenses, tarifs et recharges seront perdus (sauf si vous les avez exportés ou synchronisés ; une synchronisation les rapportera depuis le Drive).')) return;
  var t = db.transaction(['vehicles', 'readings', 'fills', 'prices', 'maints', 'expenses', 'tariffs', 'charges', 'insur', 'atts', 'blobs', 'deleted', 'meta'], 'readwrite');
  ['vehicles', 'readings', 'fills', 'prices', 'maints', 'expenses', 'tariffs', 'charges', 'insur', 'atts', 'blobs', 'deleted', 'meta'].forEach(function (n) { t.objectStore(n).clear(); });
  await done(t); await reload(); go('home'); toast('Données effacées');
}

/* ---------- Événements ---------- */
document.addEventListener('click', function (e) {
  var el = e.target.closest('[data-act]');
  if (!el) return;
  var act = el.getAttribute('data-act'), id = el.getAttribute('data-id');
  var run = function (p) { p.catch(function (err) { toast('Erreur : ' + (err && err.message ? err.message : err)); }); };
  switch (act) {
    case 'tab': closeSheet(); go(el.getAttribute('data-tab')); break;
    case 'open': go('vehicle', id); break;
    case 'addVehicle': vehicleForm(null); break;
    case 'editVehicle': vehicleForm(id); break;
    case 'addReading': readingForm(id || (state.tab === 'vehicle' ? state.vehicleId : null), null); break;
    case 'editReading': readingForm(null, id); break;
    case 'delReading': run(deleteReading(id)); break;
    case 'delVehicle': run(deleteVehicle(id)); break;
    case 'closeSheet': closeSheet(); break;
    case 'addExtra': $('#extras').insertAdjacentHTML('beforeend', extraRow('', '')); break;
    case 'rmExtra': el.closest('.xrow').remove(); break;
    case 'export': run(doExport()); break;
    case 'copyExport': run(copyExport()); break;
    case 'import': $('#importFile').click(); break;
    case 'importPaste': run(importText(($('#pasteBox').value || '').trim())); break;
    case 'wipe': run(wipe()); break;
  }
});
document.addEventListener('change', function (e) {
  if (e.target && e.target.id === 'importFile' && e.target.files && e.target.files[0]) {
    var f = e.target.files[0], rd = new FileReader();
    rd.onload = function () { importText(String(rd.result)).catch(function (err) { toast('Erreur : ' + err.message); }); };
    rd.readAsText(f); e.target.value = '';
  }
});
document.addEventListener('submit', function (e) {
  e.preventDefault();
  var f = e.target, p = null;
  if (f.id === 'vform') p = saveVehicle(f); else if (f.id === 'rform') p = saveReading(f);
  if (p) p.catch(function (err) { toast('Erreur : ' + (err && err.message ? err.message : err)); });
});

/* ---------- Démarrage ---------- */
(async function init() {
  try {
    db = await openDB();
    await reload();
  } catch (e) {
    $('#main').innerHTML = '<div class="card warn"><b>Stockage indisponible.</b><div class="muted">Le navigateur refuse la base locale (navigation privée ?). ' + esc(e && e.message) + '</div></div>';
    return;
  }
  render();
})();

/* ---------- Saisie de date au clavier (jj/mm/aaaa) + calendrier ---------- */
function parseDateFr(t) {
  t = String(t || '').trim(); if (!t) return '';
  var m = t.match(/^(\d{1,2})[\/.\-\s](\d{1,2})(?:[\/.\-\s](\d{2}|\d{4}))?$/), d, mo, y;
  if (m) { d = +m[1]; mo = +m[2]; y = m[3]; }
  else if ((m = t.match(/^(\d{2})(\d{2})(\d{2}|\d{4})?$/))) { d = +m[1]; mo = +m[2]; y = m[3]; }
  else if ((m = t.match(/^(\d{4})-(\d{2})-(\d{2})$/))) { d = +m[3]; mo = +m[2]; y = m[1]; }
  else return null;
  var now = new Date(); y = y == null ? now.getFullYear() : (String(y).length === 2 ? 2000 + +y : +y);
  var dt = new Date(Date.UTC(y, mo - 1, d)); if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return y + '-' + ('0' + mo).slice(-2) + '-' + ('0' + d).slice(-2);
}
function enhanceDates(root) {
  var setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
  [].forEach.call(root.querySelectorAll('input[type=date]'), function (nat) {
    if (nat.getAttribute('data-enh')) return; nat.setAttribute('data-enh', '1');
    var req = nat.required, wrap = document.createElement('div'); wrap.className = 'dwrap';
    var tx = document.createElement('input'); tx.type = 'text'; tx.inputMode = 'numeric'; tx.placeholder = 'jj/mm/aaaa'; tx.autocomplete = 'off'; tx.className = 'dtxt'; if (req) tx.required = true;
    var btn = document.createElement('button'); btn.type = 'button'; btn.className = 'dbtn'; btn.setAttribute('aria-label', 'Choisir dans le calendrier'); btn.textContent = '📅';
    nat.parentNode.insertBefore(wrap, nat); wrap.appendChild(tx); wrap.appendChild(btn); wrap.appendChild(nat);
    nat.required = false; nat.className = (nat.className ? nat.className + ' ' : '') + 'dnat'; nat.tabIndex = -1;
    var show = function () { var v = nat.value; tx.value = v ? v.slice(8, 10) + '/' + v.slice(5, 7) + '/' + v.slice(0, 4) : ''; tx.setCustomValidity(''); };
    Object.defineProperty(nat, 'value', { configurable: true, get: function () { return setter.get.call(nat); }, set: function (v) { setter.set.call(nat, v); show(); } });
    show();
    var busy = false;
    tx.addEventListener('input', function () {
      busy = true;
      var iso = parseDateFr(tx.value);
      if (tx.value.trim() === '') { setter.set.call(nat, ''); tx.setCustomValidity(''); }
      else if (iso && /^\d{1,2}\D\d{1,2}\D\d{2,4}$|^\d{6}$|^\d{8}$|^\d{4}-\d{2}-\d{2}$/.test(tx.value.trim())) { setter.set.call(nat, iso); tx.setCustomValidity(''); }
      else { setter.set.call(nat, ''); tx.setCustomValidity('Date invalide (jj/mm/aaaa)'); }
      nat.dispatchEvent(new Event('change', { bubbles: true })); busy = false;
    });
    tx.addEventListener('blur', function () { var iso = parseDateFr(tx.value); if (iso) { setter.set.call(nat, iso); show(); nat.dispatchEvent(new Event('change', { bubbles: true })); } });
    nat.addEventListener('change', function () { if (!busy) show(); });
    btn.addEventListener('click', function () { try { nat.showPicker(); } catch (e) { nat.focus(); nat.click(); } });
  });
}
