'use strict';
/* Étape 0.4 — Carnet d'entretien, autres dépenses, achats annexes (sans pièces jointes pour l'instant). */

var OTHER = '__other';
var LINE_KINDS = ['Main d\'oeuvre', 'Pièces', 'Équipements', 'Autre'];
var EXP_CATS = ['Assurance', 'Carte grise', 'Contrôle technique', 'Vignette', 'Parking', 'Péage', 'Lavage', 'Amende', 'Autre'];

function eur2(n) { return Math.round(n * 100) / 100; }
function vehName(id) { if (id === OTHER) return 'Autre personne'; var v = data.vehicles.filter(function (x) { return x.id === id; })[0]; return v ? v.name : '(véhicule supprimé)'; }
// Total TTC d'un entretien
function maintTotal(m) {
  if (m.mode !== 'detail') return m.total != null ? m.total : null;
  var sum = (m.lines || []).reduce(function (s, l) { return s + (Number(l.amount) || 0); }, 0);
  var net = Math.max(0, sum - (Number(m.discount) || 0));
  return eur2(m.incl === 'HT' ? net * (1 + (Number(m.vat) || 0) / 100) : net);
}
function vehMaints(id) { return data.maints.filter(function (m) { return m.vehicleId === id; }).sort(function (a, b) { return b.date.localeCompare(a.date) || (b.km || 0) - (a.km || 0); }); }
function vehExpenses(id) { return data.expenses.filter(function (m) { return m.vehicleId === id; }).sort(function (a, b) { return b.date.localeCompare(a.date); }); }
function maintTypes() {
  var t = {}; data.maints.forEach(function (m) { if (m.type) t[m.type] = 1; });
  ['Vidange', 'Pneus', 'Freins', 'Contrôle technique', 'Révision annuelle', 'Batterie', 'Distribution'].forEach(function (x) { t[x] = 1; });
  return Object.keys(t).sort(function (a, b) { return a.localeCompare(b, 'fr'); });
}
function expCats() { var t = {}; EXP_CATS.forEach(function (x) { t[x] = 1; }); data.expenses.forEach(function (e) { if (e.kind === 'depense' && e.category) t[e.category] = 1; }); return Object.keys(t); }

function maintItem(m, showVeh) {
  var tot = maintTotal(m);
  return '<div class="item"><div><b>' + esc(m.type || 'Entretien') + '</b> · ' + fmtDate(m.date) + (showVeh ? ' · ' + esc(vehName(m.vehicleId)) : '') +
    '<div class="muted">' + [m.km != null ? fmtKm(m.km) : '', m.place || '', tot != null ? fmtEur(tot) : '', attCount('maint', m.id) ? '📎 ' + attCount('maint', m.id) : ''].filter(Boolean).join(' · ') + '</div></div>' +
    '<div><button class="link" data-act="editMaint" data-id="' + esc(m.id) + '">Modifier</button></div></div>';
}
function expItem(e, showVeh) {
  return '<div class="item"><div><b>' + esc(e.kind === 'annexe' ? (e.description || 'Achat annexe') : (e.category || 'Dépense')) + '</b> · ' + fmtDate(e.date) + (showVeh ? ' · ' + esc(vehName(e.vehicleId)) : '') +
    '<div class="muted">' + [e.kind === 'annexe' ? 'achat annexe' : (e.description || ''), fmtEur(e.amount)].filter(Boolean).join(' · ') + '</div></div>' +
    '<div><button class="link" data-act="editExp" data-id="' + esc(e.id) + '">Modifier</button></div></div>';
}
function sumMaint(id) { return vehMaints(id).reduce(function (s, m) { return s + (maintTotal(m) || 0); }, 0); }
function sumExp(id, kind) { return vehExpenses(id).filter(function (e) { return !kind || e.kind === kind; }).reduce(function (s, e) { return s + (Number(e.amount) || 0); }, 0); }
function energySpend(v) { return (fillStats(v.id).eur || 0) + chargesCost(v.id); }

