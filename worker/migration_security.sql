-- Migration sécurité (2026-06)
-- À exécuter UNE FOIS sur la base D1 de production :
--   npx wrangler d1 execute latelier-destelle-db --remote --file=worker/migration_security.sql
-- (et sans --remote pour la base locale de dev)

-- 1) Anti brute-force sur les codes de connexion : compteur de tentatives
ALTER TABLE login_codes ADD COLUMN attempts INTEGER DEFAULT 0;

-- 2) Sessions admin révocables (le login ne renvoie plus le mot de passe maître,
--    mais un token de session jetable stocké ici)
CREATE TABLE IF NOT EXISTS admin_sessions (
    token TEXT PRIMARY KEY,
    expiresAt TEXT NOT NULL,
    createdAt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_admin_sessions_expires ON admin_sessions(expiresAt);
