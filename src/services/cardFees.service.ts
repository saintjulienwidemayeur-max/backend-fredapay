// ============================================================
// CardFeesService — Frè kat/wallet modifyab pa admin (table card_fees)
// Ranplase valè ki te hardcode nan config/fees.config.ts
// ============================================================

import { getSupabase } from "../db/supabase";
import { logger } from "../utils/logger";
import { FeeTiers, FeeTierOutOfRangeError } from "./fee.service";
import { FEES } from "../config/fees.config";

export interface CardFeeRow {
  id: string;
  key: string;
  label: string;
  amountCents?: number;
  percentBps?: number;
  minCents?: number;
  maxCents?: number;
  updatedByAdminId?: string;
  updatedAt: string;
}

let cache: Record<string, CardFeeRow> | null = null;
let cacheAt = 0;
const CACHE_MS = 60_000; // 1 min

const toRow = (r: Record<string, unknown>): CardFeeRow => ({
  id: r.id as string,
  key: r.key as string,
  label: r.label as string,
  amountCents: r.amount_cents as number | undefined,
  percentBps:  r.percent_bps  as number | undefined,
  minCents:    r.min_cents    as number | undefined,
  maxCents:    r.max_cents    as number | undefined,
  updatedByAdminId: r.updated_by_admin_id as string | undefined,
  updatedAt: r.updated_at as string,
});

async function loadAll(force = false): Promise<Record<string, CardFeeRow>> {
  if (!force && cache && Date.now() - cacheAt < CACHE_MS) return cache;
  try {
    const { data, error } = await getSupabase().from("card_fees").select("*");
    if (error) throw new Error(error.message);
    const map: Record<string, CardFeeRow> = {};
    for (const row of (data || []) as Record<string, unknown>[]) {
      const r = toRow(row);
      map[r.key] = r;
    }
    cache = map;
    cacheAt = Date.now();
    return map;
  } catch (e: any) {
    logger.error("CardFeesService: lecture card_fees échouée, fallback hardcodé", { error: e.message });
    return cache || {};
  }
}

export const CardFeesService = {
  /** Tout retire cache — apèl apre yon modifikasyon admin */
  invalidate() { cache = null; },

  async listAll(): Promise<CardFeeRow[]> {
    const map = await loadAll(true);
    return Object.values(map).sort((a, b) => a.key.localeCompare(b.key));
  },

  async update(key: string, adminId: string, patch: Partial<Pick<CardFeeRow, "amountCents"|"percentBps"|"minCents"|"maxCents"|"label">>): Promise<CardFeeRow> {
    const updates: Record<string, unknown> = { updated_by_admin_id: adminId, updated_at: new Date().toISOString() };
    if (patch.amountCents !== undefined) updates.amount_cents = patch.amountCents;
    if (patch.percentBps  !== undefined) updates.percent_bps  = patch.percentBps;
    if (patch.minCents    !== undefined) updates.min_cents    = patch.minCents;
    if (patch.maxCents    !== undefined) updates.max_cents    = patch.maxCents;
    if (patch.label       !== undefined) updates.label        = patch.label;

    const { data, error } = await getSupabase().from("card_fees")
      .update(updates).eq("key", key).select().single();
    if (error || !data) throw new Error(error?.message || "Frè introuvable");
    this.invalidate();
    return toRow(data as Record<string, unknown>);
  },

  /** Montan sèk (cents) pou yon kle — fallback sou hardcodé si DB pa gen li */
  async getAmountCents(key: string, fallbackCents: number): Promise<number> {
    const map = await loadAll();
    return map[key]?.amountCents ?? fallbackCents;
  },

  async cardCreationFee(isTokenized: boolean): Promise<number> {
    return this.getAmountCents(
      isTokenized ? "card_creation_tokenized" : "card_creation_debit",
      isTokenized ? 1200 : FEES.cardCreation.cents
    );
  },

  /**
   * Frè rechaj yon kat.
   *
   * ✅ v66.1 — PRI PA PALYE, DIFERAN POU KAT TOKENIZE.
   *   Kat tokenize (Apple/Google Pay):
   *        1 $ – 100 $  → 2,79 $ fiks
   *      100 $ – 500 $  → 5 %
   *   Kat debi klasik: MENM pri ak avan (1,20 $ / 2,5 %) — okenn
   *   chanjman pou kliyan ki gen kat klasik.
   *
   * Palye yo soti nan tab `fee_rule_tiers` (migration 037). Pou chanje
   * yon pri: Supabase → `fee_rule_tiers` → Save. Aktif nan 5 min, san
   * redeplwaman.
   *
   * ⚠️ `isTokenized` OBLIGATWA depi v66.1. Si yon apèl bliye l, nou
   * pran pri kat klasik la (pi ba) — donk yon bug ta fè Freda Pay pèdi
   * frè, li pa ta janm fè yon kliyan twò chè.
   */
  async cardReloadFee(amountCents: number, isTokenized = false): Promise<number> {
    const ruleKey = isTokenized ? "card_reload_tokenized" : "card_reload_standard";

    try {
      const { fee } = await FeeTiers.calc(ruleKey, amountCents);
      return fee;
    } catch (e: any) {
      // Montan an deyò tout palye yo → menm erè ak avan, pou wout yo
      // kontinye kaptire l epi bay yon mesaj klè bay itilizatè a.
      if (e instanceof FeeTierOutOfRangeError || String(e.message).includes("FEE_TIER_OUT_OF_RANGE")) {
        throw new Error("CARD_RELOAD_AMOUNT_OUT_OF_RANGE: $1–$500 sèlman");
      }
      throw e;
    }
  },

  /**
   * Tèks frè rechaj la — pou detay tranzaksyon an sou telefòn nan.
   * Egzanp: « Frais recharge carte tokenisée (2,79 $) »
   */
  async cardReloadFeeLabel(amountCents: number, isTokenized = false): Promise<string> {
    const ruleKey = isTokenized ? "card_reload_tokenized" : "card_reload_standard";
    try {
      const { label } = await FeeTiers.calc(ruleKey, amountCents);
      return label;
    } catch {
      return isTokenized ? "Frais recharge carte tokenisée" : "Frais recharge carte";
    }
  },
};
