#!/usr/bin/env bash
# Despliegue de Horizonte BTC en Cloudflare desde el Mac.
# Uso: ./desplegar.sh tu@correo.com [subdominio.tudominio.com]
# Es idempotente: si la base de datos o el KV ya existen, los reutiliza.
set -euo pipefail
cd "$(dirname "$0")"

ADMIN="${1:-}"
DOMINIO="${2:-}"
if [[ -z "$ADMIN" ]]; then echo "Uso: ./desplegar.sh tu@correo.com [subdominio.tudominio.com]"; exit 1; fi

command -v node >/dev/null || { echo "Falta Node.js (brew install node)"; exit 1; }
echo "› Instalando dependencias"
npm install --no-fund --no-audit

echo "› Sesión de Cloudflare"
npx wrangler whoami >/dev/null 2>&1 || npx wrangler login

echo "› Base de datos D1"
DB_ID=$(npx wrangler d1 list --json 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const l=JSON.parse(s);const d=l.find(x=>x.name==="escenarios-btc");console.log(d?d.uuid:"")})')
if [[ -z "$DB_ID" ]]; then
  npx wrangler d1 create escenarios-btc >/dev/null
  DB_ID=$(npx wrangler d1 list --json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{console.log(JSON.parse(s).find(x=>x.name==="escenarios-btc").uuid)})')
fi
echo "  $DB_ID"

echo "› Espacio KV"
KV_ID=$(npx wrangler kv namespace list 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const l=JSON.parse(s);const k=l.find(x=>/escenarios-btc.*kv/i.test(x.title));console.log(k?k.id:"")})')
if [[ -z "$KV_ID" ]]; then
  npx wrangler kv namespace create escenarios-btc-kv >/dev/null
  KV_ID=$(npx wrangler kv namespace list | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{console.log(JSON.parse(s).find(x=>/escenarios-btc.*kv/i.test(x.title)).id)})')
fi
echo "  $KV_ID"

# Escribe los ID, el administrador y el contacto en wrangler.toml
# Los valores se pasan por el entorno para que perl no interprete la @ del correo
DB_ID="$DB_ID" KV_ID="$KV_ID" ADMIN="$ADMIN" perl -pi -e 's/^database_id = .*/database_id = "$ENV{DB_ID}"/; s/^id = "REEMPLAZAR_CON_EL_ID_DE_KV"/id = "$ENV{KV_ID}"/; s/^ADMIN_EMAILS = .*/ADMIN_EMAILS = "$ENV{ADMIN}"/; s/^CONTACT_UA = .*/CONTACT_UA = "HorizonteBTC (contacto: $ENV{ADMIN})"/' wrangler.toml
if [[ -n "$DOMINIO" ]] && ! grep -q "^routes" wrangler.toml; then
  DOMINIO="$DOMINIO" perl -pi -e 's/^(main = .*)$/$1\nroutes = [{ pattern = "$ENV{DOMINIO}", custom_domain = true }]/' wrangler.toml
fi

echo "› Esquema de la base de datos"
npx wrangler d1 migrations apply escenarios-btc --remote

echo "› Token del calibrador"
if [[ ! -f .publish_token ]]; then
  openssl rand -hex 32 > .publish_token
  chmod 600 .publish_token
  npx wrangler secret put PUBLISH_TOKEN < .publish_token
fi

echo "› Claves opcionales (Enter para saltar)"
for K in FRED_API_KEY COINGECKO_API_KEY CONGRESS_API_KEY; do
  read -r -s -p "  $K: " V; echo
  if [[ -n "$V" ]]; then printf '%s' "$V" | npx wrangler secret put "$K"; fi
done

echo "› Compilando y publicando"
npm run build
npx wrangler deploy

echo
echo "Hecho. El cron empieza solo; el histórico tarda 2–3 horas en cargarse."
echo "Token del calibrador guardado en .publish_token (no lo subas a ningún repositorio)."
[[ -n "$DOMINIO" ]] && echo "Web: https://$DOMINIO"
echo "Siguiente: configurar Cloudflare Access (README, sección Usuarios)."
