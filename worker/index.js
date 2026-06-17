/**
 * L'atelier d'Estelle - Worker de prise de rendez-vous
 * API D1 minimaliste : créneaux disponibles + gestion des rendez-vous
 */

import {
  sendEmail, notify, runReminders, getAdminPrefs, setAdminPrefs,
  saveSubscription, deleteSubscription, buildFeedICS,
} from './notifications.js';

const OPENING_HOURS = { start: 7, end: 20 }; // 7h - 20h, du lundi au vendredi
const SLOT_STEP_MINUTES = 30;

// Origines autorisées (dev local + déploiements Pages du projet). Le domaine
// final, quand il sera choisi, s'ajoute via la variable d'env ALLOWED_ORIGINS
// (liste séparée par des virgules) — voir wrangler.toml / secrets.
const STATIC_ALLOWED_ORIGINS = [
  'http://localhost:4322', 'http://127.0.0.1:4322', 'http://localhost:8788',
];
function corsHeaders(request, env) {
  const origin = request.headers.get('Origin') || '';
  let allow = '';
  if (origin) {
    const extra = (env && env.ALLOWED_ORIGINS) ? env.ALLOWED_ORIGINS.split(',').map(s => s.trim()).filter(Boolean) : [];
    let host = '';
    try { host = new URL(origin).hostname; } catch (_) {}
    if (STATIC_ALLOWED_ORIGINS.includes(origin) || extra.includes(origin) || /(^|\.)latelier-destelle\.pages\.dev$/.test(host)) {
      allow = origin;
    }
  }
  return {
    'Access-Control-Allow-Origin': allow || STATIC_ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Vary': 'Origin',
    'Content-Type': 'application/json',
  };
}

// Comparaison à temps constant (évite les attaques par timing sur le token admin)
function constantTimeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

