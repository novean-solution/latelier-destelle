/**
 * Notifications — L'Atelier d'Estelle
 * Email (Resend) + Web Push (VAPID + chiffrement aes128gcm, RFC 8291/8188),
 * dispatcher d'événements (RDV / client), et rappels programmés (J-1, H-2).
 *
 * Aucune dépendance externe : tout repose sur Web Crypto (crypto.subtle),
 * disponible nativement dans le runtime Cloudflare Workers.
 */

// ---------------------------------------------------------------------------
// Helpers encodage
// ---------------------------------------------------------------------------
const enc = new TextEncoder();

function b64urlToBytes(s) {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + pad;
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToB64url(bytes) {
  let bin = '';
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (let i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function concatBytes(...parts) {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) { out.set(p, off); off += p.length; }
  return out;
}

// ---------------------------------------------------------------------------
// Dates (Europe/Paris)
// ---------------------------------------------------------------------------
function getParisDateString(d = new Date()) {
  return new Intl.DateTimeFormat('fr-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

// Décalage (ms) à ajouter à un instant UTC pour obtenir l'heure murale de Paris.
function parisOffsetMs(date) {
  const utc = new Date(date.toLocaleString('en-US', { timeZone: 'UTC' }));
  const paris = new Date(date.toLocaleString('en-US', { timeZone: 'Europe/Paris' }));
  return paris.getTime() - utc.getTime();
}

// Convertit une heure murale Paris ('YYYY-MM-DD', 'HH:MM') en instant epoch (ms UTC).
function parisInstant(dateStr, timeStr) {
  const [y, m, d] = String(dateStr).split('-').map(Number);
  const [hh, mm] = String(timeStr || '00:00').split(':').map(Number);
  const utcGuess = Date.UTC(y, (m || 1) - 1, d || 1, hh || 0, mm || 0);
  const offset = parisOffsetMs(new Date(utcGuess));
  return utcGuess - offset;
}

function formatFrDate(dateStr) {
  try {
    return new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Paris' })
      .format(new Date(dateStr + 'T12:00:00Z'));
  } catch (_) { return dateStr; }
}

function whenLabel(apt) {
  return `${formatFrDate(apt.date)} à ${apt.time}`;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ---------------------------------------------------------------------------
// iCalendar (.ics) — pièce jointe email + flux d'abonnement agenda
// ---------------------------------------------------------------------------
function icsEscape(s) {
  return String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}
function icsStamp(ms) {
  const d = new Date(ms), p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}T${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
}
// Pliage d'une ligne à 75 octets (RFC 5545 §3.1) — continuation = CRLF + espace.
function icsFold(line) {
  if (new TextEncoder().encode(line).length <= 75) return line;
  const parts = [];
  let cur = '', limit = 75;
  for (const ch of Array.from(line)) {
    if (new TextEncoder().encode(cur + ch).length > limit) { parts.push(cur); cur = ch; limit = 74; }
    else cur += ch;
  }
  if (cur) parts.push(cur);
  return parts.join('\r\n ');
}
// audience : 'admin' (agenda d'Estelle, infos cliente) ou 'client' (agenda de la cliente).
// alarm2h : pour l'admin, ajoute une alarme H-2 (les clientes ont J-1 + H-2 d'office).
function icsEventLines(apt, audience, alarm2h) {
  const start = parisInstant(apt.date, apt.time);
  if (!isFinite(start)) return []; // date/heure invalide → on saute (évite un DTSTART corrompu)
  const end = start + (Number(apt.duration) || 30) * 60000;
  const statusLabel = apt.status === 'confirmed' ? 'Confirmé' : (apt.status === 'cancelled' ? 'Annulé' : 'En attente');
  const svc = apt.service || 'Rendez-vous';

  let summary, descParts;
  if (audience === 'admin') {
    // Titre : Nom Prénom — téléphone ; description : toutes les infos + note.
    summary = (apt.clientName || 'Cliente') + (apt.clientPhone ? ` — ${apt.clientPhone}` : '');
    descParts = [
      `${svc}${apt.duration ? ` (${apt.duration} min)` : ''}`,
      apt.clientPhone ? `Tél : ${apt.clientPhone}` : '',
      apt.clientEmail ? `Email : ${apt.clientEmail}` : '',
      `Statut : ${statusLabel}`,
      apt.notes ? `Note : ${apt.notes}` : '',
    ];
  } else {
    summary = `${svc} — L'Atelier d'Estelle`;
    descParts = [
      apt.notes ? `Note : ${apt.notes}` : '',
      "L'Atelier d'Estelle — 06 19 75 58 63",
    ];
  }

  const lines = [
    'BEGIN:VEVENT',
    `UID:${icsEscape(apt.id)}@latelier-destelle`,
    `DTSTAMP:${icsStamp(Date.now())}`,
    `DTSTART:${icsStamp(start)}`,
    `DTEND:${icsStamp(end)}`,
    `SUMMARY:${icsEscape(summary)}`,
    `LOCATION:${icsEscape('142 Seillière, 01340 Malafretaz')}`,
    `STATUS:${apt.status === 'confirmed' ? 'CONFIRMED' : (apt.status === 'cancelled' ? 'CANCELLED' : 'TENTATIVE')}`,
  ];
  const desc = descParts.filter(Boolean).join('\n');
  if (desc) lines.push(`DESCRIPTION:${icsEscape(desc)}`);

  // Alarmes (VALARM) sur les RDV à venir non annulés.
  const alarms = [];
  if (apt.status !== 'cancelled') {
    if (audience === 'admin') {
      if (alarm2h) alarms.push(['-PT2H', 'Rendez-vous dans 2 h']);
    } else {
      alarms.push(['-P1D', 'Rendez-vous demain']);
      alarms.push(['-PT2H', 'Rendez-vous dans 2 h']);
    }
  }
  for (const [trigger, txt] of alarms) {
    lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `TRIGGER:${trigger}`, `DESCRIPTION:${icsEscape(txt)}`, 'END:VALARM');
  }

  lines.push('END:VEVENT');
  return lines;
}
// Pas de METHOD:PUBLISH (meilleure compatibilité import iOS) ; toutes les lignes sont pliées.
function wrapCalendarLines(name, eventLines) {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Novean//Atelier Estelle//FR', 'CALSCALE:GREGORIAN', `X-WR-CALNAME:${icsEscape(name)}`, ...eventLines, 'END:VCALENDAR'];
  return lines.map(icsFold).join('\r\n') + '\r\n';
}
export function buildEventICS(apt) {
  // Pièce jointe email envoyée à la cliente → vue 'client'.
  return wrapCalendarLines("L'Atelier d'Estelle", icsEventLines(apt, 'client'));
}
export function buildFeedICS(appts, name, audience, alarm2h) {
  const eventLines = (appts || []).filter((a) => a.status !== 'cancelled').flatMap((a) => icsEventLines(a, audience, alarm2h));
  return wrapCalendarLines(name || "L'Atelier d'Estelle", eventLines);
}
function toBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}
const ICS_EVENTS = new Set(['client_booked', 'created_by_admin', 'confirm_by_admin', 'reschedule_by_admin', 'reschedule_by_client', 'reminder_day_before', 'reminder_hour_before']);

// ---------------------------------------------------------------------------
// Email (Resend)
// ---------------------------------------------------------------------------
export async function sendEmail(env, { to, subject, html, replyTo, attachments }) {
  if (!env.RESEND_API_KEY) {
    console.error('RESEND_API_KEY manquant - email non envoyé');
    return false;
  }
  try {
    const payload = {
      from: env.FROM_EMAIL || "L'atelier d'Estelle <onboarding@resend.dev>",
      to,
      subject,
      html,
    };
    if (replyTo) payload.reply_to = replyTo;
    if (attachments && attachments.length) payload.attachments = attachments;
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return res.ok;
  } catch (e) {
    console.error('Erreur envoi email', e);
    return false;
  }
}

// Habillage HTML d'un email (couleurs de la marque)
function emailLayout(title, bodyHtml) {
  return `<div style="font-family:'Segoe UI',Arial,sans-serif;max-width:520px;margin:0 auto;color:#3a2c2e">
    <div style="background:linear-gradient(135deg,#c98ba0,#b06f86);padding:22px 24px;border-radius:14px 14px 0 0">
      <h1 style="margin:0;color:#fff;font-size:20px;font-weight:600">L'Atelier d'Estelle</h1>
    </div>
    <div style="background:#fdf8f6;padding:24px;border-radius:0 0 14px 14px;line-height:1.6;font-size:15px">
      <h2 style="margin:0 0 14px;font-size:18px;color:#b06f86">${esc(title)}</h2>
      ${bodyHtml}
      <p style="margin-top:22px;font-size:13px;color:#8a7a7c">Institut de thermolyse — Malafretaz (Ain) · 06 19 75 58 63</p>
    </div>
  </div>`;
}

// ---------------------------------------------------------------------------
// Web Push — VAPID + chiffrement
// ---------------------------------------------------------------------------
let _vapidKeyPromise = null;
function importVapidPrivateKey(env) {
  if (_vapidKeyPromise) return _vapidKeyPromise;
  const pub = b64urlToBytes(env.VAPID_PUBLIC_KEY); // 65 octets : 0x04 || X(32) || Y(32)
  const x = bytesToB64url(pub.slice(1, 33));
  const y = bytesToB64url(pub.slice(33, 65));
  const jwk = { kty: 'EC', crv: 'P-256', x, y, d: env.VAPID_PRIVATE_KEY, ext: true };
  _vapidKeyPromise = crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  return _vapidKeyPromise;
}

async function vapidAuthHeader(env, audience) {
  const header = bytesToB64url(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const payload = bytesToB64url(enc.encode(JSON.stringify({
    aud: audience,
    exp: Math.floor(Date.now() / 1000) + 12 * 3600,
    sub: env.VAPID_SUBJECT || 'mailto:contact@novean.fr',
  })));
  const signingInput = `${header}.${payload}`;
  const key = await importVapidPrivateKey(env);
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(signingInput));
  const jwt = `${signingInput}.${bytesToB64url(new Uint8Array(sig))}`;
  return `vapid t=${jwt}, k=${env.VAPID_PUBLIC_KEY}`;
}

// Chiffre une charge utile selon RFC 8291 (aes128gcm). Renvoie le corps binaire à POSTer.
async function encryptPayload(payloadStr, p256dhB64, authB64) {
  const clientPub = b64urlToBytes(p256dhB64);   // 65 octets
  const authSecret = b64urlToBytes(authB64);    // 16 octets

  const serverKeys = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const serverPubRaw = new Uint8Array(await crypto.subtle.exportKey('raw', serverKeys.publicKey)); // 65
  const clientKey = await crypto.subtle.importKey('raw', clientPub, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: clientKey }, serverKeys.privateKey, 256));

  // IKM = HKDF(salt=auth, ikm=shared, info="WebPush: info\0"||clientPub||serverPub)
  const sharedKey = await crypto.subtle.importKey('raw', shared, 'HKDF', false, ['deriveBits']);
  const authInfo = concatBytes(enc.encode('WebPush: info\0'), clientPub, serverPubRaw);
  const ikm = new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: authSecret, info: authInfo }, sharedKey, 256));

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const ikmKey = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  const cek = new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info: enc.encode('Content-Encoding: aes128gcm\0') }, ikmKey, 128));
  const nonce = new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info: enc.encode('Content-Encoding: nonce\0') }, ikmKey, 96));

  // Plaintext + délimiteur d'enregistrement (0x02 = dernier enregistrement)
  const plaintext = concatBytes(enc.encode(payloadStr), new Uint8Array([2]));
  const aesKey = await crypto.subtle.importKey('raw', cek, { name: 'AES-GCM' }, false, ['encrypt']);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aesKey, plaintext));

  // En-tête RFC 8188 : salt(16) || rs(4, BE) || idlen(1) || keyid(serverPub 65)
  const header = new Uint8Array(16 + 4 + 1 + 65);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, 4096, false);
  header[20] = 65;
  header.set(serverPubRaw, 21);
  return concatBytes(header, ciphertext);
}

