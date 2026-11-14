'use strict';
/* Synchronisation Google Drive (étape 0.2) — même principe que la Cave à whisky.
   Espace caché de l'appli (drive.appdata), partagé avec les autres applis du même projet Google :
   tous mes fichiers sont donc préfixés « veh_ ».
   Un enregistrement = un fichier : véhicule veh_v_<id>.json, relevé veh_r_<id>.json,
   suppression veh_x_<v|r>_<id>, bilan veh_meta. Fusion enregistrement par enregistrement :
   la modification la plus récente gagne. */

var GCLIENT = '163280160875-e3ml082aeieji23312rj1cad07u87fcv.apps.googleusercontent.com';
var GSCOPE = 'https://www.googleapis.com/auth/drive.appdata';
var PFX = 'veh_';
var SYKEY = 'veh-sync-v1', AUTOKEY = 'veh-autosync';
var G = { busy: false, msg: '', tok: '', exp: 0, report: null, confirm: null, fopen: false, bk: undefined };

function lsGet(k, def) { try { var v = JSON.parse(localStorage.getItem(k)); return v == null ? def : v; } catch (e) { return def; } }
function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
function syncInfo() { return lsGet(SYKEY, {}); }
function devName() { try { return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) ? 'téléphone' : 'PC'; } catch (e) { return 'appareil'; } }
function fmtDT(v) { try { return new Date(v).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }); } catch (e) { return String(v || ''); } }

/* ---------- Données locales vues comme des « documents » ---------- */
function updOf(o) { return Number(o && o.updatedAt) || Number(o && o.createdAt) || 0; }
var STORES = { v: 'vehicles', r: 'readings', f: 'fills', p: 'prices', m: 'maints', e: 'expenses', t: 'tariffs', c: 'charges', a: 'atts' };
var KINDS = { v: 'vehicle', r: 'reading', f: 'fill', p: 'price', m: 'maint', e: 'expense', t: 'tariff', c: 'charge', a: 'attachment' };
var KIND2KEY = { vehicle: 'v', reading: 'r', fill: 'f', price: 'p', maint: 'm', expense: 'e', tariff: 't', charge: 'c', attachment: 'a' };
function storeOf(key) { return STORES[key[0]]; }
function kindOf(key) { return KINDS[key[0]]; }
function listOf(key) { return data[storeOf(key)]; }
function localDocs() {
  var l = {};
  data.vehicles.forEach(function (o) { l['v:' + o.id] = o; });
  data.readings.forEach(function (o) { l['r:' + o.id] = o; });
  data.fills.forEach(function (o) { l['f:' + o.id] = o; });
  data.prices.forEach(function (o) { l['p:' + o.id] = o; });
  data.maints.forEach(function (o) { l['m:' + o.id] = o; });
  data.expenses.forEach(function (o) { l['e:' + o.id] = o; });
  data.tariffs.forEach(function (o) { l['t:' + o.id] = o; });
  data.charges.forEach(function (o) { l['c:' + o.id] = o; });
  data.atts.forEach(function (o) { l['a:' + o.id] = o; });
  return l;
}
function tombMap() {
  var m = {};
  (data.deleted || []).forEach(function (d) { m[(KIND2KEY[d.kind] || 'r') + ':' + d.id] = d.deletedAt || 0; });
  return m;
}
function docLabel(key, o) {
  if (!o) return key;
  if (key[0] === 'v') return o.name || 'véhicule';
  if (key[0] === 't') return 'tarif du ' + fmtDate(o.from);
  if (key[0] === 'p') return 'prix ' + o.fuel + ' ' + o.month;
  return ({ f: 'plein', m: 'entretien', e: 'dépense', c: 'recharge', a: 'pièce jointe' }[key[0]] || 'relevé') + ' du ' + fmtDate(o.date);
}
function lastChange() {
  var m = 0;
  data.vehicles.concat(data.readings, data.fills, data.prices, data.maints, data.expenses, data.tariffs, data.charges, data.atts).forEach(function (o) { var u = updOf(o); if (u > m) m = u; });
  (data.deleted || []).forEach(function (d) { if ((d.deletedAt || 0) > m) m = d.deletedAt; });
  return m;
}
function syncDirty() { var i = syncInfo(); return !!i.at && lastChange() > i.at; }

