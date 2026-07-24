# CHANGELOG v66 — Klavye, son tanbou, kont demo, verifikasyon patnè

## 🐛 1. Klavye a bare chan an (login, kreye kont, modal yo)

Se **de bug diferan**, youn pou paj yo, youn pou modal yo.

### Bug A — paj yo (Login, Kreye kont) : se fix v64/v65 la ki lakòz li

Konteneur an te gen `minHeight = wotè ekran an` (≈809px) **plis** `justify-center`.
Lè klavye a louvri sou Android, `softwareKeyboardLayoutMode: "resize"` retresi
fenèt la a ≈420px — **men kontni an rete 809px e li rete santre nan 809px sa yo**.
Donk chan yo chita alantou y=400, pandan sèl 0→420 ki vizib. Chan an tonbe
egzakteman anba klavye a.

**✅ Fix (`ui/KeyboardAware.tsx`) — 3 mekanis:**

1. **Android** : lè klavye a louvri, nou lage `minHeight` la epi nou pase an
   `justify-start`. Kontni an aliyen anwo → tout chan aksesib. Lè klavye a
   fèmen, `minHeight` la tounen → paj la rete byen santre (pa gen sote).
2. **iOS** : `automaticallyAdjustKeyboardInsets` (natif) — ScrollView la ajoute
   yon inset epi li defile jouk chan an vizib. Zewo kòd JS.
3. **Defile otomatik** : chak `Input` anonse tèt li lè li pran fokis
   (`KeyboardAwareContext`). Nou mezire pozisyon l epi nou defile jis sa
   nesesè pou l chita **anwo** klavye a. Se sa ki garanti chan an toujou
   vizib nan yon long fòm tankou paj kreye kont lan.

Yon gad sou eta a (`kbHeightRef`) anpeche nenpòt boukl fidbak.

### Bug B — modal yo : dyagnostik v63 la te alanvè

Kòmantè v63 la te di : *« sou Android `resize` deja redimansyone fenèt la, donk
pa ajoute padding — sa ta fè oscillation »*. **Sa fo.**

Yon `<Modal>` React Native sou Android kreye **pwòp fenèt li** (`android.app.Dialog`).
Fenèt sa a **pa erite** `windowSoftInputMode` Activity prensipal la — donk li pa
janm redimansyone. Rezilta : sou Android, **modal yo pa t janm monte ditou**.

Pi rèd : kòd la te koute `keyboardWillShow` sèlman — evènman sa a **pa janm tire
sou Android**. Donk menm si Android pa t bloke, li pa t ap mache.

**✅ Fix (`ModalSheet.tsx`)** : nou koute klavye a sou tou de platfòm —
`keyboardWillShow` sou iOS, `keyboardDidShow` sou Android. Pa gen oscillation
posib paske fenèt Modal la pa redimansyone : padding nou an se sèl ajisteman ki
fèt. Gad sou eta a kanmenm.

Sa a korije : Depo, Voye, Retire, Chanje modpas, Enfo pèsonèl, Nouvo kat,
Chanje tag, Demann, Evalyasyon — tout modal ki gen yon chan.

---

## 🥁 2. Son tanbou pou notifikasyon push

Nouvo fichye : `assets/sounds/tambou.wav` (1.05s, 44.1kHz mono).
Son an sentetize : twa frap ak glissando de wotè sou yon manbràn tandi
(190→88 Hz, 265→132 Hz, 330→165 Hz) plis yon atak bwi pou "slap" men an.

**Konfigirasyon :**
- `app.config.js` → plugin `expo-notifications` gen `sounds: ["./assets/sounds/tambou.wav"]`
- `usePushNotifications.ts` → nouvo channel Android `freda-tambou-v1`
- `pushNotification.service.ts` (backend) → voye `sound: "tambou.wav"` (iOS) +
  `channelId: "freda-tambou-v1"` (Android) + `priority: "high"`

### ⚠️ De pyèj enpòtan

1. **Son yon channel Android se imitab.** Android fikse l lè channel la kreye e
   li pa janm chanje apre — menm si w rele `setNotificationChannelAsync` ankò.
   Se poutèt sa channel la rele `freda-tambou-v1` epi **pa** `default` : moun ki
   deja gen app la ta rete ak son sistèm nan pou tout tan.
   👉 Si w chanje son an pi devan : monte nimewo a (`v2`, `v3`…) nan **app la
   ak backend la an menm tan**.

2. **Yon OTA update pa ka ajoute yon fichye son.** Ou dwe fè yon nouvo
   `eas build`.

Kèk notifikasyon rete an son sistèm (`system`, `morning_greeting`, `low_balance`)
— yon tanbou pou "bonjou" maten an ta twòp.

---

## 🧪 3. Kont demo pou App Store / Play Store

Apple (Guideline 2.1) ak Google mande yon kont demo **konplètman fonksyonèl**.
Men yo pa ka fè vrè tranzaksyon.

**Achitekti — zewo chanjman nan lojik biznis :**

Nou entèsepte **yon sèl kote pou chak patnè** — fonksyon HTTP la — epi nou
retounen yon repons simile ki gen **menm fòm** ak repons reyèl la.

| Fichye | Sa nou entèsepte |
|---|---|
| `services/demoMode.service.ts` **(nouvo)** | Kontèks + similatè yo |
| `middleware/auth.ts` | Make rekèt la kòm demo (`AsyncLocalStorage`) |
| `services/maplerad.service.ts` → `mpr()` | Kat, kliyan, transfè, wallet |
| `services/paym.service.ts` → `paymFetch()` | Depo, retrè MonCash/NatCash |