function timeToMinutes(t) {
  const [h, m] = String(t).split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

// Vérifie qu'un créneau [time, time+duration) ne chevauche aucun RDV existant ce jour-là.
// Tient compte de la DURÉE des RDV (un RDV de 2h bloque 4 créneaux), contrairement
// à un simple test d'égalité d'heure. excludeId : RDV à ignorer (cas du report).
async function slotConflicts(env, date, time, duration, excludeId) {
  const newStart = timeToMinutes(time);
  const newEnd = newStart + (Number(duration) || 30);
  const { results } = await env.DB.prepare(
    `SELECT id, time, duration FROM appointments WHERE date = ? AND status != 'cancelled'`
  ).bind(date).all();
  return (results || []).some(r => {
    if (excludeId && r.id === excludeId) return false;
    const exStart = timeToMinutes(r.time);
    const exEnd = exStart + (Number(r.duration) || 30);
    return exStart < newEnd && newStart < exEnd; // chevauchement d'intervalles
  });
}

// Valide un créneau côté serveur : jour ouvré, créneau réel, pas dans le passé,
// et la séance ne dépasse pas l'heure de fermeture. Retourne un message d'erreur ou null.
function validateSlot(date, time, duration) {
  const allSlots = generateDaySlots(date);
  if (allSlots.length === 0) return 'Les rendez-vous sont du lundi au vendredi uniquement.';
  if (!allSlots.includes(time)) return 'Créneau invalide.';
  const end = timeToMinutes(time) + (Number(duration) || 30);
  if (end > OPENING_HOURS.end * 60) return 'Cette séance dépasse l\'heure de fermeture, merci de choisir un horaire plus tôt.';
  if (`${date}T${time}` < getParisDateTimeString()) return 'Merci de choisir un créneau futur.';
  return null;
}

function sanitize(text) {
  if (typeof text !== 'string') return '';
  return text.replace(/[<>]/g, '').trim();
}

// Admin authentifié si : token = mot de passe maître (comparaison constante),
// OU token de session admin valide (créé au login, révocable, sans exposer le mot de passe).
async function isAdmin(request, env) {
  const auth = request.headers.get('Authorization') || '';
  const token = auth.replace('Bearer ', '').trim();
  if (!token) return false;
  if (env.ADMIN_TOKEN && constantTimeEqual(token, env.ADMIN_TOKEN)) return true;
  try {
    const s = await env.DB.prepare('SELECT expiresAt FROM admin_sessions WHERE token = ?').bind(token).first();
    return !!(s && s.expiresAt >= new Date().toISOString());
  } catch (_) {
    return false;
  }
}

// Téléphone FR tolérant : accepte 0X..., +33 X..., espaces et points.
const PHONE_REGEX = /^(?:\+33\s?|0)[1-9](?:[\s.]?\d{2}){4}$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Récupère le client lié au token de session (espace client)
async function getClientFromSession(request, env) {
  const auth = request.headers.get('Authorization') || '';
  const token = auth.replace('Bearer ', '').trim();
  if (!token) return null;

  const session = await env.DB.prepare('SELECT * FROM sessions WHERE token = ?').bind(token).first();
  if (!session || session.expiresAt < new Date().toISOString()) return null;

  return env.DB.prepare('SELECT * FROM clients WHERE id = ?').bind(session.clientId).first();
}

function getParisDateTimeString() {
  return new Intl.DateTimeFormat('fr-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
    .format(new Date()).replace(', ', 'T');
}

// Génère les créneaux possibles d'une journée (lun-ven, 7h-20h)
function generateDaySlots(dateStr) {
  const date = new Date(dateStr + 'T00:00:00');
  const day = date.getDay(); // 0 = dimanche, 6 = samedi
  if (day === 0 || day === 6) return [];

  const slots = [];
  for (let h = OPENING_HOURS.start; h < OPENING_HOURS.end; h++) {
    for (let m = 0; m < 60; m += SLOT_STEP_MINUTES) {
      slots.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
    }
  }
  return slots;
}

// Trouve un client existant par téléphone, sinon le crée.
// Renvoie { id, created } — `created` vaut true si une nouvelle fiche a été créée.
async function findOrCreateClient(env, { name, phone, email }) {
  const cleanPhone = sanitize(phone);
  if (!cleanPhone) return { id: '', created: false };

  const existing = await env.DB.prepare('SELECT id, name, email FROM clients WHERE phone = ?').bind(cleanPhone).first();
  if (existing) {
    // Complète les infos manquantes du client si besoin
    const newName = existing.name || sanitize(name || '');
    const newEmail = existing.email || sanitize(email || '');
    if (newName !== existing.name || newEmail !== existing.email) {
      await env.DB.prepare('UPDATE clients SET name = ?, email = ? WHERE id = ?').bind(newName, newEmail, existing.id).run();
    }
    return { id: existing.id, created: false };
  }

  const id = 'cli_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
  await env.DB.prepare(`
    INSERT INTO clients (id, name, phone, email, notes, createdAt)
    VALUES (?, ?, ?, ?, '', ?)
  `).bind(id, sanitize(name || ''), cleanPhone, sanitize(email || ''), new Date().toISOString()).run();
  return { id, created: true };
}

// Lance une notification en arrière-plan (n'allonge pas la réponse HTTP).
function fireNotify(ctx, env, eventType, apt, extra) {
  const p = notify(env, eventType, apt, extra).catch((e) => console.error('notify', eventType, e));
  if (ctx && ctx.waitUntil) ctx.waitUntil(p);
}

async function handleRequest(request, env, ctx) {
  const url = new URL(request.url);
  const headers = corsHeaders(request, env);

  if (request.method === 'OPTIONS') {
    return new Response(null, { headers });
  }

  // GET /api/availability?date=YYYY-MM-DD
  if (url.pathname === '/api/availability' && request.method === 'GET') {
    const date = url.searchParams.get('date');
    if (!date) {
      return Response.json({ success: false, error: 'date requise' }, { status: 400, headers });
    }

    const allSlots = generateDaySlots(date);
    if (allSlots.length === 0) {
      return Response.json({ success: true, slots: [] }, { headers });
    }

    try {
      const { results } = await env.DB.prepare(
        `SELECT time, duration FROM appointments WHERE date = ? AND status != 'cancelled'`
      ).bind(date).all();

      const taken = new Set();
      (results || []).forEach(r => {
        const startIndex = allSlots.indexOf(r.time);
        if (startIndex === -1) return;
        const slotsCount = Math.ceil((r.duration || 30) / SLOT_STEP_MINUTES);
        for (let i = 0; i < slotsCount; i++) {
          if (allSlots[startIndex + i]) taken.add(allSlots[startIndex + i]);
        }
      });

      const available = allSlots.filter(s => !taken.has(s));
      return Response.json({ success: true, slots: available }, { headers });
    } catch (e) {
      console.error(e);
      return Response.json({ success: false, error: 'Une erreur interne est survenue.' }, { status: 500, headers });
    }
  }

  // POST /api/appointments - création publique d'un rendez-vous
  if (url.pathname === '/api/appointments' && request.method === 'POST') {
    let body;
    try {
      body = await request.json();
    } catch (e) {
      return Response.json({ success: false, error: 'JSON invalide' }, { status: 400, headers });
    }

    const { service, category, date, time, duration, clientName, clientPhone, clientEmail, notes } = body;

    if (!service || !category || !date || !time || !clientName || !clientPhone) {
      return Response.json({ success: false, error: 'Champs requis manquants' }, { status: 400, headers });
    }

    const appointment = {
      id: 'apt_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
      service: sanitize(service),
      category: sanitize(category),
      date: sanitize(date),
      time: sanitize(time),
      duration: Number(duration) || 30,
      clientName: sanitize(clientName),
      clientPhone: sanitize(clientPhone),
      clientEmail: sanitize(clientEmail || ''),
      notes: sanitize(notes || ''),
      status: 'pending',
      createdAt: new Date().toISOString(),
    };

    if (!PHONE_REGEX.test(appointment.clientPhone)) {
      return Response.json({ success: false, error: 'Numéro de téléphone invalide. Format attendu : 06 12 34 56 78' }, { status: 400, headers });
    }
    if (appointment.clientEmail && !EMAIL_REGEX.test(appointment.clientEmail)) {
      return Response.json({ success: false, error: 'Adresse email invalide.' }, { status: 400, headers });
    }
    const slotErr = validateSlot(appointment.date, appointment.time, appointment.duration);
    if (slotErr) {
      return Response.json({ success: false, error: slotErr }, { status: 400, headers });
    }

    try {
      // Créneau toujours libre ? (tient compte de la durée des RDV existants)
      if (await slotConflicts(env, appointment.date, appointment.time, appointment.duration)) {
        return Response.json({ success: false, error: 'Ce créneau vient d\'être réservé, merci d\'en choisir un autre.' }, { status: 409, headers });
      }

      const { id: clientId, created: isNewClient } = await findOrCreateClient(env, {
        name: appointment.clientName, phone: appointment.clientPhone, email: appointment.clientEmail,
      });

      await env.DB.prepare(`
        INSERT INTO appointments (id, service, category, date, time, duration, clientId, clientName, clientPhone, clientEmail, notes, status, createdAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        appointment.id, appointment.service, appointment.category, appointment.date, appointment.time,
        appointment.duration, clientId, appointment.clientName, appointment.clientPhone, appointment.clientEmail,
        appointment.notes, appointment.status, appointment.createdAt
      ).run();

      const aptN = { ...appointment, clientId };
      fireNotify(ctx, env, 'client_booked', aptN);
      if (isNewClient) fireNotify(ctx, env, 'new_client', aptN);
      return Response.json({ success: true, appointment }, { headers });
    } catch (e) {
      console.error(e);
      return Response.json({ success: false, error: 'Une erreur interne est survenue.' }, { status: 500, headers });
    }
  }

  // POST /api/admin/appointments - création manuelle par l'institut (ex: appel téléphonique)
  if (url.pathname === '/api/admin/appointments' && request.method === 'POST') {
    if (!(await isAdmin(request, env))) {
      return Response.json({ success: false, error: 'Non autorisé' }, { status: 401, headers });
    }

    let body;
    try {
      body = await request.json();
    } catch (e) {
      return Response.json({ success: false, error: 'JSON invalide' }, { status: 400, headers });
    }

    const { service, category, date, time, duration, clientName, clientPhone, clientEmail, notes, status } = body;

    if (!service || !category || !date || !time || !clientName || !clientPhone) {
      return Response.json({ success: false, error: 'Champs requis manquants' }, { status: 400, headers });
    }

    const appointment = {
      id: 'apt_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
      service: sanitize(service),
      category: sanitize(category),
      date: sanitize(date),
      time: sanitize(time),
      duration: Number(duration) || 30,
      clientName: sanitize(clientName),
      clientPhone: sanitize(clientPhone),
      clientEmail: sanitize(clientEmail || ''),
      notes: sanitize(notes || ''),
      status: ['pending', 'confirmed', 'cancelled'].includes(status) ? status : 'confirmed',
      createdAt: new Date().toISOString(),
    };

    try {
      const { id: clientId } = await findOrCreateClient(env, {
        name: appointment.clientName, phone: appointment.clientPhone, email: appointment.clientEmail,
      });

      await env.DB.prepare(`
        INSERT INTO appointments (id, service, category, date, time, duration, clientId, clientName, clientPhone, clientEmail, notes, status, createdAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        appointment.id, appointment.service, appointment.category, appointment.date, appointment.time,
        appointment.duration, clientId, appointment.clientName, appointment.clientPhone, appointment.clientEmail,
        appointment.notes, appointment.status, appointment.createdAt
      ).run();

      // L'institut crée le RDV : on prévient la cliente (pas d'auto-notification de l'admin).
      fireNotify(ctx, env, 'created_by_admin', { ...appointment, clientId });
      return Response.json({ success: true, appointment }, { headers });
    } catch (e) {
      console.error(e);
      return Response.json({ success: false, error: 'Une erreur interne est survenue.' }, { status: 500, headers });
    }
  }

  // GET /api/admin/clients - liste des clients (avec nb de rendez-vous)
  if (url.pathname === '/api/admin/clients' && request.method === 'GET') {
    if (!(await isAdmin(request, env))) {
      return Response.json({ success: false, error: 'Non autorisé' }, { status: 401, headers });
    }
    try {
      const { results } = await env.DB.prepare(`
        SELECT c.*, COUNT(a.id) AS appointmentCount, MAX(a.date) AS lastVisit
        FROM clients c
        LEFT JOIN appointments a ON a.clientId = c.id
        GROUP BY c.id
        ORDER BY c.name COLLATE NOCASE ASC
      `).all();
      return Response.json({ success: true, clients: results || [] }, { headers });
    } catch (e) {
      console.error(e);
      return Response.json({ success: false, error: 'Une erreur interne est survenue.' }, { status: 500, headers });
    }
  }

  // POST /api/admin/clients - ajout manuel d'un client
  if (url.pathname === '/api/admin/clients' && request.method === 'POST') {
    if (!(await isAdmin(request, env))) {
      return Response.json({ success: false, error: 'Non autorisé' }, { status: 401, headers });
    }
    const body = await request.json().catch(() => ({}));
    const name = sanitize(body.name || '');
    const phone = sanitize(body.phone || '');
    if (!name || !phone) {
      return Response.json({ success: false, error: 'Nom et téléphone requis' }, { status: 400, headers });
    }
    try {
      const existing = await env.DB.prepare('SELECT id FROM clients WHERE phone = ?').bind(phone).first();
      if (existing) {
        return Response.json({ success: false, error: 'Un client avec ce numéro existe déjà' }, { status: 409, headers });
      }
      const id = 'cli_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
      await env.DB.prepare(`
        INSERT INTO clients (id, name, phone, email, notes, createdAt)
        VALUES (?, ?, ?, ?, ?, ?)
      `).bind(id, name, phone, sanitize(body.email || ''), sanitize(body.notes || ''), new Date().toISOString()).run();
      return Response.json({ success: true, id }, { headers });
    } catch (e) {
      console.error(e);
      return Response.json({ success: false, error: 'Une erreur interne est survenue.' }, { status: 500, headers });
    }
  }

  // GET /api/admin/clients/:id - détail d'un client + historique de rendez-vous
  if (url.pathname.match(/^\/api\/admin\/clients\/[^/]+$/) && request.method === 'GET') {
    if (!(await isAdmin(request, env))) {
      return Response.json({ success: false, error: 'Non autorisé' }, { status: 401, headers });
    }
    const id = url.pathname.split('/').pop();
    try {
      const client = await env.DB.prepare('SELECT * FROM clients WHERE id = ?').bind(id).first();
      if (!client) {
        return Response.json({ success: false, error: 'Client introuvable' }, { status: 404, headers });
      }
      const { results } = await env.DB.prepare(
        'SELECT * FROM appointments WHERE clientId = ? ORDER BY date DESC, time DESC'
      ).bind(id).all();
      return Response.json({ success: true, client, appointments: results || [] }, { headers });
    } catch (e) {
      console.error(e);
      return Response.json({ success: false, error: 'Une erreur interne est survenue.' }, { status: 500, headers });
    }
  }

  // PATCH /api/admin/clients/:id - met à jour les infos / notes d'un client
  if (url.pathname.match(/^\/api\/admin\/clients\/[^/]+$/) && request.method === 'PATCH') {
    if (!(await isAdmin(request, env))) {
      return Response.json({ success: false, error: 'Non autorisé' }, { status: 401, headers });
    }
    const id = url.pathname.split('/').pop();
    const body = await request.json().catch(() => ({}));
    try {
      const existing = await env.DB.prepare('SELECT * FROM clients WHERE id = ?').bind(id).first();
      if (!existing) {
        return Response.json({ success: false, error: 'Client introuvable' }, { status: 404, headers });
      }
      const name = body.name !== undefined ? sanitize(body.name) : existing.name;
      const phone = body.phone !== undefined ? sanitize(body.phone) : existing.phone;
      const email = body.email !== undefined ? sanitize(body.email) : existing.email;
      const notes = body.notes !== undefined ? sanitize(body.notes) : existing.notes;

      if (phone !== existing.phone) {
        const conflict = await env.DB.prepare('SELECT id FROM clients WHERE phone = ? AND id != ?').bind(phone, id).first();
        if (conflict) {
          return Response.json({ success: false, error: 'Un autre client utilise déjà ce numéro' }, { status: 409, headers });
        }
      }

      await env.DB.prepare('UPDATE clients SET name = ?, phone = ?, email = ?, notes = ? WHERE id = ?')
        .bind(name, phone, email, notes, id).run();
      // NB : la note "fiche client" est interne à l'institut → pas de notification au client.
      return Response.json({ success: true }, { headers });
    } catch (e) {
      console.error(e);
      return Response.json({ success: false, error: 'Une erreur interne est survenue.' }, { status: 500, headers });
    }
  }

  // DELETE /api/admin/clients/:id
  if (url.pathname.match(/^\/api\/admin\/clients\/[^/]+$/) && request.method === 'DELETE') {
    if (!(await isAdmin(request, env))) {
      return Response.json({ success: false, error: 'Non autorisé' }, { status: 401, headers });
    }
    const id = url.pathname.split('/').pop();
    try {
      await env.DB.prepare('DELETE FROM clients WHERE id = ?').bind(id).run();
      return Response.json({ success: true }, { headers });
    } catch (e) {
      console.error(e);
      return Response.json({ success: false, error: 'Une erreur interne est survenue.' }, { status: 500, headers });
    }
  }

  // --- Routes admin (protégées par token) ---

  // POST /api/admin/login - vérifie le mot de passe et crée une session admin révocable
  // (on ne renvoie plus le mot de passe lui-même, mais un token de session jetable)
  if (url.pathname === '/api/admin/login' && request.method === 'POST') {
    const body = await request.json().catch(() => ({}));
    if (env.ADMIN_TOKEN && typeof body.password === 'string' && constantTimeEqual(body.password, env.ADMIN_TOKEN)) {
      const token = crypto.randomUUID();
      const nowIso = new Date().toISOString();
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
      try {
        await env.DB.prepare('INSERT INTO admin_sessions (token, expiresAt, createdAt) VALUES (?, ?, ?)')
          .bind(token, expiresAt, nowIso).run();
        await env.DB.prepare('DELETE FROM admin_sessions WHERE expiresAt < ?').bind(nowIso).run();
      } catch (e) {
        console.error(e);
        return Response.json({ success: false, error: 'Une erreur interne est survenue.' }, { status: 500, headers });
      }
      return Response.json({ success: true, token }, { headers });
    }
    return Response.json({ success: false, error: 'Mot de passe incorrect' }, { status: 401, headers });
  }

  // POST /api/admin/logout - révoque la session admin courante
  if (url.pathname === '/api/admin/logout' && request.method === 'POST') {
    const auth = request.headers.get('Authorization') || '';
    const token = auth.replace('Bearer ', '').trim();
    try {
      if (token) await env.DB.prepare('DELETE FROM admin_sessions WHERE token = ?').bind(token).run();
      return Response.json({ success: true }, { headers });
    } catch (e) {
      console.error(e);
      return Response.json({ success: false, error: 'Une erreur interne est survenue.' }, { status: 500, headers });
    }
  }

  // GET /api/admin/notif-prefs - préférences de notification de l'institut
  if (url.pathname === '/api/admin/notif-prefs' && request.method === 'GET') {
    if (!(await isAdmin(request, env))) {
      return Response.json({ success: false, error: 'Non autorisé' }, { status: 401, headers });
    }
    const prefs = await getAdminPrefs(env);
    return Response.json({ success: true, prefs }, { headers });
  }

  // PUT /api/admin/notif-prefs - enregistre les préférences (cases à cocher)
  if (url.pathname === '/api/admin/notif-prefs' && request.method === 'PUT') {
    if (!(await isAdmin(request, env))) {
      return Response.json({ success: false, error: 'Non autorisé' }, { status: 401, headers });
    }
    const body = await request.json().catch(() => ({}));
    try {
      const prefs = await setAdminPrefs(env, body);
      return Response.json({ success: true, prefs }, { headers });
    } catch (e) {
      console.error(e);
      return Response.json({ success: false, error: 'Une erreur interne est survenue.' }, { status: 500, headers });
    }
  }

  // POST /api/admin/push - enregistre un abonnement Web Push pour l'institut
  if (url.pathname === '/api/admin/push' && request.method === 'POST') {
    if (!(await isAdmin(request, env))) {
      return Response.json({ success: false, error: 'Non autorisé' }, { status: 401, headers });
    }
    const body = await request.json().catch(() => ({}));
    try {
      await saveSubscription(env, { ownerType: 'admin', clientId: '', endpoint: body.endpoint, p256dh: body.p256dh, auth: body.auth, userAgent: body.userAgent });
      return Response.json({ success: true }, { headers });
    } catch (e) {
      console.error(e);
      return Response.json({ success: false, error: 'Une erreur interne est survenue.' }, { status: 500, headers });
    }
  }

  // DELETE /api/admin/push
  if (url.pathname === '/api/admin/push' && request.method === 'DELETE') {
    if (!(await isAdmin(request, env))) {
      return Response.json({ success: false, error: 'Non autorisé' }, { status: 401, headers });
    }
    const body = await request.json().catch(() => ({}));
    await deleteSubscription(env, body.endpoint);
    return Response.json({ success: true }, { headers });
  }

  // GET /api/admin/appointments - liste tous les rendez-vous
  if (url.pathname === '/api/admin/appointments' && request.method === 'GET') {
    if (!(await isAdmin(request, env))) {
      return Response.json({ success: false, error: 'Non autorisé' }, { status: 401, headers });
    }
    try {
      const { results } = await env.DB.prepare(
        'SELECT * FROM appointments ORDER BY date DESC, time DESC'
      ).all();
      return Response.json({ success: true, appointments: results || [] }, { headers });
    } catch (e) {
      console.error(e);
      return Response.json({ success: false, error: 'Une erreur interne est survenue.' }, { status: 500, headers });
    }
  }

  // PATCH /api/admin/appointments/:id - met à jour le statut ou les détails du rendez-vous
  if (url.pathname.startsWith('/api/admin/appointments/') && request.method === 'PATCH') {
    if (!(await isAdmin(request, env))) {
      return Response.json({ success: false, error: 'Non autorisé' }, { status: 401, headers });
    }
    const id = url.pathname.split('/').pop();
    const body = await request.json().catch(() => ({}));

    // Mise à jour complète du rendez-vous (modale "Modifier")
    if (body.service !== undefined) {
      const { service, category, date, time, duration, clientName, clientPhone, clientEmail, notes, status } = body;
      if (!service || !category || !date || !time || !clientName || !clientPhone) {
        return Response.json({ success: false, error: 'Champs requis manquants' }, { status: 400, headers });
      }
      if (status !== undefined && !['pending', 'confirmed', 'cancelled'].includes(status)) {
        return Response.json({ success: false, error: 'Statut invalide' }, { status: 400, headers });
      }
      try {
        const existing = await env.DB.prepare('SELECT * FROM appointments WHERE id = ?').bind(id).first();
        if (!existing) {
          return Response.json({ success: false, error: 'Rendez-vous introuvable' }, { status: 404, headers });
        }
        const { id: clientId } = await findOrCreateClient(env, {
          name: sanitize(clientName), phone: sanitize(clientPhone), email: sanitize(clientEmail || ''),
        });
        const newStatus = status !== undefined ? status : existing.status;
        const newApt = {
          id, service: sanitize(service), category: sanitize(category), date: sanitize(date), time: sanitize(time),
          duration: Number(duration) || 30, clientId, clientName: sanitize(clientName),
          clientEmail: sanitize(clientEmail || ''), notes: sanitize(notes || ''), status: newStatus,
        };
        await env.DB.prepare(`
          UPDATE appointments
          SET service = ?, category = ?, date = ?, time = ?, duration = ?, clientId = ?, clientName = ?, clientPhone = ?, clientEmail = ?, notes = ?, status = ?
          WHERE id = ?
        `).bind(
          newApt.service, sanitize(category), newApt.date, newApt.time, newApt.duration,
          clientId, newApt.clientName, sanitize(clientPhone), newApt.clientEmail, newApt.notes,
          newStatus, id
        ).run();

        // Notifications selon ce qui a changé
        if (newStatus === 'cancelled' && existing.status !== 'cancelled') {
          fireNotify(ctx, env, 'cancel_by_admin', newApt);
        } else {
          if (newApt.date !== existing.date || newApt.time !== existing.time) {
            fireNotify(ctx, env, 'reschedule_by_admin', newApt, { oldDate: existing.date, oldTime: existing.time });
          }
          if (newStatus === 'confirmed' && existing.status !== 'confirmed') {
            fireNotify(ctx, env, 'confirm_by_admin', newApt);
          }
          if ((newApt.notes || '') !== (existing.notes || '') && newApt.notes) {
            fireNotify(ctx, env, 'note_by_admin', newApt);
          }
        }
        return Response.json({ success: true }, { headers });
      } catch (e) {
        console.error(e);
      return Response.json({ success: false, error: 'Une erreur interne est survenue.' }, { status: 500, headers });
      }
    }

    // Mise à jour du statut uniquement (boutons confirmer/annuler)
    const status = sanitize(body.status || '');
    if (!['pending', 'confirmed', 'cancelled'].includes(status)) {
      return Response.json({ success: false, error: 'Statut invalide' }, { status: 400, headers });
    }
    try {
      const existing = await env.DB.prepare('SELECT * FROM appointments WHERE id = ?').bind(id).first();
      if (!existing) {
        return Response.json({ success: false, error: 'Rendez-vous introuvable' }, { status: 404, headers });
      }
      await env.DB.prepare('UPDATE appointments SET status = ? WHERE id = ?').bind(status, id).run();
      if (status !== existing.status) {
        if (status === 'confirmed') fireNotify(ctx, env, 'confirm_by_admin', { ...existing, status });
        else if (status === 'cancelled') fireNotify(ctx, env, 'cancel_by_admin', { ...existing, status });
      }
      return Response.json({ success: true }, { headers });
    } catch (e) {
      console.error(e);
      return Response.json({ success: false, error: 'Une erreur interne est survenue.' }, { status: 500, headers });
    }
  }

  // DELETE /api/admin/appointments/:id
  if (url.pathname.startsWith('/api/admin/appointments/') && request.method === 'DELETE') {
    if (!(await isAdmin(request, env))) {
      return Response.json({ success: false, error: 'Non autorisé' }, { status: 401, headers });
    }
    const id = url.pathname.split('/').pop();
    try {
      const existing = await env.DB.prepare('SELECT * FROM appointments WHERE id = ?').bind(id).first();
      await env.DB.prepare('DELETE FROM appointments WHERE id = ?').bind(id).run();
      // Suppression d'un RDV à venir non annulé → on prévient la cliente (annulation).
      if (existing && existing.status !== 'cancelled' && `${existing.date}T${existing.time}` >= getParisDateTimeString()) {
        fireNotify(ctx, env, 'cancel_by_admin', existing);
      }
      return Response.json({ success: true }, { headers });
    } catch (e) {
      console.error(e);
      return Response.json({ success: false, error: 'Une erreur interne est survenue.' }, { status: 500, headers });
    }
  }

  // POST /api/auth/request-code - envoie un code de connexion par email
  if (url.pathname === '/api/auth/request-code' && request.method === 'POST') {
    const body = await request.json().catch(() => ({}));
    const email = sanitize(body.email || '').toLowerCase();
    if (!EMAIL_REGEX.test(email)) {
      return Response.json({ success: false, error: 'Adresse email invalide' }, { status: 400, headers });
    }

    try {
      // Anti-spam : si un code récent (<45s) existe déjà, on répond OK sans en renvoyer un autre
      const recent = await env.DB.prepare('SELECT createdAt FROM login_codes WHERE email = ?').bind(email).first();
      if (recent && (Date.now() - new Date(recent.createdAt).getTime()) < 45000) {
        return Response.json({ success: true }, { headers });
      }

      let client = await env.DB.prepare('SELECT id FROM clients WHERE email = ?').bind(email).first();
      if (!client) {
        const id = 'cli_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
        await env.DB.prepare(`
          INSERT INTO clients (id, name, phone, email, notes, createdAt)
          VALUES (?, '', '', ?, '', ?)
        `).bind(id, email, new Date().toISOString()).run();
      }

      const code = String(Math.floor(100000 + Math.random() * 900000));
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

      await env.DB.prepare('DELETE FROM login_codes WHERE email = ?').bind(email).run();
      await env.DB.prepare(`
        INSERT INTO login_codes (id, email, code, expiresAt, createdAt)
        VALUES (?, ?, ?, ?, ?)
      `).bind('lc_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8), email, code, expiresAt, new Date().toISOString()).run();

      await sendEmail(env, {
        to: email,
        subject: 'Votre code de connexion - L\'atelier d\'Estelle',
        html: `<p>Bonjour,</p><p>Voici votre code de connexion à votre espace client :</p>
               <p style="font-size:28px; font-weight:bold; letter-spacing:4px;">${code}</p>
               <p>Ce code est valable 10 minutes.</p>
               <p>Si vous n'êtes pas à l'origine de cette demande, ignorez cet email.</p>`,
      });

      return Response.json({ success: true }, { headers });
    } catch (e) {
      console.error(e);
      return Response.json({ success: false, error: 'Une erreur interne est survenue.' }, { status: 500, headers });
    }
  }

  // POST /api/auth/verify-code - vérifie le code et crée une session
  if (url.pathname === '/api/auth/verify-code' && request.method === 'POST') {
    const body = await request.json().catch(() => ({}));
    const email = sanitize(body.email || '').toLowerCase();
    const code = sanitize(body.code || '');
    if (!email || !code) {
      return Response.json({ success: false, error: 'Champs requis manquants' }, { status: 400, headers });
    }

    try {
      const row = await env.DB.prepare('SELECT * FROM login_codes WHERE email = ?').bind(email).first();
      if (!row || row.expiresAt < new Date().toISOString()) {
        return Response.json({ success: false, error: 'Code invalide ou expiré' }, { status: 401, headers });
      }
      // Anti brute-force : 5 essais max par code, puis on l'invalide
      if ((row.attempts || 0) >= 5) {
        await env.DB.prepare('DELETE FROM login_codes WHERE email = ?').bind(email).run();
        return Response.json({ success: false, error: 'Trop de tentatives. Merci de redemander un code.' }, { status: 429, headers });
      }
      if (row.code !== code) {
        await env.DB.prepare('UPDATE login_codes SET attempts = attempts + 1 WHERE id = ?').bind(row.id).run();
        return Response.json({ success: false, error: 'Code invalide ou expiré' }, { status: 401, headers });
      }
      await env.DB.prepare('DELETE FROM login_codes WHERE email = ?').bind(email).run();

      const client = await env.DB.prepare('SELECT * FROM clients WHERE email = ?').bind(email).first();
      if (!client) {
        return Response.json({ success: false, error: 'Compte introuvable' }, { status: 404, headers });
      }

      const token = crypto.randomUUID();
      const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
      await env.DB.prepare(`
        INSERT INTO sessions (token, clientId, expiresAt, createdAt)
        VALUES (?, ?, ?, ?)
      `).bind(token, client.id, expiresAt, new Date().toISOString()).run();

      return Response.json({ success: true, token, client: { id: client.id, name: client.name, phone: client.phone, email: client.email } }, { headers });
    } catch (e) {
      console.error(e);
      return Response.json({ success: false, error: 'Une erreur interne est survenue.' }, { status: 500, headers });
    }
  }

  // POST /api/auth/logout
  if (url.pathname === '/api/auth/logout' && request.method === 'POST') {
    const auth = request.headers.get('Authorization') || '';
    const token = auth.replace('Bearer ', '').trim();
    try {
      if (token) await env.DB.prepare('DELETE FROM sessions WHERE token = ?').bind(token).run();
      return Response.json({ success: true }, { headers });
    } catch (e) {
      console.error(e);
      return Response.json({ success: false, error: 'Une erreur interne est survenue.' }, { status: 500, headers });
    }
  }

  // GET /api/me - infos du compte connecté
  if (url.pathname === '/api/me' && request.method === 'GET') {
    const client = await getClientFromSession(request, env);
    if (!client) return Response.json({ success: false, error: 'Non autorisé' }, { status: 401, headers });
    return Response.json({ success: true, client: { id: client.id, name: client.name, phone: client.phone, email: client.email } }, { headers });
  }

  // PATCH /api/me - met à jour le nom / téléphone du compte connecté
  if (url.pathname === '/api/me' && request.method === 'PATCH') {
    const client = await getClientFromSession(request, env);
    if (!client) return Response.json({ success: false, error: 'Non autorisé' }, { status: 401, headers });

    const body = await request.json().catch(() => ({}));
    const name = body.name !== undefined ? sanitize(body.name) : client.name;
    const phone = body.phone !== undefined ? sanitize(body.phone) : client.phone;

    if (!name) {
      return Response.json({ success: false, error: 'Le nom est requis' }, { status: 400, headers });
    }
    if (phone && !PHONE_REGEX.test(phone)) {
      return Response.json({ success: false, error: 'Numéro invalide. Format attendu : 06 12 34 56 78' }, { status: 400, headers });
    }

    try {
      if (phone && phone !== client.phone) {
        const conflict = await env.DB.prepare('SELECT id FROM clients WHERE phone = ? AND id != ?').bind(phone, client.id).first();
        if (conflict) {
          return Response.json({ success: false, error: 'Un autre compte utilise déjà ce numéro' }, { status: 409, headers });
        }
      }
      await env.DB.prepare('UPDATE clients SET name = ?, phone = ? WHERE id = ?').bind(name, phone, client.id).run();
      return Response.json({ success: true }, { headers });
    } catch (e) {
      console.error(e);
      return Response.json({ success: false, error: 'Une erreur interne est survenue.' }, { status: 500, headers });
    }
  }

  // GET /api/me/appointments - rendez-vous du compte connecté
  if (url.pathname === '/api/me/appointments' && request.method === 'GET') {
    const client = await getClientFromSession(request, env);
    if (!client) return Response.json({ success: false, error: 'Non autorisé' }, { status: 401, headers });

    try {
      const { results } = await env.DB.prepare(
        'SELECT * FROM appointments WHERE clientId = ? ORDER BY date DESC, time DESC'
      ).bind(client.id).all();
      return Response.json({ success: true, appointments: results || [] }, { headers });
    } catch (e) {
      console.error(e);
      return Response.json({ success: false, error: 'Une erreur interne est survenue.' }, { status: 500, headers });
    }
  }

  // POST /api/me/appointments - prise de rendez-vous par le client connecté
  if (url.pathname === '/api/me/appointments' && request.method === 'POST') {
    const client = await getClientFromSession(request, env);
    if (!client) return Response.json({ success: false, error: 'Non autorisé' }, { status: 401, headers });

    const body = await request.json().catch(() => ({}));
    const { service, category, date, time, duration, notes } = body;
    if (!service || !category || !date || !time) {
      return Response.json({ success: false, error: 'Champs requis manquants' }, { status: 400, headers });
    }
    if (!client.phone) {
      return Response.json({ success: false, error: 'Merci de renseigner votre numéro de téléphone dans votre profil avant de réserver.' }, { status: 400, headers });
    }

    try {
      const appointment = {
        id: 'apt_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
        service: sanitize(service),
        category: sanitize(category),
        date: sanitize(date),
        time: sanitize(time),
        duration: Number(duration) || 30,
        clientName: client.name,
        clientPhone: client.phone,
        clientEmail: client.email,
        notes: sanitize(notes || ''),
        status: 'pending',
        createdAt: new Date().toISOString(),
      };

      const slotErr = validateSlot(appointment.date, appointment.time, appointment.duration);
      if (slotErr) {
        return Response.json({ success: false, error: slotErr }, { status: 400, headers });
      }
      if (await slotConflicts(env, appointment.date, appointment.time, appointment.duration)) {
        return Response.json({ success: false, error: 'Ce créneau vient d\'être réservé, merci d\'en choisir un autre.' }, { status: 409, headers });
      }

      await env.DB.prepare(`
        INSERT INTO appointments (id, service, category, date, time, duration, clientId, clientName, clientPhone, clientEmail, notes, status, createdAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        appointment.id, appointment.service, appointment.category, appointment.date, appointment.time,
        appointment.duration, client.id, appointment.clientName, appointment.clientPhone, appointment.clientEmail,
        appointment.notes, appointment.status, appointment.createdAt
      ).run();

      fireNotify(ctx, env, 'client_booked', { ...appointment, clientId: client.id });
      return Response.json({ success: true, appointment }, { headers });
    } catch (e) {
      console.error(e);
      return Response.json({ success: false, error: 'Une erreur interne est survenue.' }, { status: 500, headers });
    }
  }

  // PATCH /api/me/appointments/:id - annulation ou report par le client connecté
  if (url.pathname.match(/^\/api\/me\/appointments\/[^/]+$/) && request.method === 'PATCH') {
    const client = await getClientFromSession(request, env);
    if (!client) return Response.json({ success: false, error: 'Non autorisé' }, { status: 401, headers });

    const id = url.pathname.split('/').pop();
    const body = await request.json().catch(() => ({}));

    try {
      const apt = await env.DB.prepare('SELECT * FROM appointments WHERE id = ?').bind(id).first();
      if (!apt || apt.clientId !== client.id) {
        return Response.json({ success: false, error: 'Rendez-vous introuvable' }, { status: 404, headers });
      }

      const now = getParisDateTimeString();
      if (`${apt.date}T${apt.time}` < now) {
        return Response.json({ success: false, error: 'Ce rendez-vous est déjà passé.' }, { status: 400, headers });
      }
      if (apt.status === 'cancelled') {
        return Response.json({ success: false, error: 'Ce rendez-vous est déjà annulé.' }, { status: 400, headers });
      }

      if (body.action === 'cancel') {
        await env.DB.prepare('UPDATE appointments SET status = ? WHERE id = ?').bind('cancelled', id).run();
        fireNotify(ctx, env, 'cancel_by_client', { ...apt, status: 'cancelled' });
        return Response.json({ success: true }, { headers });
      }

      if (body.action === 'note') {
        const note = sanitize(body.notes || '');
        await env.DB.prepare('UPDATE appointments SET notes = ? WHERE id = ?').bind(note, id).run();
        if (note) fireNotify(ctx, env, 'note_by_client', { ...apt, notes: note });
        return Response.json({ success: true }, { headers });
      }

      if (body.date && body.time) {
        const newDate = sanitize(body.date);
        const newTime = sanitize(body.time);
        const slotErr = validateSlot(newDate, newTime, apt.duration);
        if (slotErr) {
          return Response.json({ success: false, error: slotErr }, { status: 400, headers });
        }
        if (await slotConflicts(env, newDate, newTime, apt.duration, id)) {
          return Response.json({ success: false, error: 'Ce créneau est déjà réservé, merci d\'en choisir un autre.' }, { status: 409, headers });
        }

        await env.DB.prepare('UPDATE appointments SET date = ?, time = ?, status = ? WHERE id = ?')
          .bind(newDate, newTime, 'pending', id).run();
        fireNotify(ctx, env, 'reschedule_by_client', { ...apt, date: newDate, time: newTime, status: 'pending' }, { oldDate: apt.date, oldTime: apt.time });
        return Response.json({ success: true }, { headers });
      }

      return Response.json({ success: false, error: 'Action invalide' }, { status: 400, headers });
    } catch (e) {
      console.error(e);
      return Response.json({ success: false, error: 'Une erreur interne est survenue.' }, { status: 500, headers });
    }
  }

  // GET /api/push/public-key - clé publique VAPID (pour s'abonner côté navigateur)
  if (url.pathname === '/api/push/public-key' && request.method === 'GET') {
    return Response.json({ success: true, key: env.VAPID_PUBLIC_KEY || '' }, { headers });
  }

  // POST /api/me/push - enregistre un abonnement Web Push pour le client connecté
  if (url.pathname === '/api/me/push' && request.method === 'POST') {
    const client = await getClientFromSession(request, env);
    if (!client) return Response.json({ success: false, error: 'Non autorisé' }, { status: 401, headers });
    const body = await request.json().catch(() => ({}));
    try {
      await saveSubscription(env, { ownerType: 'client', clientId: client.id, endpoint: body.endpoint, p256dh: body.p256dh, auth: body.auth, userAgent: body.userAgent });
      return Response.json({ success: true }, { headers });
    } catch (e) {
      console.error(e);
      return Response.json({ success: false, error: 'Une erreur interne est survenue.' }, { status: 500, headers });
    }
  }

  // DELETE /api/me/push
  if (url.pathname === '/api/me/push' && request.method === 'DELETE') {
    const client = await getClientFromSession(request, env);
    if (!client) return Response.json({ success: false, error: 'Non autorisé' }, { status: 401, headers });
    const body = await request.json().catch(() => ({}));
    await deleteSubscription(env, body.endpoint);
    return Response.json({ success: true }, { headers });
  }

  // --- Agenda (abonnement iCal) ---
  const icsCutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  // GET /api/me/calendar - URL d'abonnement agenda du client (crée un jeton si besoin)
  if (url.pathname === '/api/me/calendar' && request.method === 'GET') {
    const client = await getClientFromSession(request, env);
    if (!client) return Response.json({ success: false, error: 'Non autorisé' }, { status: 401, headers });
    let token = client.calendarToken;
    if (!token) {
      token = 'cal_' + crypto.randomUUID().replace(/-/g, '');
      await env.DB.prepare('UPDATE clients SET calendarToken = ? WHERE id = ?').bind(token, client.id).run();
    }
    const httpsUrl = `https://${url.host}/api/me/calendar.ics?token=${token}`;
    return Response.json({ success: true, url: httpsUrl, webcal: httpsUrl.replace(/^https:/, 'webcal:') }, { headers });
  }

  // GET /api/me/calendar.ics?token=... - flux iCal du client (lu par l'app Agenda)
  if (url.pathname === '/api/me/calendar.ics' && request.method === 'GET') {
    const token = url.searchParams.get('token') || '';
    if (!token) return new Response('Missing token', { status: 401 });
    const client = await env.DB.prepare("SELECT id FROM clients WHERE calendarToken = ? AND calendarToken != ''").bind(token).first();
    if (!client) return new Response('Not found', { status: 404 });
    const { results } = await env.DB.prepare('SELECT * FROM appointments WHERE clientId = ? AND date >= ? ORDER BY date, time').bind(client.id, icsCutoff).all();
    const ics = buildFeedICS(results || [], "Mes rendez-vous — L'Atelier d'Estelle", 'client');
    return new Response(ics, { headers: { 'Content-Type': 'text/calendar; charset=utf-8', 'Cache-Control': 'no-cache' } });
  }

  // GET /api/admin/calendar - URL d'abonnement agenda de l'institut
  if (url.pathname === '/api/admin/calendar' && request.method === 'GET') {
    if (!(await isAdmin(request, env))) return Response.json({ success: false, error: 'Non autorisé' }, { status: 401, headers });
    let row = await env.DB.prepare("SELECT value FROM settings WHERE key = 'admin_calendar_token'").first();
    let token = row && row.value;
    if (!token) {
      token = 'cal_' + crypto.randomUUID().replace(/-/g, '');
      await env.DB.prepare("INSERT INTO settings (key, value) VALUES ('admin_calendar_token', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(token).run();
    }
    const httpsUrl = `https://${url.host}/api/admin/calendar.ics?token=${token}`;
    return Response.json({ success: true, url: httpsUrl, webcal: httpsUrl.replace(/^https:/, 'webcal:') }, { headers });
  }

  // GET /api/admin/calendar.ics?token=... - flux iCal de l'institut (tous les RDV)
  if (url.pathname === '/api/admin/calendar.ics' && request.method === 'GET') {
    const token = url.searchParams.get('token') || '';
    const row = await env.DB.prepare("SELECT value FROM settings WHERE key = 'admin_calendar_token'").first();
    if (!token || !row || row.value !== token) return new Response('Not found', { status: 404 });
    const { results } = await env.DB.prepare('SELECT * FROM appointments WHERE date >= ? ORDER BY date, time').bind(icsCutoff).all();
    const prefs = await getAdminPrefs(env);
    const ics = buildFeedICS(results || [], "Agenda — L'Atelier d'Estelle", 'admin', prefs.reminder2h !== false);
    return new Response(ics, { headers: { 'Content-Type': 'text/calendar; charset=utf-8', 'Cache-Control': 'no-cache' } });
  }

  return Response.json({ success: false, error: 'Not found' }, { status: 404, headers });
}

export default {
  async fetch(request, env, ctx) {
    try {
      return await handleRequest(request, env, ctx);
    } catch (error) {
      console.error(error);
      return Response.json({ success: false, error: 'Une erreur interne est survenue.' }, { status: 500, headers: corsHeaders(request, env) });
    }
  },

  // Cron (voir wrangler.toml [triggers]) : rappels J-1 et H-2 aux clients.
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runReminders(env).catch((e) => console.error('scheduled reminders', e)));
  },
};