/* ---------- Google : connexion et Drive ---------- */
function loadGsi() {
  return new Promise(function (res, rej) {
    if (window.google && google.accounts && google.accounts.oauth2) return res();
    var s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client'; s.async = true;
    s.onload = function () { res(); }; s.onerror = function () { rej(new Error('offline')); };
    document.head.appendChild(s);
  });
}
var FSCOPE = 'https://www.googleapis.com/auth/drive.file';
function gToken(withFile) { // withFile : demande aussi l'accès aux pièces jointes (dossier visible du Drive)
  if (G.tok && Date.now() < G.exp && (!withFile || G.file)) return Promise.resolve(G.tok);
  return new Promise(function (resolve, reject) {
    var tc = google.accounts.oauth2.initTokenClient({
      client_id: GCLIENT, scope: withFile ? GSCOPE + ' ' + FSCOPE : GSCOPE,
      callback: function (r) {
        if (r && r.access_token) { G.tok = r.access_token; G.file = !!withFile && String(r.scope || '').indexOf('drive.file') >= 0; G.exp = Date.now() + ((r.expires_in || 3600) - 120) * 1000; resolve(G.tok); }
        else reject(new Error((r && r.error) || 'auth'));
      },
      error_callback: function (e) { reject(new Error((e && e.type) || 'auth')); }
    });
    tc.requestAccessToken({ prompt: '' });
  });
}
async function dFetch(tok, url, opt) {
  opt = opt || {};
  var r = await fetch(url, Object.assign({}, opt, { headers: Object.assign({ Authorization: 'Bearer ' + tok }, opt.headers || {}) }));
  if (!r.ok) { var t = await r.text().catch(function () { return ''; }); throw new Error('drive ' + r.status + ' ' + t.slice(0, 160)); }
  return r;
}
async function dList(tok) {
  var out = [], pt = '';
  do {
    var r = await dFetch(tok, 'https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&pageSize=1000&fields=' +
      encodeURIComponent('nextPageToken,files(id,name,appProperties)') + (pt ? '&pageToken=' + encodeURIComponent(pt) : ''));
    var j = await r.json();
    out = out.concat(j.files || []); pt = j.nextPageToken || '';
  } while (pt);
  // l'espace caché est partagé avec les autres applis : on ne garde que mes fichiers
  return out.filter(function (f) { return f.name && f.name.indexOf(PFX) === 0; });
}
async function dPut(tok, id, name, upd, body, by) {
  var b = 'veh' + Date.now() + Math.random().toString(36).slice(2), meta = { name: name, appProperties: { upd: String(upd) } };
  if (by) meta.appProperties.by = by;
  if (!id) meta.parents = ['appDataFolder'];
  var mp = '--' + b + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' + JSON.stringify(meta) + '\r\n--' + b +
    '\r\nContent-Type: application/json\r\n\r\n' + body + '\r\n--' + b + '--';
  var url = 'https://www.googleapis.com/upload/drive/v3/files' + (id ? '/' + id : '') + '?uploadType=multipart&fields=id';
  var r = await dFetch(tok, url, { method: id ? 'PATCH' : 'POST', headers: { 'Content-Type': 'multipart/related; boundary=' + b }, body: mp });
  return r.json();
}
async function dGet(tok, id) { return (await dFetch(tok, 'https://www.googleapis.com/drive/v3/files/' + id + '?alt=media')).json(); }
async function dDel(tok, id) { try { await dFetch(tok, 'https://www.googleapis.com/drive/v3/files/' + id, { method: 'DELETE' }); } catch (e) { if (!/drive 404/.test(e.message)) throw e; } }
async function pool(tasks, n, onStep) {
  var i = 0, d = 0;
  await Promise.all(Array.from({ length: Math.min(n, tasks.length) }, async function () {
    while (i < tasks.length) { var t = tasks[i++]; await t(); d++; onStep(d, tasks.length); }
  }));
}
async function tx(stores, fn) { var t = db.transaction(stores, 'readwrite'); fn(t); await done(t); }

