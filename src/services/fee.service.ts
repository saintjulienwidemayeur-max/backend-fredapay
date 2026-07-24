// ============================================================
// FeeService — Freda Pay LLC
// Li frè yo depi Supabase (payment_fees table)
// Cache 5 minit pou evite twòp DB requests
// ============================================================

import { getSupabase } from "../db/supabase";
import { logger }       from "../utils/logger";

export interface PaymentFee {
  methodId:       string;
  methodName:     string;
  currency:       string;
  provider:       string;
  depositFlatUsd: number;   // ex: 1.50
  depositPct:     number;   // ex: 5.00 (= 5%)
  depositMinUsd:  number;
  depositMaxUsd:  number;   // 0 = illimité
  withdrawFlatUsd: number;
  withdrawPct:    number;
  withdrawMinUsd: number;
  withdrawMaxUsd: number;
  depositTime:    string;
  withdrawTime:   string;
  isActive:       boolean;
}

// Cache interne — evite DB call chak fwa
let _cache: Map<string, PaymentFee> | null = null;
let _cacheTs = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minit

async function loadAll(): Promise<Map<string, PaymentFee>> {
  const now = Date.now();
  if (_cache && (now - _cacheTs) < CACHE_TTL) return _cache;

  const { data, error } = await getSupabase()
    .from("payment_fees")
    .select("*")
    .eq("is_active", true);

  if (error) {
    logger.error("FeeService: Erreur lecture payment_fees", { error: error.message });
    // Retourner cache expiré si dispo, sinon fallback hardcodé
    if (_cache) return _cache;
    return buildFallbackCache();
  }

  const map = new Map<string, PaymentFee>();
  for (const row of (data || [])) {
    map.set(row.method_id, {
      methodId:        row.method_id,
      methodName:      row.method_name,
      currency:        row.currency,
      provider:        row.provider,
      depositFlatUsd:  parseFloat(row.deposit_flat_usd  || 0),
      depositPct:      parseFloat(row.deposit_pct       || 0),
      depositMinUsd:   parseFloat(row.deposit_min_usd   || 0),
      depositMaxUsd:   parseFloat(row.deposit_max_usd   || 0),
      withdrawFlatUsd: parseFloat(row.withdraw_flat_usd || 0),
      withdrawPct:     parseFloat(row.withdraw_pct      || 0),
      withdrawMinUsd:  parseFloat(row.withdraw_min_usd  || 0),
      withdrawMaxUsd:  parseFloat(row.withdraw_max_usd  || 0),
      depositTime:     row.deposit_time  || "Instantané",
      withdrawTime:    row.withdraw_time || "1-24h",
      isActive:        row.is_active,
    });
  }

  _cache   = map;
  _cacheTs = now;
  logger.info(`FeeService: ${map.size} frais chargés depuis Supabase`);
  return map;
}

