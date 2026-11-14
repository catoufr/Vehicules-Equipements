'use strict';
/* Étape 0.7 — Recharges électriques, tarifs de l'électricité maison par période (HP / HC), import CSV du chargeur.
   Seul le prix du kWh compte (pas d'abonnement). Heures de 00:00 à 24:00. */

function chargeable(v) { return /lectrique|rechargeable/i.test(v.energy || ''); }
function fmtKwh(n) { return n == null ? '–' : new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(n) + ' kWh'; }
function fmtPk(n) { return n == null || !isFinite(n) ? '–' : new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 4, maximumFractionDigits: 4 }).format(n) + ' €/kWh'; }
function p2(n) { return String(n).padStart(2, '0'); }

/* ---------- Heures et tarifs ---------- */
function parseHM(s) {
  var m = /^\s*(\d{1,2})[:h](\d{2})\s*$/.exec(String(s || '')); if (!m) return null;
  var h = +m[1], mi = +m[2]; if (mi > 59 || h > 24 || (h === 24 && mi > 0)) return null;
  return h * 60 + mi;
}
function fmtHM(min) { return p2(Math.floor(min / 60)) + ':' + p2(min % 60); }
function tariffFor(date) { // période valable à cette date ; la plus récemment commencée gagne
  var c = data.tariffs.filter(function (t) { return t.from <= date && (!t.to || date <= t.to); });
  c.sort(function (a, b) { return b.from.localeCompare(a.from); });
  return c[0] || null;
}
function slotAt(t, m) { // plage HC contenant la minute m (0..1439), sinon null
  var sl = t.slots || [];
  for (var i = 0; i < sl.length; i++) {
    var f = sl[i].f, e = sl[i].t;
    if (f < e ? (m >= f && m < e) : (m >= f || m < e)) return sl[i];
  }
  return null;
}
function dtParse(s) { // 'AAAA-MM-JJ HH:MM' → minutes absolues
  var m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(s || ''); if (!m) return null;
  return Math.round(Date.UTC(+m[1], +m[2] - 1, +m[3]) / 86400000) * 1440 + (+m[4]) * 60 + (+m[5]);
}
function dayStr(day) { return new Date(day * 86400000).toISOString().slice(0, 10); }
// Répartition d'une recharge : kWh répartis à égalité sur chaque minute ; chaque minute prend le tarif de sa date
function chargeInfo(c) {
  var a = dtParse(c.start), b = dtParse(c.end), out = { cost: null, hc: null, hp: null, auto: false, missing: false };
  if (c.forceHC && c.kwh > 0 && a != null) { // session longue forcée : 100 % HC au tarif de la date de début
    var tf = tariffFor(c.start.slice(0, 10));
    if (!tf) out.missing = true;
    else {
      var pr = (tf.slots || []).length ? Math.min.apply(null, tf.slots.map(function (x) { return x.price; })) : tf.hp;
      out.cost = c.kwh * pr; out.hc = c.kwh; out.hp = 0; out.auto = true;
    }
    if (c.override != null) { out.cost = c.override; out.auto = false; }
    else if (c.place && c.place !== 'maison') { out.cost = null; out.auto = false; }
    return out;
  }
  if (a != null && b != null && c.kwh > 0) {
    var n = Math.max(1, b - a), per = c.kwh / n, cost = 0, hc = 0, hp = 0, miss = 0, cache = {};
    for (var i = 0; i < n; i++) {
      var idx = a + i, day = Math.floor(idx / 1440), m = idx % 1440, d = cache[day] || (cache[day] = { t: tariffFor(dayStr(day)) });
      if (!d.t) { miss++; continue; }
      var sl = slotAt(d.t, m);
      if (sl) { hc += per; cost += per * sl.price; } else { hp += per; cost += per * d.t.hp; }
    }
    if (miss < n) { out.hc = hc; out.hp = hp; out.cost = cost; out.auto = true; out.missing = miss > 0; }
    else out.missing = true;
  }
  if (c.override != null) { out.cost = c.override; out.auto = false; }
  else if (c.place && c.place !== 'maison') { out.cost = null; out.auto = false; }
  return out;
}
function longCharge(c) { var a = dtParse(c.start), b = dtParse(c.end); return a != null && b != null && b - a > 480; }
function vehCharges(id) { return data.charges.filter(function (c) { return c.vehicleId === id; }).sort(function (a, b) { return b.start.localeCompare(a.start); }); }
function chargesCost(id) { return vehCharges(id).reduce(function (s, c) { var i = chargeInfo(c); return s + (i.cost || 0); }, 0); }