function maintVehicleSection(v) {
  var ms = vehMaints(v.id), es = vehExpenses(v.id), en = energySpend(v), mt = sumMaint(v.id), ex = sumExp(v.id, 'depense'), an = sumExp(v.id, 'annexe'), as = insCost(v.id).cost;
  var h = '<h2>Entretiens (' + ms.length + ')</h2><div class="actions"><button data-act="addMaint" data-id="' + esc(v.id) + '">＋ Entretien</button></div>';
  h += ms.length ? '<div class="card list">' + ms.map(function (m) { return maintItem(m, false); }).join('') + '</div>' : '<div class="card muted">Aucun entretien enregistré.</div>';
  h += '<h2>Dépenses et achats annexes (' + es.length + ')</h2><div class="actions"><button data-act="addExp" data-id="' + esc(v.id) + '">＋ Dépense</button><button data-act="addAnnexe" data-id="' + esc(v.id) + '">＋ Achat annexe</button></div>';
  h += es.length ? '<div class="card list">' + es.map(function (e) { return expItem(e, false); }).join('') + '</div>' : '<div class="card muted">' + (v.equip ? 'Aucune dépense (pièces, intervention…).' : 'Aucune dépense (assurance, péage, protège-écran…).') + '</div>';
  if (v.equip) {
    var pp = v.purchase && v.purchase.price != null ? v.purchase.price : 0;
    h += '<h2>Dépenses cumulées</h2><div class="card">' + kv([['Achat de l\'équipement', pp ? fmtEur(pp) : ''], ['Fioul (remplissages de cuve)', fmtEur(en)], ['Entretiens', fmtEur(mt)], ['Autres dépenses', fmtEur(ex)], ['Achats annexes', fmtEur(an)], ['Total (achat compris)', fmtEur(pp + en + mt + ex + an)]]) + '</div>';
    return h;
  }
  h += '<h2>Dépenses cumulées</h2><div class="card">' + kv([['Énergie (pleins et recharges)', fmtEur(en)], ['Entretiens', fmtEur(mt)], ['Autres dépenses', fmtEur(ex)], ['Achats annexes', fmtEur(an)], ['Assurance (au prorata)', fmtEur(as)], ['Total (hors achat du véhicule)', fmtEur(en + mt + ex + an + as)]]) + '</div>';
  return h;
}
function viewMaint() {
  var h = '<h1>Entretiens</h1><div class="actions"><button class="primary" data-act="addMaint">＋ Entretien</button><button data-act="addExp">＋ Dépense</button><button data-act="addAnnexe">＋ Achat annexe</button></div>';
  var ms = data.maints.slice().sort(function (a, b) { return b.date.localeCompare(a.date); }), es = data.expenses.slice().sort(function (a, b) { return b.date.localeCompare(a.date); });
  h += '<h2>Entretiens (' + ms.length + ')</h2>' + (ms.length ? '<div class="card list">' + ms.map(function (m) { return maintItem(m, true); }).join('') + '</div>' : '<div class="card empty">Aucun entretien. Les types se créent au fur et à mesure.</div>');
  h += '<h2>Dépenses et achats annexes (' + es.length + ')</h2>' + (es.length ? '<div class="card list">' + es.map(function (e) { return expItem(e, true); }).join('') + '</div>' : '<div class="card empty">Aucune dépense.</div>');
  return h;
}

