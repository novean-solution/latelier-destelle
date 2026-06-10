DROP INDEX IF EXISTS idx_clients_phone;
CREATE UNIQUE INDEX IF NOT EXISTS idx_clients_phone ON clients(phone) WHERE phone != '';
CREATE UNIQUE INDEX IF NOT EXISTS idx_clients_email ON clients(email) WHERE email != '';

CREATE TABLE IF NOT EXISTS login_codes (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    code TEXT NOT NULL,
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
