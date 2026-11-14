'use strict';
/* Assurance : une période de contrat = assureur, formule, prime ANNUELLE, dates de début et de fin (vide = en cours).
   Un changement d'assureur ou de contrat = une nouvelle période (l'ancienne est arrêtée la veille).
   Le coût est réparti au prorata des jours : prime annuelle ÷ 365 × jours couverts. */

function insList(vid) { return data.insur.filter(function (c) { return c.vehicleId === vid; }).sort(function (a, b) { return b.from.localeCompare(a.from); }); }
function dayNum(ds) { return Math.round(Date.UTC(+ds.slice(0, 4), +ds.slice(5, 7) - 1, +ds.slice(8, 10)) / 86400000); }
function addDays(ds, n) { return new Date((dayNum(ds) + n) * 86400000).toISOString().slice(0, 10); }
function insEnd(c, v) { // fin retenue pour le calcul : fin du contrat, sinon aujourd'hui ; jamais après la sortie du véhicule
  var end = c.to || todayStr(); if (end > todayStr() && !c.to) end = todayStr();
  var x = v && v.exit && v.exit.date; if (x && x < end) end = x; return end;
}
function insCost(vid) {
  var v = data.vehicles.filter(function (x) { return x.id === vid; })[0], cost = 0, days = 0;
  insList(vid).forEach(function (c) {
    var end = insEnd(c, v); if (end < c.from || !(c.annual >= 0)) return;
    var d = dayNum(end) - dayNum(c.from) + 1; days += d; cost += c.annual * d / 365;
  });
  return { cost: cost, days: days, perYear: days ? cost / days * 365 : null };
}
function insItem(c) {
  var cur = !c.to;
  return '<div class="item"><div><b>' + esc(c.insurer || 'Assurance') + '</b>' + (c.formula ? ' · ' + esc(c.formula) : '') + (cur ? ' <span class="tag">en cours</span>' : '') +
    '<div class="muted">du ' + fmtDate(c.from) + (c.to ? ' au ' + fmtDate(c.to) : '') + ' · ' + fmtEur(c.annual) + ' / an' + (c.franchise ? ' · franchise ' + esc(c.franchise) : '') + (attCount('insur', c.id) ? ' · 📎 ' + attCount('insur', c.id) : '') + '</div></div>' +
    '<div><button class="link" data-act="editIns" data-id="' + esc(c.id) + '">Modifier</button></div></div>';
}
function insVehicleSection(v) {
  var cs = insList(v.id), h = '<h2>Assurance</h2>';
  if (cs.length) {
    var t = insCost(v.id);
    h += '<div class="card">' + kv([['Coût cumulé (au prorata des jours)', fmtEur(t.cost)], ['Jours couverts', String(t.days)], ['Moyenne par an', t.perYear != null ? fmtEur(t.perYear) : ''], ['Moyenne par mois', t.perYear != null ? fmtEur(t.perYear / 12) : '']]) + '</div>' +
      '<div class="card list">' + cs.map(insItem).join('') + '</div>';
  } else h += '<div class="card muted">Aucun contrat d\'assurance enregistré.</div>';
  h += '<div class="actions"><button data-act="addIns" data-id="' + esc(v.id) + '">' + (cs.length ? '＋ Changement de contrat / d\'assureur' : '＋ Contrat d\'assurance') + '</button></div>';
  return h;
}