/* ---------- Formulaire entretien ---------- */
function vehOptions(vid, noEquip) {
  return data.vehicles.filter(function (v) { return !(noEquip && v.equip); }).map(function (v) { return '<option value="' + esc(v.id) + '"' + (v.id === vid ? ' selected' : '') + '>' + esc(v.name) + '</option>'; }).join('');
}
function defaultVeh(vehicleId) { return vehicleId || (sortedVehicles('actuel')[0] || data.vehicles[0] || {}).id; }
function lineRow(l) {
  l = l || {};
  return '<div class="lrow"><select name="lk">' + LINE_KINDS.map(function (k) { return '<option' + (l.kind === k ? ' selected' : '') + '>' + esc(k) + '</option>'; }).join('') + '</select>' +
    '<input name="ll" placeholder="Détail" value="' + esc(l.label || '') + '"><input name="la" inputmode="decimal" placeholder="Montant" value="' + esc(l.amount == null ? '' : l.amount) + '">' +
    '<button type="button" data-act="rmLine" aria-label="Retirer">✕</button></div>';
}
function maintForm(vehicleId, id) {
  var m = id ? data.maints.filter(function (x) { return x.id === id; })[0] : null;
  if (!data.vehicles.length) { toast('Ajoutez d\'abord un véhicule'); return; }
  var vid = m ? m.vehicleId : defaultVeh(vehicleId), detail = m ? m.mode === 'detail' : false;
  var h = '<h1>' + (m ? 'Modifier l\'entretien' : 'Nouvel entretien') + '</h1><form id="mform" data-id="' + esc(m ? m.id : '') + '">' +
    '<label for="f_vid">Véhicule</label><select id="f_vid" name="vehicleId">' + vehOptions(vid) + '</select>' +
    fld('Type d\'entretien', 'type', m ? m.type : '', { list: 'dl_mtypes', req: true, ph: 'Vidange, pneus… (libre)' }) +
    '<datalist id="dl_mtypes">' + opts(maintTypes()) + '</datalist>' +
    fld('Date', 'date', m ? m.date : todayStr(), { type: 'date', req: true }) +
    '<div id="kmWrap"' + ((data.vehicles.filter(function (x) { return x.id === vid; })[0] || {}).equip ? ' hidden' : '') + '>' + fld('Kilométrage (facultatif)', 'km', m ? m.km : '', { inputmode: 'numeric' }) + '</div>' +
    fld('Garage ou lieu (facultatif)', 'place', m ? m.place : '') +
    '<label>Prix</label><div class="seg"><label><input type="radio" name="mode" value="total"' + (!detail ? ' checked' : '') + '><span>Total seul</span></label>' +
    '<label><input type="radio" name="mode" value="detail"' + (detail ? ' checked' : '') + '><span>Détaillé</span></label></div>' +
    '<div id="pTotal"' + (detail ? ' hidden' : '') + '>' + fld('Total payé (€)', 'total', m && m.mode !== 'detail' ? m.total : '', { inputmode: 'decimal' }) + '</div>' +
    '<div id="pDetail"' + (detail ? '' : ' hidden') + '><label>Lignes</label><div id="lines">' + ((m && m.lines && m.lines.length ? m.lines : [{}]).map(lineRow).join('')) + '</div>' +
    '<div class="actions"><button type="button" data-act="addLine">＋ Ajouter une ligne</button></div>' +
    '<label>Les montants des lignes sont</label><div class="seg"><label><input type="radio" name="incl" value="TTC"' + (!m || m.incl !== 'HT' ? ' checked' : '') + '><span>TTC</span></label>' +
    '<label><input type="radio" name="incl" value="HT"' + (m && m.incl === 'HT' ? ' checked' : '') + '><span>HT</span></label></div>' +
    '<div class="pair"><div>' + fld('TVA (%) si HT', 'vat', m && m.vat != null ? m.vat : 20, { inputmode: 'decimal' }) + '</div><div>' + fld('Remise (€)', 'discount', m ? m.discount : '', { inputmode: 'decimal' }) + '</div></div>' +
    '<div class="card"><div class="muted">Total TTC calculé</div><div class="big" id="mcalc">–</div></div></div>' +
    '<h2>Pièces jointes</h2><div id="attBox"></div>' +
    '<div id="aiBox"></div>' +
    '<label for="f_notes">Remarques</label><textarea id="f_notes" name="notes">' + esc(m ? m.notes || '' : '') + '</textarea>' +
    (m ? '<div class="actions"><button type="button" class="danger" data-act="delMaint" data-id="' + esc(m.id) + '">Supprimer cet entretien</button></div>' : '') +
    '<div class="formbar"><button type="button" data-act="closeSheet">Annuler</button><button class="primary" type="submit">Enregistrer</button></div></form>';
  openSheet(h); maintCalc(); attInit('maint', m ? m.id : ''); invInit('maint');
}
function readMaintForm(form) {
  var fd = new FormData(form), g = function (k) { return (fd.get(k) || '').toString().trim(); };
  var lk = fd.getAll('lk'), ll = fd.getAll('ll'), la = fd.getAll('la'), lines = [];
  la.forEach(function (a, i) { var amt = num(a); if (amt != null || String(ll[i] || '').trim()) lines.push({ kind: String(lk[i]), label: String(ll[i] || '').trim(), amount: amt || 0 }); });
  return { mode: g('mode') === 'detail' ? 'detail' : 'total', total: num(g('total')), lines: lines, incl: g('incl') === 'HT' ? 'HT' : 'TTC', vat: num(g('vat')), discount: num(g('discount')) };
}
function maintCalc() {
  var f = $('#mform'), out = $('#mcalc'); if (!f || !out) return;
  var p = readMaintForm(f); out.textContent = fmtEur(maintTotal(p));
}
async function saveMaint(form) {
  var fd = new FormData(form), id = form.getAttribute('data-id'), g = function (k) { return (fd.get(k) || '').toString().trim(); };
  var vid = g('vehicleId'), date = g('date'), type = g('type'), km = num(g('km'));
  if (!date || !type) { toast('Type et date requis'); return; }
  var p = readMaintForm(form);
  if (p.mode === 'total') { p.lines = []; } else { p.total = null; }
  var v = data.vehicles.filter(function (x) { return x.id === vid; })[0];
  if (v && v.equip) km = null;
  if (km != null) {
    km = Math.round(km);
    var w = kmWarnings(v, date, km, null);
    if (w.length && !confirm('Kilométrage incohérent : ' + w.join(' ; ') + '.\n\nEnregistrer quand même ?')) return;
  }
  var old = id ? data.maints.filter(function (x) { return x.id === id; })[0] : null;
  var m = old ? Object.assign({}, old) : { id: uid(), createdAt: Date.now() };
  Object.assign(m, p, { vehicleId: vid, type: type, date: date, km: km, place: g('place'), notes: g('notes'), updatedAt: Date.now() });
  await dbPut('maints', m);
  var nAtt = await attCommit('maint', m.id, vid, m.type + ' ' + date);
  if (km != null && !data.readings.some(function (r) { return r.vehicleId === vid && r.date === date && r.km === km; })) {
    await dbPut('readings', { id: uid(), vehicleId: vid, date: date, km: km, createdAt: Date.now(), updatedAt: Date.now(), fromMaint: true });
  }
  await reload(); closeSheet();
  if (state.tab === 'vehicle') go('vehicle', vid); else render();
  toast('Entretien enregistré' + (nAtt ? ' (' + nAtt + ' pièce(s) jointe(s) ajoutée(s))' : ''));
}
async function deleteRec(store, kind, id, label) {
  if (!confirm('Supprimer ' + label + (store === 'maints' && attCount('maint', id) ? ' et ses ' + attCount('maint', id) + ' pièce(s) jointe(s)' : '') + (store === 'insur' && attCount('insur', id) ? ' et ses ' + attCount('insur', id) + ' document(s)' : '') + ' ?')) return;
  if (store === 'maints') await attPurgeOwner('maint', id);
  if (store === 'insur') await attPurgeOwner('insur', id);
  var t = db.transaction([store, 'deleted'], 'readwrite');
  t.objectStore(store).delete(id); t.objectStore('deleted').put({ id: id, kind: kind, deletedAt: Date.now() });
  await done(t); await reload(); closeSheet(); render();
}

