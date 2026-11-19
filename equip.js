'use strict';
/* Équipements (0.10) : chaudière fioul et autres. Un équipement est une fiche du magasin « vehicles » marquée equip:true :
   il reprend donc tel quel les entretiens, les dépenses, les pièces jointes, la synchro et l'export.
   Les remplissages de cuve sont des enregistrements « fills » (litres, prix au litre, montant) rattachés à l'équipement. */

function isEquip(v) { return !!(v && v.equip); }
/* ---------- Jauge de la cuve ---------- */
// Par défaut (cadran imprimé du boîtier, déjà gradué en volume) le % est linéaire. Mode « hauteur » : la jauge indique une hauteur (%) : dans une cuve cylindrique couchée, le volume n'est pas proportionnel à la hauteur
// (la jauge bouge lentement vers 50 %, vite près du vide et du plein). Volume = (θ − sin θ) / 2π avec θ = 2·arccos(1 − 2·hauteur).
function capL(v) { var n = parseFloat(String(v.capacity || '').replace(/\s/g, '').replace(',', '.').replace(/[^0-9.]/g, '')); return n > 0 ? n : null; }
function gaugeFrac(pct, v) {
  var x = Math.min(1, Math.max(0, pct / 100));
  if (v.gaugeMode !== 'hauteur') return x; // défaut : cadran gradué en volume, donc linéaire
  var th = 2 * Math.acos(1 - 2 * x); return (th - Math.sin(th)) / (2 * Math.PI);
}
function gaugeL(pct, v) { var c = capL(v); return (c != null && pct != null && isFinite(pct)) ? c * gaugeFrac(pct, v) : null; }
function cuveFills(id) { return vehFills(id).filter(function (f) { return !f.reading; }); }
function equipList(status) {
  return data.vehicles.filter(function (v) { return v.equip && (v.status || 'actuel') === status; })
    .sort(function (a, b) { return (a.name || '').localeCompare(b.name || '', 'fr'); });
}
function equipCard(v) {
  var old = (v.status || 'actuel') === 'ancien', n = cuveFills(v.id).length, last = cuveFills(v.id).slice(-1)[0];
  return '<div class="card tap" data-act="open" data-id="' + esc(v.id) + '"><div class="row"><div>' +
    '<div class="big">🔥 ' + esc(v.name) + (old ? '<span class="tag old">ancien</span>' : '') + '</div>' +
    '<div class="muted">' + esc([v.type, [v.make, v.model].filter(Boolean).join(' ')].filter(Boolean).join(' · ') || '—') + '</div></div>' +
    '<div style="text-align:right"><div class="big">' + (n ? n + ' remplissage' + (n > 1 ? 's' : '') : '') + '</div>' +
    '<div class="muted">' + (last ? 'dernier le ' + fmtDate(last.date) : '') + '</div></div></div></div>';
}
function viewEquips() {
  var cur = equipList('actuel'), old = equipList('ancien');
  var h = '<h1>Équipements</h1><div class="actions"><button class="primary" data-act="addEquip">＋ Ajouter un équipement</button></div>';
  h += '<h2>Actuels</h2>' + (cur.length ? cur.map(equipCard).join('') : '<div class="card empty">Aucun équipement. Ajoutez par exemple votre chaudière fioul : entretien et remplissages de cuve.</div>');
  if (old.length) h += '<h2>Anciens</h2>' + old.map(equipCard).join('');
  return h;
}

