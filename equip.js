'use strict';
/* Équipements (0.10) : chaudière fioul et autres. Un équipement est une fiche du magasin « vehicles » marquée equip:true :
   il reprend donc tel quel les entretiens, les dépenses, les pièces jointes, la synchro et l'export.
   Les remplissages de cuve sont des enregistrements « fills » (litres, prix au litre, montant) rattachés à l'équipement. */

function isEquip(v) { return !!(v && v.equip); }
function equipList(status) {
  return data.vehicles.filter(function (v) { return v.equip && (v.status || 'actuel') === status; })
    .sort(function (a, b) { return (a.name || '').localeCompare(b.name || '', 'fr'); });
}
function equipCard(v) {
  var old = (v.status || 'actuel') === 'ancien', n = vehFills(v.id).length, last = vehFills(v.id).slice(-1)[0];
  return '<div class="card tap" data-act="open" data-id="' + esc(v.id) + '"><div class="row"><div>' +
    '<div class="big">🔥 ' + esc(v.name) + (old ? '<span class="tag old">ancien</span>' : '') + '</div>' +
    '<div class="muted">' + esc([v.type, [v.make, v.model].filter(Boolean).join(' ')].filter(Boolean).join(' · ') || '—') + '</div></div>' +
    '<div style="text-align:right"><div class="big">' + (n ? n + ' remplissage' + (n > 1 ? 's' : '') : '') + '</div>' +
    '<div class="muted">' + (last ? 'dernier le ' + fmtDate(last.date) : '') + '</div></div></div></div>';
}
function equipsSection() {
  var cur = equipList('actuel'), old = equipList('ancien');
  var h = '<h2>Équipements</h2><div class="actions"><button data-act="addEquip">＋ Équipement (chaudière…)</button></div>';
  if (!cur.length && !old.length) return h + '<div class="card empty">Aucun équipement. Ajoutez par exemple votre chaudière fioul : entretien et remplissages de cuve.</div>';
  return h + cur.concat(old).map(equipCard).join('');
}

/* ---------- Statistiques de cuve ---------- */
function seasonOf(ds) { var y = +ds.slice(0, 4), m = +ds.slice(5, 7); var s = m >= 7 ? y : y - 1; return s + '-' + (s + 1); } // saison de chauffe : 1er juillet → 30 juin
function cuveStats(id) {
  var fs = vehFills(id).slice().sort(function (a, b) { return a.date.localeCompare(b.date); });
  var o = { n: fs.length, liters: 0, eur: 0, litersPriced: 0, seasons: [], avgGap: null, perYear: null };
  if (!fs.length) return o;
  var seas = {};
  fs.forEach(function (f) {
    o.liters += f.liters; var c = fillCost(f);
    var k = seasonOf(f.date), s = seas[k] || (seas[k] = { label: k, n: 0, liters: 0, eur: 0, lp: 0 });
    s.n++; s.liters += f.liters; if (c != null) { o.eur += c; o.litersPriced += f.liters; s.eur += c; s.lp += f.liters; }
  });
  o.seasons = Object.keys(seas).sort().reverse().map(function (k) { return seas[k]; });
  if (fs.length >= 2) {
    var days = dayNum(fs[fs.length - 1].date) - dayNum(fs[0].date);
    if (days > 0) {
      o.avgGap = days / (fs.length - 1);
      o.perYear = (o.liters - fs[fs.length - 1].liters) / days * 365; // le dernier remplissage n'est pas encore consommé
    }
  }
  o.avgPrice = o.litersPriced > 0 ? o.eur / o.litersPriced : null;
  return o;
}
function cuveItem(f) {
  var c = fillCost(f);
  return '<div class="item"><div><b>' + fmtDate(f.date) + '</b> · ' + fmtL(f.liters) +
    '<div class="muted">' + [fmtPpl(f.ppl), c != null ? fmtEur(c) : '', f.station || ''].filter(function (x) { return x && x !== '–'; }).join(' · ') + '</div></div>' +
    '<div><button class="link" data-act="editCuve" data-id="' + esc(f.id) + '">Modifier</button></div></div>';
}
function cuveSection(v) {
  var s = cuveStats(v.id), fs = vehFills(v.id).slice().reverse();
  var h = '<h2>Cuve et remplissages</h2>';
  if (s.n) {
    h += '<div class="card">' + kv([
      ['Remplissages', String(s.n)], ['Litres achetés', fmtL(s.liters)], ['Dépense', fmtEur(s.eur)],
      ['Prix moyen payé', s.avgPrice != null ? fmtPpl(s.avgPrice) : ''],
      ['Intervalle moyen entre remplissages', s.avgGap != null ? Math.round(s.avgGap) + ' jours' : ''],
      ['Consommation estimée par an', s.perYear != null ? fmtL(s.perYear) : '']]) +
      '<div class="muted">La consommation estimée = litres achetés (sauf le dernier remplissage) ÷ durée entre le premier et le dernier remplissage ; elle suppose une cuve remplie à un niveau comparable. ' + (v.capacity ? 'Capacité de la cuve : ' + esc(v.capacity) + '.' : '') + '</div></div>';
    h += '<h3>Par saison de chauffe (juillet → juin)</h3><div class="card list">' + s.seasons.map(function (x) {
      return '<div class="item"><div><b>' + esc(x.label) + '</b><div class="muted">' + x.n + ' remplissage' + (x.n > 1 ? 's' : '') + (x.lp ? ' · ' + fmtPpl(x.eur / x.lp) : '') + '</div></div><div style="text-align:right"><b>' + fmtL(x.liters) + '</b><div class="muted">' + fmtEur(x.eur) + '</div></div></div>';
    }).join('') + '</div>';
  } else h += '<div class="card muted">Aucun remplissage enregistré.</div>';
  h += '<div class="actions"><button class="primary" data-act="addCuve" data-id="' + esc(v.id) + '">＋ Remplissage de cuve</button></div>';
  if (fs.length) h += '<h3>Remplissages (' + fs.length + ')</h3><div class="card list">' + fs.map(cuveItem).join('') + '</div>';
  return h;
}

