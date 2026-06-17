-- Migration : abonnement agenda (iCal) — jeton de calendrier par client.
-- À lancer UNE FOIS sur la base de prod :
--   npx wrangler d1 execute latelier-destelle-db --remote --file=worker/migration_calendar.sql

ALTER TABLE clients ADD COLUMN calendarToken TEXT DEFAULT '';
CREATE INDEX IF NOT EXISTS idx_clients_calendarToken ON clients(calendarToken) WHERE calendarToken != '';