// Fallback si DB pa disponib — frè par défaut selon metòd
function buildFallbackCache(): Map<string, PaymentFee> {
  // Règ frè depo:
  // • MonCash + NatCash → $1.00 + 5%
  // • Tout lòt metòd    → $1.00 + 3.5%
  const PAYM_HTG: Omit<PaymentFee, "methodId" | "methodName" | "currency" | "provider"> = {
    depositFlatUsd: 1.00, depositPct: 5.00, depositMinUsd: 1,  depositMaxUsd: 0,
    withdrawFlatUsd: 1.00, withdrawPct: 5.00, withdrawMinUsd: 1, withdrawMaxUsd: 0,
    depositTime: "Instantané", withdrawTime: "1-24h", isActive: true,
  };
  const DEFAULT_MOMO: Omit<PaymentFee, "methodId" | "methodName" | "currency" | "provider"> = {
    depositFlatUsd: 1.00, depositPct: 3.50, depositMinUsd: 1,  depositMaxUsd: 0,
    withdrawFlatUsd: 1.00, withdrawPct: 3.50, withdrawMinUsd: 1, withdrawMaxUsd: 0,
    depositTime: "Instantané", withdrawTime: "1-24h", isActive: true,
  };

  const methods: Array<[string, string, string, string, typeof PAYM_HTG]> = [
    // [methodId, methodName, currency, provider, fees]
    ["moncash",    "MonCash",            "HTG", "paym",    PAYM_HTG],
    ["natcash",    "NatCash",            "HTG", "paym",    PAYM_HTG],
    ["kashpaw",    "KashPaw",            "HTG", "paym",    DEFAULT_MOMO],
    ["ngn_bank",   "Bank Transfer NGN",  "NGN", "maplerad", DEFAULT_MOMO],
    ["mpesa_ke",   "M-PESA",             "KES", "maplerad", DEFAULT_MOMO],
    ["airtel_ke",  "Airtel Kenya",       "KES", "maplerad", DEFAULT_MOMO],
    ["mtn_cm",     "MTN Cameroun",       "XAF", "maplerad", DEFAULT_MOMO],
    ["orange_cm",  "Orange Cameroun",    "XAF", "maplerad", DEFAULT_MOMO],
    ["mtn_ci",     "MTN Côte d'Ivoire",  "XOF", "maplerad", DEFAULT_MOMO],
    ["orange_ci",  "Orange CI",          "XOF", "maplerad", DEFAULT_MOMO],
    ["moov_ci",    "Moov Money CI",      "XOF", "maplerad", DEFAULT_MOMO],
    ["mtn_bj",     "MTN Bénin",          "XOF", "maplerad", DEFAULT_MOMO],
    ["orange_bj",  "Orange Bénin",       "XOF", "maplerad", DEFAULT_MOMO],
    ["moov_bj",    "Moov Money Bénin",   "XOF", "maplerad", DEFAULT_MOMO],
    ["celtis_bj",  "Celtis Bénin",       "XOF", "maplerad", DEFAULT_MOMO],
    ["mtn_ug",     "MTN Uganda",         "UGX", "maplerad", DEFAULT_MOMO],
    ["airtel_ug",  "Airtel Uganda",      "UGX", "maplerad", DEFAULT_MOMO],
    ["tigo_tz",    "Tigo Pesa",          "TZS", "maplerad", DEFAULT_MOMO],
    ["airtel_tz",  "Airtel Tanzania",    "TZS", "maplerad", DEFAULT_MOMO],
    ["halo_tz",    "HaloPesa",           "TZS", "maplerad", DEFAULT_MOMO],
    // Fallback global
    ["_default",   "Défaut",             "USD", "maplerad", DEFAULT_MOMO],
  ];

  const map = new Map<string, PaymentFee>();
  for (const [id, name, cur, prov, fees] of methods) {
    map.set(id, { methodId: id, methodName: name, currency: cur, provider: prov, ...fees });
  }
  return map;
}

