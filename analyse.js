'use strict';
/* Analyse et comparatif des véhicules (0.11) : coût d'usage et coût total de possession (achat − revente + dépenses),
   par km, par mois et par an ; dépenses par année ; comparaison côte à côte. */

var CMP = { sel: null, yearVeh: null, metric: 'total', ref: null, align: false };
var CATS = [['energy', 'Énergie / carburant', 'c1'], ['maint', 'Entretiens', 'c2'], ['insur', 'Assurance', 'c3'], ['other', 'Autres dépenses et achats annexes', 'c4']];

function cmpVehicles() {
  return data.vehicles.filter(function (v) { return !v.equip; }).sort(function (a, b) {
    var sa = (a.status || 'actuel') === 'actuel' ? 0 : 1, sb = (b.status || 'actuel') === 'actuel' ? 0 : 1;
    return sa - sb || (a.name || '').localeCompare(b.name || '', 'fr');
  });
}
function manualSegs(v) { // segments de la conso moyenne : [{a, b, eur}]
  var c = v.manualConso; if (!(c > 0)) return [];
  var pts = kmPoints(v).sort(function (x, y) { return x.date.localeCompare(y.date) || x.km - y.km; }), fuel = fuelOf(v), out = [];
  for (var i = 1; i < pts.length; i++) {
    var a = pts[i - 1], b = pts[i], km = b.km - a.km; if (!(km > 0)) continue;
    var pr = fuel ? avgPrice(fuel, a.date, b.date) : null; if (pr == null) pr = v.manualPrice > 0 ? v.manualPrice : null;
    if (pr != null) out.push({ a: a.date, b: b.date, eur: km * c / 100 * pr });
  }
  return out;
}
function spreadYears(a, b, eur, into, key) { // répartit un montant sur les années, au prorata des jours
  var d0 = dayNum(a), d1 = Math.max(dayNum(b), d0 + 1), tot = d1 - d0;
  for (var d = d0; d < d1;) {
    var y = new Date(d * 86400000).getUTCFullYear(), endY = Math.min(d1, Math.round(Date.UTC(y + 1, 0, 1) / 86400000));
    var o = into[y] || (into[y] = {}); o[key] = (o[key] || 0) + eur * (endY - d) / tot; d = endY;
  }
}
function yearCosts(v) { // { année: {energy, maint, insur, other} }
  var Y = {}, add = function (ds, key, amt) { if (!ds || !amt) return; var y = +ds.slice(0, 4), o = Y[y] || (Y[y] = {}); o[key] = (o[key] || 0) + amt; };
  var est = !isElec(v) && v.mode === 'manual' ? manualSegs(v) : null;
  if (est && est.length) est.forEach(function (s) { spreadYears(s.a, s.b, s.eur, Y, 'energy'); });
  else {
    vehFills(v.id).forEach(function (f) { add(f.date, 'energy', fillCost(f)); });
    vehCharges(v.id).forEach(function (c) { add(c.start.slice(0, 10), 'energy', chargeInfo(c).cost); });
  }
  vehMaints(v.id).forEach(function (m) { add(m.date, 'maint', maintTotal(m)); });
  vehExpenses(v.id).forEach(function (e) { add(e.date, 'other', Number(e.amount) || 0); });
  insList(v.id).forEach(function (c) {
    var end = insEnd(c, v); if (end < c.from || !(c.annual >= 0)) return;
    spreadYears(c.from, addDays(end, 1), c.annual * (dayNum(end) - dayNum(c.from) + 1) / 365, Y, 'insur');
  });
  return Y;
}
function vehTco(v) {
  var pts = kmPoints(v).sort(function (a, b) { return a.date.localeCompare(b.date) || a.km - b.km; }), p = v.purchase || {}, x = v.exit || {}, sold = (v.status || 'actuel') === 'ancien';
  var start = p.date || (pts[0] && pts[0].date) || null, end = x.date || (sold && pts.length ? pts[pts.length - 1].date : todayStr());
  var k0 = p.km != null ? p.km : (pts[0] ? pts[0].km : null), k1 = x.km != null ? x.km : (pts.length ? pts[pts.length - 1].km : null);
  var o = { start: start, end: end, sold: sold, km: (k0 != null && k1 != null && k1 > k0) ? k1 - k0 : null };
  o.days = start && end && end >= start ? dayNum(end) - dayNum(start) + 1 : null;
  var en = energySpend(v), est = false;
  if (!isElec(v) && v.mode === 'manual') { var ms = manualStats(v); if (ms && ms.noPrice < ms.km) { en = ms.eur; est = true; } }
  var ex = sumExp(v.id, 'depense') + sumExp(v.id, 'annexe');
  o.energy = en; o.estimated = est; o.maint = sumMaint(v.id); o.other = ex; o.insur = insCost(v.id).cost;
  o.usage = o.energy + o.maint + o.other + o.insur;
  o.buy = p.price != null ? p.price : null; o.resale = x.price != null ? x.price : null;
  o.total = o.usage + (o.buy || 0) - (o.resale || 0);
  return o;
}
// Le total (achat − revente) n'a de sens que pour un véhicule vendu, avec prix d'achat et de revente connus
function totalOk(o) { return o.sold && o.buy != null && o.resale != null; }
function perKm(n, o) { return o.km ? n / o.km : null; }
function perMonth(n, o) { return o.days ? n / (o.days / 30.4375) : null; }
function perYear(n, o) { return o.days ? n / (o.days / 365) : null; }