/* ---------- Statistiques de cuve ---------- */
function seasonOf(ds) { var y = +ds.slice(0, 4), m = +ds.slice(5, 7); var s = m >= 6 ? y : y - 1; return s + '-' + (s + 1); } // saison de chauffe : 1er juin → 31 mai
function cuveStats(id) {
  var fs = cuveFills(id).slice().sort(function (a, b) { return a.date.localeCompare(b.date); });
  var o = { n: fs.length, liters: 0, eur: 0, litersPriced: 0, seasons: [], avgGap: null, perYear: null };
  if (!fs.length) return o;
  var seas = {};
  fs.forEach(function (f) {
    o.liters += f.liters || 0; var c = fillCost(f);
    var k = seasonOf(f.date), s = seas[k] || (seas[k] = { label: k, n: 0, liters: 0, eur: 0, lp: 0 });
    s.n++; s.liters += f.liters || 0; if (c != null) { o.eur += c; o.litersPriced += f.liters || 0; s.eur += c; s.lp += f.liters || 0; }
  });
  o.seasons = Object.keys(seas).sort().reverse().map(function (k) { return seas[k]; });
  if (fs.length >= 2) {
    var days = dayNum(fs[fs.length - 1].date) - dayNum(fs[0].date);
    if (days > 0) {
      o.avgGap = days / (fs.length - 1);
      o.perYear = (o.liters - (fs[fs.length - 1].liters || 0)) / days * 365; // le dernier remplissage n'est pas encore consommé
    }
  }
  o.avgPrice = o.litersPriced > 0 ? o.eur / o.litersPriced : null;
  var ev = data.vehicles.filter(function (x) { return x.id === id; })[0];
  if (ev) { var M = seasonModel(ev); if (M.lanTotal != null) { o.perYear = M.lanTotal; o.src = M.src; } }
  return o;
}
function cuveItem(f) {
  var c = fillCost(f);
  var g = (f.gb != null || f.ga != null) ? 'jauge ' + (f.gb != null ? f.gb + ' %' : '?') + ' → ' + (f.ga != null ? f.ga + ' %' : '?') : '';
  return '<div class="item"><div><b>' + fmtDate(f.date) + '</b> · ' + fmtL(f.liters) +
    '<div class="muted">' + [fmtPpl(f.ppl), c != null ? fmtEur(c) : '', g, f.station || ''].filter(function (x) { return x && x !== '–'; }).join(' · ') + '</div></div>' +
    '<div><button class="link" data-act="editCuve" data-id="' + esc(f.id) + '">Modifier</button></div></div>';
}
function cuveSection(v) {
  var s = cuveStats(v.id), fs = cuveFills(v.id).slice().reverse();
  var h = '<h2>Cuve et remplissages</h2>';
  if (s.n) {
    h += '<div class="card">' + kv([
      ['Remplissages', String(s.n)], ['Litres achetés', fmtL(s.liters)], ['Dépense', fmtEur(s.eur)],
      ['Prix moyen payé', s.avgPrice != null ? fmtPpl(s.avgPrice) : ''],
      ['Intervalle moyen entre remplissages', s.avgGap != null ? Math.round(s.avgGap) + ' jours' : ''],
      [s.src ? 'Consommation moyenne par an (' + s.src + ')' : 'Consommation estimée par an', s.perYear != null ? fmtL(s.perYear) : '']]) +
      '<div class="muted">' + (s.src ? 'Calculée selon la source indiquée (voir « Consommation et tendance »). ' : '') + 'Sinon : litres achetés (sauf le dernier remplissage) ÷ durée entre le premier et le dernier remplissage. ' + (v.capacity ? 'Capacité de la cuve : ' + esc(v.capacity) + '.' : '') + '</div></div>';
    h += '<h3>Par saison de chauffe (juin → mai)</h3><div class="card list">' + s.seasons.map(function (x) {
      return '<div class="item"><div><b>' + esc(x.label) + '</b><div class="muted">' + x.n + ' remplissage' + (x.n > 1 ? 's' : '') + (x.lp ? ' · ' + fmtPpl(x.eur / x.lp) : '') + '</div></div><div style="text-align:right"><b>' + fmtL(x.liters) + '</b><div class="muted">' + fmtEur(x.eur) + '</div></div></div>';
    }).join('') + '</div>';
  } else h += '<div class="card muted">Aucun remplissage enregistré.</div>';
  h += gaugeSection(v);
  h += '<div class="actions"><button class="primary" data-act="addCuve" data-id="' + esc(v.id) + '">＋ Remplissage de cuve</button><button data-act="addJauge" data-id="' + esc(v.id) + '">＋ Relevé de jauge</button><button data-act="impCuve" data-id="' + esc(v.id) + '">Coller une liste (papier)</button></div>';
  if (fs.length) h += '<h3>Remplissages (' + fs.length + ')</h3><div class="card list">' + fs.map(cuveItem).join('') + '</div>';
  return h;
}