/* ---------- Plan : quoi envoyer, récupérer, supprimer ---------- */
function parseFiles(files) {
  var rdoc = {}, rtomb = {};
  files.forEach(function (f) {
    var m = /^veh_([vrfpmetca])_(.+)\.json$/.exec(f.name), x = /^veh_x_([vrfpmetca])_(.+)$/.exec(f.name), u = Number(f.appProperties && f.appProperties.upd) || 0;
    if (m) rdoc[m[1] + ':' + m[2]] = { file: f, upd: u };
    else if (x) rtomb[x[1] + ':' + x[2]] = { file: f, upd: u };
  });
  return { rdoc: rdoc, rtomb: rtomb };
}
function newPlan() { return { up: [], down: [], delLocal: [], delRemote: [], mkTomb: [], tombLocal: [], setTombs: null, conflicts: [] }; }

function planSync(files) {
  var P = parseFiles(files), rdoc = P.rdoc, rtomb = P.rtomb, plan = newPlan(), ldoc = localDocs(), lt = tombMap(), keys = {};
  [rdoc, rtomb, ldoc, lt].forEach(function (m) { Object.keys(m).forEach(function (k) { keys[k] = 1; }); });
  var at = syncInfo().at || 0;
  Object.keys(keys).forEach(function (k) {
    var ld = ldoc[k], rd = rdoc[k], lts = lt[k] || 0, rt = rtomb[k], rts = rt ? rt.upd : 0;
    var lu = ld ? updOf(ld) : 0, ru = rd ? rd.upd : 0, tomb = Math.max(lts, rts), best = Math.max(lu, ru);
    if (tomb && tomb >= best) { // une suppression plus récente gagne
      if (ld) plan.delLocal.push({ key: k, o: ld });
      if (rd) plan.delRemote.push({ key: k, file: rd.file });
      if (!rt) plan.mkTomb.push({ key: k, ts: tomb });
      if (rt && !lts) plan.tombLocal.push({ key: k, ts: rts });
      return;
    }
    if (lu >= ru && ld) { // la copie de cet appareil est la plus récente (ou la seule)
      if (!rd || lu > ru) {
        plan.up.push({ key: k, o: ld, file: rd ? rd.file : null, upd: lu });
        if (rd && ru > at && lu > at) plan.conflicts.push({ key: k, name: docLabel(k, ld), kept: 'local' });
      }
    } else if (rd) { // la copie du Drive est la plus récente
      plan.down.push({ key: k, file: rd.file, upd: ru, had: ld });
      if (ld && lu > at) plan.conflicts.push({ key: k, name: docLabel(k, ld), kept: 'drive' });
    }
    if (rt && best > rts) plan.delRemote.push({ key: k, file: rt.file });
  });
  return plan;
}
/* Forcer un sens : 'send' = le Drive devient identique à cet appareil ; 'recv' = cet appareil devient identique au Drive */
function planForce(files, mode) {
  var P = parseFiles(files), rdoc = P.rdoc, rtomb = P.rtomb, ldoc = localDocs(), now = Date.now(), plan = newPlan();
  if (mode === 'send') {
    Object.keys(ldoc).forEach(function (k) {
      plan.up.push({ key: k, o: ldoc[k], file: rdoc[k] ? rdoc[k].file : null, upd: now });
      if (rtomb[k]) plan.delRemote.push({ key: k, file: rtomb[k].file });
    });
    Object.keys(rdoc).forEach(function (k) {
      if (!ldoc[k]) { plan.delRemote.push({ key: k, file: rdoc[k].file }); if (!rtomb[k]) plan.mkTomb.push({ key: k, ts: now }); }
    });
    var lt = tombMap();
    Object.keys(lt).forEach(function (k) {
      if (!ldoc[k] && !rtomb[k] && !plan.mkTomb.some(function (x) { return x.key === k; })) plan.mkTomb.push({ key: k, ts: lt[k] });
    });
  } else {
    var eff = {};
    Object.keys(rdoc).forEach(function (k) { if (!(rtomb[k] && rtomb[k].upd >= rdoc[k].upd)) eff[k] = rdoc[k]; });
    Object.keys(eff).forEach(function (k) { plan.down.push({ key: k, file: eff[k].file, upd: eff[k].upd, had: ldoc[k] }); });
    Object.keys(ldoc).forEach(function (k) { if (!eff[k]) plan.delLocal.push({ key: k, o: ldoc[k] }); });
    plan.setTombs = {};
    Object.keys(rtomb).forEach(function (k) { plan.setTombs[k] = rtomb[k].upd; });
  }
  return plan;
}