/* ---------- Vue d'un équipement ---------- */
function viewEquip(v) {
  var old = (v.status || 'actuel') === 'ancien', as = attsOf('vehicle', v.id);
  var h = '<div class="actions"><button class="link" data-act="tab" data-tab="vehicles">‹ Véhicules</button></div>' +
    '<h1>🔥 ' + esc(v.name) + (old ? '<span class="tag old">ancien</span>' : '<span class="tag">actuel</span>') + '</h1>';
  h += '<div class="actions"><button data-act="editEquip" data-id="' + esc(v.id) + '">Modifier la fiche</button></div>';
  h += '<h2>Fiche technique</h2><div class="card">' + kv([
    ['Type', v.type], ['Marque', v.make], ['Modèle', v.model], ['Puissance', v.powerKw ? v.powerKw + ' kW' : ''], ['Combustible', v.energy],
    ['Capacité de la cuve', v.capacity], ['Emplacement', v.place], ['Mise en service', v.since ? fmtDate(v.since) : ''],
    ['N° de série', v.vin]].concat((v.extra || []).map(function (e) { return [e.k, e.v]; }))) + '</div>';
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
    fld('Emplacement', 'place', v.place, { ph: 'Cave, garage…' }) +
    fld('Mise en service', 'since', v.since, { type: 'date' }) +
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
    powerKw: g('powerKw'), capacity: g('capacity'), place: g('place'), since: g('since'), vin: g('vin'), notes: g('notes'), updatedAt: Date.now() });
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
    '<div class="pair"><div>' + fld('Litres', 'liters', f ? f.liters : '', { inputmode: 'decimal', req: true }) + '</div><div>' +
    fld('Prix au litre (€)', 'ppl', f ? f.ppl : '', { inputmode: 'decimal', ph: last && last.ppl ? 'dernier : ' + String(last.ppl).replace('.', ',') : '' }) + '</div></div>' +
    fld('Montant total (€)', 'total', f ? f.total : '', { inputmode: 'decimal' }) +
    '<div class="muted">Deux des trois valeurs (litres, prix au litre, montant) suffisent : la troisième est calculée.</div>' +
    fld('Fournisseur (facultatif)', 'station', f ? f.station : '') +
    (f ? '<div class="actions"><button type="button" class="danger" data-act="delCuve" data-id="' + esc(f.id) + '">Supprimer ce remplissage</button></div>' : '') +
    '<div class="formbar"><button type="button" data-act="closeSheet">Annuler</button><button class="primary" type="submit">Enregistrer</button></div></form>';
  openSheet(h);
}
async function saveCuve(form) {
  var fd = new FormData(form), id = form.getAttribute('data-id'), vid = form.getAttribute('data-vid'), g = function (k) { return (fd.get(k) || '').toString().trim(); };
  var date = g('date'), L = num(g('liters')), P = num(g('ppl')), T = num(g('total'));
  if (!date || !(L > 0)) { toast('Date et litres requis'); return; }
  if (P == null && T != null) P = Math.round(T / L * 1000) / 1000;
  if (T == null && P != null) T = Math.round(L * P * 100) / 100;
  var old = id ? data.fills.filter(function (x) { return x.id === id; })[0] : null;
  var f = old ? Object.assign({}, old) : { id: uid(), createdAt: Date.now() };
  Object.assign(f, { vehicleId: vid, date: date, km: null, liters: L, ppl: P, total: T, full: true, station: g('station'), updatedAt: Date.now() });
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
});
document.addEventListener('input', function (e) {
  var n = e.target && e.target.name;
  if ((n === 'liters' || n === 'ppl' || n === 'total') && $('#cform')) calcFill(n);
});
document.addEventListener('submit', function (e) {
  var f = e.target, p;
  if (f.id === 'eform') p = saveEquip(f); else if (f.id === 'cform') p = saveCuve(f); else return;
  e.preventDefault(); p.catch(function (err) { toast('Erreur : ' + (err && err.message ? err.message : err)); });
});
document.addEventListener('change', function (e) { // pas de kilométrage pour un équipement
  var t = e.target; if (!t || t.id !== 'f_vid' || !$('#mform')) return;
  var v = data.vehicles.filter(function (x) { return x.id === t.value; })[0], w = $('#kmWrap'); if (w) w.hidden = !!(v && v.equip);
});