export const FeeService = {

  /** Invalide cache (apré update admin) */
  invalidateCache() {
    _cache   = null;
    _cacheTs = 0;
    logger.info("FeeService: Cache invalidé");
  },

  /** Retounen tout frè kòm array (pou API /api/fees) */
  async getAll(): Promise<PaymentFee[]> {
    const map = await loadAll();
    return Array.from(map.values());
  },

  /** Retounen frè pou yon metòd spesifik */
  async getForMethod(methodId: string): Promise<PaymentFee | null> {
    const map = await loadAll();
    return map.get(methodId) || map.get("_default") || null;
  },

  /** Kalkile frè depo pou yon montant (en cents) + methodId */
  async calcDepositFee(grossCents: number, methodId: string = "_default"): Promise<{ fee: number; net: number }> {
    const f = await this.getForMethod(methodId);
    if (!f) {
      // Fallback: $1.50 + 5%
      const fee = 150 + Math.round(grossCents * 0.05);
      return { fee, net: grossCents - fee };
    }
    const flatCents = Math.round(f.depositFlatUsd * 100);
    const pctCents  = Math.round(grossCents * f.depositPct / 100);
    const fee       = flatCents + pctCents;
    return { fee, net: Math.max(0, grossCents - fee) };
  },

  /** Kalkile frè retrè pou yon montant (en cents) + methodId */
  async calcWithdrawFee(amountCents: number, methodId: string = "_default"): Promise<number> {
    const f = await this.getForMethod(methodId);
    if (!f) {
      return Math.max(100, Math.round(amountCents * 0.05));
    }
    const flatCents = Math.round(f.withdrawFlatUsd * 100);
    const pctCents  = Math.round(amountCents * f.withdrawPct / 100);
    const minCents  = Math.round(f.withdrawMinUsd * 100);
    return Math.max(minCents, flatCents + pctCents);
  },

  /** Valide montant depo vs min/max pou yon metòd */
  async validateDepositAmount(amountUsd: number, methodId: string): Promise<string | null> {
    const f = await this.getForMethod(methodId);
    if (!f) return null;
    if (f.depositMinUsd > 0 && amountUsd < f.depositMinUsd) {
      return `Montant minimum: $${f.depositMinUsd.toFixed(2)}`;
    }
    if (f.depositMaxUsd > 0 && amountUsd > f.depositMaxUsd) {
      return `Montant maximum: $${f.depositMaxUsd.toFixed(2)}`;
    }
    return null;
  },

  /** Valide montant retrè vs min/max pou yon metòd */
  async validateWithdrawAmount(amountUsd: number, methodId: string): Promise<string | null> {
    const f = await this.getForMethod(methodId);
    if (!f) return null;
    if (f.withdrawMinUsd > 0 && amountUsd < f.withdrawMinUsd) {
      return `Montant minimum: $${f.withdrawMinUsd.toFixed(2)}`;
    }
    if (f.withdrawMaxUsd > 0 && amountUsd > f.withdrawMaxUsd) {
      return `Montant maximum: $${f.withdrawMaxUsd.toFixed(2)}`;
    }
    return null;
  },
};

// ============================================================
// FEE RULES — TOUT LÒT FRÈ YO (v66)
// ============================================================
// Anvan v66, frè sa yo te AN DUR nan `fees.config.ts`: transfè P2P,
// emisyon kat, txn kat reyisi/refize, kont bankè, reyaktivasyon tadi.
// Pou chanje youn ou te oblije redeplwaye backend la.
//
// Kounye a yo tout nan tab `fee_rules` (migration 036). Chanje yon valè
// nan Supabase → li aktif nan 5 minit, san redeplwaman.
//
// ⚠️ `fees.config.ts` RETE kòm sekou ijans SÈLMAN — si DB a tonbe, nou
//    pito aplike ansyen frè a pase nou pa aplike okenn.

export type FeeRuleKey =
  | "p2p_transfer"
  | "wallet_deposit"
  | "wallet_withdrawal"
  | "card_creation"
  | "card_creation_token"
  | "card_reload"
  | "card_txn_success"
  | "card_txn_declined"
  | "bank_account_open"
  | "late_reactivation"
  | "nsf_penalty";

export interface FeeRule {
  ruleKey:     string;
  label:       string;
  flatCents:   number;
  percentBps:  number;
  minCents:    number;
  maxCents:    number;   // 0 = pa gen plafon
  isActive:    boolean;
}

