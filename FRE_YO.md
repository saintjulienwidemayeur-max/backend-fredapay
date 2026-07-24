# FRÈ YO — tout nan DB (v66)

## Sa ki te pa mache

Frè yo te **separe an de kote** :

| Kote | Sa ki te ladan | Pwoblèm |
|---|---|---|
| `payment_fees` (DB) ✅ | Frè depo/retrè **pa metòd** (MonCash, NatCash, KashPaw…) | Byen fèt |
| `fees.config.ts` (kòd) ❌ | **Tout rès la** | Pou chanje yon pri ou te oblije redeplwaye backend la |

Sa ki te an dur nan kòd la :

- Transfè P2P — 0,5 %
- Emisyon kat — 5,20 $
- Kat tokenize — 12,00 $
- Txn kat reyisi — 0,50 $ / refize — 0,40 $
- Ouvèti kont bankè US — 12,00 $
- Reyaktivasyon tadi — 5,00 $
- Penalite solde ensifizan — 5,00 $

Pi rèd : `wallet.service.ts` (depo, P2P, retrè) t ap sèvi ak valè **an dur** yo,
pandan `paym.ts` t ap sèvi ak **DB a**. De sous verite pou menm bagay la.

---

## Sa ki chanje

### 1. Nouvo tab `fee_rules`

Yon sèl tab pou **tout** frè yo. Migration : `036_fee_rules.sql`.

| Kolòn | Sa li ye |
|---|---|
| `rule_key` | Kle teknik (`p2p_transfer`, `card_creation`…). **Pa chanje yo.** |
| `label` | Tèks ki parèt nan detay tranzaksyon an sou telefòn nan |
| `flat_cents` | Pati fiks, an santim (1,50 $ → `150`) |
| `percent_bps` | Poursantaj an base points (5 % → `500`, 0,5 % → `50`) |
| `min_cents` / `max_cents` | Planche / plafon. `max_cents = 0` → pa gen plafon |
| `is_active` | Mete `FALSE` pou anile yon frè san efase l |

**Fòmil la :** `flat + (montan × bps ÷ 10000)`, apre sa klipe ant `min` ak `max`.

### 2. Kijan pou chanje yon pri

Supabase → **Table Editor** → `fee_rules` → chanje valè a → Save.

Li aktif nan **5 minit** (kachèt la), **san redeplwaman**.

Egzanp — pase frè P2P la de 0,5 % a 1 % :
```sql
UPDATE fee_rules SET percent_bps = 100 WHERE rule_key = 'p2p_transfer';
```

Anile frè txn kat refize a :
```sql
UPDATE fee_rules SET is_active = FALSE WHERE rule_key = 'card_txn_declined';
```

### 3. Frè a parèt nan detay tranzaksyon an

Nouvo kolòn `transactions_ledger.fee_label`.

Lè yon tranzaksyon fèt, nou anrejistre **tèks frè a jan li te ye nan moman an**.
Se yon **istorik fig** : yon resi ki gen 6 mwa ap toujou montre frè ki te aplike
lè sa a, menm si w chanje tarif la jodi a. Sa a enpòtan pou konfòmite —
yon resi pa dwe janm chanje apre koutfè.

Nan app la, detay tranzaksyon an montre kounye a :

```
Montant brut      12,00 $
Frais              0,66 $
Détail des frais   Frais transfert (0,5 %)     ← nouvo
Montant total     -12,66 $
```

### 4. Nouvo andwa API

```
GET /api/fees/rules
```

Retounen tout règ yo — pou paj « Frais » nan app la ak pou panèl admin lan.

⚠️ Wout sa a deklare **avan** `/:methodId`, sinon Express ta konprann `rules`
kòm yon `methodId` epi li ta bay 404.

---

## Frè pa palye (v66.1) — `fee_rule_tiers`

Kèk frè chanje **selon montan an**. Yon sèl fòmil `flat + pousantaj` pa ka
eksprime sa, donk tab `fee_rule_tiers` (migration 037) kenbe palye yo.

Si yon `rule_key` gen palye, **palye yo pran priyorite** sou fòmil senp la.

### Pri rechaj kat — anvigè kounye a

| Kalite kat | 1 $ – 100 $ | 100,01 $ – 500 $ |
|---|---|---|
| **Tokenize** (Apple/Google Pay) | **2,79 $** fiks | **5 %** |
| Debi klasik | 1,20 $ fiks | 2,5 % |

Kat klasik yo **pa chanje** — menm pri ak avan.

### Pou chanje yon palye

