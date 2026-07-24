# Freda Pay Backend — Vèsyon konplè v53

Backend Node.js/TypeScript/Express konplè avèk TOUT modifikasyon aplike.

## Enstalasyon

```bash
# 1. Enstale
npm install

# 2. Konfigure .env
cp .env.example .env
# Edite .env — fè sèten BREVO_API_KEY, DATABASE_URL, JWT_SECRET, elt yo mete

# 3. Migrations
npm run migrate

# 4. Devlopman
npm run dev

# 5. Pwodiksyon (Render/Railway ap fè sa otomatikman)
npm run build && npm start
```

## Chanjman aplike (v53)

### Emails yo pa ale nan Promotions ankò
- ✅ Subject netwaye (san emoji ekstrèm): `"Freda Pay: Code de vérification 123456"`
- ✅ Header transactionnels:
  - `X-Category: Transactional`
  - `X-Priority: 1`, `Importance: High`
  - `Precedence: normal`
  - `X-Auto-Response-Suppress: All`
  - `X-Mailer: Freda Pay Transactional Service`
  - `X-Entity-Ref-ID: fredapay-{timestamp}`
- ✅ Vèsyon text/plain jenere otomatikman ak `htmlToText()` — obligatwa pou deliverability
- ✅ Paramèt `category: transactional|notification|marketing` sou send()

### Logo email sou Android
- ✅ Nouvo endpoint `/public/logo.png` (express.static ak Cache-Control 30 jou)
- ✅ Nouvo logo `public/logo.png` (16 KB) + `public/logo-hd.png` (137 KB)
- ✅ email.service.ts itilize `${BACKEND_URL}/public/logo.png` olye Dropbox

### server.ts
```typescript
// Nouvo middleware:
app.use("/public", express.static("public", {
  maxAge: "30d",
  etag: true,
  setHeaders: (res) => {
    res.setHeader("Cache-Control", "public, max-age=2592000, immutable");
    res.setHeader("X-Content-Type-Options", "nosniff");
  },
}));
```

## Konfigirasyon .env kritik

```env
# BREVO
BREVO_API_KEY=xkeysib-...

# URLs
BACKEND_URL=https://backend-fredapay11.onrender.com   # Pou konstwi URL logo email
PUBLIC_URL=https://backend-fredapay11.onrender.com    # Alias pou BACKEND_URL
FRONTEND_URL=https://fredapay.com

# Database
DATABASE_URL=postgres://...

# JWT
JWT_SECRET=...
JWT_REFRESH_SECRET=...

# Maplerad (cartes virtuelles)
MAPLERAD_API_KEY=...
MAPLERAD_WEBHOOK_SECRET=...

# Didit (KYC)
DIDIT_API_KEY=...

# Google Cloud Vision (OCR, opsyonèl)
GOOGLE_APPLICATION_CREDENTIALS=...
```

## Estrikti

```
src/
├── config/         # Env, konfigirasyon
├── cron/           # Tach recurent (dunning, cleanup, elt)
├── data/           # Done statik (frè, plan yo)
├── db/             # Migrations + pool
├── middleware/     # requireAuth, validation, rate-limit, elt
├── routes/         # Endpoint yo (auth, wallet, cards, subscriptions, elt)
├── services/       # Logic biznis (email FIXE, push, wallet, jwt, elt)
├── types/          # TS types
├── utils/          # Validation, logger, elt
└── server.ts       # Antipwen — kounye a sèvi /public tou
public/             # NOUVO — sèvi kòm fichye statik (logo email)
├── logo.png        # 200x200 pou emails
└── logo-hd.png     # 1024x1024 pou HD
migrations/         # SQL migrations
```

## Deploiman

```bash
git push origin main
# Render deploye otomatikman
```

⚠ **IMPÒTAN**: Apre depoiman, verifye:
```bash
curl -I https://backend-fredapay11.onrender.com/public/logo.png
# Ta dwe retounen 200 OK ak Content-Type: image/png
```

Si li retounen 404, `express.static` middleware la pa aktif — verifye `dist/public/logo.png` egziste apre `npm run build`.

## Test emails

```bash
# Voye yon OTP tès
curl -X POST https://backend-fredapay11.onrender.com/api/auth/verify-email \
  -H "Content-Type: application/json" \
  -d '{"email":"tès@egzanp.com"}'

# Verifye Gmail: OTP dwe rive nan Inbox principal, pa Promotions
# Verifye Android Gmail: logo Freda dwe parèt
```
