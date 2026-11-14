'use strict';
/* Étape 0.3 — Énergie : pleins, prix moyens mensuels du carburant, conso et coûts.
   Les recharges électriques arrivent à l'étape 0.7. */

function isElec(v) { return /lectrique/i.test(v.energy || '') && !/hybride/i.test(v.energy || ''); }
function fuelOf(v) {
  if (v.fuel) return v.fuel;
  var e = v.energy || '';
  if (/diesel|gazole/i.test(e)) return 'Gazole';
  if (/E85/i.test(e)) return 'E85';
  if (/GPL/i.test(e)) return 'GPL';
  if (/essence|hybride/i.test(e)) return 'SP95-E10';
  return '';
}
function fmtPpl(n) { return n == null ? '–' : new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 3, maximumFractionDigits: 3 }).format(n) + ' €/L'; }
function fmtL(n) { return n == null ? '–' : new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 }).format(n) + ' L'; }
function fmtC(n) { return n == null || !isFinite(n) ? '–' : new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 }).format(n) + ' L/100 km'; }
function fmtM(n) { return n == null || !isFinite(n) ? '–' : new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 3 }).format(n) + '/km'; }
function monthName(m) { var p = m.split('-'); return ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'][Number(p[1]) - 1] + ' ' + p[0]; }

/* ---------- Données et calculs ---------- */
function vehFills(id) {
  return data.fills.filter(function (f) { return f.vehicleId === id; })
    .sort(function (a, b) { return a.date.localeCompare(b.date) || (a.km || 0) - (b.km || 0); });
}
function fillCost(f) { return f.total != null ? f.total : (f.liters != null && f.ppl != null ? f.liters * f.ppl : null); }
function priceRows(fuel) { return data.prices.filter(function (p) { return p.fuel === fuel; }).sort(function (a, b) { return a.month.localeCompare(b.month); }); }
function priceForMonth(fuel, date) {
  var m = (date || '').slice(0, 7), r = priceRows(fuel).filter(function (p) { return p.month === m; })[0];
  return r ? r.price : null;
}
// moyenne des prix mensuels entre deux dates ; à défaut, mois le plus proche ; à défaut, null
function avgPrice(fuel, d1, d2) {
  var rows = priceRows(fuel); if (!rows.length) return null;
  var a = d1.slice(0, 7), b = d2.slice(0, 7), sel = rows.filter(function (p) { return p.month >= a && p.month <= b; });
  if (!sel.length) {
    var mid = a, best = rows[0], bd = 1e9;
    rows.forEach(function (p) { var d = Math.abs((Number(p.month.slice(0, 4)) * 12 + Number(p.month.slice(5))) - (Number(mid.slice(0, 4)) * 12 + Number(mid.slice(5)))); if (d < bd) { bd = d; best = p; } });
    return best.price;
  }
  return sel.reduce(function (s, p) { return s + p.price; }, 0) / sel.length;
}
// Plein à plein : segments entre deux pleins complets successifs
function fillStats(id) {
  var fs = vehFills(id), st = { n: fs.length, liters: 0, eur: 0, eurKnown: 0, segs: [], l100: null, cpk: null, ppl: null };
  fs.forEach(function (f) { st.liters += f.liters || 0; var c = fillCost(f); if (c != null) { st.eur += c; st.eurKnown += f.liters || 0; } });
  if (st.eurKnown > 0) st.ppl = st.eur / st.eurKnown;
  var last = null, accL = 0, accE = 0, accKnown = true;
  fs.filter(function (f) { return f.km != null && f.liters > 0; }).forEach(function (f) {
    if (last) { accL += f.liters; var c = fillCost(f); if (c == null) accKnown = false; else accE += c; }
    if (f.full) {
      if (last && f.km > last.km) st.segs.push({ km: f.km - last.km, liters: accL, eur: accKnown ? accE : null });
      last = f; accL = 0; accE = 0; accKnown = true;
    }
  });
  var km = st.segs.reduce(function (s, x) { return s + x.km; }, 0), L = st.segs.reduce(function (s, x) { return s + x.liters; }, 0);
  if (km > 0) {
    st.kmSeg = km; st.l100 = L / km * 100;
    var ok = st.segs.filter(function (x) { return x.eur != null; }), kmE = ok.reduce(function (s, x) { return s + x.km; }, 0);
    if (kmE > 0) st.cpk = ok.reduce(function (s, x) { return s + x.eur; }, 0) / kmE;
  }
  return st;
}
// Conso moyenne saisie : coût estimé entre les points kilométriques connus
function manualStats(v) {
  var c = v.manualConso; if (!(c > 0)) return null;
  var pts = kmPoints(v).sort(function (a, b) { return a.date.localeCompare(b.date) || a.km - b.km; });
  var out = { km: 0, liters: 0, eur: 0, noPrice: 0, from: null, to: null }, fuel = fuelOf(v);
  for (var i = 1; i < pts.length; i++) {
    var a = pts[i - 1], b = pts[i], km = b.km - a.km; if (!(km > 0)) continue;
    var pr = fuel ? avgPrice(fuel, a.date, b.date) : null; if (pr == null) pr = v.manualPrice > 0 ? v.manualPrice : null;
    out.km += km; out.liters += km * c / 100;
    if (pr == null) out.noPrice += km; else out.eur += km * c / 100 * pr;
    if (!out.from) out.from = a.date; out.to = b.date;
  }
  return out.km > 0 ? out : null;
}

/* ---------- Affichage ---------- */
function statRows(v) {
  var rows = '', fs = fillStats(v.id), mode = v.mode === 'manual' ? 'manual' : 'fills';
  if (mode === 'fills') {
    if (!fs.n) return '<div class="muted">Aucun plein enregistré.</div>';
    rows = kv([['Pleins', String(fs.n)], ['Litres au total', fmtL(fs.liters)], ['Dépensé', fmtEur(fs.eur)], ['Prix moyen payé', fmtPpl(fs.ppl)],
      ['Conso moyenne (plein à plein)', fs.l100 != null ? fmtC(fs.l100) : ''], ['Coût énergie au km', fs.cpk != null ? fmtM(fs.cpk) : '']]);
    if (fs.l100 == null) rows += '<div class="muted">La conso se calcule avec au moins deux pleins complets avec kilométrage.</div>';
    return rows;
  }
  var ms = manualStats(v);
  if (!ms) return '<div class="muted">Mode « Conso moyenne » : renseignez la conso moyenne dans la fiche et au moins deux relevés ou dates avec kilométrage.</div>';
  rows = kv([['Période', fmtDate(ms.from) + ' → ' + fmtDate(ms.to)], ['Kilomètres', fmtKm(ms.km)], ['Litres estimés', fmtL(ms.liters)],
    ['Coût estimé', ms.noPrice < ms.km ? fmtEur(ms.eur) : ''], ['Coût estimé au km', ms.noPrice < ms.km && ms.km ? fmtM(ms.eur / (ms.km - ms.noPrice)) : '']]);
  if (ms.noPrice) rows += '<div class="muted">Prix manquant pour ' + fmtKm(ms.noPrice) + ' : ajoutez des prix dans l\'onglet Énergie ou un prix moyen dans la fiche.</div>';
  return rows + '<div class="muted">Valeurs <b>estimées</b> (conso moyenne × prix moyens mensuels).</div>';
}
function fillItem(f) {
  var c = fillCost(f);
  return '<div class="item"><div><b>' + fmtDate(f.date) + '</b> · ' + fmtL(f.liters) + (f.full ? '' : ' <span class="tag old">partiel</span>') +
    '<div class="muted">' + [f.km != null ? fmtKm(f.km) : '', fmtPpl(f.ppl), c != null ? fmtEur(c) : '', f.station || ''].filter(function (x) { return x && x !== '–'; }).join(' · ') + '</div></div>' +
    '<div><button class="link" data-act="editFill" data-id="' + esc(f.id) + '">Modifier</button></div></div>';
}
function energyVehicleSection(v) {
  if (isElec(v)) return chargeVehicleSection(v);
  var fs = vehFills(v.id).slice().reverse();
  var h = '<h2>Énergie</h2><div class="card">' + statRows(v) + '</div>';
  h += '<div class="actions"><button data-act="addFill" data-id="' + esc(v.id) + '">＋ Plein</button></div>';
  if (fs.length) h += '<h3>Pleins (' + fs.length + ')</h3><div class="card list">' + fs.map(fillItem).join('') + '</div>';
  if (chargeable(v)) h += chargeVehicleSection(v);
  return h;
}
function viewEnergy() {
  var h = '<h1>Énergie</h1><div class="actions"><button class="primary" data-act="addFill">＋ Plein</button><button class="primary" data-act="addCharge">＋ Recharge</button></div>';
  var vs = sortedVehicles('actuel').concat(sortedVehicles('ancien'));
  if (!vs.length) h += '<div class="card empty">Ajoutez d\'abord un véhicule.</div>';
  vs.forEach(function (v) {
    h += '<h2>' + esc(v.name) + '</h2><div class="card">' + (isElec(v) ? chargeStats(v) : statRows(v) + (chargeable(v) ? '<h3>Recharges</h3>' + chargeStats(v) : '')) + '</div>';
  });
  h += othersSection();
  h += '<div class="actions"><button data-act="importCharges">Importer le CSV du chargeur</button></div>';
  h += tariffsSection();
  h += '<h2>Prix moyens du carburant (par mois)</h2><div class="card"><div class="muted">Sert à estimer les périodes sans tickets (mode « Conso moyenne ») et à proposer le prix au litre. Table à remplir à la main pour l\'instant : aucune source gratuite et complète n\'a pu être récupérée automatiquement.</div>' +
    '<div class="actions"><button data-act="addPrice">＋ Un prix</button><button data-act="bulkPrice">Coller une liste</button></div></div>';
  FUELS.forEach(function (fu) {
    var rows = priceRows(fu).reverse(); if (!rows.length) return;
    h += '<details class="card"><summary><b>' + esc(fu) + '</b> <span class="muted">(' + rows.length + ' mois)</span></summary><div class="list">' +
      rows.map(function (p) { return '<div class="item"><div>' + esc(monthName(p.month)) + ' · <b>' + fmtPpl(p.price) + '</b></div><button class="link" data-act="editPrice" data-id="' + esc(p.id) + '">Modifier</button></div>'; }).join('') + '</div></details>';
  });
  return h;
}

/* ---------- Formulaires ---------- */
function fillForm(vehicleId, fillId) {
  var f = fillId ? data.fills.filter(function (x) { return x.id === fillId; })[0] : null;
  var list = data.vehicles.filter(function (v) { return !isElec(v); });
  if (!list.length) { toast(data.vehicles.length ? 'Ce véhicule est électrique : utilisez « ＋ Recharge »' : 'Ajoutez d\'abord un véhicule'); return; }
  var vid = f ? f.vehicleId : (vehicleId && list.some(function (v) { return v.id === vehicleId; }) ? vehicleId : (list.filter(function (v) { return (v.status || 'actuel') === 'actuel'; })[0] || list[0]).id);
  var h = '<h1>' + (f ? 'Modifier le plein' : 'Nouveau plein') + '</h1><form id="fform" data-id="' + esc(f ? f.id : '') + '">' +
    '<label for="f_vid">Véhicule</label><select id="f_vid" name="vehicleId">' +
    list.map(function (v) { return '<option value="' + esc(v.id) + '"' + (v.id === vid ? ' selected' : '') + '>' + esc(v.name) + '</option>'; }).join('') + '</select>' +
    fld('Date', 'date', f ? f.date : todayStr(), { type: 'date', req: true }) +
    fld('Kilométrage au compteur (facultatif)', 'km', f ? f.km : '', { inputmode: 'numeric' }) +
    '<div class="pair"><div>' + fld('Litres', 'liters', f ? f.liters : '', { inputmode: 'decimal', req: true }) + '</div><div>' +
    fld('Prix au litre (€)', 'ppl', f ? f.ppl : '', { inputmode: 'decimal' }) + '</div></div>' +
    fld('Montant total (€)', 'total', f ? f.total : '', { inputmode: 'decimal' }) +
    '<div class="muted" id="fillHint">Deux des trois valeurs (litres, prix au litre, montant) suffisent : la troisième est calculée.</div>' +
    '<label style="display:flex;gap:10px;align-items:center;color:var(--text)"><input type="checkbox" name="full" style="width:auto;min-height:0"' + (!f || f.full ? ' checked' : '') + '> Plein complet (réservoir rempli)</label>' +
    fld('Station (facultatif)', 'station', f ? f.station : '') +
    (f ? '<div class="actions"><button type="button" class="danger" data-act="delFill" data-id="' + esc(f.id) + '">Supprimer ce plein</button></div>' : '') +
    '<div class="formbar"><button type="button" data-act="closeSheet">Annuler</button><button class="primary" type="submit">Enregistrer</button></div></form>';
  openSheet(h); fillHint();
}
function fillHint() {
  var vs = $('#f_vid'), d = $('#f_date'), p = $('#f_ppl'), hint = $('#fillHint'); if (!vs || !d || !p) return;
  var v = data.vehicles.filter(function (x) { return x.id === vs.value; })[0], fu = v ? fuelOf(v) : '', pr = fu ? priceForMonth(fu, d.value) : null;
  p.placeholder = pr != null ? 'moyenne du mois : ' + String(pr).replace('.', ',') : '';
}
function calcFill(changed) {
  var L = num($('#f_liters').value), P = num($('#f_ppl').value), T = num($('#f_total').value);
  var set = function (id, v, d) { $(id).value = String(Math.round(v * d) / d).replace('.', ','); };
  if (changed === 'liters') { if (L > 0 && P != null) set('#f_total', L * P, 100); else if (L > 0 && T != null) set('#f_ppl', T / L, 1000); }
  else if (changed === 'ppl') { if (P > 0 && L != null) set('#f_total', L * P, 100); else if (P > 0 && T != null) set('#f_liters', T / P, 100); }
  else if (changed === 'total') { if (L > 0 && T != null) set('#f_ppl', T / L, 1000); else if (P > 0 && T != null) set('#f_liters', T / P, 100); }
}
async function saveFill(form) {
  var fd = new FormData(form), id = form.getAttribute('data-id'), g = function (k) { return (fd.get(k) || '').toString().trim(); };
  var vid = g('vehicleId'), date = g('date'), km = num(g('km')), L = num(g('liters')), P = num(g('ppl')), T = num(g('total'));
  if (!date || !(L > 0)) { toast('Date et litres requis'); return; }
  if (P == null && T != null) P = Math.round(T / L * 1000) / 1000;
  if (T == null && P != null) T = Math.round(L * P * 100) / 100;
  var v = data.vehicles.filter(function (x) { return x.id === vid; })[0];
  if (km != null) {
    km = Math.round(km);
    var w = kmWarnings(v, date, km, null);
    if (w.length && !confirm('Kilométrage incohérent : ' + w.join(' ; ') + '.\n\nEnregistrer quand même ?')) return;
  }
  var old = id ? data.fills.filter(function (x) { return x.id === id; })[0] : null;
  var f = old ? Object.assign({}, old) : { id: uid(), createdAt: Date.now() };
  f.vehicleId = vid; f.date = date; f.km = km; f.liters = L; f.ppl = P; f.total = T; f.full = !!fd.get('full'); f.station = g('station'); f.updatedAt = Date.now();
  await dbPut('fills', f);
  // le kilométrage d'un plein alimente aussi les relevés (sinon le kilométrage actuel n'avance pas)
  if (km != null && !data.readings.some(function (r) { return r.vehicleId === vid && r.date === date && r.km === km; })) {
    await dbPut('readings', { id: uid(), vehicleId: vid, date: date, km: km, createdAt: Date.now(), updatedAt: Date.now(), fromFill: true });
  }
  await reload(); closeSheet();
  if (state.tab === 'vehicle') go('vehicle', vid); else render();
  toast('Plein enregistré');
}
async function deleteFill(id) {
  var f = data.fills.filter(function (x) { return x.id === id; })[0];
  if (!f || !confirm('Supprimer ce plein du ' + fmtDate(f.date) + ' ?')) return;
  var t = db.transaction(['fills', 'deleted'], 'readwrite');
  t.objectStore('fills').delete(id); t.objectStore('deleted').put({ id: id, kind: 'fill', deletedAt: Date.now() });
  await done(t); await reload(); closeSheet(); if (state.tab === 'vehicle') go('vehicle', f.vehicleId); else render();
}

function priceForm(id) {
  var p = id ? data.prices.filter(function (x) { return x.id === id; })[0] : null;
  var h = '<h1>' + (p ? 'Modifier le prix' : 'Nouveau prix moyen') + '</h1><form id="pform" data-id="' + esc(p ? p.id : '') + '">' +
    '<label for="f_month">Mois</label><input id="f_month" name="month" type="month" required value="' + esc(p ? p.month : todayStr().slice(0, 7)) + '">' +
    '<label for="f_pfuel">Carburant</label><select id="f_pfuel" name="fuel">' + FUELS.map(function (o) { return '<option' + (p && p.fuel === o ? ' selected' : '') + '>' + o + '</option>'; }).join('') + '</select>' +
    fld('Prix moyen du litre (€)', 'price', p ? p.price : '', { inputmode: 'decimal', req: true, ph: 'ex. 1,789' }) +
    (p ? '<div class="actions"><button type="button" class="danger" data-act="delPrice" data-id="' + esc(p.id) + '">Supprimer ce prix</button></div>' : '') +
    '<div class="formbar"><button type="button" data-act="closeSheet">Annuler</button><button class="primary" type="submit">Enregistrer</button></div></form>';
  openSheet(h);
}
async function putPrice(month, fuel, price) {
  var id = month + '_' + fuel, old = data.prices.filter(function (x) { return x.id === id; })[0];
  var p = old ? Object.assign({}, old) : { id: id, createdAt: Date.now() };
  p.month = month; p.fuel = fuel; p.price = price; p.updatedAt = Date.now();
  var t = db.transaction(['prices', 'deleted'], 'readwrite');
  t.objectStore('prices').put(p); t.objectStore('deleted').delete(id); await done(t);
}
async function savePrice(form) {
  var fd = new FormData(form), id = form.getAttribute('data-id'), month = (fd.get('month') || '').toString(), fuel = (fd.get('fuel') || '').toString(), price = num(fd.get('price'));
  if (!/^\d{4}-\d{2}$/.test(month) || !(price > 0) || FUELS.indexOf(fuel) < 0) { toast('Mois, carburant et prix requis'); return; }
  if (id && id !== month + '_' + fuel) await removePrice(id, true);
  await putPrice(month, fuel, price); await reload(); closeSheet(); render(); toast('Prix enregistré');
}
async function removePrice(id, quiet) {
  var t = db.transaction(['prices', 'deleted'], 'readwrite');
  t.objectStore('prices').delete(id); t.objectStore('deleted').put({ id: id, kind: 'price', deletedAt: Date.now() }); await done(t);
  if (!quiet) { await reload(); closeSheet(); render(); }
}
function bulkForm() {
  openSheet('<h1>Coller une liste de prix</h1><form id="bform"><div class="muted">Deux formats acceptés. <b>1) Tableau</b> avec une ligne d\'en-tête : <b>Mois,Diesel_EUR_L,SP95_E10_EUR_L,E85_EUR_L</b> puis <b>2022-01,1.609,1.666,0.709</b>… <b>2) Une ligne par prix</b> : <b>AAAA-MM ; Carburant ; prix</b>. Exemple :<br>2026-03 ; Gazole ; 1,789<br>2026-03 ; SP95-E10 ; 1,842<br>Carburants admis : ' + FUELS.join(', ') + '.</div>' +
    '<textarea name="txt" rows="10" style="min-height:180px" placeholder="2026-03 ; Gazole ; 1,789"></textarea>' +
    '<div class="formbar"><button type="button" data-act="closeSheet">Annuler</button><button class="primary" type="submit">Importer</button></div></form>');
}
var FUEL_ALIAS = { diesel: 'Gazole', gazole: 'Gazole', sp95: 'SP95', sp95_e10: 'SP95-E10', 'sp95-e10': 'SP95-E10', e10: 'SP95-E10', sp98: 'SP98', e85: 'E85', gpl: 'GPL', gplc: 'GPL', 'gpl-c': 'GPL' };
function fuelFromHeader(h) { var k = String(h || '').toLowerCase().replace(/_?(eur|€)(_?l)?(\/l)?$/i, '').replace(/[\s]/g, '').replace(/_+$/, ''); return FUEL_ALIAS[k] || FUEL_ALIAS[k.replace(/_/g, '-')] || null; }
// Lit soit « AAAA-MM ; Carburant ; prix » (une ligne par prix), soit un tableau « Mois, Diesel_EUR_L, SP95_E10_EUR_L, E85_EUR_L … »
function parsePriceList(text) {
  var lines = String(text || '').split(/\r?\n/).map(function (l) { return l.trim(); }).filter(Boolean), items = [], bad = [];
  var first = lines[0] || '', wide = /^mois\s*[,;\t]/i.test(first) ? first.split(/\s*[,;\t]\s*/).map(fuelFromHeader) : null;
  if (wide) lines = lines.slice(1);
  lines.forEach(function (l) {
    if (wide) {
      var c = l.split(/\s*[,;\t]\s*/), m = (c[0] || '').trim(), n = 0;
      if (!/^\d{4}-\d{2}$/.test(m)) { bad.push(l); return; }
      wide.forEach(function (fu, i) { if (i === 0 || !fu) return; var p = num(c[i]); if (p > 0) { items.push({ m: m, f: fu, p: p }); n++; } });
      if (!n) bad.push(l);
      return;
    }
    var c2 = l.split(/\s*[;\t]\s*/), m2 = (c2[0] || '').trim(), fi = FUELS.map(function (f) { return f.toLowerCase(); }).indexOf((c2[1] || '').trim().toLowerCase()), p2 = num(c2[2]);
    if (/^\d{4}-\d{2}$/.test(m2) && fi >= 0 && p2 > 0) items.push({ m: m2, f: FUELS[fi], p: p2 }); else bad.push(l);
  });
  return { items: items, bad: bad, wide: !!wide };
}
async function saveBulk(form) {
  var r = parsePriceList(new FormData(form).get('txt'));
  if (!r.items.length) { toast('Aucun prix reconnu'); return; }
  var changed = r.items.filter(function (x) { var o = data.prices.filter(function (p) { return p.id === x.m + '_' + x.f; })[0]; return o && o.price !== x.p; }).length;
  if (changed && !confirm(changed + ' prix déjà saisi(s) seront remplacés par ceux de la liste. Continuer ?')) return;
  var now = Date.now(), t = db.transaction(['prices', 'deleted'], 'readwrite'), byId = {};
  data.prices.forEach(function (p) { byId[p.id] = p; });
  r.items.forEach(function (x) {
    var id = x.m + '_' + x.f, o = byId[id], rec = o ? Object.assign({}, o) : { id: id, createdAt: now };
    rec.month = x.m; rec.fuel = x.f; rec.price = x.p; rec.updatedAt = now;
    t.objectStore('prices').put(rec); t.objectStore('deleted').delete(id);
  });
  await done(t); await reload(); closeSheet(); render();
  toast(r.items.length + ' prix importé(s)' + (r.bad.length ? ', ' + r.bad.length + ' ligne(s) ignorée(s)' : ''));
  if (r.bad.length) setTimeout(function () { alert('Lignes ignorées (format non reconnu) :\n\n' + r.bad.slice(0, 10).join('\n')); }, 300);
}

/* ---------- Événements ---------- */
document.addEventListener('click', function (e) {
  var el = e.target.closest && e.target.closest('[data-act]'); if (!el) return;
  var act = el.getAttribute('data-act'), id = el.getAttribute('data-id');
  var run = function (p) { p.catch(function (err) { toast('Erreur : ' + (err && err.message ? err.message : err)); }); };
  if (act === 'addFill') fillForm(id || (state.tab === 'vehicle' ? state.vehicleId : null), null);
  else if (act === 'editFill') fillForm(null, id);
  else if (act === 'delFill') run(deleteFill(id));
  else if (act === 'addPrice') priceForm(null);
  else if (act === 'editPrice') priceForm(id);
  else if (act === 'delPrice') { if (confirm('Supprimer ce prix ?')) run(removePrice(id)); }
  else if (act === 'bulkPrice') bulkForm();
});
document.addEventListener('input', function (e) {
  var n = e.target && e.target.name;
  if ((n === 'liters' || n === 'ppl' || n === 'total') && $('#fform')) calcFill(n);
});
document.addEventListener('change', function (e) {
  var t = e.target; if (t && (t.id === 'f_vid' || t.id === 'f_date') && $('#fform')) fillHint();
});
document.addEventListener('submit', function (e) {
  var f = e.target, p = null;
  if (f.id === 'fform') p = saveFill(f); else if (f.id === 'pform') p = savePrice(f); else if (f.id === 'bform') p = saveBulk(f);
  if (p) p.catch(function (err) { toast('Erreur : ' + (err && err.message ? err.message : err)); });
});