```sql
-- Egzanp: monte premye palye tokenize a a 3,00 $
UPDATE fee_rule_tiers
   SET flat_cents = 300
 WHERE rule_key = 'card_reload_tokenized' AND min_cents = 100;
```

Aktif nan 5 minit, san redeplwaman.

---

## ⚠️ De bagay sou nouvo pri tokenize a

### 1. Gen yon sote de 2,21 $ nan 100 $

| Montan | Frè |
|---|---|
| 100,00 $ | 2,79 $ |
| 100,01 $ | 5,00 $ |

Yon santim anplis koute 2,21 $ anplis. Sa se konsekans dirèk estrikti a —
li pa yon bug, men fè atansyon: kliyan yo **ka remake l**.

### 2. Li pi bon marche pou divize yon gwo rechaj

| Estrateji | Frè total |
|---|---|
| 1 × 200 $ | 10,00 $ |
| 2 × 100 $ | 5,58 $ |
| 1 × 500 $ | 25,00 $ |
| 5 × 100 $ | 13,95 $ |

Yon kliyan ki fè 5 rechaj de 100 $ olye 1 de 500 $ **ekonomize 11,05 $**.
Sa se yon arbitraj reyèl — atann ou ke kèk kliyan pral fè l.

**Si w vle fèmen sa**, de opsyon:

```sql
-- Opsyon A: yon plafon sou palye fiks la (egzanp min 5 % apre 55,80 $)
--   Pwen ekilib la se 55,80 $ — se la 5 % egal 2,79 $.
UPDATE fee_rule_tiers SET max_cents = 5580
 WHERE rule_key = 'card_reload_tokenized' AND min_cents = 100;
INSERT INTO fee_rule_tiers (rule_key, min_cents, max_cents, flat_cents, percent_bps)
VALUES ('card_reload_tokenized', 5581, 50000, 0, 500)
ON CONFLICT (rule_key, min_cents) DO NOTHING;

-- Opsyon B: kite l konsa (pi senp pou kliyan an konprann)
```

Mwen **kite pri a egzakteman jan w mande l** — se yon desizyon biznis, pa yon
desizyon teknik. Men m vle w konnen chif yo anvan w lanse l.

### 3. Bòn nan: 100,01 $ epi pa 101 $

Ou te di « 101 à 500 ». Mwen mete dezyèm palye a kòmanse a **100,01 $** —
sinon yon rechaj de 100,50 $ pa ta antre nan **okenn** palye epi li ta echwe
ak yon erè. Si w vle vre yon twou ant 100 $ ak 101 $, chanje `min_cents`
la a `10100`.

---

## Sekou si DB a tonbe

`fees.config.ts` **rete** — men **sèlman kòm sekou ijans**. Si Supabase pa
reponn, nou pito aplike ansyen frè a pase nou pa aplike okenn (sa ta lakòz pèt
lajan). `RULE_FALLBACK` nan `fee.service.ts` gen egzakteman menm valè ak DB a.

Si yon règ manke nan DB a (migration poko pase), `loadRules()` konplete l
otomatikman ak valè sekou a — donk deplwaman an pa janm kraze.

---

## ⚠️ Sa ki rete pou fè

**`cardFees.service.ts`** gen deja pwòp tab li (`card_fees`, migration 010) —
li deja DB-driven, donk mwen pa touche l. Men sa fè **twa** tab frè kounye a :
`payment_fees`, `card_fees`, `fee_rules`. Pi devan, fizyone `card_fees` nan
`fee_rules` ta senplifye bagay yo — men mwen pa fè l kounye a paske w ap
soumèt app la, epi sa ta yon migrasyon ki riske.

**Frè txn kat yo** (`card_txn_success` / `card_txn_declined`) : règ yo nan DB
kounye a, men verifye ke `cardTxnGuard.service.ts` aplike yo vre sou chak
webhook Maplerad. Mwen pa t ka teste sa san yon vrè tranzaksyon kat.

---

## Kijan pou teste

```sql
-- 1. Gade valè aktyèl yo
SELECT rule_key, label, flat_cents/100.0 AS fiks, percent_bps/100.0 AS pct
  FROM fee_rules ORDER BY rule_key;

-- 2. Apre yon transfè P2P, verifye frè a anrejistre
SELECT txn_id, type, gross_amount, fee_amount, fee_label, net_amount
  FROM transactions_ledger ORDER BY created_at DESC LIMIT 5;
```

`fee_label` la **pa dwe** vid. Si li vid, tranzaksyon an te fèt anvan migration
036 la — sa nòmal pou ansyen done yo.