/* ---------- Affichage ---------- */
function chargeItem(c, showVeh) {
  var i = chargeInfo(c), pl = { maison: 'maison', borne: 'borne publique', autre: 'autre' }[c.place] || c.place;
  return '<div class="item"><div><b>' + fmtDate(c.start.slice(0, 10)) + '</b> ' + c.start.slice(11) + ' → ' + c.end.slice(11) + ' · ' + fmtKwh(c.kwh) + (showVeh ? ' · ' + esc(vehName(c.vehicleId)) : '') +
    '<div class="muted">' + [pl, i.cost != null ? fmtEur(i.cost) + (i.auto ? '' : ' (saisi)') : (c.place === 'maison' ? 'tarif manquant' : ''), c.forceHC ? '100 % HC (forcé)' : (i.hc != null && i.cost != null ? 'HC ' + fmtKwh(i.hc) + ' · HP ' + fmtKwh(i.hp) : ''), c.note || ''].filter(Boolean).join(' · ') + '</div></div>' +
    '<div><button class="link" data-act="editCharge" data-id="' + esc(c.id) + '">Modifier</button></div></div>';
}
// Comparaison coût réel (recharges) / coût d'utilisation (conso moyenne × km), sur la période où les deux sont connus
function evStats(v) {
  var cs = vehCharges(v.id).slice().sort(function (a, b) { return a.start.localeCompare(b.start); });
  if (!cs.length) return null;
  var d0 = cs[0].date, pts = kmPoints(v).filter(function (p) { return p.date >= d0; }).sort(function (a, b) { return a.date.localeCompare(b.date) || a.km - b.km; });
  if (pts.length < 2) return null;
  var p0 = pts[0], p1 = pts[pts.length - 1], km = p1.km - p0.km; if (!(km > 0)) return null;
  var per = cs.filter(function (c) { return c.date > p0.date && c.date <= p1.date; }), kwh = 0, eur = 0, eurKwh = 0;
  if (!per.length) return null;
  per.forEach(function (c) { kwh += c.kwh; var i = chargeInfo(c); if (i.cost != null) { eur += i.cost; eurKwh += c.kwh; } });
  var o = { from: p0.date, to: p1.date, km: km, kwh: kwh, eur: eur, eurKwh: eurKwh, real100: kwh / km * 100 };
  if (v.manualConso > 0) {
    o.use100 = v.manualConso; o.useKwh = km * v.manualConso / 100; o.loss = kwh / o.useKwh - 1;
    var price = eurKwh > 0 ? eur / eurKwh : (v.manualPrice > 0 ? v.manualPrice : null);
    if (price != null) { o.useCost = o.useKwh * price; o.realCost = eurKwh > 0 ? eur / eurKwh * kwh : null; }
  }
  return o;
}
function chargeStats(v) {
  var cs = vehCharges(v.id); if (!cs.length) return '<div class="muted">Aucune recharge enregistrée.</div>';
  var kwh = 0, eur = 0, eurKwh = 0, home = 0, hc = 0, hcBase = 0;
  cs.forEach(function (c) { var i = chargeInfo(c); kwh += c.kwh; if (c.place === 'maison') home += c.kwh; if (i.cost != null) { eur += i.cost; eurKwh += c.kwh; } if (i.hc != null) { hc += i.hc; hcBase += c.kwh; } });
  var h = kv([['Recharges', String(cs.length)], ['Énergie rechargée (réelle)', fmtKwh(kwh)], ['Coût réel (recharges)', fmtEur(eur)], ['Prix moyen', eurKwh ? fmtPk(eur / eurKwh) : ''],
    ['Part à la maison', Math.round(home / kwh * 100) + ' %'], ['Part en heures creuses', hcBase ? Math.round(hc / hcBase * 100) + ' %' : '']]);
  if (v.id === OTHER) return h;
  var e = evStats(v);
  if (e) {
    h += '<h3>Coût réel et coût d\'utilisation (du ' + fmtDate(e.from) + ' au ' + fmtDate(e.to) + ', ' + fmtKm(e.km) + ')</h3>' + kv([
      ['Conso réelle (recharges, pertes comprises)', fmtKwh(e.real100).replace(' kWh', ' kWh/100 km')],
      ['Conso moyenne indiquée', e.use100 ? fmtKwh(e.use100).replace(' kWh', ' kWh/100 km') : ''],
      ['Pertes estimées (chargeur + voiture)', e.loss != null ? (e.loss >= 0 ? '+' : '') + Math.round(e.loss * 1000) / 10 + ' %' : ''],
      ['Coût réel (recharges)', e.realCost != null ? fmtEur(e.realCost) : fmtEur(e.eur)],
      ['Coût d\'utilisation (conso moyenne)', e.useCost != null ? fmtEur(e.useCost) : '']]) +
      '<div class="muted">Le coût réel vient des recharges ; il est le seul compté dans les dépenses cumulées. Le coût d\'utilisation (conso moyenne × km) est indicatif.</div>';
  } else if (v.manualConso > 0) h += '<div class="muted">La comparaison coût réel / coût d\'utilisation demande au moins deux relevés kilométriques après la première recharge.</div>';
  return h;
}
function chargeVehicleSection(v) {
  var cs = vehCharges(v.id);
  var h = '<h2>Recharges</h2><div class="card">' + chargeStats(v) + '</div>' +
    '<div class="actions"><button data-act="addCharge" data-id="' + esc(v.id) + '">＋ Recharge</button><button data-act="importCharges" data-id="' + esc(v.id) + '">Importer le CSV du chargeur</button></div>';
  if (cs.length) h += '<h3>Recharges (' + cs.length + ')</h3><div class="card list">' + cs.map(function (c) { return chargeItem(c, false); }).join('') + '</div>';
  return h;
}
function slotsText(t) {
  var s = (t.slots || []).slice().sort(function (a, b) { return a.f - b.f; }).map(function (x) { return 'HC ' + fmtHM(x.f) + '–' + fmtHM(x.t) + ' : ' + fmtPk(x.price); });
  return ['HP : ' + fmtPk(t.hp)].concat(s).join(' · ');
}
function tariffsSection() {
  var ts = data.tariffs.slice().sort(function (a, b) { return b.from.localeCompare(a.from); });
  var h = '<h2>Tarifs électricité maison</h2><div class="card"><div class="muted">Prix du kWh seulement (pas d\'abonnement). Une période : date de début, date de fin facultative (vide = contrat en cours), prix HP, et une ou plusieurs plages d\'heures creuses avec leur prix, de 00:00 à 24:00.</div>' +
    '<div class="actions"><button data-act="addTariff">＋ Période de tarif</button></div></div>';
  if (ts.length) h += '<div class="card list">' + ts.map(function (t) {
    return '<div class="item"><div><b>' + (t.name ? esc(t.name) + ' · ' : '') + 'depuis le ' + fmtDate(t.from) + (t.to ? ' jusqu\'au ' + fmtDate(t.to) : ' <span class="tag">en cours</span>') + '</div><div class="muted">' + esc(slotsText(t)) + '</div></div>' +
      '<div><button class="link" data-act="editTariff" data-id="' + esc(t.id) + '">Modifier</button></div></div>';
  }).join('') + '</div>';
  return h;
}