Konsa **tout lojik la kouri nòmalman** (frè, ledger, notifikasyon, limit) — sèl
bagay ki chanje se repons patnè a. Revizè a wè yon app 100% fonksyonèl,
ak **zewo apèl rezo** vè Maplerad/Pay'm ak **zewo vrè lajan**.

Kat demo yo gen yon nimewo ki valid Luhn men nan plaj `400000…` — se pa yon vrè BIN.

**Enstalasyon :**
```bash
# 1. Migration
psql $DATABASE_URL -f migrations/034_demo_account.sql

# 2. Nan .env
DEMO_ACCOUNT_EMAILS=demo.review@fredapay.com
DEMO_EMAIL=demo.review@fredapay.com
DEMO_PASSWORD=<chwazi youn>
DEMO_BALANCE_CENTS=100000

# 3. Seed
npm run seed:demo
```

Script la **idanpotan** — ou ka relanse l otan fwa ou vle. Li mete
`is_demo = TRUE`, apwouve KYC, verifye imèl, epi ranpli wallet la.

Modpas la **pa** nan git — script la hash li lokalman lè w lanse l.

---

## ✅ 4. Verifikasyon Maplerad

| Pwen | Rezilta |
|---|---|
| URL API | ✅ Korèk. Maplerad sèvi ak **menm** URL (`api.maplerad.com`) pou sandbox ak pwodiksyon — se **kle a** ki detèmine anviwònman an. Kòd la fè sa byen. |
| Otantifikasyon | ✅ `Authorization: Bearer <secret_key>` — konfòm |
| Jesyon erè | ✅ Trè bon : 401/403/422/404 gen mesaj dyagnostik klè |
| Webhook | ✅ Prezan (`/api/webhooks/maplerad`) |

### ⚠️ De pwen ki merite atansyon

**a) Kle sandbox an dur nan kòd la** (`maplerad.service.ts` liy 13-20) :
```ts
const SANDBOX_SK = "mpr_sandbox_sk_7f36...";
process.env.MAPLERAD_SECRET_KEY || SANDBOX_SK
```
Si `MAPLERAD_SECRET_KEY` pa defini an pwodiksyon, app la **bascule an silans**
sou sandbox. Kliyan yo ta jwenn kat ki pa egziste vre, san okenn erè. Mwen
**pa** touche l (li ka entansyonèl pou dev) — men anvan w ale live, mwen
rekòmande yon `throw` si `NODE_ENV === "production"` epi kle a manke.

**b) Checklist "Going Live" Maplerad la** mande :
- Teste chak sèvis endividyèlman
- **Mande yon reyinyon "Post-Integration audit"** ak ekip entegrasyon yo
  anvan w ale live (via imèl)
- Asire w gen **ase balans** nan wallet Maplerad ou a pou kouvri tranzaksyon yo

---

## ✅ 5. Verifikasyon Pay'm (plopplop v1.4/1.5)

| Pwen | Rezilta |
|---|---|
| Fòmil siyati HMAC | ✅ Egzat : `amount\|method\|recipient\|reference\|timestamp` |
| Flux 3 etap | ✅ Konplè |
| `refference_id` (doub f) | ✅ Byen respekte |
| Andwa yo | ✅ Tout konfòm |
| **`api/withdraw/marchand/verify`** | ❌ **Te manke** |

### Sa m korije

`api/withdraw/marchand/verify` (ajoute nan doc v1.5) pa t entegre. Dokimantasyon
an di yon retrè ka rete nan estati `pending` — san andwa sa a, nou pa t gen
**okenn** fason pou nou konnen si li fini oswa echwe. Lajan an ta bloke nan
ledger la san rezolisyon.

✅ Ajoute : `PaymWithdrawService.verifyWithdrawal(reference)`.

👉 Rekòmandasyon : rele l nan yon cron pou tout retrè ki `pending` depi > 5 min.

---

## 🔒 6. Pwoblèm sekirite (aji anvan soumisyon)

### 🔴 KRITIK — `.env` la komite nan git

Zip backend la gen yon dosye `.git` epi `.env` la **swiv nan git**. Pa t gen
okenn `.gitignore`. Tout kle sa yo nan istorik la :

Supabase service key · JWT secret · Admin token · Maplerad · DeepSeek · Groq ·
Brevo · Pay'm client secret · Didit · logo.dev

**Sa pou fè :**
1. **Woule tout kle sa yo** nan dashboard chak patnè (yo konsidere kòm konpwomèt)
2. Yon `.gitignore` ajoute nan v66 — men li **pa** retire yo nan istorik la :
```bash
git rm --cached .env
git commit -m "Retire .env de git"
# Netwaye istorik la (li rekri tout commit yo):
npx git-filter-repo --path .env --invert-paths
git push --force
```
3. `JWT_SECRET` la sitou : si li konpwomèt, nenpòt moun ka fabrike yon token
   valid pou nenpòt kont.

---

## 🧪 Kijan pou teste anvan soumisyon

```bash
npx expo start -c        # efase kachèt Metro
```

**Klavye :**
1. Login → tape Email, apre sa Modpas → chan an dwe rete vizib anwo klavye a
2. Kreye kont, etap 1→2→3, chak chan (se la ki pi long)
3. Modal Depo → tape montan → modal la dwe monte
4. Repete sou **Android ak iOS** — se de mekanis diferan

**Son tanbou :** bezwen yon nouvo `eas build` (OTA pa sifi). Enstale, konekte,
epi voye yon push. Si w pa tande tanbou a sou Android : dezenstale/reenstale —
channel la ka deja egziste ak ansyen son an.

**Kont demo :** konekte ak li, epi verifye nan log backend la ou wè
`Maplerad court-circuité (compte démo)` — sa konfime zewo apèl reyèl.
