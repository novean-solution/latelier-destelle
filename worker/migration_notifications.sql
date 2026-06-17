-- Migration : système de notifications (push + rappels)
-- À lancer UNE FOIS sur la base de prod, AVANT le déploiement du worker :
--   npx wrangler d1 execute latelier-destelle-db --remote --file=worker/migration_notifications.sql

-- Abonnements Web Push (admin et clients)
CREATE TABLE IF NOT EXISTS push_subscriptions (
    id TEXT PRIMARY KEY,
    ownerType TEXT NOT NULL,
    clientId TEXT DEFAULT '',
    endpoint TEXT NOT NULL UNIQUE,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    userAgent TEXT DEFAULT '',
    createdAt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_push_owner ON push_subscriptions(ownerType, clientId);

-- Réglages clé/valeur (préférences de notification de l'institut, etc.)
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

-- Drapeaux de rappel sur les rendez-vous (idempotence du cron J-1 / H-2)
ALTER TABLE appointments ADD COLUMN reminderDayBeforeSentAt TEXT DEFAULT '';
ALTER TABLE appointments ADD COLUMN reminderHourBeforeSentAt TEXT DEFAULT '';
