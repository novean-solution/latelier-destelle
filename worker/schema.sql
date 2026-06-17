CREATE TABLE IF NOT EXISTS appointments (
    id TEXT PRIMARY KEY,
    service TEXT NOT NULL,
    category TEXT NOT NULL,
    date TEXT NOT NULL,
    time TEXT NOT NULL,
    duration INTEGER DEFAULT 30,
    clientId TEXT DEFAULT '',
    clientName TEXT NOT NULL,
    clientPhone TEXT NOT NULL,
    clientEmail TEXT DEFAULT '',
    notes TEXT DEFAULT '',
    status TEXT DEFAULT 'pending',
    createdAt TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_appointments_date ON appointments(date);
CREATE INDEX IF NOT EXISTS idx_appointments_status ON appointments(status);
CREATE INDEX IF NOT EXISTS idx_appointments_clientId ON appointments(clientId);

CREATE TABLE IF NOT EXISTS clients (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    phone TEXT NOT NULL,
    email TEXT DEFAULT '',
    notes TEXT DEFAULT '',
    createdAt TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_clients_phone ON clients(phone) WHERE phone != '';
CREATE UNIQUE INDEX IF NOT EXISTS idx_clients_email ON clients(email) WHERE email != '';

CREATE TABLE IF NOT EXISTS login_codes (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    code TEXT NOT NULL,
    attempts INTEGER DEFAULT 0,
    expiresAt TEXT NOT NULL,
    createdAt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_login_codes_email ON login_codes(email);

CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    clientId TEXT NOT NULL,
    expiresAt TEXT NOT NULL,
    createdAt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_clientId ON sessions(clientId);

CREATE TABLE IF NOT EXISTS admin_sessions (
    token TEXT PRIMARY KEY,
    expiresAt TEXT NOT NULL,
    createdAt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_admin_sessions_expires ON admin_sessions(expiresAt);