/* ---------- Copie de sécurité de cet appareil (la dernière seulement) ---------- */
function bkOpen() {
  return new Promise(function (res, rej) {
    var r = indexedDB.open('veh_equip_backup', 1);
    r.onupgradeneeded = function () { r.result.createObjectStore('b', { keyPath: 'k' }); };
    r.onsuccess = function () { res(r.result); }; r.onerror = function () { rej(r.error); };
  });
}
async function bkSave(o) {
  var d = await bkOpen();
  return new Promise(function (res, rej) { var t = d.transaction('b', 'readwrite'); t.objectStore('b').put(o); t.oncomplete = function () { res(); }; t.onerror = function () { rej(t.error); }; });
}
async function bkLoad() {
  try {
    var d = await bkOpen();
    return await new Promise(function (res, rej) { var q = d.transaction('b').objectStore('b').get('last'); q.onsuccess = function () { res(q.result || null); }; q.onerror = function () { rej(q.error); }; });
  } catch (e) { return null; }
}
async function safetyCopy(plan, mode) {
  var vs = [], rs = [], fs = [], ps = [], ms = [], es = [], ts = [], cs = [], as = [], to = { v: vs, r: rs, f: fs, p: ps, m: ms, e: es, t: ts, c: cs, a: as };
  plan.down.forEach(function (p) { if (p.had) to[p.key[0]].push(p.had); });
  plan.delLocal.forEach(function (p) { to[p.key[0]].push(p.o); });
  if (!vs.length && !rs.length && !fs.length && !ps.length && !ms.length && !es.length && !ts.length && !cs.length && !as.length) return;
  var o = { k: 'last', at: Date.now(), reason: mode === 'recv' ? 'avant « Récupérer depuis le Drive »' : 'avant remplacement par le Drive',
    vehicles: JSON.parse(JSON.stringify(vs)), readings: JSON.parse(JSON.stringify(rs)),
    fills: JSON.parse(JSON.stringify(fs)), prices: JSON.parse(JSON.stringify(ps)),
    maints: JSON.parse(JSON.stringify(ms)), expenses: JSON.parse(JSON.stringify(es)),
    tariffs: JSON.parse(JSON.stringify(ts)), charges: JSON.parse(JSON.stringify(cs)), atts: JSON.parse(JSON.stringify(as)) };
  await bkSave(o); G.bk = o;
}
async function restoreBackup() {
  var b = G.bk || await bkLoad();
  if (!b) { G.msg = 'Aucune copie de sécurité.'; gbox(); return; }
  await tx(['vehicles', 'readings', 'fills', 'prices', 'maints', 'expenses', 'tariffs', 'charges', 'atts', 'deleted'], function (t) {
    ['vehicles', 'readings', 'fills', 'prices', 'maints', 'expenses', 'tariffs', 'charges', 'atts'].forEach(function (n) {
      (b[n] || []).forEach(function (o) { t.objectStore(n).put(o); t.objectStore('deleted').delete(o.id); });
    });
  });
  await reload();
  G.msg = 'Copie de sécurité restaurée (' + b.vehicles.length + ' véhicule(s), ' + b.readings.length + ' relevé(s), ' + (b.fills || []).length + ' plein(s), ' + (b.prices || []).length + ' prix, ' + (b.maints || []).length + ' entretien(s), ' + (b.expenses || []).length + ' dépense(s), ' + (b.tariffs || []).length + ' tarif(s), ' + (b.charges || []).length + ' recharge(s)). Synchronisez pour l\'envoyer sur le Drive.';
  render();
}

