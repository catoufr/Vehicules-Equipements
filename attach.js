'use strict';
/* Étape 0.4 (suite) — Pièces jointes : photos et PDF.
   Stockage : le fichier est gardé sur l'appareil (base locale, photos réduites) puis envoyé dans le Drive de l'utilisateur,
   dossier visible « Suivi véhicules & équipements » > un sous-dossier par véhicule (autorisation drive.file : l'appli ne voit que ses propres fichiers).
   Les fiches (nom, lien Drive) sont synchronisées avec les autres données ; le fichier lui-même est téléchargé à la demande sur l'autre appareil. */

var ROOT_NAME = 'Suivi véhicules & équipements';
var FOLDERS_KEY = 'veh-folders', DELQ_KEY = 'veh-drive-del';
var AT = { pend: [], rem: {}, urls: [], kind: '', owner: '' };

/* ---------- Base locale (blobs) ---------- */
function blobGet(id) { return rq(db.transaction('blobs').objectStore('blobs').get(id)).then(function (r) { return r ? r.blob : null; }); }
async function blobPut(id, blob) { var t = db.transaction('blobs', 'readwrite'); t.objectStore('blobs').put({ id: id, blob: blob }); await done(t); }
async function blobIds() { return rq(db.transaction('blobs').objectStore('blobs').getAllKeys()); }
function attsOf(kind, id) { return data.atts.filter(function (a) { return a.ownerKind === kind && a.ownerId === id; }).sort(function (a, b) { return a.createdAt - b.createdAt; }); }
function attCount(kind, id) { return attsOf(kind, id).length; }
function delQueue() { return lsGet(DELQ_KEY, []); }
function queueDriveDelete(driveId) { if (!driveId) return; var q = delQueue(); if (q.indexOf(driveId) < 0) q.push(driveId); lsSet(DELQ_KEY, q); }
function attPending() { return data.atts.filter(function (a) { return !a.driveId; }).length; }
function safeName(s) { return String(s || '').replace(/[\\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'fichier'; }

// Supprime une pièce jointe (fiche, copie locale, et fichier Drive dès qu'une connexion le permet)
async function attDelete(ids) {
  ids = [].concat(ids); if (!ids.length) return;
  var t = db.transaction(['atts', 'blobs', 'deleted'], 'readwrite'), now = Date.now();
  ids.forEach(function (id) {
    var a = data.atts.filter(function (x) { return x.id === id; })[0]; if (a) queueDriveDelete(a.driveId);
    t.objectStore('atts').delete(id); t.objectStore('blobs').delete(id); t.objectStore('deleted').put({ id: id, kind: 'attachment', deletedAt: now });
  });
  await done(t);
}
async function attPurgeOwner(kind, ownerId) { await attDelete(attsOf(kind, ownerId).map(function (a) { return a.id; })); }

/* ---------- Réduction des photos ---------- */
function loadImg(file) {
  return new Promise(function (res, rej) {
    var u = URL.createObjectURL(file), im = new Image();
    im.onload = function () { res({ im: im, u: u }); }; im.onerror = function () { URL.revokeObjectURL(u); rej(new Error('image illisible')); }; im.src = u;
  });
}
async function shrink(file) { // JPEG, grand côté 1600 px, qualité 0,82
  if (!/^image\//.test(file.type) || /gif|svg/.test(file.type)) return { blob: file, ext: (file.name.split('.').pop() || 'bin').toLowerCase() };
  try {
    var L = await loadImg(file), w = L.im.naturalWidth, h = L.im.naturalHeight, k = Math.min(1, 1600 / Math.max(w, h));
    var c = document.createElement('canvas'); c.width = Math.round(w * k); c.height = Math.round(h * k);
    c.getContext('2d').drawImage(L.im, 0, 0, c.width, c.height); URL.revokeObjectURL(L.u);
    var b = await new Promise(function (r) { c.toBlob(r, 'image/jpeg', 0.82); });
    if (b && b.size < file.size) return { blob: b, ext: 'jpg' };
  } catch (e) { /* on garde l'original */ }
  return { blob: file, ext: (file.name.split('.').pop() || 'jpg').toLowerCase() };
}

/* ---------- Zone « Pièces jointes » des formulaires ---------- */
function attBoxHtml() {
  var h = '', ex = attsOf(AT.kind, AT.owner);
  ex.forEach(function (a) {
    var gone = AT.rem[a.id];
    h += '<div class="att' + (gone ? ' gone' : '') + '"><span class="athumb" data-thumb="' + esc(a.id) + '">' + (/^image\//.test(a.mime) ? '🖼' : '📄') + '</span><span class="aname">' + esc(a.name) + (a.driveId ? '' : ' <span class="tag old">à envoyer</span>') + '</span>' +
      '<button type="button" class="link" data-act="attView" data-id="' + esc(a.id) + '">Voir</button>' +
      '<button type="button" class="link" data-act="attRem" data-id="' + esc(a.id) + '">' + (gone ? 'Garder' : 'Retirer') + '</button></div>';
  });
  AT.pend.forEach(function (f, i) {
    h += '<div class="att"><span class="athumb">' + (/^image\//.test(f.type) ? '🖼' : '📄') + '</span><span class="aname">' + esc(f.name) + ' <span class="tag">nouveau</span></span>' +
      '<button type="button" class="link" data-act="attDrop" data-id="' + i + '">Retirer</button></div>';
  });
  if (!h) h = '<div class="muted">Aucune pièce jointe.</div>';
  h += '<div class="actions"><label class="btn" style="margin:0;text-align:center">＋ Photos ou PDF<input id="attFile" type="file" accept="image/*,application/pdf" multiple hidden></label>' +
    '<label class="btn" style="margin:0;text-align:center">📷 Prendre une photo<input id="attCam" type="file" accept="image/*" capture="environment" hidden></label></div>' +
    '<div class="muted">Les photos sont réduites pour économiser la place, puis envoyées dans le dossier « ' + esc(ROOT_NAME) + ' » de votre Drive à la prochaine synchronisation.</div>';
  return h;
}
function attInit(kind, owner) { AT.pend = []; AT.rem = {}; AT.kind = kind; AT.owner = owner || ''; attRender(); }
function attRender() {
  var box = document.getElementById('attBox'); if (!box) return;
  box.innerHTML = attBoxHtml();
  box.querySelectorAll('[data-thumb]').forEach(function (el) { // vignettes des photos présentes sur cet appareil
    var id = el.getAttribute('data-thumb');
    blobGet(id).then(function (b) { if (b && /^image\//.test(b.type)) { var u = URL.createObjectURL(b); AT.urls.push(u); el.innerHTML = '<img src="' + u + '" alt="">'; } });
  });
}
// Enregistre les ajouts / retraits du formulaire
async function attCommit(kind, ownerId, vehicleId, label) {
  var rm = Object.keys(AT.rem).filter(function (k) { return AT.rem[k]; });
  if (rm.length) await attDelete(rm);
  var n = attsOf(kind, ownerId).length;
  for (var i = 0; i < AT.pend.length; i++) {
    var f = AT.pend[i], s = await shrink(f), id = uid(), now = Date.now(); n++;
    var name = safeName(label) + ' ' + n + '.' + s.ext.replace(/[^a-z0-9]/g, '').slice(0, 4);
    await blobPut(id, s.blob);
    await dbPut('atts', { id: id, ownerKind: kind, ownerId: ownerId, vehicleId: vehicleId, name: name, mime: s.blob.type || (s.ext === 'pdf' ? 'application/pdf' : 'image/jpeg'), size: s.blob.size, driveId: '', createdAt: now, updatedAt: now });
  }
  var added = AT.pend.length; AT.pend = []; AT.rem = {};
  return added;
}

/* ---------- Visionneuse ---------- */
function showBlob(a, blob) {
  var u = URL.createObjectURL(blob); AT.urls.push(u);
  if (!/^image\//.test(a.mime)) { window.open(u, '_blank'); return; }
  var lb = document.createElement('div'); lb.id = 'lightbox';
  lb.innerHTML = '<div class="lbbar"><span>' + esc(a.name) + '</span><button type="button" class="primary" id="lbx">Fermer</button></div><img src="' + u + '" alt="' + esc(a.name) + '">';
  document.body.appendChild(lb);
  lb.addEventListener('click', function (e) { if (e.target.id === 'lbx' || e.target === lb) lb.remove(); });
}
async function attView(id) {
  var a = data.atts.filter(function (x) { return x.id === id; })[0]; if (!a) return;
  var b = await blobGet(id);
  if (!b) {
    if (!a.driveId) { toast('Fichier introuvable sur cet appareil'); return; }
    toast('Téléchargement depuis le Drive…');
    await loadGsi(); var tok = await gToken(true);
    var r = await dFetch(tok, 'https://www.googleapis.com/drive/v3/files/' + a.driveId + '?alt=media'); b = await r.blob();
    await blobPut(id, b);
  }
  showBlob(a, b);
}

/* ---------- Drive : dossiers et envoi ---------- */
function qEsc(s) { return String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'"); }
async function ensureFolder(tok, name, parent) {
  var cache = lsGet(FOLDERS_KEY, {}), key = (parent || 'root') + '/' + name;
  if (cache[key]) return cache[key];
  var q = "mimeType='application/vnd.google-apps.folder' and trashed=false and name='" + qEsc(name) + "'" + (parent ? " and '" + parent + "' in parents" : " and 'root' in parents");
  var j = await (await dFetch(tok, 'https://www.googleapis.com/drive/v3/files?fields=files(id,name)&q=' + encodeURIComponent(q))).json(), id = j.files && j.files[0] && j.files[0].id;
  if (!id) {
    var body = { name: name, mimeType: 'application/vnd.google-apps.folder' }; if (parent) body.parents = [parent];
    id = (await (await dFetch(tok, 'https://www.googleapis.com/drive/v3/files?fields=id', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json()).id;
  }
  cache[key] = id; lsSet(FOLDERS_KEY, cache); return id;
}
async function uploadBlob(tok, parent, name, blob, mime) {
  var b = 'att' + Date.now() + Math.random().toString(36).slice(2);
  var head = '--' + b + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' + JSON.stringify({ name: name, parents: [parent] }) + '\r\n--' + b + '\r\nContent-Type: ' + (mime || 'application/octet-stream') + '\r\n\r\n';
  var body = new Blob([head, blob, '\r\n--' + b + '--']);
  var r = await dFetch(tok, 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id', { method: 'POST', headers: { 'Content-Type': 'multipart/related; boundary=' + b }, body: body });
  return (await r.json()).id;
}
// Envoie les fichiers en attente et traite les suppressions en attente. Retourne { sent, failed, deleted }
async function attUploadPending(tok, onStep) {
  var out = { sent: 0, failed: 0, deleted: 0 }, q = delQueue(), keep = [];
  for (var i = 0; i < q.length; i++) { try { await dDel(tok, q[i]); out.deleted++; } catch (e) { keep.push(q[i]); } }
  lsSet(DELQ_KEY, keep);
  var todo = data.atts.filter(function (a) { return !a.driveId; });
  for (var k = 0; k < todo.length; k++) {
    var a = todo[k], blob = await blobGet(a.id); if (!blob) { out.failed++; continue; }
    if (onStep) onStep(k + 1, todo.length);
    try {
      var run = async function () {
        var root = await ensureFolder(tok, ROOT_NAME, null), v = data.vehicles.filter(function (x) { return x.id === a.vehicleId; })[0];
        var sub = await ensureFolder(tok, safeName(v ? v.name : 'Divers'), root);
        return uploadBlob(tok, sub, a.name, blob, a.mime);
      };
      var driveId;
      try { driveId = await run(); } catch (e) { if (/drive 404/.test(e.message)) { lsSet(FOLDERS_KEY, {}); driveId = await run(); } else throw e; }
      var upd = Object.assign({}, a, { driveId: driveId, updatedAt: Date.now() }); await dbPut('atts', upd); out.sent++;
    } catch (e) { out.failed++; out.err = e.message; }
  }
  await reload(); return out;
}
// Nettoyage après synchronisation : copies locales sans fiche
async function attAfterSync() {
  var ids = await blobIds(), have = {}; data.atts.forEach(function (a) { have[a.id] = 1; });
  var orphan = ids.filter(function (i) { return !have[i]; });
  if (orphan.length) { var t = db.transaction('blobs', 'readwrite'); orphan.forEach(function (i) { t.objectStore('blobs').delete(i); }); await done(t); }
}

/* ---------- Événements ---------- */
document.addEventListener('click', function (e) {
  var el = e.target.closest && e.target.closest('[data-act]'); if (!el) return;
  var act = el.getAttribute('data-act'), id = el.getAttribute('data-id');
  if (act === 'attRem') { AT.rem[id] = !AT.rem[id]; attRender(); }
  else if (act === 'attDrop') { AT.pend.splice(Number(id), 1); attRender(); }
  else if (act === 'attView') attView(id).catch(function (err) { toast('Impossible d\'ouvrir : ' + syncErr(err)); });
});
document.addEventListener('change', function (e) {
  var t = e.target; if (!t || (t.id !== 'attFile' && t.id !== 'attCam')) return;
  Array.prototype.forEach.call(t.files || [], function (f) {
    if (f.size > 25 * 1024 * 1024) { toast(f.name + ' dépasse 25 Mo : ignoré'); return; }
    AT.pend.push(f);
  });
  t.value = ''; attRender();
});