/* ---------- Dépense / achat annexe ---------- */
function expForm(vehicleId, id, kind) {
  var e = id ? data.expenses.filter(function (x) { return x.id === id; })[0] : null;
  if (!data.vehicles.length) { toast('Ajoutez d\'abord un véhicule'); return; }
  kind = e ? e.kind : (kind || 'depense');
  var an = kind === 'annexe', vid = e ? e.vehicleId : defaultVeh(vehicleId);
  var h = '<h1>' + (e ? (an ? 'Modifier l\'achat annexe' : 'Modifier la dépense') : (an ? 'Nouvel achat annexe' : 'Nouvelle dépense')) + '</h1><form id="eform" data-id="' + esc(e ? e.id : '') + '" data-kind="' + kind + '">' +
    '<label for="f_vid">Véhicule</label><select id="f_vid" name="vehicleId">' + vehOptions(vid) + '</select>' +
    (an ? fld('Description', 'description', e ? e.description : '', { req: true, ph: 'ex. protège-écran Tesla' })
      : fld('Catégorie', 'category', e ? e.category : '', { list: 'dl_ecats', req: true, ph: 'Assurance, péage… (libre)' }) + '<datalist id="dl_ecats">' + opts(expCats()) + '</datalist>' +
        fld('Détail (facultatif)', 'description', e ? e.description : '')) +
    fld('Date', 'date', e ? e.date : todayStr(), { type: 'date', req: true }) + fld('Montant (€)', 'amount', e ? e.amount : '', { inputmode: 'decimal', req: true }) +
    (e ? '<div class="actions"><button type="button" class="danger" data-act="delExp" data-id="' + esc(e.id) + '">Supprimer</button></div>' : '') +
    '<div class="formbar"><button type="button" data-act="closeSheet">Annuler</button><button class="primary" type="submit">Enregistrer</button></div></form>';
  openSheet(h);
}
async function saveExp(form) {
  var fd = new FormData(form), id = form.getAttribute('data-id'), kind = form.getAttribute('data-kind'), g = function (k) { return (fd.get(k) || '').toString().trim(); };
  var amount = num(g('amount')), date = g('date');
  if (!date || amount == null || amount < 0) { toast('Date et montant requis'); return; }
  var old = id ? data.expenses.filter(function (x) { return x.id === id; })[0] : null;
  var e = old ? Object.assign({}, old) : { id: uid(), createdAt: Date.now() };
  Object.assign(e, { kind: kind, vehicleId: g('vehicleId'), date: date, amount: amount, description: g('description'), category: kind === 'annexe' ? '' : g('category'), updatedAt: Date.now() });
  await dbPut('expenses', e); await reload(); closeSheet();
  if (state.tab === 'vehicle') go('vehicle', e.vehicleId); else render();
  toast('Enregistré');
}