/* ---------- Exécution ---------- */
function syncErr(e) {
  var m = String((e && e.message) || e);
  if (m === 'offline' || /Failed to fetch|NetworkError/i.test(m)) return 'Pas de connexion : réessayez quand le téléphone est en ligne.';
  if (/popup_closed|popup_failed/.test(m)) return 'La fenêtre Google a été fermée avant la fin.';
  if (/access_denied/.test(m)) return 'Autorisation refusée.';
  if (/drive 403/.test(m)) return 'Google refuse l\'accès : vérifiez que « Google Drive API » est activée dans le projet Google Cloud. (' + m + ')';
  if (/drive 401/.test(m)) { G.tok = ''; return 'La connexion Google a expiré : touchez de nouveau « Synchroniser ».'; }
  return 'Échec de la synchronisation : ' + m;
}
async function doSync(mode) {
  if (G.busy) return;
  mode = (mode === 'send' || mode === 'recv') ? mode : '';
  G.confirm = null; G.busy = true; G.msg = 'Connexion à Google…'; G.report = null; gbox();
  try {
    await loadGsi();
    var needFile = typeof attPending === 'function' && (attPending() > 0 || delQueue().length > 0), tok, att = null;
    try { tok = await gToken(needFile); }
    catch (e) { if (!needFile) throw e; G.attMsg = 'Pièces jointes non envoyées : accès au dossier Drive refusé ou fenêtre fermée.'; tok = await gToken(false); }
    if (needFile && G.file) {
      G.msg = 'Envoi des pièces jointes…'; gbox();
      try { att = await attUploadPending(tok, function (d, n) { G.msg = 'Envoi des pièces jointes… ' + d + ' / ' + n; gbox(); }); G.attMsg = att.failed ? att.failed + ' pièce(s) jointe(s) non envoyée(s)' + (att.err ? ' (' + att.err.slice(0, 120) + ')' : '') + ' : réessayez à la prochaine synchronisation.' : ''; }
      catch (e) { G.attMsg = 'Envoi des pièces jointes impossible : ' + syncErr(e); }
    }
    G.msg = 'Lecture du Drive…'; gbox();
    var files = await dList(tok), plan = mode ? planForce(files, mode) : planSync(files);
    await safetyCopy(plan, mode);
    var rep = { up: plan.up.length, down: plan.down.length, del: plan.delLocal.length + plan.delRemote.length, conflicts: plan.conflicts };
    var tasks = [];
    plan.up.forEach(function (p) {
      tasks.push(async function () {
        var id = p.key.slice(2), o = Object.assign({}, p.o);
        if (mode === 'send') o.updatedAt = p.upd;
        await dPut(tok, p.file ? p.file.id : null, PFX + p.key[0] + '_' + id + '.json', mode === 'send' ? p.upd : updOf(o), JSON.stringify(o));
        if (mode === 'send') await tx([storeOf(p.key)], function (t) { t.objectStore(storeOf(p.key)).put(o); });
      });
    });
    plan.down.forEach(function (p) {
      tasks.push(async function () {
        var o = await dGet(tok, p.file.id);
        if (!o || !o.id) throw new Error('fichier du Drive illisible (' + p.file.name + ')');
        o.updatedAt = p.upd;
        await tx([storeOf(p.key), 'deleted'], function (t) { t.objectStore(storeOf(p.key)).put(o); t.objectStore('deleted').delete(o.id); });
      });
    });
    plan.delLocal.forEach(function (p) {
      tasks.push(async function () { await tx([storeOf(p.key)], function (t) { t.objectStore(storeOf(p.key)).delete(p.key.slice(2)); }); });
    });
    plan.tombLocal.forEach(function (p) {
      tasks.push(async function () { await tx(['deleted'], function (t) { t.objectStore('deleted').put({ id: p.key.slice(2), kind: kindOf(p.key), deletedAt: p.ts }); }); });
    });
    if (plan.setTombs) {
      tasks.push(async function () {
        await tx(['deleted'], function (t) {
          t.objectStore('deleted').clear();
          Object.keys(plan.setTombs).forEach(function (k) { t.objectStore('deleted').put({ id: k.slice(2), kind: kindOf(k), deletedAt: plan.setTombs[k] }); });
        });
      });
    }
    plan.delRemote.forEach(function (p) { tasks.push(function () { return dDel(tok, p.file.id); }); });
    plan.mkTomb.forEach(function (p) { tasks.push(async function () { await dPut(tok, null, PFX + 'x_' + p.key.replace(':', '_'), p.ts, '{}'); }); });
    await pool(tasks, 4, function (d, n) { G.msg = 'Synchronisation… ' + d + ' / ' + n; gbox(); });
    await reload();
    if (typeof attAfterSync === 'function') await attAfterSync();
    var mf = files.find(function (f) { return f.name === PFX + 'meta'; }),
      pushed = plan.up.length || plan.delRemote.length || plan.mkTomb.length, now = Date.now(), remote = null;
    if (pushed || !mf) { await dPut(tok, mf ? mf.id : null, PFX + 'meta', now, '{}', devName()); remote = { at: now, by: devName() }; }
    else remote = { at: Number(mf.appProperties && mf.appProperties.upd) || 0, by: (mf.appProperties && mf.appProperties.by) || '' };
    lsSet(SYKEY, { at: Date.now(), by: devName(), n: data.vehicles.length, remote: remote });
    G.report = rep;
    G.msg = mode === 'send' ? 'Le Drive est maintenant identique à cet appareil.'
      : mode === 'recv' ? 'Cet appareil est maintenant identique au Drive.'
      : tasks.length ? 'Synchronisation terminée.' : 'Déjà à jour : rien à envoyer ni à récupérer.';
    render();
  } catch (e) { G.msg = syncErr(e); }
  G.busy = false; gbox(); markDirty();
}

