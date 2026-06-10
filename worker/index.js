/**
 * L'atelier d'Estelle - Worker de prise de rendez-vous
 * API D1 minimaliste : créneaux disponibles + gestion des rendez-vous
 */

const OPENING_HOURS = { start: 7, end: 20 }; // 7h - 20h, du lundi au vendredi
const SLOT_STEP_MINUTES = 30;

function corsHeaders(request) {
  const origin = request.headers.get('Origin') || '*';
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'application/json',
  };
}

function sanitize(text) {
  if (typeof text !== 'string') return '';
  return text.replace(/[<>]/g, '').trim();
}

function isAdmin(request, env) {
  const auth = request.headers.get('Authorization') || '';
  const token = auth.replace('Bearer ', '');
  return token && token === env.ADMIN_TOKEN;
}

const PHONE_REGEX = /^0[1-9](\s?\d{2}){4}$/;
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

// Envoie un email via Resend
async function sendEmail(env, { to, subject, html }) {
  if (!env.RESEND_API_KEY) {
    console.error('RESEND_API_KEY manquant - email non envoyé');
    return false;
  }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: env.FROM_EMAIL || "L'atelier d'Estelle <onboarding@resend.dev>",
        to,
        subject,
        html,
      }),
    });
    return res.ok;
  } catch (e) {
    console.error('Erreur envoi email', e);
    return false;
  }
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

// Trouve un client existant par téléphone, sinon le crée
async function findOrCreateClient(env, { name, phone, email }) {
  const cleanPhone = sanitize(phone);
  if (!cleanPhone) return '';

  const existing = await env.DB.prepare('SELECT id, name, email FROM clients WHERE phone = ?').bind(cleanPhone).first();
  if (existing) {
    // Complète les infos manquantes du client si besoin
    const newName = existing.name || sanitize(name || '');
    const newEmail = existing.email || sanitize(email || '');
    if (newName !== existing.name || newEmail !== existing.email) {
      await env.DB.prepare('UPDATE clients SET name = ?, email = ? WHERE id = ?').bind(newName, newEmail, existing.id).run();
    }
    return existing.id;
  }

  const id = 'cli_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
  await env.DB.prepare(`
    INSERT INTO clients (id, name, phone, email, notes, createdAt)
    VALUES (?, ?, ?, ?, '', ?)
  `).bind(id, sanitize(name || ''), cleanPhone, sanitize(email || ''), new Date().toISOString()).run();
  return id;
}

