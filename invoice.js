'use strict';
/* Extraction d'une facture d'entretien par une IA extérieure (Claude ou Gemini, dans leur appli, gratuit).
   1) la photo de la facture et la consigne partent vers l'IA (partage Android) ; 2) l'IA répond par un bloc JSON ;
   3) on le colle ici : le formulaire d'entretien se remplit, l'utilisateur vérifie puis enregistre. */

var INV_PROMPT = `Tu es mon assistant pour le carnet d'entretien de mes véhicules. Je joins la photo (ou le PDF) d'une facture d'entretien ou de réparation, éventuellement sur plusieurs pages.
Lis la facture avec soin et réponds par UN SEUL bloc de code JSON (pour que j'aie un bouton « copier »), sans aucun texte avant ni après, de cette forme exacte :
{"type":"","date":"AAAA-MM-JJ","km":null,"place":"","plate":"","vin":"","lines":[{"kind":"Main d'oeuvre","label":"","amount":0}],"amounts_incl":"TTC","vat_rate":20,"discount":null,"total_ttc":null,"notes":""}
Règles :
- type : nom court de l'entretien (ex. "Vidange", "Pneus", "Freins", "Contrôle technique", "Révision annuelle", "Batterie", "Distribution"). Pour une facture qui regroupe plusieurs opérations, donne le nom de la principale ou "Révision".
- date : date de la facture ou de l'intervention, au format AAAA-MM-JJ. km : kilométrage au compteur inscrit sur la facture (nombre entier), sinon null.
- place : nom du garage ou du centre (avec la ville si elle est indiquée). plate : immatriculation du véhicule si elle est inscrite, vin : numéro de série (17 caractères) s'il est inscrit, sinon "".
- lines : une entrée par ligne de la facture. kind doit être exactement l'un de : "Main d'oeuvre", "Pièces", "Équipements", "Autre" (fournitures, huile, liquides, forfaits, déplacement, taxes écologiques : "Pièces" pour les pièces et fluides, "Autre" pour le reste). label : description courte de la ligne. amount : montant de la ligne en euros, nombre avec un point décimal, tel qu'écrit sur la facture (quantité déjà multipliée par le prix unitaire).
- amounts_incl : "HT" si les montants des lignes sont hors taxes, "TTC" s'ils sont toutes taxes comprises. vat_rate : taux de TVA en % (20 en général), 0 si la facture n'en mentionne pas.
- discount : remise totale en euros (nombre positif) si la facture en mentionne une, sinon null. Ne la mets pas aussi dans les lignes.
- total_ttc : le net à payer toutes taxes comprises, tel qu'écrit sur la facture. Il me sert à contrôler ton extraction : vérifie que les lignes, la remise et la TVA y mènent.
- notes : informations utiles qui ne rentrent pas ailleurs (références de pièces, garantie, remarque du garage), sinon "".
- Valeur illisible ou absente : null (ou "" pour un texte, [] pour lines). N'invente rien et ne devine pas un chiffre illisible : laisse-le à null et signale-le dans notes.`;

function invPrompt() {
  var v = document.getElementById('f_vid'), veh = v ? data.vehicles.filter(function (x) { return x.id === v.value; })[0] : null;
  var types = maintTypes().join(', ');
  return INV_PROMPT + (veh ? '\nVéhicule concerné (à vérifier avec la facture) : ' + veh.name + (veh.plate ? ', immatriculation ' + veh.plate : '') + '.' : '') +
    '\nTypes d\'entretien que j\'utilise déjà : ' + types + '. Réutilise l\'un d\'eux s\'il convient.';
}
var INVCLIP = { last: '', launched: false, busy: false };

