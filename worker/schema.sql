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

CREATE UNIQUE INDEX IF NOT EXISTS idx_clients_phone ON clients(phone);