async function handleRequest(request, env) {
  const url = new URL(request.url);
  const headers = corsHeaders(request);

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
      return Response.json({ success: false, error: e.message }, { status: 500, headers });
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

    try {
      // Vérifier que le créneau est toujours libre
      const { results } = await env.DB.prepare(
        `SELECT id FROM appointments WHERE date = ? AND time = ? AND status != 'cancelled'`
      ).bind(appointment.date, appointment.time).all();

      if (results && results.length > 0) {
        return Response.json({ success: false, error: 'Ce créneau vient d\'être réservé, merci d\'en choisir un autre.' }, { status: 409, headers });
      }

      const clientId = await findOrCreateClient(env, {
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

      return Response.json({ success: true, appointment }, { headers });
    } catch (e) {
      return Response.json({ success: false, error: e.message }, { status: 500, headers });
    }
  }

  // POST /api/admin/appointments - création manuelle par l'institut (ex: appel téléphonique)
  if (url.pathname === '/api/admin/appointments' && request.method === 'POST') {
    if (!isAdmin(request, env)) {
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
      const clientId = await findOrCreateClient(env, {
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

      return Response.json({ success: true, appointment }, { headers });
    } catch (e) {
      return Response.json({ success: false, error: e.message }, { status: 500, headers });
    }
  }

  // GET /api/admin/clients - liste des clients (avec nb de rendez-vous)
  if (url.pathname === '/api/admin/clients' && request.method === 'GET') {
    if (!isAdmin(request, env)) {
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
      return Response.json({ success: false, error: e.message }, { status: 500, headers });
    }
  }

  // POST /api/admin/clients - ajout manuel d'un client
  if (url.pathname === '/api/admin/clients' && request.method === 'POST') {
    if (!isAdmin(request, env)) {
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
      return Response.json({ success: false, error: e.message }, { status: 500, headers });
    }
  }

  // GET /api/admin/clients/:id - détail d'un client + historique de rendez-vous
  if (url.pathname.match(/^\/api\/admin\/clients\/[^/]+$/) && request.method === 'GET') {
    if (!isAdmin(request, env)) {
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
      return Response.json({ success: false, error: e.message }, { status: 500, headers });
    }
  }

  // PATCH /api/admin/clients/:id - met à jour les infos / notes d'un client
  if (url.pathname.match(/^\/api\/admin\/clients\/[^/]+$/) && request.method === 'PATCH') {
    if (!isAdmin(request, env)) {
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
      return Response.json({ success: true }, { headers });
    } catch (e) {
      return Response.json({ success: false, error: e.message }, { status: 500, headers });
    }
  }

  // DELETE /api/admin/clients/:id
  if (url.pathname.match(/^\/api\/admin\/clients\/[^/]+$/) && request.method === 'DELETE') {
    if (!isAdmin(request, env)) {
      return Response.json({ success: false, error: 'Non autorisé' }, { status: 401, headers });
    }
    const id = url.pathname.split('/').pop();
    try {
      await env.DB.prepare('DELETE FROM clients WHERE id = ?').bind(id).run();
      return Response.json({ success: true }, { headers });
    } catch (e) {
      return Response.json({ success: false, error: e.message }, { status: 500, headers });
    }
  }

  // --- Routes admin (protégées par token) ---

  // POST /api/admin/login - vérifie le mot de passe
  if (url.pathname === '/api/admin/login' && request.method === 'POST') {
    const body = await request.json().catch(() => ({}));
    if (body.password && body.password === env.ADMIN_TOKEN) {
      return Response.json({ success: true, token: env.ADMIN_TOKEN }, { headers });
    }
    return Response.json({ success: false, error: 'Mot de passe incorrect' }, { status: 401, headers });
  }

  // GET /api/admin/appointments - liste tous les rendez-vous
  if (url.pathname === '/api/admin/appointments' && request.method === 'GET') {
    if (!isAdmin(request, env)) {
      return Response.json({ success: false, error: 'Non autorisé' }, { status: 401, headers });
    }
    try {
      const { results } = await env.DB.prepare(
        'SELECT * FROM appointments ORDER BY date DESC, time DESC'
      ).all();
      return Response.json({ success: true, appointments: results || [] }, { headers });
    } catch (e) {
      return Response.json({ success: false, error: e.message }, { status: 500, headers });
    }
  }

  // PATCH /api/admin/appointments/:id - met à jour le statut
  if (url.pathname.startsWith('/api/admin/appointments/') && request.method === 'PATCH') {
    if (!isAdmin(request, env)) {
      return Response.json({ success: false, error: 'Non autorisé' }, { status: 401, headers });
    }
    const id = url.pathname.split('/').pop();
    const body = await request.json().catch(() => ({}));
    const status = sanitize(body.status || '');
    if (!['pending', 'confirmed', 'cancelled'].includes(status)) {
      return Response.json({ success: false, error: 'Statut invalide' }, { status: 400, headers });
    }
    try {
      await env.DB.prepare('UPDATE appointments SET status = ? WHERE id = ?').bind(status, id).run();
      return Response.json({ success: true }, { headers });
    } catch (e) {
      return Response.json({ success: false, error: e.message }, { status: 500, headers });
    }
  }

  // DELETE /api/admin/appointments/:id
  if (url.pathname.startsWith('/api/admin/appointments/') && request.method === 'DELETE') {
    if (!isAdmin(request, env)) {
      return Response.json({ success: false, error: 'Non autorisé' }, { status: 401, headers });
    }
    const id = url.pathname.split('/').pop();
    try {
      await env.DB.prepare('DELETE FROM appointments WHERE id = ?').bind(id).run();
      return Response.json({ success: true }, { headers });
    } catch (e) {
      return Response.json({ success: false, error: e.message }, { status: 500, headers });
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
      return Response.json({ success: false, error: e.message }, { status: 500, headers });
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
      const row = await env.DB.prepare('SELECT * FROM login_codes WHERE email = ? AND code = ?').bind(email, code).first();
      if (!row || row.expiresAt < new Date().toISOString()) {
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
      return Response.json({ success: false, error: e.message }, { status: 500, headers });
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
      return Response.json({ success: false, error: e.message }, { status: 500, headers });
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
      return Response.json({ success: false, error: e.message }, { status: 500, headers });
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
      return Response.json({ success: false, error: e.message }, { status: 500, headers });
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
      const { results } = await env.DB.prepare(
        `SELECT id FROM appointments WHERE date = ? AND time = ? AND status != 'cancelled'`
      ).bind(sanitize(date), sanitize(time)).all();
      if (results && results.length > 0) {
        return Response.json({ success: false, error: 'Ce créneau vient d\'être réservé, merci d\'en choisir un autre.' }, { status: 409, headers });
      }

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

      await env.DB.prepare(`
        INSERT INTO appointments (id, service, category, date, time, duration, clientId, clientName, clientPhone, clientEmail, notes, status, createdAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        appointment.id, appointment.service, appointment.category, appointment.date, appointment.time,
        appointment.duration, client.id, appointment.clientName, appointment.clientPhone, appointment.clientEmail,
        appointment.notes, appointment.status, appointment.createdAt
      ).run();

      return Response.json({ success: true, appointment }, { headers });
    } catch (e) {
      return Response.json({ success: false, error: e.message }, { status: 500, headers });
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
        return Response.json({ success: true }, { headers });
      }

      if (body.date && body.time) {
        const newDate = sanitize(body.date);
        const newTime = sanitize(body.time);
        if (`${newDate}T${newTime}` < now) {
          return Response.json({ success: false, error: 'Merci de choisir un créneau futur.' }, { status: 400, headers });
        }

        const allSlots = generateDaySlots(newDate);
        if (!allSlots.includes(newTime)) {
          return Response.json({ success: false, error: 'Créneau indisponible.' }, { status: 400, headers });
        }

        const { results } = await env.DB.prepare(
          `SELECT id FROM appointments WHERE date = ? AND time = ? AND status != 'cancelled' AND id != ?`
        ).bind(newDate, newTime, id).all();
        if (results && results.length > 0) {
          return Response.json({ success: false, error: 'Ce créneau est déjà réservé, merci d\'en choisir un autre.' }, { status: 409, headers });
        }

        await env.DB.prepare('UPDATE appointments SET date = ?, time = ?, status = ? WHERE id = ?')
          .bind(newDate, newTime, 'pending', id).run();
        return Response.json({ success: true }, { headers });
      }

      return Response.json({ success: false, error: 'Action invalide' }, { status: 400, headers });
    } catch (e) {
      return Response.json({ success: false, error: e.message }, { status: 500, headers });
    }
  }

  return Response.json({ success: false, error: 'Not found' }, { status: 404, headers });
}

export default {
  async fetch(request, env) {
    try {
      return await handleRequest(request, env);
    } catch (error) {
      return Response.json({ success: false, error: error.message }, { status: 500, headers: corsHeaders(request) });
    }
  },
};
