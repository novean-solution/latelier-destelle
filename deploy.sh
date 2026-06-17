#!/usr/bin/env bash
# Déploiement L'Atelier d'Estelle — à lancer depuis la racine du projet (git bash).
#   ./deploy.sh
#
# ⚠️ Si tu as modifié le schéma de la base (worker/schema.sql ou une migration),
#    lance D'ABORD la migration sur la base de prod, par ex. :
#      npx wrangler d1 execute latelier-destelle-db --remote --file=worker/migration_security.sql
set -e

echo "1/2 — Déploiement du Worker (API)…"
npx wrangler deploy

echo "2/2 — Déploiement du front (Pages, sans exposer le code du worker)…"
rm -rf _dist && mkdir -p _dist
cp -r index.html compte.html robots.txt sitemap.xml favicon.svg css js images admin _dist/
npx wrangler pages deploy _dist --project-name=latelier-destelle --branch=master --commit-dirty=true
rm -rf _dist

echo "✅ Déploiement terminé."