/* ---------- Formulaire tarif ---------- */
function slotRow(s) {
  s = s || {};
  return '<div class="srow"><input name="sf" inputmode="numeric" placeholder="22:00" value="' + esc(s.f != null ? fmtHM(s.f) : '') + '"><input name="st" inputmode="numeric" placeholder="06:00" value="' + esc(s.t != null ? (s.t === 1440 ? '24:00' : fmtHM(s.t)) : '') + '">' +
    '<input name="sp" inputmode="decimal" placeholder="€/kWh" value="' + esc(s.price == null ? '' : String(s.price).replace('.', ',')) + '"><button type="button" data-act="rmSlot" aria-label="Retirer">✕</button></div>';
}
function tariffForm(id) {
  var t = id ? data.tariffs.filter(function (x) { return x.id === id; })[0] : null;
  var h = '<h1>' + (t ? 'Modifier la période' : 'Nouvelle période de tarif') + '</h1><form id="tform" data-id="' + esc(t ? t.id : '') + '">' +
    fld('Nom (facultatif)', 'name', t ? t.name : '', { ph: 'ex. Contrat 2026' }) +
    fld('Date de début', 'from', t ? t.from : todayStr(), { type: 'date', req: true }) +
    fld('Date de fin (vide = contrat en cours)', 'to', t ? t.to : '', { type: 'date' }) +
    fld('Prix HP, hors plages creuses (€/kWh)', 'hp', t ? String(t.hp).replace('.', ',') : '', { inputmode: 'decimal', req: true, ph: 'ex. 0,2404' }) +
    '<label>Plages d\'heures creuses (de 00:00 à 24:00)</label><div class="muted">Début, fin, prix du kWh. Une plage qui passe minuit (22:00 → 06:00) est acceptée.</div><div id="slots">' +
    ((t && t.slots && t.slots.length ? t.slots : [{}]).map(slotRow).join('')) + '</div>' +
    '<div class="actions"><button type="button" data-act="addSlot">＋ Ajouter une plage</button></div>' +
    (t ? '<div class="actions"><button type="button" class="danger" data-act="delTariff" data-id="' + esc(t.id) + '">Supprimer cette période</button></div>' : '') +
    '<div class="formbar"><button type="button" data-act="closeSheet">Annuler</button><button class="primary" type="submit">Enregistrer</button></div></form>';
  openSheet(h);
}
function overlap(slots) { // les plages se chevauchent-elles ?
  var used = new Array(1440).fill(0), bad = false;
  slots.forEach(function (s) { for (var m = 0; m < 1440; m++) { var inn = s.f < s.t ? (m >= s.f && m < s.t) : (m >= s.f || m < s.t); if (inn) { if (used[m]) bad = true; used[m] = 1; } } });
  return bad;
}
async function saveTariff(form) {
  var fd = new FormData(form), id = form.getAttribute('data-id'), g = function (k) { return (fd.get(k) || '').toString().trim(); };
  var from = g('from'), to = g('to'), hp = num(g('hp'));
  if (!from || !(hp >= 0) || g('hp') === '') { toast('Date de début et prix HP requis'); return; }
  if (to && to < from) { toast('La date de fin précède la date de début'); return; }
  var sf = fd.getAll('sf'), st = fd.getAll('st'), sp = fd.getAll('sp'), slots = [];
  for (var i = 0; i < sf.length; i++) {
    if (!String(sf[i]).trim() && !String(st[i]).trim() && !String(sp[i]).trim()) continue;
    var f = parseHM(sf[i]), e = parseHM(st[i]), p = num(sp[i]);
    if (f == null || e == null || p == null || p < 0 || f === 1440) { toast('Plage ' + (i + 1) + ' : heures de 00:00 à 24:00 et prix requis'); return; }
    if (f === e) { toast('Plage ' + (i + 1) + ' : début et fin identiques'); return; }
    slots.push({ f: f, t: e, price: p });
  }
  if (overlap(slots)) { toast('Des plages se chevauchent'); return; }
  var others = data.tariffs.filter(function (x) { return x.id !== id && x.from <= (to || '9999-12-31') && (!x.to || x.to >= from); });
  if (others.length && !confirm('Cette période chevauche une autre période de tarif. La plus récente (date de début) sera utilisée pour les jours communs.\n\nEnregistrer quand même ?')) return;
  var old = id ? data.tariffs.filter(function (x) { return x.id === id; })[0] : null;
  var t = old ? Object.assign({}, old) : { id: uid(), createdAt: Date.now() };
  Object.assign(t, { name: g('name'), from: from, to: to, hp: hp, slots: slots, updatedAt: Date.now() });
  await dbPut('tariffs', t); await reload(); closeSheet(); render(); toast('Tarif enregistré');
}