// Envoie un push à UN abonnement. Supprime l'abonnement si 404/410 (expiré).
async function sendOnePush(env, sub, payloadObj) {
  if (!env.VAPID_PRIVATE_KEY || !env.VAPID_PUBLIC_KEY) return 0; // push non configuré -> no-op
  try {
    const endpoint = sub.endpoint;
    const audience = new URL(endpoint).origin;
    const [auth, body] = await Promise.all([
      vapidAuthHeader(env, audience),
      encryptPayload(JSON.stringify(payloadObj), sub.p256dh, sub.auth),
    ]);
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: auth,
        'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream',
        TTL: '86400',
        Urgency: 'normal',
      },
      body,
    });
    if (res.status === 404 || res.status === 410) {
      await env.DB.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').bind(endpoint).run().catch(() => {});
    }
    return res.status;
  } catch (e) {
    console.error('Erreur push', e);
    return 0;
  }
}

async function getSubs(env, ownerType, clientId) {
  try {
    const q = ownerType === 'client'
      ? env.DB.prepare("SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE ownerType = 'client' AND clientId = ?").bind(clientId)
      : env.DB.prepare("SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE ownerType = 'admin'");
    const { results } = await q.all();
    return results || [];
  } catch (_) { return []; }
}

async function pushToClient(env, clientId, payloadObj) {
  if (!clientId) return;
  const subs = await getSubs(env, 'client', clientId);
  await Promise.all(subs.map((s) => sendOnePush(env, s, payloadObj)));
}