/* ---------- Vue d'un équipement ---------- */
function viewEquip(v) {
  var old = (v.status || 'actuel') === 'ancien', as = attsOf('vehicle', v.id);
  var h = '<div class="actions"><button class="link" data-act="tab" data-tab="equips">‹ Équipements</button></div>' +
    '<h1>🔥 ' + esc(v.name) + (old ? '<span class="tag old">ancien</span>' : '<span class="tag">actuel</span>') + '</h1>';
  h += '<div class="actions"><button data-act="editEquip" data-id="' + esc(v.id) + '">Modifier la fiche</button></div>';
  h += '<h2>Fiche technique</h2><div class="card">' + kv([
    ['Type', v.type], ['Marque', v.make], ['Modèle', v.model], ['Puissance', v.powerKw ? v.powerKw + ' kW' : ''], ['Combustible', v.energy],
    ['Capacité de la cuve', v.capacity], ['Emplacement', v.place], ['Mise en service', v.since ? fmtDate(v.since) : ''],
    ['N° de série', v.vin], ['Prix d\'achat', (v.purchase || {}).price != null ? fmtEur(v.purchase.price) : ''], ['Date d\'achat', (v.purchase || {}).date ? fmtDate(v.purchase.date) : '']].concat((v.extra || []).map(function (e) { return [e.k, e.v]; }))) + '</div>';
  if (v.notes) h += '<h2>Remarques</h2><div class="card" style="white-space:pre-wrap">' + esc(v.notes) + '</div>';
  if (as.length) h += '<h2>Documents</h2><div class="card list">' + as.map(function (a) {
    return '<div class="item"><div>' + (/^image\//.test(a.mime) ? '🖼 ' : '📄 ') + esc(a.name) + (a.driveId ? '' : ' <span class="tag old">à envoyer</span>') + '</div><button class="link" data-act="attView" data-id="' + esc(a.id) + '">Voir</button></div>';
  }).join('') + '</div>';
  h += cuveSection(v) + maintVehicleSection(v);
  h += '<h2>Zone sensible</h2><div class="actions"><button class="danger" data-act="delEquip" data-id="' + esc(v.id) + '">Supprimer cet équipement</button></div>';
  return h;
}

/* ---------- Fiche de l'équipement ---------- */
function equipForm(id) {
  var v = id ? data.vehicles.filter(function (x) { return x.id === id; })[0] : null;
  v = v || { type: 'Chaudière fioul', energy: 'Fioul', status: 'actuel', extra: [] };
  var status = v.status || 'actuel';
  var h = '<h1>' + (id ? 'Modifier l\'équipement' : 'Nouvel équipement') + '</h1><form id="eform" data-id="' + esc(id || '') + '">' +
    fld('Nom', 'name', v.name, { req: true, ph: 'ex. Chaudière fioul' }) +
    fld('Type', 'type', v.type, { ph: 'Chaudière fioul, poêle…' }) +
    fld('Combustible', 'energy', v.energy, { ph: 'Fioul' }) +
    '<label>Statut</label><div class="seg"><label><input type="radio" name="status" value="actuel"' + (status === 'actuel' ? ' checked' : '') + '><span>Actuel</span></label>' +
    '<label><input type="radio" name="status" value="ancien"' + (status === 'ancien' ? ' checked' : '') + '><span>Ancien</span></label></div>' +
    '<fieldset><legend>Fiche technique</legend>' +
    fld('Marque', 'make', v.make) + fld('Modèle', 'model', v.model) +
    fld('Puissance (kW)', 'powerKw', v.powerKw, { inputmode: 'decimal' }) +
    fld('Capacité de la cuve (ex. 1 500 L)', 'capacity', v.capacity) +
    '<label for="f_gaugeMode">La jauge indique</label><select id="f_gaugeMode" name="gaugeMode"><option value="volume"' + (v.gaugeMode !== 'hauteur' ? ' selected' : '') + '>Le volume (cadran gradué en % de volume, cas habituel)</option><option value="hauteur"' + (v.gaugeMode === 'hauteur' ? ' selected' : '') + '>La hauteur de fioul (cuve couchée : % non proportionnel au volume)</option></select>' +
    fld('Emplacement', 'place', v.place, { ph: 'Cave, garage…' }) +
    fld('Mise en service', 'since', v.since, { type: 'date' }) +
    fld('Prix d\'achat (€)', 'price', (v.purchase || {}).price, { inputmode: 'decimal' }) +
    fld('Date d\'achat', 'pdate', (v.purchase || {}).date, { type: 'date' }) +
    fld('N° de série (facultatif)', 'vin', v.vin) +
    '</fieldset><h2>Documents</h2><div id="attBox"></div>' +
    '<label for="f_notes">Remarques</label><textarea id="f_notes" name="notes">' + esc(v.notes || '') + '</textarea>' +
    '<div class="formbar"><button type="button" data-act="closeSheet">Annuler</button><button class="primary" type="submit">Enregistrer</button></div></form>';
  openSheet(h); attInit('vehicle', id || '');
}
async function saveEquip(form) {
  var fd = new FormData(form), id = form.getAttribute('data-id'), g = function (k) { return (fd.get(k) || '').toString().trim(); };
  if (!g('name')) { toast('Nom requis'); return; }
  var old = id ? data.vehicles.filter(function (x) { return x.id === id; })[0] : null;
  var v = old ? Object.assign({}, old) : { id: uid(), createdAt: Date.now(), purchase: {}, exit: {}, extra: [] };
  Object.assign(v, { equip: true, name: g('name'), type: g('type'), energy: g('energy') || 'Fioul', status: g('status') || 'actuel', make: g('make'), model: g('model'),
    powerKw: g('powerKw'), capacity: g('capacity'), gaugeMode: g('gaugeMode') || 'volume', place: g('place'), since: g('since'), vin: g('vin'), notes: g('notes'), updatedAt: Date.now() });
  v.purchase = Object.assign({}, v.purchase || {}, { price: num(g('price')), date: g('pdate') });
  if (!v.fuel && /fioul/i.test(v.energy)) v.fuel = 'Fioul';
  await dbPut('vehicles', v);
  await attCommit('vehicle', v.id, v.id, v.name);
  await reload(); closeSheet(); go('vehicle', v.id); toast('Équipement enregistré');
}

/* ---------- Remplissage de cuve ---------- */
function cuveForm(equipId, fillId) {
  var f = fillId ? data.fills.filter(function (x) { return x.id === fillId; })[0] : null, vid = f ? f.vehicleId : equipId;
  var v = data.vehicles.filter(function (x) { return x.id === vid; })[0]; if (!v) return;
  var last = !f ? vehFills(vid).slice(-1)[0] : null;
  var h = '<h1>' + (f ? 'Modifier le remplissage' : 'Remplissage de cuve') + ' · ' + esc(v.name) + '</h1><form id="cform" data-id="' + esc(f ? f.id : '') + '" data-vid="' + esc(vid) + '">' +
    fld('Date', 'date', f ? f.date : todayStr(), { type: 'date', req: true }) +
    '<div class="pair"><div>' + fld('Litres', 'liters', f ? f.liters : '', { inputmode: 'decimal' }) + '</div><div>' +
    fld('Prix au litre (€)', 'ppl', f ? f.ppl : '', { inputmode: 'decimal', ph: last && last.ppl ? 'dernier : ' + String(last.ppl).replace('.', ',') : '' }) + '</div></div>' +
    fld('Montant total (€)', 'total', f ? f.total : '', { inputmode: 'decimal' }) +
    '<div class="muted">Deux des trois valeurs (litres, prix au litre, montant) suffisent : la troisième est calculée.</div>' +
    '<h2>Jauge (facultatif)</h2><div class="pair"><div>' + fld('Avant le remplissage (%)', 'gb', f && f.gb != null ? f.gb : '', { inputmode: 'decimal' }) + '</div><div>' + fld('Après (%)', 'ga', f && f.ga != null ? f.ga : '', { inputmode: 'decimal' }) + '</div></div>' +
    '<div class="muted" id="gHint"></div>' +
    fld('Fournisseur (facultatif)', 'station', f ? f.station : '') +
    (f ? '<div class="actions"><button type="button" class="danger" data-act="delCuve" data-id="' + esc(f.id) + '">Supprimer ce remplissage</button></div>' : '') +
    '<div class="formbar"><button type="button" data-act="closeSheet">Annuler</button><button class="primary" type="submit">Enregistrer</button></div></form>';
  openSheet(h);
}
async function saveCuve(form) {
  var fd = new FormData(form), id = form.getAttribute('data-id'), vid = form.getAttribute('data-vid'), g = function (k) { return (fd.get(k) || '').toString().trim(); };
  var date = g('date'), L = num(g('liters')), P = num(g('ppl')), T = num(g('total')), gb = num(g('gb')), ga = num(g('ga'));
  var ev = data.vehicles.filter(function (x) { return x.id === vid; })[0];
  if (!(L > 0) && gb != null && ga != null && ev && capL(ev)) L = Math.round(gaugeL(ga, ev) - gaugeL(gb, ev)); // litres déduits de la jauge
  if (!date || !(L > 0)) { toast('Date et litres requis (ou jauge avant et après avec la capacité de la cuve)'); return; }
  if ((gb != null && (gb < 0 || gb > 100)) || (ga != null && (ga < 0 || ga > 100))) { toast('La jauge est entre 0 et 100 %'); return; }
  if (P == null && T != null) P = Math.round(T / L * 1000) / 1000;
  if (T == null && P != null) T = Math.round(L * P * 100) / 100;
  var old = id ? data.fills.filter(function (x) { return x.id === id; })[0] : null;
  var f = old ? Object.assign({}, old) : { id: uid(), createdAt: Date.now() };
  Object.assign(f, { vehicleId: vid, date: date, km: null, liters: L, ppl: P, total: T, full: true, gb: gb, ga: ga, station: g('station'), updatedAt: Date.now() });
  await dbPut('fills', f); await reload(); closeSheet(); go('vehicle', vid); toast('Remplissage enregistré');
}

document.addEventListener('click', function (e) {
  var el = e.target.closest && e.target.closest('[data-act]'); if (!el) return;
  var act = el.getAttribute('data-act'), id = el.getAttribute('data-id');
  var run = function (p) { p.catch(function (err) { toast('Erreur : ' + (err && err.message ? err.message : err)); }); };
  if (act === 'addEquip') equipForm(null);
  else if (act === 'editEquip') equipForm(id);
  else if (act === 'delEquip') run(deleteVehicle(id));
  else if (act === 'addCuve') cuveForm(id, null);
  else if (act === 'editCuve') cuveForm(null, id);
  else if (act === 'delCuve') run(deleteFill(id));
  else if (act === 'setCap') { var ev0 = data.vehicles.filter(function (x) { return x.id === id; })[0]; if (ev0) run(dbPut('vehicles', Object.assign({}, ev0, { capacity: el.getAttribute('data-cap') + ' L', updatedAt: Date.now() })).then(reload).then(function () { go('vehicle', id); toast('Capacité mise à jour'); })); }
  else if (act === 'addJauge') jaugeForm(id, null);
  else if (act === 'editJauge') jaugeForm(null, id);
  else if (act === 'impCuve') impCuveForm(id);
});
document.addEventListener('input', function (e) {
  var n = e.target && e.target.name;
  if ((n === 'liters' || n === 'ppl' || n === 'total') && $('#cform')) calcFill(n);
  if ((n === 'gb' || n === 'ga' || n === 'liters') && $('#cform')) gaugeHint();
});
document.addEventListener('submit', function (e) {
  var f = e.target, p;
  if (f.id === 'eform') p = saveEquip(f); else if (f.id === 'cform') p = saveCuve(f); else if (f.id === 'jform') p = saveJauge(f); else if (f.id === 'iform') p = saveImpCuve(f); else return;
  e.preventDefault(); p.catch(function (err) { toast('Erreur : ' + (err && err.message ? err.message : err)); });
});
document.addEventListener('change', function (e) { // pas de kilométrage pour un équipement
  var t = e.target; if (!t || t.id !== 'f_vid' || !$('#mform')) return;
  var v = data.vehicles.filter(function (x) { return x.id === t.value; })[0], w = $('#kmWrap'); if (w) w.hidden = !!(v && v.equip);
});

/* ---------- Relevé de jauge seul ---------- */
function jaugeForm(equipId, id) {
  var f = id ? data.fills.filter(function (x) { return x.id === id; })[0] : null, vid = f ? f.vehicleId : equipId;
  var v = data.vehicles.filter(function (x) { return x.id === vid; })[0]; if (!v) return;
  var h = '<h1>' + (f ? 'Modifier le relevé' : 'Relevé de jauge') + ' · ' + esc(v.name) + '</h1><form id="jform" data-id="' + esc(f ? f.id : '') + '" data-vid="' + esc(vid) + '">' +
    fld('Date', 'date', f ? f.date : todayStr(), { type: 'date', req: true }) + fld('Jauge (%)', 'ga', f && f.ga != null ? f.ga : '', { inputmode: 'decimal', req: true }) +
    '<div class="muted">Hors remplissage : un relevé de temps en temps (par exemple chaque mois) affine la courbe et la tendance de consommation.' + (capL(v) ? '' : ' Renseignez la capacité de la cuve dans la fiche pour obtenir des litres.') + '</div>' +
    (f ? '<div class="actions"><button type="button" class="danger" data-act="delCuve" data-id="' + esc(f.id) + '">Supprimer ce relevé</button></div>' : '') +
    '<div class="formbar"><button type="button" data-act="closeSheet">Annuler</button><button class="primary" type="submit">Enregistrer</button></div></form>';
  openSheet(h);
}
async function saveJauge(form) {
  var fd = new FormData(form), id = form.getAttribute('data-id'), vid = form.getAttribute('data-vid'), g = function (k) { return (fd.get(k) || '').toString().trim(); };
  var date = g('date'), ga = num(g('ga'));
  if (!date || ga == null || ga < 0 || ga > 100) { toast('Date et jauge (0 à 100 %) requis'); return; }
  var old = id ? data.fills.filter(function (x) { return x.id === id; })[0] : null;
  var f = old ? Object.assign({}, old) : { id: uid(), createdAt: Date.now() };
  Object.assign(f, { vehicleId: vid, date: date, km: null, liters: 0, ppl: null, total: null, full: false, reading: true, gb: null, ga: ga, updatedAt: Date.now() });
  await dbPut('fills', f); await reload(); closeSheet(); go('vehicle', vid); toast('Relevé enregistré');
}
function gaugeHint() {
  var el = $('#gHint'), vid = $('#cform').getAttribute('data-vid'), v = data.vehicles.filter(function (x) { return x.id === vid; })[0]; if (!el || !v) return;
  var gb = num(($('#f_gb') || {}).value), ga = num(($('#f_ga') || {}).value), L = num(($('#f_liters') || {}).value);
  if (!capL(v)) { el.textContent = (gb != null || ga != null) ? 'Renseignez la capacité de la cuve dans la fiche pour convertir la jauge en litres.' : ''; return; }
  var msg = [];
  if (gb != null) msg.push('Avant : ≈ ' + fmtL(gaugeL(gb, v)));
  if (ga != null) msg.push('Après : ≈ ' + fmtL(gaugeL(ga, v)));
  if (gb != null && ga != null) { var d = gaugeL(ga, v) - gaugeL(gb, v); msg.push('Ajouté selon la jauge : ≈ ' + fmtL(d) + (L > 0 ? ' (facturé ' + fmtL(L) + ', écart ' + Math.round((L - d) / L * 100) + ' %)' : '')); }
  el.textContent = msg.join(' · ');
}

/* ---------- Niveau de la cuve, consommation et tendance ---------- */
// Méthode : pour chaque remplissage, niveau après = niveau avant (jauge) + litres facturés (plus fiable que la jauge « après »,
// dont 1 % vaut plusieurs dizaines de litres). Consommation entre deux remplissages = niveau après − niveau avant le suivant.
function gaugeEvents(v) { // [{date, b, a, add, reading}] : niveau (litres) avant et après chaque remplissage ou relevé
  return vehFills(v.id).map(function (f) {
    var b = f.gb != null ? gaugeL(f.gb, v) : null, a = f.ga != null ? gaugeL(f.ga, v) : null, L = f.liters || 0;
    if (f.reading) b = a;
    else if (L > 0) { if (b != null) a = b + L; else if (a != null) b = a - L; }
    return { date: f.date, b: b, a: a, add: f.reading ? 0 : L, reading: !!f.reading };
  });
}
function gaugeSegments(v) { // consommation entre deux niveaux connus
  var ev = gaugeEvents(v), last = null, pend = 0, segs = [];
  ev.forEach(function (e) {
    if (last && e.b != null) {
      var days = dayNum(e.date) - dayNum(last.date), used = last.a + pend - e.b;
      if (days > 0) segs.push({ from: last.date, to: e.date, days: days, used: used, bad: used < -5 });
    }
    if (e.a != null) { last = { date: e.date, a: e.a }; pend = 0; }
    else if (e.b != null) { last = null; pend = 0; }
    else if (last) pend += e.add;
  });
  return segs;
}
var MW = [1.0, 0.9, 0.8, 0.5, 0.25, 0.1, 0.05, 0.05, 0.15, 0.45, 0.75, 1.0]; // poids de chauffe par mois (janv. → déc.) : répartit la consommation dans l'année
var WYEAR = MW.reduce(function (t, w) { return t + w * 365 / 12; }, 0);
function alloc(d0, d1, used, est, out) { // répartit une consommation entre deux dates sur les saisons, selon le poids de chauffe des jours
  if (d1 <= d0) return;
  var per = {}, tot = 0, cur;
  for (cur = d0; cur < d1; cur++) { var ds = new Date(cur * 86400000).toISOString().slice(0, 10), w = MW[+ds.slice(5, 7) - 1], k = seasonOf(ds), o = per[k] || (per[k] = { w: 0, d: 0 }); o.w += w; o.d++; tot += w; }
  Object.keys(per).forEach(function (k) {
    var o = out[k] || (out[k] = { label: k, used: 0, days: 0, w: 0, est: 0 });
    o.used += used * per[k].w / tot; o.days += per[k].d; o.w += per[k].w; if (est) o.est += per[k].d;
  });
}
function seasonModel(v) { // consommation par saison : jauge quand elle existe, sinon estimée avec les livraisons
  var seas = {}, segs = gaugeSegments(v), ok = segs.filter(function (x) { return !x.bad && x.used >= 0; }), nG = 0, nE = 0;
  ok.forEach(function (x) { alloc(dayNum(x.from), dayNum(x.to), x.used, false, seas); nG++; });
  var m = {}; cuveFills(v.id).forEach(function (f) { var o = m[f.date] || (m[f.date] = { date: f.date, liters: 0 }); o.liters += f.liters || 0; });
  var fs = Object.keys(m).sort().map(function (k) { return m[k]; });
  for (var i = 1; i < fs.length; i++) { // entre deux livraisons : on suppose que les litres livrés la première fois ont été consommés avant la suivante
    var a = fs[i - 1], b = fs[i], d0 = dayNum(a.date), d1 = dayNum(b.date), cov = 0;
    ok.forEach(function (x) { cov += Math.max(0, Math.min(d1, dayNum(x.to)) - Math.max(d0, dayNum(x.from))); });
    if (d1 > d0 && cov <= (d1 - d0) / 2) { alloc(d0, d1, a.liters, true, seas); nE++; }
  }
  var rows = Object.keys(seas).sort().map(function (k) { var o = seas[k], cv = o.w / WYEAR; return { label: k, used: o.used, days: o.days, cover: cv, est: o.est > o.days / 2, lan: cv >= 0.2 ? o.used / cv : null, partial: cv < 0.9 }; });
  var used = rows.reduce(function (t, r) { return t + r.used; }, 0), days = rows.reduce(function (t, r) { return t + r.days; }, 0), cvt = rows.reduce(function (t, r) { return t + r.cover; }, 0);
  var tr = rows.filter(function (r) { return r.lan != null && r.cover >= 0.6; }), trend = null;
  if (tr.length >= 2) {
    var xs = tr.map(function (r) { return +r.label.slice(0, 4); }), ys = tr.map(function (r) { return r.lan; }), n = tr.length, mx = xs.reduce(function (a, b) { return a + b; }, 0) / n, my = ys.reduce(function (a, b) { return a + b; }, 0) / n, sxy = 0, sxx = 0;
    xs.forEach(function (x, i) { sxy += (x - mx) * (ys[i] - my); sxx += (x - mx) * (x - mx); });
    trend = { n: n, pct: sxx ? sxy / sxx / my : (ys[n - 1] / ys[0] - 1) / Math.max(1, xs[n - 1] - xs[0]), first: tr[0].label, last: tr[n - 1].label };
  }
  return { rows: rows, used: used, days: days, lanTotal: cvt >= 0.3 ? used / cvt : null, src: nG && nE ? 'jauge + livraisons' : nG ? 'jauge' : 'livraisons', nG: nG, nE: nE, trend: trend };
}
function capEstimate(v) { // capacité de la cuve déduite des remplissages avec jauge avant et après
  var rows = vehFills(v.id).filter(function (f) { return !f.reading && f.gb != null && f.ga != null && f.liters > 0 && gaugeFrac(f.ga, v) - gaugeFrac(f.gb, v) >= 0.08; });
  if (!rows.length) return null;
  var sL = 0, sF = 0, each = rows.map(function (f) { var d = gaugeFrac(f.ga, v) - gaugeFrac(f.gb, v); sL += f.liters; sF += d; return f.liters / d; }).sort(function (a, b) { return a - b; });
  return { n: rows.length, est: sL / sF, med: each[Math.floor(each.length / 2)], min: each[0], max: each[each.length - 1] };
}
function r50(x) { return Math.round(x / 50) * 50; }
function fmtN(x) { return Math.round(x).toLocaleString('fr-FR').replace(/ /g, ' '); }
function seasonChart(rows) { // rows: [{label, lan, ppl, partial}] ; deux courbes : L/an (gauche) et €/L (droite), grille en pointillé
  var W = 340, H = 210, L = 46, R = 44, T = 16, B = 26, n = rows.length, DIV = 5;
  var ls = rows.filter(function (r) { return r.lan != null; }), ps = rows.filter(function (r) { return r.ppl != null; });
  var top = Math.max.apply(null, ls.map(function (r) { return r.lan; }).concat([1])) * 1.1, raw = top / DIV, steps = [10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000], step = steps.filter(function (x) { return x >= raw; })[0] || Math.ceil(raw / 1000) * 1000, lmax = step * DIV;
  var pmin = ps.length ? Math.min.apply(null, ps.map(function (r) { return r.ppl; })) : 0, pmax = ps.length ? Math.max.apply(null, ps.map(function (r) { return r.ppl; })) : 1, pad = (pmax - pmin) * 0.25 || pmax * 0.1 || 0.1; pmin = Math.max(0, pmin - pad); pmax += pad;
  var x = function (i) { return L + (n > 1 ? i / (n - 1) : 0.5) * (W - L - R); }, y = function (f) { return T + (1 - f) * (H - T - B); }, yl = function (v) { return y(v / lmax); }, yp = function (v) { return y((v - pmin) / (pmax - pmin)); };
  var fp = function (v) { return v.toFixed(2).replace('.', ','); };
  var line = function (key, fy, cls, dy, fmt) { var pts = []; rows.forEach(function (r, i) { if (r[key] != null) pts.push([x(i), fy(r[key]), r, i]); }); return (pts.length > 1 ? '<polyline fill="none" class="' + cls + '" points="' + pts.map(function (p) { return p[0].toFixed(1) + ',' + p[1].toFixed(1); }).join(' ') + '"/>' : '') + pts.map(function (p) { return '<circle cx="' + p[0].toFixed(1) + '" cy="' + p[1].toFixed(1) + '" r="3" class="' + cls + 'd' + (p[2].partial && key === 'lan' ? ' part' : '') + '"/><text x="' + p[0].toFixed(1) + '" y="' + (p[1] + dy).toFixed(1) + '" text-anchor="middle" class="gt gv ' + (key === 'lan' ? 'c1' : 'c2') + '">' + (key === 'lan' && p[2].est ? '~' : '') + fmt(p[2][key]) + '</text>'; }).join(''); };
  var h = '<svg viewBox="0 0 ' + W + ' ' + H + '" class="gchart" role="img" aria-label="Consommation annuelle et prix moyen du litre par saison">';
  for (var k = 0; k <= DIV; k++) {
    var f = k / DIV, yy = y(f).toFixed(1);
    h += '<line x1="' + L + '" y1="' + yy + '" x2="' + (W - R) + '" y2="' + yy + '" class="gl"/>' +
      '<text x="' + (L - 5) + '" y="' + (+yy + 3) + '" text-anchor="end" class="gt c1">' + fmtN(lmax * f) + '</text>' +
      '<text x="' + (W - R + 5) + '" y="' + (+yy + 3) + '" class="gt c2">' + fp(pmin + (pmax - pmin) * f) + '</text>';
  }
  h += '<text x="' + L + '" y="9" class="gt c1">L / an</text><text x="' + (W - R) + '" y="9" text-anchor="end" class="gt c2">€ / L</text>';
  rows.forEach(function (r, i) { h += '<line x1="' + x(i).toFixed(1) + '" y1="' + y(0) + '" x2="' + x(i).toFixed(1) + '" y2="' + (y(0) + 3) + '" class="gl2"/><text x="' + x(i).toFixed(1) + '" y="' + (H - 8) + '" text-anchor="middle" class="gt">' + esc(r.label.slice(2, 4) + '-' + r.label.slice(7)) + '</text>'; });
  h += line('lan', yl, 'gp1', -8, fmtN) + line('ppl', yp, 'gp2', 14, fp);
  return h + '</svg><div class="gleg"><span class="c1">● Consommation moyenne par an (L)</span><span class="c2">● Prix moyen du litre (€)</span></div>';
}
function gaugeSection(v) {
  var h = '<h3>Consommation et tendance</h3>', ce = capEstimate(v), cap = capL(v);
  if (ce) {
    var rec = r50(ce.est);
    h += '<div class="card">' + kv([['Capacité estimée de la cuve', '≈ ' + fmtN(ce.est) + ' L'], ['Basée sur', ce.n + ' remplissage' + (ce.n > 1 ? 's' : '') + ' (de ' + fmtN(ce.min) + ' à ' + fmtN(ce.max) + ' L, médiane ' + fmtN(ce.med) + ' L)'], ['Capacité saisie', cap ? fmtN(cap) + ' L' : 'non renseignée']]) +
      '<div class="muted">Litres facturés ÷ variation de la jauge. Chaque lecture est précise à quelques % près : plus il y a de remplissages, plus l\'estimation est fiable.</div>' +
      (cap && Math.abs(rec - cap) < 1 ? '' : '<div class="actions"><button data-act="setCap" data-id="' + esc(v.id) + '" data-cap="' + rec + '">Utiliser ' + fmtN(rec) + ' L comme capacité</button></div>') + '</div>';
  }
  var M = seasonModel(v), ev = gaugeEvents(v).filter(function (e) { return e.b != null || e.a != null; }), hasG = vehFills(v.id).some(function (f) { return f.gb != null || f.ga != null; });
  if (hasG && !cap) h += '<div class="card muted">Renseignez la capacité de la cuve dans la fiche (ou utilisez l\'estimation ci-dessus) pour convertir la jauge en litres.</div>';
  var rows = M.rows;
  if (!rows.length) return h + '<div class="card muted">Il faut au moins deux livraisons à des dates différentes (ou deux niveaux de jauge) pour estimer la consommation.</div>';
  var price = {}; cuveFills(v.id).forEach(function (f) { var c = fillCost(f); if (c > 0 && f.liters > 0) { var k = seasonOf(f.date), o = price[k] || (price[k] = { c: 0, l: 0 }); o.c += c; o.l += f.liters; } });
  Object.keys(price).forEach(function (k) { if (!rows.some(function (r) { return r.label === k; })) rows.push({ label: k, used: 0, days: 0, cover: 0, est: false, lan: null, partial: true }); });
  rows.sort(function (a, b) { return a.label.localeCompare(b.label); });
  rows.forEach(function (r) { var p = price[r.label]; r.ppl = p ? p.c / p.l : null; });
  h += '<div class="card"><div class="muted">Par saison de chauffe (juin → mai)</div>' + seasonChart(rows) + '</div>';
  h += '<div class="card">' + kv([['Source du calcul', M.src], ['Consommation sur la période', fmtL(M.used) + ' sur ' + M.days + ' jours'], ['Équivalent par an', M.lanTotal != null ? fmtL(M.lanTotal) : '—']]) +
    (M.trend ? '<div class="trend">Tendance : ' + (Math.abs(M.trend.pct) < 0.02 ? 'consommation stable' : 'consommation en ' + (M.trend.pct < 0 ? 'baisse' : 'hausse') + ' d\'environ ' + Math.abs(Math.round(M.trend.pct * 100)) + ' % par an') + ' <span class="muted">(' + M.trend.n + ' saisons, de ' + esc(M.trend.first) + ' à ' + esc(M.trend.last) + ')</span></div>' : '') +
    (M.nE ? '<div class="muted">« ~ » = estimé à partir des livraisons seules : on suppose que les litres livrés sont consommés avant la livraison suivante, et la consommation est répartie selon la saison (hiver &gt; été). Un remplissage partiel ou un stock restant décale un peu une saison vers sa voisine, mais l\'erreur s\'annule sur plusieurs années : fiez-vous à la tendance plus qu\'à une saison isolée. Les relevés de jauge rendent le calcul plus précis.</div>' : '') +
    '</div>';
  h += '<h3>Détail par saison</h3><div class="card list">' + rows.slice().reverse().map(function (x, i, arr) {
    var prev = arr.slice(i + 1).filter(function (r) { return r.lan != null; })[0], trend = prev && x.lan != null && x.cover >= 0.6 && prev.cover >= 0.6 ? x.lan / prev.lan - 1 : null;
    return '<div class="item"><div><b>' + esc(x.label) + '</b><div class="muted">' + (x.days ? (x.est ? 'estimée (livraisons)' : 'mesurée (jauge)') + (x.partial ? ' · saison incomplète' : '') : 'pas assez de données') + (trend != null ? ' · ' + (trend >= 0 ? '+' : '') + Math.round(trend * 100) + ' % vs ' + esc(prev.label) : '') + '</div></div>' +
      '<div style="text-align:right"><b>' + (x.lan != null ? (x.est ? '~' : '') + fmtL(x.lan) + ' /an' : '—') + '</b><div class="muted">' + (x.ppl != null ? x.ppl.toFixed(3).replace('.', ',') + ' €/L' : '') + '</div></div></div>';
  }).join('') + '</div>';
  // courbe du niveau (repliée)
  var pts = []; ev.forEach(function (e) { if (e.b != null) pts.push([dayNum(e.date), e.b]); if (e.a != null && !e.reading) pts.push([dayNum(e.date), e.a]); });
  if (cap && pts.length > 1) {
    var x0 = pts[0][0], x1 = pts[pts.length - 1][0] || x0 + 1, W = 300, H = 110, px = function (d) { return 8 + (x1 > x0 ? (d - x0) / (x1 - x0) : 0.5) * (W - 16); }, py = function (l) { return H - 10 - Math.max(0, Math.min(1, l / cap)) * (H - 22); };
    h += '<details class="sect"><summary>Niveau de la cuve dans le temps</summary><div class="card"><svg viewBox="0 0 ' + W + ' ' + H + '" class="gchart" role="img" aria-label="Niveau de la cuve dans le temps"><line x1="8" y1="' + py(cap) + '" x2="' + (W - 8) + '" y2="' + py(cap) + '" class="gl"/><line x1="8" y1="' + py(0) + '" x2="' + (W - 8) + '" y2="' + py(0) + '" class="gl"/>' +
      '<polyline fill="none" class="gp1" points="' + pts.map(function (p) { return px(p[0]).toFixed(1) + ',' + py(p[1]).toFixed(1); }).join(' ') + '"/></svg>' +
      '<div class="row"><span class="muted">' + fmtDate(ev[0].date) + '</span><span class="muted">cuve pleine = ' + fmtL(cap) + '</span><span class="muted">' + fmtDate(ev[ev.length - 1].date) + '</span></div></div></details>';
  }
  var rd = vehFills(v.id).filter(function (f) { return f.reading; }).reverse();
  if (rd.length) h += '<div class="card list">' + rd.map(function (f) { return '<div class="item"><div>' + fmtDate(f.date) + ' · relevé ' + f.ga + ' %' + (cap ? '<div class="muted">≈ ' + fmtL(gaugeL(f.ga, v)) + '</div>' : '') + '</div><button data-act="editJauge" data-id="' + esc(f.id) + '">Modifier</button></div>'; }).join('') + '</div>';
  return h;
}

/* ---------- Import d'une liste (papier) ---------- */
function parseCuveList(text) {
  var out = [], bad = [];
  String(text || '').split(/\r?\n/).forEach(function (line, i) {
    line = line.trim(); if (!line || /^(date|jour)\b/i.test(line)) return;
    var c = line.split(/[;\t]/).map(function (x) { return x.trim(); });
    var d = c[0].match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})$/), date = null;
    if (d) date = (d[3].length === 2 ? '20' + d[3] : d[3]) + '-' + ('0' + d[2]).slice(-2) + '-' + ('0' + d[1]).slice(-2);
    else if (/^\d{4}-\d{2}-\d{2}$/.test(c[0])) date = c[0];
    var L = num(c[1]), P = num(c[2]), gb = num(c[3]), ga = num(c[4]);
    if (!date || (L == null && ga == null)) { bad.push(i + 1); return; }
    out.push({ date: date, liters: L || 0, ppl: P, gb: gb, ga: ga });
  });
  return { rows: out, bad: bad };
}
function impCuveForm(id) {
  var v = data.vehicles.filter(function (x) { return x.id === id; })[0]; if (!v) return;
  openSheet('<h1>Coller une liste · ' + esc(v.name) + '</h1><form id="iform" data-vid="' + esc(id) + '">' +
    '<div class="muted">Une ligne par remplissage, colonnes séparées par « ; » (ou tabulation) : <b>date ; litres ; prix au litre ; jauge avant % ; jauge après %</b>. Les colonnes prix et jauges peuvent être vides. Dates : 25/10/2023 ou 2023-10-25. Une ligne avec seulement la date, une colonne litres vide et la jauge après est un simple relevé de jauge.</div>' +
    '<label for="f_list">Liste</label><textarea id="f_list" name="list" rows="9" placeholder="25/10/2023 ; 1000 ; 1,02 ; 18 ; 85\n12/03/2024 ; ; ; ; 52"></textarea>' +
    '<div class="formbar"><button type="button" data-act="closeSheet">Annuler</button><button class="primary" type="submit">Importer</button></div></form>');
}
async function saveImpCuve(form) {
  var vid = form.getAttribute('data-vid'), r = parseCuveList(new FormData(form).get('list'));
  if (!r.rows.length) { toast('Aucune ligne lisible'); return; }
  var have = {}; vehFills(vid).forEach(function (f) { have[f.date + '|' + (f.liters || 0)] = 1; });
  var add = r.rows.filter(function (x) { var k = x.date + '|' + x.liters; if (have[k]) return false; have[k] = 1; return true; });
  if (!confirm(add.length + ' ligne(s) à importer' + (r.rows.length - add.length ? ', ' + (r.rows.length - add.length) + ' déjà présente(s) ignorée(s)' : '') + (r.bad.length ? ', ' + r.bad.length + ' illisible(s) (lignes ' + r.bad.join(', ') + ')' : '') + '. Continuer ?')) return;
  for (var i = 0; i < add.length; i++) {
    var x = add[i], reading = !(x.liters > 0), T = x.ppl != null && x.liters > 0 ? Math.round(x.liters * x.ppl * 100) / 100 : null;
    await dbPut('fills', { id: uid(), vehicleId: vid, date: x.date, km: null, liters: x.liters, ppl: x.ppl, total: T, full: !reading, reading: reading, gb: reading ? null : x.gb, ga: x.ga, createdAt: Date.now(), updatedAt: Date.now() });
  }
  await reload(); closeSheet(); go('vehicle', vid); toast(add.length + ' ligne(s) importée(s)');
}