/* ---------- Formulaire recharge ---------- */
function chargeForm(vehicleId, id) {
  var c = id ? data.charges.filter(function (x) { return x.id === id; })[0] : null;
  var list = data.vehicles.filter(chargeable);
  if (!list.length && !(c && c.vehicleId === OTHER)) { toast('Aucun véhicule électrique : indiquez l\'énergie « Électrique » dans la fiche'); return; }
  var vid = c ? c.vehicleId : (vehicleId && list.some(function (v) { return v.id === vehicleId; }) ? vehicleId : (list.filter(function (v) { return (v.status || 'actuel') === 'actuel'; })[0] || list[0]).id);
  var t0 = todayStr();
  var h = '<h1>' + (c ? 'Modifier la recharge' : 'Nouvelle recharge') + '</h1><form id="cform" data-id="' + esc(c ? c.id : '') + '">' +
    '<label for="f_vid">Véhicule</label><select id="f_vid" name="vehicleId">' + list.map(function (v) { return '<option value="' + esc(v.id) + '"' + (v.id === vid ? ' selected' : '') + '>' + esc(v.name) + '</option>'; }).join('') + '<option value="' + OTHER + '"' + (vid === OTHER ? ' selected' : '') + '>Autre personne (ami…) : non compté dans mes véhicules</option></select>' +
    '<label for="f_place">Lieu</label><select id="f_place" name="place">' + [['maison', 'Maison'], ['borne', 'Borne publique'], ['autre', 'Autre']].map(function (o) { return '<option value="' + o[0] + '"' + ((c ? c.place : 'maison') === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select>' +
    '<div class="pair"><div>' + fld('Début : date', 'sd', c ? c.start.slice(0, 10) : t0, { type: 'date', req: true }) + '</div><div>' + fld('Début : heure', 'sh', c ? c.start.slice(11) : '', { type: 'time', req: true }) + '</div></div>' +
    '<div class="pair"><div>' + fld('Fin : date', 'ed', c ? c.end.slice(0, 10) : t0, { type: 'date', req: true }) + '</div><div>' + fld('Fin : heure', 'eh', c ? c.end.slice(11) : '', { type: 'time', req: true }) + '</div></div>' +
    fld('Énergie rechargée (kWh)', 'kwh', c ? String(c.kwh).replace('.', ',') : '', { inputmode: 'decimal', req: true }) +
    fld('Montant payé (€) — vide = calcul automatique à la maison', 'override', c && c.override != null ? String(c.override).replace('.', ',') : '', { inputmode: 'decimal' }) +
    '<div id="cLong" class="card warn" hidden><div>Session de plus de 8 h : probablement une erreur (câble resté branché ?).</div><label style="display:flex;gap:10px;align-items:center;color:var(--text)"><input type="checkbox" name="forceHC" style="width:auto;min-height:0"' + (c && c.forceHC ? ' checked' : '') + '> Forcer en 100 % heures creuses, au tarif de la date de début</label></div>' +
    '<div class="card"><div class="muted">Coût calculé</div><div class="big" id="ccalc">–</div><div class="muted" id="csplit"></div></div>' +
    fld('Kilométrage au compteur (facultatif)', 'km', '', { inputmode: 'numeric' }) +
    fld('Remarque (pour qui ? facultatif)', 'note', c ? c.note : '') +
    (c ? '<div class="actions"><button type="button" class="danger" data-act="delCharge" data-id="' + esc(c.id) + '">Supprimer cette recharge</button></div>' : '') +
    '<div class="formbar"><button type="button" data-act="closeSheet">Annuler</button><button class="primary" type="submit">Enregistrer</button></div></form>';
  openSheet(h); chargeCalc();
}
function readCharge(form) {
  var fd = new FormData(form), g = function (k) { return (fd.get(k) || '').toString().trim(); };
  return { forceHC: !!fd.get('forceHC') && longCharge({ start: g('sd') + ' ' + g('sh'), end: g('ed') + ' ' + g('eh') }), vehicleId: g('vehicleId'), place: g('place'), start: g('sd') + ' ' + g('sh'), end: g('ed') + ' ' + g('eh'), kwh: num(g('kwh')), override: num(g('override')), note: g('note'), km: num(g('km')) };
}
function chargeCalc() {
  var f = $('#cform'), o = $('#ccalc'); if (!f || !o) return;
  var c = readCharge(f), i = chargeInfo(c), lg = $('#cLong'); if (lg) lg.hidden = !longCharge(c);
  o.textContent = i.cost != null ? fmtEur(i.cost) : (c.place === 'maison' ? (i.missing ? 'tarif manquant à cette date' : '–') : '–');
  $('#csplit').textContent = i.hc != null ? 'HC ' + fmtKwh(i.hc) + ' · HP ' + fmtKwh(i.hp) : '';
}
async function saveCharge(form) {
  var id = form.getAttribute('data-id'), c = readCharge(form);
  var a = dtParse(c.start), b = dtParse(c.end);
  if (a == null || b == null || !(c.kwh > 0)) { toast('Début, fin et kWh requis'); return; }
  if (b < a) { toast('La fin précède le début'); return; }
  var old = id ? data.charges.filter(function (x) { return x.id === id; })[0] : null, km = c.km;
  var r = old ? Object.assign({}, old) : { id: uid(), createdAt: Date.now(), source: 'manuel' };
  Object.assign(r, { vehicleId: c.vehicleId, place: c.place, start: c.start, end: c.end, kwh: c.kwh, override: c.override, note: c.note, forceHC: c.forceHC, date: c.start.slice(0, 10), updatedAt: Date.now() });
  await dbPut('charges', r);
  if (km != null && r.vehicleId !== OTHER) {
    km = Math.round(km);
    var v = data.vehicles.filter(function (x) { return x.id === r.vehicleId; })[0];
    if (!kmWarnings(v, r.date, km, null).length || confirm('Kilométrage incohérent avec les relevés existants. L\'ajouter quand même ?'))
      await dbPut('readings', { id: uid(), vehicleId: r.vehicleId, date: r.date, km: km, createdAt: Date.now(), updatedAt: Date.now(), fromCharge: true });
  }
  await reload(); closeSheet();
  if (state.tab === 'vehicle') go('vehicle', r.vehicleId); else render();
  toast('Recharge enregistrée');
}

/* ---------- Import CSV du chargeur ---------- */
function parseChargerCsv(text) {
  var out = [];
  String(text || '').split(/\r?\n/).forEach(function (raw) {
    var c = raw.split(','); if (c.length < 6) return;
    var h = c[1].trim().match(/^(\d{4}-\d{2}-\d{2}) (\d{2}):(\d{2}):(\d{2})/), d = c[4].trim().match(/^(\d+):(\d{2}):(\d{2})$/), kwh = parseFloat(c[5].replace(',', '.'));
    if (!h || !d || !isFinite(kwh) || kwh <= 0) return;
    var durSec = +d[1] * 3600 + +d[2] * 60 + +d[3];
    var a = dtParse(h[1] + ' ' + h[2] + ':' + h[3]), b = a + Math.round(durSec / 60), day = Math.floor(b / 1440), m = b % 1440;
    out.push({ start: h[1] + ' ' + h[2] + ':' + h[3], end: dayStr(day) + ' ' + p2(Math.floor(m / 60)) + ':' + p2(m % 60), kwh: kwh });
  });
  return out;
}
var IMP = null, IMPV = null;
function vehSelectHtml(name, sel) {
  return '<select name="' + name + '">' + data.vehicles.filter(chargeable).map(function (v) { return '<option value="' + esc(v.id) + '"' + (v.id === sel ? ' selected' : '') + '>' + esc(v.name) + '</option>'; }).join('') +
    '<option value="' + OTHER + '"' + (sel === OTHER ? ' selected' : '') + '>Autre personne (ami…)</option></select>';
}
function importForm() {
  openSheet('<h1>Importer le CSV du chargeur</h1><form id="iform"><div class="muted">Export du chargeur (Smart Life), même format que l\'appli Conso : Nom, Heure, Début, Fin, Durée, Chargé (kWh). Étape suivante : la liste des nouvelles recharges, pour choisir celles à importer et le véhicule de chacune.</div>' +
    '<label for="f_csv">Fichier CSV</label><input id="f_csv" name="file" type="file" accept=".csv,text/csv,text/plain">' +
    '<label for="f_paste">Ou coller le contenu</label><textarea id="f_paste" name="txt" style="min-height:140px"></textarea>' +
    '<div class="formbar"><button type="button" data-act="closeSheet">Annuler</button><button class="primary" type="submit">Lire les recharges</button></div></form>');
}
async function saveImport(form, vehicleId) {
  var fd = new FormData(form), file = fd.get('file'), text = (fd.get('txt') || '').toString();
  if (file && file.size) text = await file.text();
  var rows = parseChargerCsv(text);
  if (!rows.length) { toast('Aucune recharge lisible dans ce texte'); return; }
  var have = {}; data.charges.forEach(function (c) { have[c.start + '|' + c.kwh] = 1; });
  var seen = {}, fresh = rows.filter(function (r) { var k = r.start + '|' + r.kwh; if (have[k] || seen[k]) return false; seen[k] = 1; return true; })
    .sort(function (a, b) { return b.start.localeCompare(a.start); });
  if (!fresh.length) { toast('Tout est déjà importé (' + rows.length + ' recharge(s))'); return; }
  var cur = vehicleId && data.vehicles.some(function (v) { return v.id === vehicleId && chargeable(v); }) ? vehicleId : ((data.vehicles.filter(chargeable).filter(function (v) { return (v.status || 'actuel') === 'actuel'; })[0] || data.vehicles.filter(chargeable)[0] || { id: OTHER }).id);
  IMP = { rows: fresh, dup: rows.length - fresh.length };
  importPreview(cur);
}
function importPreview(defVeh) {
  var r = IMP.rows;
  var h = '<h1>Nouvelles recharges (' + r.length + ')</h1><form id="ipform"><div class="muted">' + (IMP.dup ? IMP.dup + ' déjà présente(s) ou en double : ignorée(s). ' : '') +
    'Coche celles à importer et choisis le véhicule de chacune. Elles sont comptées « maison ».</div>' +
    '<label>Véhicule pour toutes</label><select id="impAll">' + vehSelectHtml('x', defVeh).replace('name="x"', 'name="x"').replace(/^<select name="x">/, '').replace(/<\/select>$/, '') + '</select>' +
    '<div class="actions"><button type="button" data-act="impAll">Appliquer à toutes</button><button type="button" data-act="impNone">Tout décocher</button><button type="button" data-act="impEvery">Tout cocher</button></div><div class="card list">';
  r.forEach(function (x, i) {
    var miss = !tariffFor(x.start.slice(0, 10));
    h += '<div class="item" style="flex-direction:column;align-items:stretch"><label style="display:flex;gap:10px;align-items:center;margin:0;color:var(--text)"><input type="checkbox" name="ck" value="' + i + '" checked style="width:auto;min-height:0">' +
      '<span><b>' + fmtDate(x.start.slice(0, 10)) + '</b> ' + x.start.slice(11) + ' → ' + x.end.slice(11) + ' · ' + fmtKwh(x.kwh) + (miss ? ' <span class="tag old">tarif manquant</span>' : '') + '</span></label>' +
      vehSelectHtml('rv' + i, defVeh).replace('<select', '<select data-row="1"') +
      (longCharge(x) ? '<div class="card warn" style="margin:8px 0 0"><div>Session de ' + Math.round((dtParse(x.end) - dtParse(x.start)) / 6) / 10 + ' h (plus de 8 h) : probablement une erreur de branchement. Sans option, elle est calculée minute par minute en HP et HC.</div>' +
        '<label style="display:flex;gap:10px;align-items:center;color:var(--text)"><input type="checkbox" name="fh" value="' + i + '" style="width:auto;min-height:0"> Forcer en 100 % heures creuses, au tarif de la date de début</label></div>' : '') + '</div>';
  });
  h += '</div><div class="formbar"><button type="button" data-act="closeSheet">Annuler</button><button class="primary" type="submit">Importer la sélection</button></div></form>';
  openSheet(h);
}
async function saveImportPreview(form) {
  var fd = new FormData(form), idx = fd.getAll('ck').map(Number), fh = fd.getAll('fh').map(Number);
  if (!idx.length) { toast('Aucune recharge cochée'); return; }
  var now = Date.now(), t = db.transaction(['charges'], 'readwrite'), kwh = 0, byV = {};
  idx.forEach(function (i) {
    var r = IMP.rows[i], vid = fd.get('rv' + i); kwh += r.kwh; byV[vid] = (byV[vid] || 0) + 1;
    t.objectStore('charges').put({ id: uid(), vehicleId: vid, place: 'maison', start: r.start, end: r.end, kwh: r.kwh, override: null, note: vid === OTHER ? 'autre personne' : '', date: r.start.slice(0, 10), source: 'csv', forceHC: fh.indexOf(i) >= 0 && longCharge(r), createdAt: now, updatedAt: now });
  });
  await done(t); IMP = null; await reload(); closeSheet(); render();
  toast(idx.length + ' recharge(s) importée(s) (' + fmtKwh(kwh) + ')');
}
function othersSection() {
  var cs = vehCharges(OTHER); if (!cs.length) return '';
  return '<h2>Recharges pour d\'autres personnes (' + cs.length + ')</h2><div class="card">' + chargeStats({ id: OTHER }) + '</div><div class="card list">' + cs.map(function (c) { return chargeItem(c, false); }).join('') + '</div>';
}

/* ---------- Événements ---------- */
document.addEventListener('click', function (ev) {
  var el = ev.target.closest && ev.target.closest('[data-act]'); if (!el) return;
  var act = el.getAttribute('data-act'), id = el.getAttribute('data-id'), cur = state.tab === 'vehicle' ? state.vehicleId : null;
  var run = function (p) { p.catch(function (err) { toast('Erreur : ' + (err && err.message ? err.message : err)); }); };
  if (act === 'addCharge') chargeForm(id || cur, null);
  else if (act === 'editCharge') chargeForm(null, id);
  else if (act === 'delCharge') run(deleteRec('charges', 'charge', id, 'cette recharge'));
  else if (act === 'importCharges') { IMPV = id || cur; importForm(); }
  else if (act === 'impAll') { var v = $('#impAll').value; document.querySelectorAll('#ipform select[data-row]').forEach(function (x) { x.value = v; }); }
  else if (act === 'impNone' || act === 'impEvery') document.querySelectorAll('#ipform input[name=ck]').forEach(function (x) { x.checked = act === 'impEvery'; });
  else if (act === 'addTariff') tariffForm(null);
  else if (act === 'editTariff') tariffForm(id);
  else if (act === 'delTariff') run(deleteRec('tariffs', 'tariff', id, 'cette période de tarif'));
  else if (act === 'addSlot') $('#slots').insertAdjacentHTML('beforeend', slotRow());
  else if (act === 'rmSlot') el.closest('.srow').remove();
});
document.addEventListener('input', function (ev) { if (ev.target.closest && ev.target.closest('#cform')) chargeCalc(); });
document.addEventListener('change', function (ev) {
  var t = ev.target; if (!t || !t.closest) return;
  if (t.closest('#cform')) { if (t.name === 'sd' && $('#f_ed') && !$('#f_ed').dataset.t) $('#f_ed').value = t.value; chargeCalc(); }
});
document.addEventListener('submit', function (ev) {
  var f = ev.target, p = null;
  if (f.id === 'tform') p = saveTariff(f); else if (f.id === 'cform') p = saveCharge(f); else if (f.id === 'iform') p = saveImport(f, IMPV); else if (f.id === 'ipform') p = saveImportPreview(f);
  if (p) p.catch(function (err) { toast('Erreur : ' + (err && err.message ? err.message : err)); });
});