function invInit() {
  var el = document.getElementById('aiBox'); if (!el) return;
  el.innerHTML = '<h2>Lire la facture avec une IA</h2><div class="card"><div class="muted">Ajoute d\'abord la photo ou le PDF de la facture ci-dessus. Puis :<br><b>1.</b> « Analyser avec Claude ou Gemini » copie la consigne et envoie la facture vers l\'appli que tu choisis. <b>2.</b> Dans l\'appli, colle la consigne si elle n\'apparaît pas, puis touche « copier » sur la réponse. <b>3.</b> Reviens ici : le formulaire se remplit tout seul (sinon, touche « Coller la réponse »). Vérifie, corrige, enregistre.</div>' +
    '<div class="actions"><button type="button" class="primary" data-act="invShare">Analyser avec Claude ou Gemini</button></div>' +
    '<div class="actions"><button type="button" data-act="invCopy">Copier la consigne</button><a class="btn" href="https://claude.ai/new" target="_blank" rel="noopener" data-act="invOpen" style="text-decoration:none;text-align:center">Ouvrir Claude</a><a class="btn" href="https://gemini.google.com/app" target="_blank" rel="noopener" data-act="invOpen" style="text-decoration:none;text-align:center">Ouvrir Gemini</a></div>' +
    '<div class="actions"><button type="button" data-act="invPaste">Coller la réponse</button></div>' +
    '<details id="invDet"><summary>Coller la réponse à la main</summary><textarea id="invTxt" placeholder="Colle ici le bloc JSON copié depuis Claude ou Gemini" style="min-height:120px"></textarea><div class="actions"><button type="button" data-act="invFill">Remplir le formulaire</button></div></details>' +
    '<div id="invRes"></div></div>';
}
async function invCopy(txt) {
  try { await navigator.clipboard.writeText(txt); return true; } catch (e) { /* repli */ }
  try { var ta = document.createElement('textarea'); ta.value = txt; ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select(); var ok = document.execCommand('copy'); ta.remove(); return ok; } catch (e2) { return false; }
}
async function invFiles() { // fichiers à partager : nouveaux ajouts (originaux) puis pièces déjà enregistrées présentes sur l'appareil
  var out = AT.pend.slice(), ex = attsOf(AT.kind, AT.owner);
  for (var i = 0; i < ex.length; i++) { if (AT.rem[ex[i].id]) continue; var b = await blobGet(ex[i].id); if (b) out.push(new File([b], ex[i].name, { type: ex[i].mime })); }
  return out;
}
async function invShare() {
  var txt = invPrompt(), copied = await invCopy(txt), files = [];
  try { files = await invFiles(); } catch (e) { /* sans fichier */ }
  INVCLIP.launched = true;
  if (!files.length) { toast(copied ? 'Consigne copiée. Ajoute d\'abord la photo de la facture (＋ Photos ou PDF).' : 'Ajoute d\'abord la photo de la facture.'); return; }
  try {
    if (navigator.canShare && navigator.canShare({ files: files })) {
      await navigator.share({ files: files, text: txt, title: 'Facture d\'entretien' });
      toast(copied ? 'Consigne copiée. Colle-la dans l\'appli si elle n\'apparaît pas.' : 'Choisis Claude ou Gemini, puis colle la consigne (bouton « Copier la consigne »).'); return;
    }
  } catch (e) { if (e && e.name === 'AbortError') return; }
  toast(copied ? 'Partage impossible ici. Consigne copiée : ouvre Claude ou Gemini, joins la facture et colle la consigne.' : 'Partage impossible ici : touche « Copier la consigne », puis ouvre Claude ou Gemini.');
}