/* ---------- Carte « Synchronisation Google Drive » (onglet Données) ---------- */
function gbox() {
  var el = document.getElementById('gbox'); if (!el) return;
  var i = syncInfo(), r = G.report, h = '';
  h += '<p class="muted">Sauvegarde et synchronise vos véhicules et relevés dans un espace caché de votre Drive, visible seulement par les applis de ce projet. Utilisez le même compte Google sur le téléphone et sur le PC.</p>';
  h += '<p class="muted">' + (i.at ? 'Dernière synchronisation de cet appareil (' + devName() + ') : ' + fmtDT(i.at) + (syncDirty() ? ' · <b>modifications pas encore envoyées</b>' : '') : 'Jamais synchronisé sur cet appareil.') + '</p>';
  if (i.at && i.remote && i.remote.at) {
    var by = i.remote.by === devName() ? 'cet appareil (' + devName() + ')' : (i.remote.by === 'téléphone' ? 'le téléphone' : i.remote.by === 'PC' ? 'le PC' : 'un autre appareil');
    h += '<p class="muted">Dernière sauvegarde sur le Drive : ' + fmtDT(i.remote.at) + ', envoyée depuis ' + by + '.</p>';
  }
  h += '<div class="actions"><button class="primary" type="button" data-act="sync"' + (G.busy ? ' disabled' : '') + '>' + (G.busy ? 'Synchronisation…' : 'Synchroniser') + '</button></div>';
  if (G.msg) h += '<div class="card warn" role="status">' + esc(G.msg) + '</div>';
  if (typeof attPending === 'function') { var np = attPending(); if (np || G.attMsg) h += '<p class="muted">Pièces jointes : ' + (np ? np + ' en attente d\'envoi vers le Drive (envoyées à la prochaine synchronisation). ' : 'toutes envoyées. ') + esc(G.attMsg || '') + '</p>'; }
  if (r && !G.busy) {
    var parts = [];
    if (r.up) parts.push(r.up + ' envoyé' + (r.up > 1 ? 's' : '')); if (r.down) parts.push(r.down + ' récupéré' + (r.down > 1 ? 's' : '')); if (r.del) parts.push(r.del + ' suppression' + (r.del > 1 ? 's' : ''));
    if (parts.length) h += '<p class="muted">Détail (véhicules et relevés) : ' + parts.join(', ') + '.</p>';
    if (r.conflicts.length) h += '<div class="card warn">Modifiés des deux côtés depuis la dernière synchronisation : ' + r.conflicts.map(function (c) { return esc(c.name) + (c.kept === 'drive' ? ' (version du Drive gardée)' : ' (version de cet appareil gardée)'); }).join(', ') + '. La modification la plus récente a été gardée.</div>';
  }
  if (G.bk === undefined) { G.bk = null; bkLoad().then(function (b) { G.bk = b || null; gbox(); }); }
  h += '<div class="actions"><button type="button" class="link" data-act="fopen" aria-expanded="' + !!G.fopen + '">Forcer un sens ' + (G.fopen ? '▴' : '▾') + '</button></div>';
  if (G.fopen) {
    h += '<div class="card"><p class="muted">À n\'utiliser que si la synchronisation normale ne convient pas (par exemple après une erreur). Aucune fusion : un côté remplace l\'autre.</p>' +
      '<div class="actions"><button type="button" data-act="fsend"' + (G.busy ? ' disabled' : '') + '>Envoyer cet appareil vers le Drive</button><button type="button" data-act="frecv"' + (G.busy ? ' disabled' : '') + '>Récupérer depuis le Drive</button></div>';
    if (G.confirm) {
      h += '<p><b>' + (G.confirm === 'send' ? 'Le Drive sera remplacé par le contenu de cet appareil : les véhicules et relevés du Drive absents ici seront supprimés du Drive.' :
        'Cet appareil sera remplacé par le Drive : les véhicules et relevés absents du Drive seront supprimés ici. Une copie de sécurité de cet appareil est gardée avant le remplacement.') + '</b></p>' +
        '<div class="actions"><button type="button" class="danger" data-act="fgo">Confirmer</button><button type="button" data-act="fcancel">Annuler</button></div>';
    }
    h += '</div>';
  }
  if (G.bk) h += '<p class="muted">Copie de sécurité sur cet appareil : ' + fmtDT(G.bk.at) + ' (' + esc(G.bk.reason) + ', ' + G.bk.vehicles.length + ' véhicule(s), ' + G.bk.readings.length + ' relevé(s), ' + (G.bk.fills || []).length + ' plein(s), ' + (G.bk.prices || []).length + ' prix, ' + (G.bk.maints || []).length + ' entretien(s), ' + (G.bk.expenses || []).length + ' dépense(s), ' + (G.bk.tariffs || []).length + ' tarif(s), ' + (G.bk.charges || []).length + ' recharge(s)). <button type="button" class="link" data-act="bkrestore">Restaurer</button></p>';
  h += '<label style="display:flex;gap:10px;align-items:flex-start;color:var(--text)"><input type="checkbox" data-g="auto" style="width:auto;min-height:0;margin-top:4px"' + (lsGet(AUTOKEY, false) ? ' checked' : '') + '> <span>Synchroniser à la première touche après l\'ouverture, si des modifications n\'ont pas été envoyées ou après plus de 6 h. Une fenêtre Google s\'ouvre alors brièvement.</span></label>';
  el.innerHTML = h;
}
function markDirty() {
  var b = document.querySelector('#nav button[data-tab=data]');
  if (b) b.classList.toggle('dirty', syncDirty());
}
window.afterRender = function () { gbox(); markDirty(); };