/** Sekou ijans — MENM valè ak `fees.config.ts`. Itilize SÈLMAN si DB tonbe. */
const RULE_FALLBACK: Record<FeeRuleKey, FeeRule> = {
  p2p_transfer:        { ruleKey: "p2p_transfer",        label: "Frais transfert (0,5 %)",       flatCents: 0,    percentBps: 50,  minCents: 1,   maxCents: 0, isActive: true },
  wallet_deposit:      { ruleKey: "wallet_deposit",      label: "Frais dépôt (1,50 $ + 5 %)",    flatCents: 150,  percentBps: 500, minCents: 0,   maxCents: 0, isActive: true },
  wallet_withdrawal:   { ruleKey: "wallet_withdrawal",   label: "Frais retrait (5 %, min 1 $)",  flatCents: 0,    percentBps: 500, minCents: 100, maxCents: 0, isActive: true },
  card_creation:       { ruleKey: "card_creation",       label: "Émission carte",                flatCents: 520,  percentBps: 0,   minCents: 0,   maxCents: 0, isActive: true },
  card_creation_token: { ruleKey: "card_creation_token", label: "Émission carte tokenisée",      flatCents: 1200, percentBps: 0,   minCents: 0,   maxCents: 0, isActive: true },
  card_reload:         { ruleKey: "card_reload",         label: "Frais recharge carte",          flatCents: 0,    percentBps: 200, minCents: 50,  maxCents: 0, isActive: true },
  card_txn_success:    { ruleKey: "card_txn_success",    label: "Frais transaction carte",       flatCents: 50,   percentBps: 0,   minCents: 0,   maxCents: 0, isActive: true },
  card_txn_declined:   { ruleKey: "card_txn_declined",   label: "Frais transaction refusée",     flatCents: 40,   percentBps: 0,   minCents: 0,   maxCents: 0, isActive: true },
  bank_account_open:   { ruleKey: "bank_account_open",   label: "Ouverture compte bancaire US",  flatCents: 1200, percentBps: 0,   minCents: 0,   maxCents: 0, isActive: true },
  late_reactivation:   { ruleKey: "late_reactivation",   label: "Réactivation tardive",          flatCents: 500,  percentBps: 0,   minCents: 0,   maxCents: 0, isActive: true },
  nsf_penalty:         { ruleKey: "nsf_penalty",         label: "Pénalité solde insuffisant",    flatCents: 500,  percentBps: 0,   minCents: 0,   maxCents: 0, isActive: true },
};

let _rules: Map<string, FeeRule> | null = null;
let _rulesTs = 0;

async function loadRules(): Promise<Map<string, FeeRule>> {
  const now = Date.now();
  if (_rules && (now - _rulesTs) < CACHE_TTL) return _rules;

  const { data, error } = await getSupabase()
    .from("fee_rules")
    .select("*")
    .eq("is_active", true);

  if (error) {
    logger.error("FeeService: erreur lecture fee_rules — utilisation du secours", { error: error.message });
    if (_rules) return _rules;
    return new Map(Object.entries(RULE_FALLBACK));
  }

  const map = new Map<string, FeeRule>();
  for (const row of (data || [])) {
    map.set(row.rule_key, {
      ruleKey:    row.rule_key,
      label:      row.label,
      flatCents:  Number(row.flat_cents  || 0),
      percentBps: Number(row.percent_bps || 0),
      minCents:   Number(row.min_cents   || 0),
      maxCents:   Number(row.max_cents   || 0),
      isActive:   row.is_active !== false,
    });
  }

  // Si yon règ manke nan DB a (migration poko pase), nou konplete l.
  for (const [k, v] of Object.entries(RULE_FALLBACK)) {
    if (!map.has(k)) map.set(k, v);
  }

  _rules   = map;
  _rulesTs = now;
  logger.info(`FeeService: ${map.size} règles de frais chargées depuis Supabase`);
  return map;
}

export const FeeRules = {
  /** Jwenn yon règ frè. Pa janm retounen `null` — sekou a garanti youn. */
  async get(key: FeeRuleKey): Promise<FeeRule> {
    const rules = await loadRules();
    return rules.get(key) || RULE_FALLBACK[key];
  },

  /** Tout règ yo — pou paj "Frais" nan app la ak panèl admin lan. */
  async all(): Promise<FeeRule[]> {
    const rules = await loadRules();
    return [...rules.values()].sort((a, b) => a.ruleKey.localeCompare(b.ruleKey));
  },

  /**
   * Kalkile frè a pou yon montan.
   * Fòmil: `flat + (montan × bps / 10000)`, apre sa klipe ant min ak max.
   * Retounen tou `label` la pou n ka anrejistre l sou tranzaksyon an.
   */
  async calc(key: FeeRuleKey, amountCents = 0): Promise<{ fee: number; label: string; rule: FeeRule }> {
    const rule = await this.get(key);
    if (!rule.isActive) return { fee: 0, label: rule.label, rule };

    let fee = rule.flatCents + Math.round(amountCents * rule.percentBps / 10000);
    if (rule.minCents > 0) fee = Math.max(fee, rule.minCents);
    if (rule.maxCents > 0) fee = Math.min(fee, rule.maxCents);

    return { fee: Math.max(0, fee), label: rule.label, rule };
  },

  /** Vide kachèt la — rele l apre yon admin chanje yon frè. */
  invalidate(): void { _rules = null; _rulesTs = 0; },
};

