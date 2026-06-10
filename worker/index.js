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
