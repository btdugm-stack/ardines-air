#!/usr/bin/env bash
# Deploy ardines-web ke Cloudflare Workers (ardines.moonlab.my.id)
# Pemakaian: bash scripts/deploy-live.sh
# Alur: build -> patch dist/server/wrangler.json (D1 id + custom domain, karena
#       npm run build SELALU menimpa file itu dengan placeholder) -> deploy -> smoke test.
set -euo pipefail
cd "$(dirname "$0")/.."

D1_ID="ce129571-be2a-42bf-96c6-4ce519d06e71"
D1_NAME="depot-air-db"
DOMAIN="ardines.moonlab.my.id"

echo "==> 1/4 Build (vinext)..."
npm run build

echo "==> 2/4 Patch dist/server/wrangler.json (D1 + custom domain)..."
node -e "
const fs = require('fs');
const p = 'dist/server/wrangler.json';
const cfg = JSON.parse(fs.readFileSync(p, 'utf8'));
cfg.d1_databases = [{ binding: 'DB', database_name: process.argv[1], database_id: process.argv[2] }];
cfg.routes = [{ pattern: process.argv[3], custom_domain: true }];
fs.writeFileSync(p, JSON.stringify(cfg));
console.log('patched ->', 'D1:', cfg.d1_databases[0].database_id, '| route:', cfg.routes[0].pattern);
" "$D1_NAME" "$D1_ID" "$DOMAIN"

echo "==> 3/4 Deploy..."
(cd dist/server && npx wrangler deploy --config wrangler.json)

echo "==> 4/4 Smoke test..."
curl -s -m 40 -A 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' "https://$DOMAIN/" -o /tmp/depot-home.html -w "GET / -> %{http_code}\n"
rm -f /tmp/depot-home.html
curl -s -m 40 -A 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' "https://$DOMAIN/api/app" -o /tmp/depot-api.json
python -c "import json; d=json.load(open('/tmp/depot-api.json', encoding='utf-8')); print('products:', len(d.get('products', [])))" || echo "api parse fail"
rm -f /tmp/depot-api.json
echo "==> Selesai. Live di https://$DOMAIN"