// ============================================================
// Tèks frè yo — pou detay tranzaksyon an sou telefòn nan (v66)
// ============================================================
// Anvan, detay tranzaksyon an te montre yon montan frè san esplikasyon.
// Kounye a nou konstwi yon tèks lizib depi valè DB yo, epi nou anrejistre
// l sou tranzaksyon an — konsa yon resi ki gen 6 mwa toujou montre frè ki
// te aplike LÈ SA A, menm si w chanje tarif la jodi a.

function describe(flatUsd: number, pct: number, minUsd: number): string {
  const parts: string[] = [];
  if (flatUsd > 0) parts.push(`${flatUsd.toFixed(2).replace(".", ",")} $`);
  if (pct > 0)     parts.push(`${String(pct).replace(/\.?0+$/, "").replace(".", ",")} %`);
  if (!parts.length) return "Aucuns frais";
  let txt = `Frais (${parts.join(" + ")})`;
  if (minUsd > 0) txt += `, min ${minUsd.toFixed(2).replace(".", ",")} $`;
  return txt;
}

/** Tèks frè depo pou yon metòd — soti nan `payment_fees`. */
export async function describeDepositFee(methodId: string): Promise<string> {
  const f = await FeeService.getForMethod(methodId);
  if (!f) return (await FeeRules.get("wallet_deposit")).label;
  return describe(f.depositFlatUsd, f.depositPct, f.depositMinUsd);
}

/** Tèks frè retrè pou yon metòd — soti nan `payment_fees`. */
export async function describeWithdrawFee(methodId: string): Promise<string> {
  const f = await FeeService.getForMethod(methodId);
  if (!f) return (await FeeRules.get("wallet_withdrawal")).label;
  return describe(f.withdrawFlatUsd, f.withdrawPct, f.withdrawMinUsd);
}

// ============================================================
// FRÈ PA PALYE — tiers (v66.1)
// ============================================================
// Kèk frè chanje selon montan an. Egzanp rechaj kat tokenize:
//     1 $ – 100 $  → 2,79 $ fiks
//   100 $ – 500 $  → 5 %
// Yon sèl fòmil `flat + pct` pa ka eksprime sa. Donk yon règ ka gen
// plizyè palye nan tab `fee_rule_tiers` (migration 037).
//
// Règ la: si yon `rule_key` gen palye, palye yo PRAN PRIYORITE sou
// fòmil senp `fee_rules` la.

export interface FeeTier {
  minCents:   number;
  maxCents:   number;   // 0 = pa gen limit anwo
  flatCents:  number;
  percentBps: number;
}

let _tiers: Map<string, FeeTier[]> | null = null;
let _tiersTs = 0;

/** Sekou si DB tonbe — MENM valè ak migration 037. */
const TIER_FALLBACK: Record<string, FeeTier[]> = {
  card_reload_tokenized: [
    { minCents: 100,   maxCents: 10000, flatCents: 279, percentBps: 0   },
    { minCents: 10001, maxCents: 50000, flatCents: 0,   percentBps: 500 },
  ],
  card_reload_standard: [
    { minCents: 100,   maxCents: 10000, flatCents: 120, percentBps: 0   },
    { minCents: 10001, maxCents: 50000, flatCents: 0,   percentBps: 250 },
  ],
};