/* ---------- Affichage ---------- */
var METRICS = [['total', 'Total (€)'], ['km', 'Par km'], ['k1000', 'Par 1 000 km'], ['year', 'Par an']];
// Coûts d'un véhicule, éventuellement recalculés comme s'il avait la même utilisation que la référence :
// énergie et entretiens proportionnels aux km, assurance et autres dépenses proportionnelles à la durée.
function cmpAdj(o, ref) {
  var a = { energy: o.energy, maint: o.maint, insur: o.insur, other: o.other, km: o.km, days: o.days, ok: true, aligned: false };
  if (ref && ref !== o) {
    if (!o.km || !o.days || !ref.km || !ref.days) return { ok: false };
    var kf = ref.km / o.km, df = ref.days / o.days;
    a.energy *= kf; a.maint *= kf; a.insur *= df; a.other *= df; a.km = ref.km; a.days = ref.days; a.aligned = true;
  }
  a.usage = a.energy + a.maint + a.insur + a.other; return a;
}
function cmpUnit(a, x) { // x en euros → valeur selon l'indicateur choisi
  if (x == null) return null;
  if (CMP.metric === 'km') return a.km ? x / a.km : null;
  if (CMP.metric === 'k1000') return a.km ? x / a.km * 1000 : null;
  if (CMP.metric === 'year') return a.days ? x / a.days * 365 : null;
  return x;
}
function cmpFmt(n) {
  if (n == null) return '–';
  if (CMP.metric === 'km') return fmtPerKm(n);
  if (CMP.metric === 'k1000') return new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n) + ' €/1 000 km';
  if (CMP.metric === 'year') return fmtEur(n) + ' /an';
  return fmtEur(n);
}
function cmpBar(a, max) { // barre empilée par catégorie, longueur proportionnelle à la valeur (échelle commune à tous les véhicules)
  var vals = CATS.map(function (c) { return cmpUnit(a, a[c[0]]) || 0; }), tot = vals.reduce(function (x, y) { return x + y; }, 0);
  if (!(tot > 0)) return '<div class="muted">Aucune dépense enregistrée.</div>';
  var segs = CATS.map(function (c, i) { return vals[i] > 0 ? '<span class="seg-' + c[2] + '" style="width:' + (vals[i] / tot * 100).toFixed(2) + '%" title="' + esc(c[1]) + ' : ' + cmpFmt(vals[i]) + '"></span>' : ''; }).join('');
  return '<div class="stack" style="width:' + Math.max(2, tot / max * 100).toFixed(1) + '%" role="img" aria-label="Répartition du coût d\'usage">' + segs + '</div>';
}
function cmpLegend() { return '<div class="legend">' + CATS.map(function (c) { return '<span><i class="sw seg-' + c[2] + '"></i>' + esc(c[1]) + '</span>'; }).join('') + '</div>'; }
function fmtPerKm(n) { return n == null ? '–' : new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 3, maximumFractionDigits: 3 }).format(n) + ' €/km'; }