async function pushToAdmin(env, payloadObj) {
  const subs = await getSubs(env, 'admin');
  await Promise.all(subs.map((s) => sendOnePush(env, s, payloadObj)));
}

// ---------------------------------------------------------------------------
// Préférences de notification de l'admin (table settings, singleton)
// ---------------------------------------------------------------------------
const DEFAULT_ADMIN_PREFS = { booking: true, cancellation: true, reschedule: true, newClient: true, note: true, reminder2h: true };

export async function getAdminPrefs(env) {
  try {
    const row = await env.DB.prepare("SELECT value FROM settings WHERE key = 'admin_notif_prefs'").first();
    if (!row) return { ...DEFAULT_ADMIN_PREFS };
    return { ...DEFAULT_ADMIN_PREFS, ...JSON.parse(row.value) };
  } catch (_) { return { ...DEFAULT_ADMIN_PREFS }; }
}

export async function setAdminPrefs(env, prefs) {
  const clean = {
    booking: prefs.booking !== false,
    cancellation: prefs.cancellation !== false,
    reschedule: prefs.reschedule !== false,
    newClient: prefs.newClient !== false,
    note: prefs.note !== false,
    reminder2h: prefs.reminder2h !== false,
  };
  await env.DB.prepare(
    "INSERT INTO settings (key, value) VALUES ('admin_notif_prefs', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  ).bind(JSON.stringify(clean)).run();
  return clean;
}

// ---------------------------------------------------------------------------
// Composition des messages par type d'événement
// ---------------------------------------------------------------------------
function buildMessages(eventType, apt, extra = {}) {
  const when = whenLabel(apt);
  const name = apt.clientName || 'Bonjour';
  const svc = apt.service || 'votre soin';
  const dur = apt.duration ? ` (${apt.duration} min)` : '';
  const oldWhen = extra.oldDate ? `${formatFrDate(extra.oldDate)} à ${extra.oldTime}` : '';

  const clientEmail = (subject, intro) => ({
    subject,
    html: emailLayout(subject, `<p>Bonjour ${esc(apt.clientName) || ''},</p><p>${intro}</p>
      <p style="background:#fff;border-radius:10px;padding:12px 14px;margin:14px 0">
        <strong>${esc(svc)}</strong>${esc(dur)}<br>${esc(when)}
      </p>
      <p>Vous pouvez consulter et gérer vos rendez-vous dans <a href="${esc(extra.clientUrl)}" style="color:#b06f86">votre espace client</a>.</p>`),
  });

  switch (eventType) {
    case 'client_booked':
      return {
        client: { ...clientEmail('Votre rendez-vous est enregistré', `Votre demande de rendez-vous pour <strong>${esc(svc)}</strong> est bien enregistrée. Elle est <strong>en attente de confirmation</strong> par l'institut.`), push: { title: 'Rendez-vous enregistré', body: `${svc} — ${when}` } },
        admin: { pref: 'booking', push: { title: '📅 Nouveau rendez-vous', body: `${name} — ${when} · ${svc}` }, email: { subject: `Nouveau rendez-vous — ${name} (${apt.date})`, html: emailLayout('Nouveau rendez-vous', `<p><strong>${esc(name)}</strong> — ${esc(apt.clientPhone || '')}${apt.clientEmail ? ' — ' + esc(apt.clientEmail) : ''}</p><p>${esc(svc)}${esc(dur)}<br>${esc(when)}</p>${apt.notes ? `<p>Note : ${esc(apt.notes)}</p>` : ''}<p>Statut : en attente.</p>`) } },
      };
    case 'created_by_admin': {
      const confirmed = apt.status === 'confirmed';
      return {
        client: { ...clientEmail(confirmed ? 'Votre rendez-vous est confirmé' : 'Votre rendez-vous est enregistré', confirmed ? `L'institut a programmé votre rendez-vous pour <strong>${esc(svc)}</strong>. Il est <strong>confirmé</strong>.` : `L'institut a enregistré votre rendez-vous pour <strong>${esc(svc)}</strong>.`), push: { title: confirmed ? 'Rendez-vous confirmé ✅' : 'Rendez-vous enregistré', body: `${svc} — ${when}` } },
        admin: null,
      };
    }
    case 'cancel_by_client':
      return {
        client: { ...clientEmail('Annulation confirmée', `Votre rendez-vous du <strong>${esc(when)}</strong> a bien été annulé. Au plaisir de vous revoir.`), push: { title: 'Rendez-vous annulé', body: `${svc} — ${when}` } },
        admin: { pref: 'cancellation', push: { title: '❌ Annulation', body: `${name} a annulé : ${when} · ${svc}` }, email: { subject: `Annulation — ${name} (${apt.date})`, html: emailLayout('Rendez-vous annulé', `<p><strong>${esc(name)}</strong> a annulé son rendez-vous :</p><p>${esc(svc)}<br>${esc(when)}</p>`) } },
      };
    case 'cancel_by_admin':
      return {
        client: { ...clientEmail('Votre rendez-vous a été annulé', `Votre rendez-vous du <strong>${esc(when)}</strong> a été annulé par l'institut. Pour reprogrammer, contactez-nous ou réservez un nouveau créneau.`), push: { title: 'Rendez-vous annulé', body: `${svc} — ${when}` } },
        admin: null,
      };
    case 'reschedule_by_client':
      return {
        client: { subject: 'Report confirmé', html: emailLayout('Votre rendez-vous a été reporté', `<p>Bonjour ${esc(apt.clientName) || ''},</p><p>Votre rendez-vous a bien été déplacé.</p><p style="background:#fff;border-radius:10px;padding:12px 14px;margin:14px 0"><strong>${esc(svc)}</strong>${esc(dur)}<br>Nouveau créneau : <strong>${esc(when)}</strong>${oldWhen ? `<br><span style="color:#8a7a7c">auparavant : ${esc(oldWhen)}</span>` : ''}</p>`), push: { title: 'Rendez-vous reporté', body: `Nouveau : ${when}` } },
        admin: { pref: 'reschedule', push: { title: '🔄 Report', body: `${name} : ${when}${oldWhen ? ` (avant ${oldWhen})` : ''}` }, email: { subject: `Report — ${name} (${apt.date})`, html: emailLayout('Rendez-vous reporté', `<p><strong>${esc(name)}</strong> a reporté son rendez-vous :</p><p>${esc(svc)}<br>Nouveau : ${esc(when)}${oldWhen ? `<br>Avant : ${esc(oldWhen)}` : ''}</p>`) } },
      };
    case 'reschedule_by_admin':
      return {
        client: { subject: 'Votre rendez-vous a été reporté', html: emailLayout('Votre rendez-vous a été reporté', `<p>Bonjour ${esc(apt.clientName) || ''},</p><p>L'institut a déplacé votre rendez-vous.</p><p style="background:#fff;border-radius:10px;padding:12px 14px;margin:14px 0"><strong>${esc(svc)}</strong>${esc(dur)}<br>Nouveau créneau : <strong>${esc(when)}</strong>${oldWhen ? `<br><span style="color:#8a7a7c">auparavant : ${esc(oldWhen)}</span>` : ''}</p>`), push: { title: 'Rendez-vous reporté', body: `Nouveau : ${when}` } },
        admin: null,
      };
    case 'confirm_by_admin':
      return {
        client: { ...clientEmail('Votre rendez-vous est confirmé', `Bonne nouvelle ! Votre rendez-vous pour <strong>${esc(svc)}</strong> est <strong>confirmé</strong>.`), push: { title: 'Rendez-vous confirmé ✅', body: `${svc} — ${when}` } },
        admin: null,
      };
    case 'note_by_admin':
      return {
        client: { subject: 'Une note a été ajoutée à votre rendez-vous', html: emailLayout('Information sur votre rendez-vous', `<p>Bonjour ${esc(apt.clientName) || ''},</p><p>L'institut a ajouté une information à votre rendez-vous du <strong>${esc(when)}</strong> :</p><p style="background:#fff;border-radius:10px;padding:12px 14px;margin:14px 0;font-style:italic">« ${esc(apt.notes)} »</p>`), push: { title: 'Note ajoutée à votre RDV', body: when } },
        admin: null,
      };
    case 'note_by_client':
      return {
        client: null,
        admin: { pref: 'note', push: { title: '📝 Note d\'une cliente', body: `${name} : ${apt.notes ? String(apt.notes).slice(0, 90) : ''}` }, email: { subject: `Note — ${name} (${apt.date})`, html: emailLayout('Note ajoutée par une cliente', `<p><strong>${esc(name)}</strong> a ajouté une note à son rendez-vous du <strong>${esc(when)}</strong> (${esc(svc)}) :</p><p style="background:#fff;border-radius:10px;padding:12px 14px;font-style:italic">« ${esc(apt.notes)} »</p>`) } },
      };
    case 'new_client':
      return {
        client: null,
        admin: { pref: 'newClient', push: { title: '🌸 Nouvelle cliente', body: `${name}${apt.clientPhone ? ` (${apt.clientPhone})` : ''}` }, email: { subject: `Nouvelle cliente — ${name}`, html: emailLayout('Nouvelle cliente', `<p>Une nouvelle cliente vient de réserver :</p><p><strong>${esc(name)}</strong>${apt.clientPhone ? ` — ${esc(apt.clientPhone)}` : ''}${apt.clientEmail ? ` — ${esc(apt.clientEmail)}` : ''}</p>`) } },
      };
    case 'reminder_day_before':
      return {
        client: { subject: 'Rappel : votre rendez-vous demain', html: emailLayout('Rappel de rendez-vous', `<p>Bonjour ${esc(apt.clientName) || ''},</p><p>Petit rappel : votre rendez-vous a lieu <strong>demain</strong>.</p><p style="background:#fff;border-radius:10px;padding:12px 14px;margin:14px 0"><strong>${esc(svc)}</strong>${esc(dur)}<br>${esc(when)}</p><p>À très vite !</p>`), push: { title: 'Rappel — RDV demain', body: `${svc} — ${when}` } },
        admin: null,
      };
    case 'reminder_hour_before':
      return {
        client: { subject: 'Rappel : votre rendez-vous dans 2 heures', html: emailLayout('Votre rendez-vous approche', `<p>Bonjour ${esc(apt.clientName) || ''},</p><p>Votre rendez-vous a lieu <strong>aujourd'hui à ${esc(apt.time)}</strong>.</p><p style="background:#fff;border-radius:10px;padding:12px 14px;margin:14px 0"><strong>${esc(svc)}</strong>${esc(dur)}</p><p>À tout à l'heure !</p>`), push: { title: `Rappel — RDV à ${apt.time}`, body: `${svc} — aujourd'hui ${apt.time}` } },
        admin: null,
      };
    case 'reminder_admin_2h':
      return {
        client: null,
        admin: { pref: 'reminder2h', push: { title: '⏰ RDV dans 2 h', body: `${name} — ${apt.time} · ${svc}` }, email: { subject: `Rappel — ${name} à ${apt.time}`, html: emailLayout('Rendez-vous dans 2 heures', `<p>Rappel : rendez-vous <strong>aujourd'hui à ${esc(apt.time)}</strong>.</p><p><strong>${esc(name)}</strong>${apt.clientPhone ? ` — ${esc(apt.clientPhone)}` : ''}<br>${esc(svc)}${esc(dur)}</p>`) } },
      };
    default:
      return { client: null, admin: null };
  }
}

// ---------------------------------------------------------------------------
// Dispatcher principal — à appeler via ctx.waitUntil(...)
// ---------------------------------------------------------------------------
export async function notify(env, eventType, apt, extra = {}) {
  const clientUrl = env.CLIENT_URL || 'https://latelier-destelle.pages.dev/compte';
  const adminUrl = env.ADMIN_URL || 'https://latelier-destelle.pages.dev/admin/';
  const m = buildMessages(eventType, apt, { ...extra, clientUrl });

  const jobs = [];

  if (m.client) {
    if (apt.clientEmail && EMAIL_RE.test(apt.clientEmail)) {
      let attachments;
      if (ICS_EVENTS.has(eventType) && apt.date && apt.time && apt.status !== 'cancelled') {
        attachments = [{ filename: 'rendez-vous.ics', content: toBase64(buildEventICS(apt)) }];
      }
      jobs.push(sendEmail(env, { to: apt.clientEmail, subject: m.client.subject, html: m.client.html, replyTo: env.OWNER_EMAIL, attachments }));
    }
    if (m.client.push) {
      jobs.push(pushToClient(env, apt.clientId, { ...m.client.push, url: clientUrl, icon: '/icon-192.png', badge: '/icon-192.png', tag: 'rdv-' + (apt.id || '') }));
    }
  }

  if (m.admin) {
    const prefs = await getAdminPrefs(env);
    if (prefs[m.admin.pref] !== false) {
      if (m.admin.push) {
        jobs.push(pushToAdmin(env, { ...m.admin.push, url: adminUrl, icon: '/admin/icon-192.png', badge: '/admin/icon-192.png', tag: 'admin-' + (apt.id || '') }));
      }
      if (m.admin.email && env.OWNER_EMAIL) {
        jobs.push(sendEmail(env, { to: env.OWNER_EMAIL, subject: m.admin.email.subject, html: m.admin.email.html }));
      }
    }
  }

  await Promise.allSettled(jobs);
}

// ---------------------------------------------------------------------------
// Rappels programmés (déclenchés par le cron / handler scheduled)
// ---------------------------------------------------------------------------
const H = 3600 * 1000;

export async function runReminders(env) {
  const today = getParisDateString();
  let appts = [];
  try {
    const { results } = await env.DB.prepare(
      "SELECT * FROM appointments WHERE status != 'cancelled' AND date >= ?"
    ).bind(today).all();
    appts = results || [];
  } catch (e) {
    console.error('runReminders query', e);
    return { dayBefore: 0, hourBefore: 0 };
  }

  const now = Date.now();
  let dayBefore = 0, hourBefore = 0;

  for (const apt of appts) {
    const start = parisInstant(apt.date, apt.time);
    const diff = start - now;
    if (diff <= 0) continue;

    // Rappel J-1 : dès que le RDV est à moins de 24h (et plus de 2h), une seule fois.
    if (diff <= 24 * H && diff > 2 * H && !apt.reminderDayBeforeSentAt) {
      await notify(env, 'reminder_day_before', apt);
      await env.DB.prepare('UPDATE appointments SET reminderDayBeforeSentAt = ? WHERE id = ?')
        .bind(new Date().toISOString(), apt.id).run().catch(() => {});
      dayBefore++;
    }

    // Rappel H-2 : dès que le RDV est à moins de 2h, une seule fois (cliente + institut).
    if (diff <= 2 * H && diff > 0 && !apt.reminderHourBeforeSentAt) {
      await notify(env, 'reminder_hour_before', apt); // cliente
      await notify(env, 'reminder_admin_2h', apt);    // institut (selon préférence)
      await env.DB.prepare('UPDATE appointments SET reminderHourBeforeSentAt = ? WHERE id = ?')
        .bind(new Date().toISOString(), apt.id).run().catch(() => {});
      hourBefore++;
    }
  }
  return { dayBefore, hourBefore };
}

// ---------------------------------------------------------------------------
// Enregistrement / suppression d'un abonnement push
// ---------------------------------------------------------------------------
export async function saveSubscription(env, { ownerType, clientId, endpoint, p256dh, auth, userAgent }) {
  if (!endpoint || !p256dh || !auth) return false;
  const id = 'sub_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
  await env.DB.prepare(`
    INSERT INTO push_subscriptions (id, ownerType, clientId, endpoint, p256dh, auth, userAgent, createdAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(endpoint) DO UPDATE SET ownerType = excluded.ownerType, clientId = excluded.clientId, p256dh = excluded.p256dh, auth = excluded.auth, userAgent = excluded.userAgent
  `).bind(id, ownerType, clientId || '', endpoint, p256dh, auth, userAgent || '', new Date().toISOString()).run();
  return true;
}

export async function deleteSubscription(env, endpoint) {
  if (!endpoint) return false;
  await env.DB.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').bind(endpoint).run().catch(() => {});
  return true;
}

// Exposé pour les tests unitaires (crypto). Sans effet en production.
export const _internal = { parisInstant, parisOffsetMs, vapidAuthHeader, encryptPayload, b64urlToBytes, bytesToB64url };