/* ---------- Événements ---------- */
document.addEventListener('click', function (ev) {
  var el = ev.target.closest && ev.target.closest('[data-act]'); if (!el) return;
  var act = el.getAttribute('data-act'), id = el.getAttribute('data-id'), cur = state.tab === 'vehicle' ? state.vehicleId : null;
  var run = function (p) { p.catch(function (err) { toast('Erreur : ' + (err && err.message ? err.message : err)); }); };
  if (act === 'addMaint') maintForm(id || cur, null);
  else if (act === 'editMaint') maintForm(null, id);
  else if (act === 'delMaint') run(deleteRec('maints', 'maint', id, 'cet entretien'));
  else if (act === 'addExp') expForm(id || cur, null, 'depense');
  else if (act === 'addAnnexe') expForm(id || cur, null, 'annexe');
  else if (act === 'editExp') expForm(null, id);
  else if (act === 'delExp') run(deleteRec('expenses', 'expense', id, 'cette ligne'));
  else if (act === 'addLine') { $('#lines').insertAdjacentHTML('beforeend', lineRow()); }
  else if (act === 'rmLine') { el.closest('.lrow').remove(); maintCalc(); }
});
document.addEventListener('input', function (ev) { if (ev.target.closest && ev.target.closest('#mform')) maintCalc(); });
document.addEventListener('change', function (ev) {
  var t = ev.target; if (!t || !t.closest || !t.closest('#mform')) return;
  if (t.name === 'mode') { var d = t.value === 'detail'; $('#pTotal').hidden = d; $('#pDetail').hidden = !d; }
  maintCalc();
});
document.addEventListener('submit', function (ev) {
  var f = ev.target, p = null;
  if (f.id === 'mform') p = saveMaint(f); else if (f.id === 'eform') p = saveExp(f);
  if (p) p.catch(function (err) { toast('Erreur : ' + (err && err.message ? err.message : err)); });
});
