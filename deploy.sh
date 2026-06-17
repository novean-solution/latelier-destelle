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
# Copie tout le dépôt SAUF le code serveur et les fichiers de dev/déploiement.
# (allowlist abandonnée : on oubliait d'ajouter les nouveaux fichiers, ex. PWA.)
for item in *; do
  case "$item" in
    worker|_dist|node_modules|deploy.sh|wrangler.toml|*.sql|*.md|*.mjs|"A FAIRE.txt") continue ;;
  esac
  cp -r "$item" _dist/
done
npx wrangler pages deploy _dist --project-name=latelier-destelle --branch=master --commit-dirty=true
rm -rf _dist

echo "✅ Déploiement terminé."
