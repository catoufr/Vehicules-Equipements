'use strict';
/* Fiche « carte grise » (certificat d'immatriculation) : tous les champs officiels, photos jointes, lecture par une IA extérieure. */

// [clé = code officiel, libellé, type de champ]
var REG = [
  ['A', 'Immatriculation'], ['B', 'Date de 1ère immatriculation', 'date'], ['I', 'Date du certificat', 'date'], ['certNo', 'N° de formule'],
  ['C1', 'Titulaire'], ['C3', 'Adresse'], ['C4a', 'Propriété du titulaire'],
  ['D1', 'Marque'], ['D2', 'Type, variante, version'], ['D21', 'Code national d\'identification du type'], ['D3', 'Dénomination commerciale'], ['E', 'N° d\'identification (VIN)'],
  ['F1', 'PTAC (kg)'], ['F2', 'PTAC en service (kg)'], ['F3', 'PTRA (kg)'], ['G', 'Poids à vide (kg)'], ['G1', 'Poids en service (kg)'],
  ['J', 'Catégorie'], ['J1', 'Genre national'], ['J2', 'Carrosserie (CE)'], ['J3', 'Carrosserie (nationale)'], ['K', 'N° de réception par type'],
  ['P1', 'Cylindrée (cm³)'], ['P2', 'Puissance nette maximale (kW)'], ['P3', 'Énergie'], ['P6', 'Puissance administrative (CV)'], ['Q', 'Puissance massique (kW/kg)'],
  ['S1', 'Places assises'], ['S2', 'Places debout'], ['U1', 'Niveau sonore à l\'arrêt (dB(A))'], ['U2', 'Régime moteur (min⁻¹)'],
  ['V7', 'Émissions de CO₂ (g/km)'], ['V9', 'Classe environnementale'], ['Y6', 'Total des taxes payées (€)'], ['Z', 'Mentions particulières']
];
var REG_ENERGY = { ES: 'Essence', GO: 'Diesel', EL: 'Électrique', EH: 'Hybride', GH: 'Hybride', EE: 'Hybride rechargeable', GE: 'Hybride rechargeable', FE: 'E85 (superéthanol)', GL: 'GPL', GN: 'Gaz naturel', H2: 'Hydrogène' };