async function loadTiers(): Promise<Map<string, FeeTier[]>> {
  const now = Date.now();
  if (_tiers && (now - _tiersTs) < CACHE_TTL) return _tiers;

  const { data, error } = await getSupabase()
    .from("fee_rule_tiers")
    .select("*")
    .eq("is_active", true)
    .order("min_cents", { ascending: true });

  if (error) {
    logger.error("FeeService: erreur lecture fee_rule_tiers — utilisation du secours", { error: error.message });
    if (_tiers) return _tiers;
    return new Map(Object.entries(TIER_FALLBACK));
  }

  const map = new Map<string, FeeTier[]>();
  for (const row of (data || [])) {
    const list = map.get(row.rule_key) || [];
    list.push({
      minCents:   Number(row.min_cents   || 0),
      maxCents:   Number(row.max_cents   || 0),
      flatCents:  Number(row.flat_cents  || 0),
      percentBps: Number(row.percent_bps || 0),
    });
    map.set(row.rule_key, list);
  }

  // Konplete ak sekou a pou nenpòt règ ki manke (migration poko pase).
  for (const [k, v] of Object.entries(TIER_FALLBACK)) {
    if (!map.has(k)) map.set(k, v);
  }

  _tiers   = map;
  _tiersTs = now;
  logger.info(`FeeService: ${map.size} grilles de paliers chargées depuis Supabase`);
  return map;
}

/** Erè teknik lè montan an pa antre nan okenn palye. */
export class FeeTierOutOfRangeError extends Error {
  constructor(public ruleKey: string, public amountCents: number, public minCents: number, public maxCents: number) {
    super(`FEE_TIER_OUT_OF_RANGE: ${ruleKey} — ${amountCents}¢ deyò rang ${minCents}¢–${maxCents}¢`);
    this.name = "FeeTierOutOfRangeError";
  }
}

export const FeeTiers = {
  /** Palye yo pou yon règ (vid si règ la pa gen palye). */
  async forRule(ruleKey: string): Promise<FeeTier[]> {
    const all = await loadTiers();
    return all.get(ruleKey) || [];
  },

  /**
   * Kalkile frè a pa palye.
   * Leve `FeeTierOutOfRangeError` si montan an deyò tout palye yo —
   * konsa wout la ka retounen yon mesaj klè bay itilizatè a olye yon
   * frè zewo an silans (ki ta fè Freda Pay pèdi lajan).
   */
  async calc(ruleKey: string, amountCents: number): Promise<{ fee: number; tier: FeeTier; label: string }> {
    const tiers = await this.forRule(ruleKey);
    if (!tiers.length) throw new Error(`NO_TIERS_FOR_RULE: ${ruleKey}`);

    const tier = tiers.find((t) =>
      amountCents >= t.minCents && (t.maxCents === 0 || amountCents <= t.maxCents)
    );

    if (!tier) {
      const min = Math.min(...tiers.map((t) => t.minCents));
      const withoutCap = tiers.some((t) => t.maxCents === 0);
      const max = withoutCap ? 0 : Math.max(...tiers.map((t) => t.maxCents));
      throw new FeeTierOutOfRangeError(ruleKey, amountCents, min, max);
    }

    const fee = Math.max(0, tier.flatCents + Math.round(amountCents * tier.percentBps / 10000));

    // Tèks ki parèt nan detay tranzaksyon an — li dekri PALYE ki aplike a,
    // pa tout gri a. Konsa moun nan wè egzakteman poukisa li peye sa.
    const rule  = await FeeRules.get(ruleKey as FeeRuleKey);
    const parts: string[] = [];
    if (tier.flatCents  > 0) parts.push(`${(tier.flatCents / 100).toFixed(2).replace(".", ",")} $`);
    if (tier.percentBps > 0) parts.push(`${String(tier.percentBps / 100).replace(/\.?0+$/, "").replace(".", ",")} %`);
    const label = parts.length ? `${rule.label} (${parts.join(" + ")})` : rule.label;

    return { fee, tier, label };
  },

  /** Vide kachèt la — rele l apre yon admin chanje yon palye. */
  invalidate(): void { _tiers = null; _tiersTs = 0; },
};