document.addEventListener('click', function (e) {
  var b = e.target.closest && e.target.closest('[data-act]'); if (!b) return;
  var a = b.getAttribute('data-act');
  if (a === 'sync') doSync('');
  else if (a === 'fopen') { G.fopen = !G.fopen; G.confirm = null; gbox(); }
  else if (a === 'fsend') { G.confirm = 'send'; gbox(); }
  else if (a === 'frecv') { G.confirm = 'recv'; gbox(); }
  else if (a === 'fcancel') { G.confirm = null; gbox(); }
  else if (a === 'fgo') doSync(G.confirm);
  else if (a === 'bkrestore') restoreBackup().catch(function (err) { toast('Erreur : ' + err.message); });
});
document.addEventListener('change', function (e) { var t = e.target; if (t && t.getAttribute && t.getAttribute('data-g') === 'auto') lsSet(AUTOKEY, !!t.checked); });

/* Synchronisation à la première touche après l'ouverture (option) */
var AUTODONE = false;
document.addEventListener('pointerdown', function () {
  if (AUTODONE) return; AUTODONE = true;
  if (!lsGet(AUTOKEY, false)) return;
  var i = syncInfo();
  if (i.at && (syncDirty() || Date.now() - i.at > 6 * 36e5)) doSync('');
});