/* ---------- Formulaire ---------- */
function insForm(vehicleId, id) {
  var c = id ? data.insur.filter(function (x) { return x.id === id; })[0] : null;
  if (!data.vehicles.length) { toast('Ajoutez d\'abord un véhicule'); return; }
  var vid = c ? c.vehicleId : defaultVeh(vehicleId), prev = insList(vid)[0];
  var h = '<h1>' + (c ? 'Modifier le contrat' : 'Nouveau contrat / changement') + '</h1><form id="insform" data-id="' + esc(c ? c.id : '') + '">' +
    '<label for="f_vid">Véhicule</label><select id="f_vid" name="vehicleId">' + vehOptions(vid, true) + '</select>' +
    fld('Assureur', 'insurer', c ? c.insurer : '', { req: true, ph: 'ex. MAIF, Matmut, Direct Assurance…' }) +
    fld('Formule / type de contrat', 'formula', c ? c.formula : '', { ph: 'Tous risques, tiers, tiers + vol…' }) +
    fld('N° de contrat (facultatif)', 'contractNo', c ? c.contractNo : '') +
    fld('Début de cette période', 'from', c ? c.from : todayStr(), { type: 'date', req: true }) +
    fld('Fin de cette période (vide = en cours)', 'to', c ? c.to : '', { type: 'date' }) +
    fld('Prime annuelle (€)', 'annual', c ? String(c.annual).replace('.', ',') : '', { inputmode: 'decimal', req: true, ph: 'ex. 480' }) +
    fld('Franchise (facultatif)', 'franchise', c ? c.franchise : '') +
    '<div class="muted">Un changement d\'assureur, de formule ou de prime = une nouvelle période avec sa date de début : l\'ancienne période en cours est arrêtée la veille.' + (prev && !c ? ' Période actuelle : ' + esc(prev.insurer) + ' depuis le ' + fmtDate(prev.from) + '.' : '') + '</div>' +
    '<h2>Documents</h2><div id="attBox"></div><div id="aiBox"></div>' +
    '<label for="f_notes">Remarques</label><textarea id="f_notes" name="notes">' + esc(c ? c.notes || '' : '') + '</textarea>' +
    (c ? '<div class="actions"><button type="button" class="danger" data-act="delIns" data-id="' + esc(c.id) + '">Supprimer cette période</button></div>' : '') +
    '<div class="formbar"><button type="button" data-act="closeSheet">Annuler</button><button class="primary" type="submit">Enregistrer</button></div></form>';
  openSheet(h); attInit('insur', c ? c.id : ''); invInit('insur');
}
async function saveIns(form) {
  var fd = new FormData(form), id = form.getAttribute('data-id'), g = function (k) { return (fd.get(k) || '').toString().trim(); };
  var vid = g('vehicleId'), from = g('from'), to = g('to'), annual = num(g('annual'));
  if (!g('insurer') || !from || annual == null || annual < 0) { toast('Assureur, début et prime annuelle requis'); return; }
  if (to && to < from) { toast('La fin précède le début'); return; }
  var others = insList(vid).filter(function (x) { return x.id !== id; });
  var open = others.filter(function (x) { return !x.to && x.from < from; })[0];
  if (!to && open) { // changement de contrat : l'ancienne période en cours est arrêtée la veille
    if (!confirm('La période « ' + open.insurer + ' » (depuis le ' + fmtDate(open.from) + ') sera arrêtée le ' + fmtDate(addDays(from, -1)) + '.\n\nContinuer ?')) return;
    await dbPut('insur', Object.assign({}, open, { to: addDays(from, -1), updatedAt: Date.now() }));
    others = insList(vid).filter(function (x) { return x.id !== id; });
  }
  var ov = others.filter(function (x) { return x.from <= (to || '9999-12-31') && (!x.to || x.to >= from); });
  if (ov.length && !confirm('Cette période chevauche « ' + ov[0].insurer + ' » (' + fmtDate(ov[0].from) + (ov[0].to ? ' → ' + fmtDate(ov[0].to) : ' → en cours') + ') : les jours communs seraient comptés deux fois.\n\nEnregistrer quand même ?')) return;
  var old = id ? data.insur.filter(function (x) { return x.id === id; })[0] : null;
  var c = old ? Object.assign({}, old) : { id: uid(), createdAt: Date.now() };
  Object.assign(c, { vehicleId: vid, insurer: g('insurer'), formula: g('formula'), contractNo: g('contractNo'), from: from, to: to, annual: annual, franchise: g('franchise'), notes: g('notes'), updatedAt: Date.now() });
  await dbPut('insur', c);
  var nAtt = await attCommit('insur', c.id, vid, 'Assurance ' + c.insurer + ' ' + from);
  await reload(); closeSheet();
  if (state.tab === 'vehicle') go('vehicle', vid); else render();
  toast('Contrat enregistré' + (nAtt ? ' (' + nAtt + ' document(s) ajouté(s))' : ''));
}

