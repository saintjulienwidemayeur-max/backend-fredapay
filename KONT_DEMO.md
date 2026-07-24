# KONT DEMO — App Store & Play Store

## 🔑 Kredansyèl yo

```
Imèl    : demo.review@fredapay.com
Modpas  : FredaDemo2026!
```

FredaTag: `@demoreview` · Balans: **$1,000.00 (DEMO)** · KYC: deja apwouve

---

## ⚙️ Etap enstalasyon — 2 etap sèlman

### 1. SQL la nan Supabase (pa gen `psql` pou enstale)

Supabase Dashboard → pwojè w la → **SQL Editor** → **New query** →
kole tout kontni **`migrations/035_seed_demo_account.sql`** → **Run**.

Yon sèl fichye fè tout bagay: kolòn `is_demo`, kont lan, modpas la (hash
ak `pgcrypto`), ak wallet la. Li idanpotan — relanse l otan fwa ou vle.

Nan fen an li afiche yon tablo verifikasyon: ou dwe wè `is_demo = true`
ak `balans_dola = 1000`.

> `npm run seed:demo` se yon **altènatif** si w prefere liy kòmand.
> Si w fè SQL la, ou pa bezwen l ditou.

### 2. Varyab anviwònman sou Render
Nan dashboard Render → sèvis backend la → **Environment** :

| Kle | Valè |
|---|---|
| `DEMO_ACCOUNT_EMAILS` | `demo.review@fredapay.com` |
| `DEMO_EMAIL` | `demo.review@fredapay.com` |
| `DEMO_PASSWORD` | `FredaDemo2026!` |
| `DEMO_TAG` | `demoreview` |
| `DEMO_BALANCE_CENTS` | `100000` |

⚠️ `DEMO_ACCOUNT_EMAILS` se sa ki **aktive** mòd demo a. San li, kont la ta fè
vrè tranzaksyon.

### 3. Verifye (enpòtan)
Konekte ak kont lan nan app la, epi fè yon depo. Nan log Render yo ou dwe wè :
```
Pay'm court-circuité (compte démo)
```
Si w **pa** wè liy sa a → mòd demo a pa aktive, epi kont lan ap fè vrè
tranzaksyon. Verifye `DEMO_ACCOUNT_EMAILS`.

---

## 📋 Sa pou kole nan App Store Connect

**App Review Information → Sign-In Information** (koche « Sign-in required ») :

- Username: `demo.review@fredapay.com`
- Password: `FredaDemo2026!`

**Notes** (kopye tèks anba a) :

```
This is a fully functional demo account provisioned specifically for App Review.

All financial operations on this account are SIMULATED. The backend intercepts
every request to our banking partners (Maplerad — card issuing, Pay'm — mobile
money) and returns simulated responses. No real money moves, no real cards are
issued, and no network calls reach our partners' production systems.

The account is pre-funded with $1,000.00 in demo balance and its identity
verification (KYC) is pre-approved, so the reviewer can exercise every feature
without submitting personal documents.

Features available for testing:
- Wallet: view balance, transaction history, receipts
- Deposit: MonCash / NatCash / KashPaw (confirms instantly in demo mode,
  no external browser redirect)
- Send / receive money via FredaTag (@demoreview)
- Payment requests
- Virtual card: create, view full card details, freeze/unfreeze, reload,
  terminate, view card transactions
- Fred'AI assistant (text and voice)
- Notifications, settings, biometric lock, 2FA, dark/light theme

Card numbers generated on this account are Luhn-valid but use the 400000
test range — they are not real BINs and cannot be used anywhere.
```

---

## 📋 Sa pou kole nan Google Play Console

**App content → App access** → chwazi « All or some functionality is restricted » :

- Name of instruction: `Demo account`
- Username: `demo.review@fredapay.com`
- Password: `FredaDemo2026!`
- Any other instructions:

```
Fully functional demo account. All financial operations are simulated on the
backend — no real money moves and no requests reach our banking partners.
Pre-funded with $1,000.00 demo balance, KYC pre-approved. The reviewer can
test every feature: deposits, transfers, payment requests, virtual card
issuing and management, and the AI assistant.
```

---

## 🔒 Nòt sekirite

- Kont demo a **pa ka** vin yon kont reyèl. Drapo `is_demo` a li sèlman —
  okenn wout API pa modifye l. Se sèlman via SQL li chanje.
- Menm si modpas la fuit, kont lan pa ka touche vrè lajan.
- Apre app la apwouve, ou ka kite kont lan pou pwochèn mizajou yo — Apple ak
  Google ap sèvi ak li chak fwa.
- Si w vle chanje modpas la : chanje `DEMO_PASSWORD` sou Render epi relanse
  `npm run seed:demo`.
