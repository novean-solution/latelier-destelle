ALTER TABLE appointments ADD COLUMN clientId TEXT DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_appointments_clientId ON appointments(clientId);

CREATE TABLE IF NOT EXISTS clients (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    phone TEXT NOT NULL,
    email TEXT DEFAULT '',
    notes TEXT DEFAULT '',
    createdAt TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_clients_phone ON clients(phone);