/* ---------- Lecture par une IA extérieure ---------- */
var INS_PROMPT = `Tu es mon assistant pour le suivi de mes assurances automobiles. Je joins la photo (ou le PDF) d'un contrat, d'un avis d'échéance ou d'une attestation d'assurance, éventuellement sur plusieurs pages.
Lis le document avec soin et réponds par UN SEUL bloc de code JSON (pour que j'aie un bouton « copier »), sans aucun texte avant ni après, de cette forme exacte :
{"insurer":"","formula":"","contract_no":"","start_date":"AAAA-MM-JJ","end_date":null,"annual_premium":null,"franchise":"","plate":"","vin":"","notes":""}
Règles :
- insurer : nom de l'assureur. formula : formule ou type de contrat (ex. "Tous risques", "Tiers", "Tiers + vol et incendie"). contract_no : numéro de contrat ou de sociétaire.
- start_date : date de début de la période de garantie couverte par ce document (AAAA-MM-JJ). end_date : date de fin de cette période si elle est écrite, sinon null.
- annual_premium : cotisation TOTALE sur 12 mois en euros, toutes taxes comprises, nombre avec un point décimal. Si le document ne donne qu'une cotisation mensuelle, multiplie par 12 ; si la période du document n'est pas de 12 mois, ramène-la à 12 mois. Précise ton calcul dans notes.
- franchise : franchise principale telle qu'écrite (texte court). plate : immatriculation du véhicule assuré, vin : numéro de série s'il est écrit, sinon "".
- notes : informations utiles (garanties notables, bonus-malus, échéance de renouvellement, calcul de la prime), sinon "".
- Valeur absente ou illisible : null (ou "" pour un texte). N'invente rien.`;
function insFill(raw) {
  var j = invParse(raw), res = document.getElementById('invRes');
  if (!j) { toast('Réponse illisible : copie le bloc complet (de { à }).'); return; }
  var f = document.getElementById('insform'); if (!f) return;
  var n = 0, warn = [], setv = function (id, v) { var el = document.getElementById(id); if (el && v != null && String(v).trim() !== '') { el.value = String(v).trim(); mark(el); n++; } };
  var norm = function (s) { return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); }, sel = document.getElementById('f_vid');
  if (sel && (j.plate || j.vin)) {
    var hit = data.vehicles.filter(function (v) { return (j.plate && norm(v.plate) && norm(v.plate) === norm(j.plate)) || (j.vin && norm(v.vin) && norm(v.vin) === norm(j.vin)); })[0];
    if (hit) { if (sel.value !== hit.id) { sel.value = hit.id; warn.push('Véhicule changé pour « ' + hit.name + ' » d\'après l\'immatriculation ou le numéro de série.'); } }
    else warn.push('Immatriculation « ' + (j.plate || j.vin) + ' » absente de tes fiches : vérifie le véhicule choisi.');
  }
  setv('f_insurer', j.insurer); setv('f_formula', j.formula); setv('f_contractNo', j.contract_no); setv('f_franchise', j.franchise);
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(j.start_date || ''))) setv('f_from', j.start_date);
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(j.end_date || ''))) setv('f_to', j.end_date);
  var p = nn(j.annual_premium); if (p != null) setv('f_annual', String(p).replace('.', ','));
  if (j.notes) { var nt = document.getElementById('f_notes'); if (nt && !nt.value.trim()) { nt.value = String(j.notes); mark(nt); n++; } }
  if (p == null) warn.push('Prime annuelle non lue : saisis-la.');
  var out = '<div class="card ' + (n ? '' : 'warn') + '" style="margin-top:10px"><b>' + (n ? n + ' champ(s) remplis (surlignés). Vérifie avant d\'enregistrer.' : 'Rien à remplir dans cette réponse.') + '</b>';
  warn.forEach(function (w) { out += '<div style="margin-top:6px">⚠️ ' + esc(w) + '</div>'; });
  if (res) res.innerHTML = out + '</div>';
  var det = document.getElementById('invDet'); if (det) det.open = false;
  toast(n ? 'Formulaire rempli (' + n + ' champs). Vérifie puis enregistre.' : 'Rien à remplir dans cette réponse.');
}

document.addEventListener('click', function (e) {
  var el = e.target.closest && e.target.closest('[data-act]'); if (!el) return;
  var act = el.getAttribute('data-act'), id = el.getAttribute('data-id'), cur = state.tab === 'vehicle' ? state.vehicleId : null;
  if (act === 'addIns') insForm(id || cur, null);
  else if (act === 'editIns') insForm(null, id);
  else if (act === 'delIns') deleteRec('insur', 'insurance', id, 'cette période d\'assurance').catch(function (err) { toast('Erreur : ' + err.message); });
});
document.addEventListener('submit', function (e) {
  if (e.target.id === 'insform') saveIns(e.target).catch(function (err) { toast('Erreur : ' + (err && err.message ? err.message : err)); });
});