function regCode(k) { if (k === 'certNo') return 'N°'; if (k === 'C4a') return 'C.4.a'; return k.replace(/^([A-Z])(\d)(\d?)$/, function (m, a, b, c) { return a + '.' + b + (c ? '.' + c : ''); }); }
function regFieldsHtml(v) {
  var rg = v.reg || {}, h = '<div class="muted">Les champs portent le code officiel imprimé sur la carte grise (A, B, C.1…). Tout est facultatif.</div>';
  REG.forEach(function (f) { h += fld(regCode(f[0]) + ' · ' + f[1], 'r_' + f[0], rg[f[0]] || '', f[2] === 'date' ? { type: 'date' } : {}); });
  return h;
}
function regSection(v) {
  var rg = v.reg || {}, rows = REG.filter(function (f) { return rg[f[0]]; }).map(function (f) {
    var val = f[2] === 'date' ? fmtDate(rg[f[0]]) : rg[f[0]];
    return [regCode(f[0]) + ' · ' + f[1], val];
  });
  var as = attsOf('vehicle', v.id);
  if (!rows.length && !as.length) return '';
  var h = '<h2>Carte grise</h2><div class="card">' + kv(rows) + '</div>';
  if (as.length) h += '<div class="card list">' + as.map(function (a) {
    return '<div class="item"><div>' + (/^image\//.test(a.mime) ? '🖼 ' : '📄 ') + esc(a.name) + (a.driveId ? '' : ' <span class="tag old">à envoyer</span>') + '</div><button class="link" data-act="attView" data-id="' + esc(a.id) + '">Voir</button></div>';
  }).join('') + '</div>';
  return h;
}
function regRead(g) { var o = {}; REG.forEach(function (f) { var x = g('r_' + f[0]); if (x) o[f[0]] = x; }); return o; }

/* ---------- Lecture par une IA extérieure ---------- */
var REG_PROMPT = `Tu es mon assistant pour la fiche de mes véhicules. Je joins la photo (ou le PDF) d'un certificat d'immatriculation français (carte grise), recto et si possible verso.
Lis-le avec soin et réponds par UN SEUL bloc de code JSON (pour que j'aie un bouton « copier »), sans aucun texte avant ni après, avec exactement ces clés (le code officiel de la rubrique), chaque valeur étant un texte :
{"A":"","B":"AAAA-MM-JJ","I":"AAAA-MM-JJ","certNo":"","C1":"","C3":"","C4a":"","D1":"","D2":"","D21":"","D3":"","E":"","F1":"","F2":"","F3":"","G":"","G1":"","J":"","J1":"","J2":"","J3":"","K":"","P1":"","P2":"","P3":"","P6":"","Q":"","S1":"","S2":"","U1":"","U2":"","V7":"","V9":"","Y6":"","Z":""}
Règles :
- Recopie chaque rubrique telle qu'elle est imprimée, sans reformuler. A : immatriculation. B et I : dates au format AAAA-MM-JJ. certNo : numéro de formule (en haut de la carte). E : numéro VIN. D.2.1 s'écrit D21, P.1 s'écrit P1, etc. (sans le point).
- P3 : le code énergie tel qu'imprimé (ES, GO, EL, FE, EH, GL…), sans le traduire.
- C1 : nom et prénom du titulaire. C3 : adresse. Y6 : total des taxes en euros, nombre avec un point décimal.
- Rubrique absente, illisible ou non applicable : "" (chaîne vide). N'invente rien et ne devine pas un caractère illisible : laisse la valeur vide.`;
function regFill(raw) {
  var j = invParse(raw), res = document.getElementById('invRes');
  if (!j) { toast('Réponse illisible : copie le bloc complet (de { à }).'); return; }
  var n = 0, warn = [], setv = function (id, v) { var el = document.getElementById(id); if (el && v != null && String(v).trim() !== '') { el.value = String(v).trim(); mark(el); n++; return true; } return false; };
  REG.forEach(function (f) { setv('f_r_' + f[0], j[f[0]]); });
  // reprend dans la fiche technique ce qui y est encore vide
  var fill = function (id, v) { var el = document.getElementById(id); if (el && !el.value.trim() && v) { el.value = String(v).trim(); mark(el); n++; } };
  fill('f_plate', j.A); fill('f_vin', j.E); fill('f_make', j.D1); fill('f_model', j.D3); fill('f_version', j.D2);
  fill('f_powerCv', String(j.P6 || '').replace(/[^\d.,]/g, '')); if (/^\d{4}/.test(j.B || '')) fill('f_year', j.B.slice(0, 4));
  fill('f_energy', REG_ENERGY[String(j.P3 || '').toUpperCase()]);
  var det = document.getElementById('regDet'); if (det) det.open = true;
  var vin = String(j.E || '').replace(/\s/g, ''); if (vin && vin.length !== 17) warn.push('Le numéro VIN lu (« ' + vin + ' ») ne fait pas 17 caractères : vérifie-le sur la carte.');
  if (j.B && !/^\d{4}-\d{2}-\d{2}$/.test(j.B)) warn.push('La date B n\'est pas au format AAAA-MM-JJ : corrige-la.');
  var out = '<div class="card ' + (n ? '' : 'warn') + '" style="margin-top:10px"><b>' + (n ? n + ' champ(s) remplis (surlignés). Vérifie avant d\'enregistrer.' : 'Rien à remplir dans cette réponse.') + '</b>';
  warn.forEach(function (w) { out += '<div style="margin-top:6px">⚠️ ' + esc(w) + '</div>'; });
  if (res) res.innerHTML = out + '</div>';
  var d2 = document.getElementById('invDet'); if (d2) d2.open = false;
  toast(n ? 'Fiche remplie (' + n + ' champs). Vérifie puis enregistre.' : 'Rien à remplir dans cette réponse.');
}