/* ---------- Lecture de la réponse ---------- */
function invParse(raw) {
  var t = String(raw || '').trim(), m = /\{[\s\S]*\}/.exec(t); if (!m) return null;
  try { var j = JSON.parse(m[0]); return j && typeof j === 'object' ? j : null; } catch (e) { return null; }
}
function invLooks(t) { var j = invParse(t); return !!(j && (Array.isArray(j.lines) || j.total_ttc != null) && (j.type || j.date || j.lines)); }
function nn(x) { if (x == null || x === '') return null; var v = typeof x === 'number' ? x : num(String(x).replace(/\s/g, '').replace(',', '.')); return v != null && isFinite(v) ? v : null; }
function mark(el) { if (el) el.classList.add('auto'); }
function invFill(raw) {
  var j = invParse(raw), res = document.getElementById('invRes');
  if (!j) { toast('Réponse illisible : copie le bloc complet (de { à }).'); return; }
  var f = document.getElementById('mform'); if (!f) return;
  var n = 0, warn = [], setv = function (id, v) { var el = document.getElementById(id); if (el && v != null && v !== '') { el.value = v; mark(el); n++; } };
  // véhicule : par immatriculation ou numéro de série
  var norm = function (s) { return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); }, sel = document.getElementById('f_vid');
  if (sel && (j.plate || j.vin)) {
    var hit = data.vehicles.filter(function (v) { return (j.plate && norm(v.plate) && norm(v.plate) === norm(j.plate)) || (j.vin && norm(v.vin) && norm(v.vin) === norm(j.vin)); })[0];
    if (hit) { if (sel.value !== hit.id) { sel.value = hit.id; warn.push('Véhicule changé pour « ' + hit.name + ' » d\'après l\'immatriculation ou le numéro de série.'); } }
    else warn.push('Immatriculation « ' + (j.plate || j.vin) + ' » de la facture absente de tes fiches : vérifie que le véhicule choisi est le bon.');
  }
  if (j.type) setv('f_type', String(j.type).trim());
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(j.date || ''))) setv('f_date', j.date);
  var km = nn(j.km); if (km != null) setv('f_km', Math.round(km));
  if (j.place) setv('f_place', String(j.place).trim());
  var lines = Array.isArray(j.lines) ? j.lines.filter(function (l) { return l && nn(l.amount) != null; }) : [];
  var total = nn(j.total_ttc);
  if (lines.length) {
    var radio = f.querySelector('input[name=mode][value=detail]'); radio.checked = true; radio.dispatchEvent(new Event('change', { bubbles: true }));
    var box = document.getElementById('lines'); box.innerHTML = '';
    lines.forEach(function (l) { var k = LINE_KINDS.indexOf(l.kind) >= 0 ? l.kind : 'Autre'; box.insertAdjacentHTML('beforeend', lineRow({ kind: k, label: String(l.label || '').trim(), amount: nn(l.amount) })); });
    n += lines.length;
    var incl = String(j.amounts_incl).toUpperCase() === 'HT' ? 'HT' : 'TTC';
    f.querySelector('input[name=incl][value=' + incl + ']').checked = true;
    var vat = nn(j.vat_rate); if (vat != null) setv('f_vat', String(vat).replace('.', ','));
    var disc = nn(j.discount); if (disc != null && disc > 0) setv('f_discount', String(disc).replace('.', ','));
  } else if (total != null) {
    var r2 = f.querySelector('input[name=mode][value=total]'); r2.checked = true; r2.dispatchEvent(new Event('change', { bubbles: true }));
    setv('f_total', String(total).replace('.', ','));
  }
  if (j.notes) { var nt = document.getElementById('f_notes'); if (nt && !nt.value.trim()) { nt.value = String(j.notes); mark(nt); n++; } }
  maintCalc();
  // contrôle : total calculé et total de la facture
  var calc = maintTotal(readMaintForm(f));
  var out = '<div class="card ' + (n ? '' : 'warn') + '" style="margin-top:10px"><b>' + (n ? n + ' élément(s) remplis (surlignés). Vérifie avant d\'enregistrer.' : 'Rien à remplir dans cette réponse.') + '</b>';
  if (lines.length && total != null) {
    var ok = Math.abs(calc - total) < 0.06;
    out += '<div style="margin-top:6px">' + (ok ? '✅ Le total calculé (' + fmtEur(calc) + ') correspond au total de la facture (' + fmtEur(total) + ').' :
      '⚠️ Le total calculé (' + fmtEur(calc) + ') diffère du total de la facture (' + fmtEur(total) + ') : une ligne, la remise ou la TVA est peut-être mal lue. Compare avec la photo.') + '</div>';
  }
  warn.forEach(function (w) { out += '<div style="margin-top:6px">⚠️ ' + esc(w) + '</div>'; });
  out += '</div>';
  if (res) res.innerHTML = out;
  var det = document.getElementById('invDet'); if (det) det.open = false;
  toast(n ? 'Formulaire rempli (' + n + ' éléments). Vérifie puis enregistre.' : 'Rien à remplir dans cette réponse.');
}
async function invPaste() {
  var t = ''; try { t = await navigator.clipboard.readText(); } catch (e) { /* refus */ }
  if (t && t.trim()) { document.getElementById('invTxt').value = t; invFill(t); return; }
  var det = document.getElementById('invDet'); if (det) det.open = true;
  var ta = document.getElementById('invTxt'); if (ta) { ta.focus(); ta.scrollIntoView({ block: 'center' }); }
  toast('Colle la réponse dans la zone, puis touche « Remplir le formulaire ».');
}
// Au retour dans l'appli : si le dernier texte copié est une réponse au bon format, on remplit le formulaire (une fois par texte)
async function invClipCheck() {
  if (!INVCLIP.launched || INVCLIP.busy || !document.getElementById('invTxt')) return;
  INVCLIP.busy = true;
  try {
    var t = ((await navigator.clipboard.readText()) || '').trim();
    if (t && t !== INVCLIP.last && invLooks(t)) { INVCLIP.last = t; INVCLIP.launched = false; document.getElementById('invTxt').value = t; invFill(t); }
  } catch (e) { /* lecture refusée */ }
  INVCLIP.busy = false;
}
document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') invClipCheck(); });
window.addEventListener('focus', invClipCheck);

document.addEventListener('click', function (e) {
  var el = e.target.closest && e.target.closest('[data-act]'); if (!el) return;
  var act = el.getAttribute('data-act'), run = function (p) { p.catch(function (err) { toast('Erreur : ' + (err && err.message ? err.message : err)); }); };
  if (act === 'invShare') run(invShare());
  else if (act === 'invCopy') run(invCopy(invPrompt()).then(function (ok) { INVCLIP.launched = true; toast(ok ? 'Consigne copiée.' : 'Copie impossible : sélectionne le texte à la main.'); }));
  else if (act === 'invOpen') INVCLIP.launched = true;
  else if (act === 'invPaste') run(invPaste());
  else if (act === 'invFill') invFill(document.getElementById('invTxt').value);
});