function viewCompare() {
  var vs = cmpVehicles(), h = '<div class="actions"><button class="link" data-act="tab" data-tab="vehicles">‹ Véhicules</button></div><h1>Analyse et comparatif</h1>';
  if (!vs.length) return h + '<div class="card empty">Ajoutez des véhicules pour les comparer.</div>';
  if (!CMP.sel) CMP.sel = vs.map(function (v) { return v.id; });
  h += '<div class="card"><div class="muted">Véhicules comparés</div><div class="chips">' + vs.map(function (v) {
    return '<label class="chip"><input type="checkbox" data-cmp="' + esc(v.id) + '"' + (CMP.sel.indexOf(v.id) >= 0 ? ' checked' : '') + '><span>' + esc(v.name) + ((v.status || 'actuel') === 'ancien' ? ' (ancien)' : '') + '</span></label>';
  }).join('') + '</div></div>';
  var sel = vs.filter(function (v) { return CMP.sel.indexOf(v.id) >= 0; });
  if (!sel.length) return h + '<div class="card empty">Cochez au moins un véhicule.</div>';
  var T = sel.map(function (v) { return { v: v, o: vehTco(v) }; });
  var anyEst = T.some(function (t) { return t.o.estimated; });
  var rows = [], R = function (label, fn, cls) { rows.push([label, fn, cls || '']); };
  var s = function (f) { return function (o) { return f(o); }; };
  R('Période', function (o) { return o.start ? '<span class="two">' + fmtDate(o.start) + ' →</span><span class="two">' + (o.sold ? fmtDate(o.end) : 'aujourd\'hui') + '</span>' : '–'; });
  R('Durée', function (o) { return o.days ? (o.days >= 365 ? (o.days / 365).toFixed(1).replace('.', ',') + ' ans' : Math.round(o.days / 30.4375) + ' mois') : '–'; });
  R('Kilomètres parcourus', function (o) { return o.km != null ? fmtKm(o.km) : '–'; });
  R('Km par an', function (o) { return o.km && o.days ? fmtKm(Math.round(perYear(o.km, o))) : '–'; });
  R('Énergie / carburant' + (anyEst ? ' (*)' : ''), function (o) { return fmtEur(o.energy) + (o.estimated ? ' *' : ''); });
  R('Entretiens', function (o) { return fmtEur(o.maint); });
  R('Assurance', function (o) { return fmtEur(o.insur); });
  R('Autres dépenses et achats annexes', function (o) { return fmtEur(o.other); });
  R('Coût d\'usage (hors achat)', function (o) { return fmtEur(o.usage); }, 'tot');
  R('Prix d\'achat', function (o) { return o.buy != null ? fmtEur(o.buy) : '–'; });
  R('Revente', function (o) { return o.resale != null ? fmtEur(o.resale) : '–'; });
  R('Coût total de possession', function (o) { return totalOk(o) ? fmtEur(o.total) : '–'; }, 'tot');
  R('Usage par km', function (o) { return fmtPerKm(perKm(o.usage, o)); });
  R('  dont énergie', function (o) { return fmtPerKm(perKm(o.energy, o)); });
  R('  dont entretiens', function (o) { return fmtPerKm(perKm(o.maint, o)); });
  R('  dont assurance', function (o) { return fmtPerKm(perKm(o.insur, o)); });
  R('Total (achat − revente) par km', function (o) { return totalOk(o) ? fmtPerKm(perKm(o.total, o)) : '–'; }, 'tot');
  R('Usage par mois', function (o) { var n = perMonth(o.usage, o); return n == null ? '–' : fmtEur(n); });
  R('Usage par an', function (o) { var n = perYear(o.usage, o); return n == null ? '–' : fmtEur(n); });
  R('Total par an', function (o) { var n = totalOk(o) ? perYear(o.total, o) : null; return n == null ? '–' : fmtEur(n); });
  if (!CMP.ref || !T.some(function (t) { return t.v.id === CMP.ref; })) CMP.ref = T[0].v.id;
  var refT = T.filter(function (t) { return t.v.id === CMP.ref; })[0], aligned = CMP.align === true;
  h += '<h2>Répartition du coût d\'usage</h2><div class="card"><div class="muted">Indicateur</div><div class="chips">' + METRICS.map(function (m) {
    return '<label class="chip"><input type="radio" name="cmpMetric" data-metric="' + m[0] + '"' + (CMP.metric === m[0] ? ' checked' : '') + '><span>' + esc(m[1]) + '</span></label>';
  }).join('') + '</div><div class="muted" style="margin-top:10px">Kilométrage pris en compte</div><div class="chips">' +
    '<label class="chip"><input type="radio" name="cmpBase" data-base="real"' + (!aligned ? ' checked' : '') + '><span>Km réellement parcourus</span></label>' +
    '<label class="chip"><input type="radio" name="cmpBase" data-base="ref"' + (aligned ? ' checked' : '') + '><span>Aligné sur un véhicule de référence</span></label></div>' +
    (aligned ? '<label for="cmpRef">Véhicule de référence</label><select id="cmpRef">' + T.map(function (t) { return '<option value="' + esc(t.v.id) + '"' + (t.v.id === CMP.ref ? ' selected' : '') + '>' + esc(t.v.name) + '</option>'; }).join('') + '</select>' : '') + '</div>';
  var A = T.map(function (t) { return { t: t, a: cmpAdj(t.o, aligned ? refT.o : null) }; });
  var max = Math.max.apply(null, A.map(function (x) { return x.a.ok ? cmpUnit(x.a, x.a.usage) || 0 : 0; }).concat([0.000001]));
  h += '<div class="card">' + A.map(function (x) {
    var a = x.a, head;
    if (!a.ok) return '<div class="cmpbar"><div class="row"><b>' + esc(x.t.v.name) + '</b><span class="muted">–</span></div><div class="muted">Km ou dates manquants : alignement impossible.</div></div>';
    var info = CMP.metric === 'year' ? 'soit ' + fmtKm(Math.round(a.km / a.days * 365)) + ' par an' : 'sur ' + fmtKm(Math.round(a.km)) + ', ' + (a.days >= 365 ? (a.days / 365).toFixed(1).replace('.', ',') + ' ans' : Math.round(a.days / 30.4375) + ' mois');
    return '<div class="cmpbar"><div class="row"><b>' + esc(x.t.v.name) + '</b><span><b>' + cmpFmt(cmpUnit(a, a.usage)) + '</b></span></div>' + cmpBar(a, max) +
      '<div class="muted">' + info + (a.aligned ? ' (recalculé sur ' + esc(refT.v.name) + ')' : '') + (x.t.o.estimated ? ' · carburant estimé' : '') + '</div></div>';
  }).join('') + cmpLegend() + (aligned ? '<div class="muted">Alignement : chaque véhicule est recalculé avec les km et la durée de « ' + esc(refT.v.name) + ' ». L\'énergie et les entretiens sont proportionnels aux km ; l\'assurance et les autres dépenses à la durée.</div>' : '') + '</div>';
  h += '<h2>Tableau comparatif</h2><div class="muted">Faites défiler le tableau vers la droite pour voir tous les véhicules.</div><div class="tbl"><table><thead><tr><th></th>' + T.map(function (t) { return '<th>' + esc(t.v.name) + '</th>'; }).join('') + '</tr></thead><tbody>' +
    rows.map(function (r) { return '<tr class="' + r[2] + '"><th>' + esc(r[0].trim()) + '</th>' + T.map(function (t) { return '<td>' + r[1](t.o) + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table></div>';
  h += '<div class="muted">' + (anyEst ? '* Carburant <b>estimé</b> (conso moyenne × km × prix mensuels) pour les véhicules en mode « Conso moyenne ». ' : '') +
    'Le coût d\'usage (énergie, entretiens, assurance, autres dépenses) se compare entre tous les véhicules. Le total (achat − revente) n\'est calculé que pour un véhicule <b>vendu</b> dont l\'achat et la revente sont renseignés ; sinon « – ». L\'assurance est au prorata des jours.</div>';
  // dépenses par année
  var yv = CMP.yearVeh && sel.some(function (x) { return x.id === CMP.yearVeh; }) ? CMP.yearVeh : sel[0].id;
  h += '<h2>Dépenses par année</h2><div class="card"><label for="cmpYear">Véhicule</label><select id="cmpYear">' + sel.map(function (x) { return '<option value="' + esc(x.id) + '"' + (x.id === yv ? ' selected' : '') + '>' + esc(x.name) + '</option>'; }).join('') + '</select></div>';
  var yvv = data.vehicles.filter(function (x) { return x.id === yv; })[0], Y = yearCosts(yvv), ys = Object.keys(Y).sort().reverse();
  if (!ys.length) h += '<div class="card muted">Aucune dépense datée.</div>';
  else {
    var max = Math.max.apply(null, ys.map(function (y) { return CATS.reduce(function (s, c) { return s + (Y[y][c[0]] || 0); }, 0); }));
    h += '<div class="card">' + ys.map(function (y) {
      var o = Y[y], tot = CATS.reduce(function (s, c) { return s + (o[c[0]] || 0); }, 0);
      var bar = '<div class="stack" style="width:' + (max ? (tot / max * 100).toFixed(1) : 0) + '%">' + CATS.map(function (c) { var v = o[c[0]] || 0; return v > 0 ? '<span class="seg-' + c[2] + '" style="width:' + (v / tot * 100).toFixed(2) + '%" title="' + esc(c[1]) + ' : ' + fmtEur(v) + '"></span>' : ''; }).join('') + '</div>';
      return '<div class="cmpbar"><div class="row"><b>' + y + '</b><span>' + fmtEur(tot) + '</span></div>' + bar +
        '<div class="muted">' + CATS.filter(function (c) { return o[c[0]] > 0; }).map(function (c) { return c[1].split(' ')[0] + ' ' + fmtEur(o[c[0]]); }).join(' · ') + '</div></div>';
    }).join('') + cmpLegend() + '</div>';
  }
  return h;
}

document.addEventListener('change', function (e) {
  var t = e.target; if (!t) return;
  if (t.getAttribute && t.getAttribute('data-cmp')) {
    var id = t.getAttribute('data-cmp'), i = (CMP.sel || []).indexOf(id);
    if (t.checked && i < 0) CMP.sel.push(id); else if (!t.checked && i >= 0) CMP.sel.splice(i, 1);
    render();
  } else if (t.getAttribute && t.getAttribute('data-metric')) { CMP.metric = t.getAttribute('data-metric'); render(); }
  else if (t.getAttribute && t.getAttribute('data-base')) { CMP.align = t.getAttribute('data-base') === 'ref'; render(); }
  else if (t.id === 'cmpRef') { CMP.ref = t.value; render(); }
  else if (t.id === 'cmpYear') { CMP.yearVeh = t.value; render(); }
});
