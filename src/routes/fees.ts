// ============================================================
// GET /api/fees — Frais depo/retrè depuis Supabase
// Toujou fresh — si admin chanje DB, frontend mete ajou
// Cache 60s pou pa surcharger DB
// ============================================================
import { Router, Request, Response } from "express";
import { getSupabase } from "../db/supabase";
import { logger } from "../utils/logger";
import { FeeRules } from "../services/fee.service";

const router = Router();

// Cache simple en mémoire (60 secondes)
let cache: { data: any; expiresAt: number } | null = null;
const CACHE_TTL = 60 * 1000; // 60s

// ── GET /api/fees ─────────────────────────────────────────────
// Retourne tous les frais indexés par method_id
router.get("/", async (_req: Request, res: Response) => {
  try {
    // Servir depuis cache si encore valide
    if (cache && Date.now() < cache.expiresAt) {
      res.json({ success: true, data: cache.data, cached: true });
      return;
    }

    const sb = getSupabase();
    const { data, error } = await sb
      .from("payment_fees")
      .select("*")
      .eq("is_active", true)
      .order("method_id");

    if (error) throw new Error(error.message);

    // Indexer par method_id pour accès O(1) depuis frontend
    const indexed: Record<string, any> = {};
    for (const row of data || []) {
      indexed[row.method_id] = {
        methodId:        row.method_id,
        methodName:      row.method_name,
        currency:        row.currency,
        provider:        row.provider,
        // Dépôt
        depositFlatUsd:  parseFloat(row.deposit_flat_usd  || 0),
        depositPct:      parseFloat(row.deposit_pct        || 0),
        depositMinUsd:   parseFloat(row.deposit_min_usd   || 0),
        depositMaxUsd:   parseFloat(row.deposit_max_usd   || 0),
        depositTime:     row.deposit_time || "Instantané",
        // Retrait
        withdrawFlatUsd: parseFloat(row.withdraw_flat_usd || 0),
        withdrawPct:     parseFloat(row.withdraw_pct       || 0),
        withdrawMinUsd:  parseFloat(row.withdraw_min_usd  || 1),
        withdrawMaxUsd:  parseFloat(row.withdraw_max_usd  || 0),
        withdrawTime:    row.withdraw_time || "1-24h",
      };
    }

    // Mettre en cache
    cache = { data: indexed, expiresAt: Date.now() + CACHE_TTL };

    logger.info("Fees fetched from DB", { count: data?.length });
    res.json({ success: true, data: indexed, cached: false });
  } catch (e: any) {
    logger.error("Erreur fetch fees", { error: e.message });
    // Fallback si DB down → retourner valeurs par défaut hardcodées
    res.status(500).json({
      success: false,
      error:   e.message,
      data:    getDefaultFees(),  // fallback
    });
  }
});

// ── GET /api/fees/:methodId ───────────────────────────────────
// Un seul method fee
// ✅ v66 — TOUT FRÈ YO (fee_rules): P2P, kat, kont bankè, penalite…
// ⚠️ Wout sa a DWE deklare AVAN `/:methodId`, sinon Express ta konprann
// "rules" kòm yon `methodId` epi li ta retounen 404.
router.get("/rules", async (_req: Request, res: Response) => {
  try {
    const rules = await FeeRules.all();
    res.json({
      success: true,
      data: rules.map((r) => ({
        key:        r.ruleKey,
        label:      r.label,
        flatUsd:    r.flatCents / 100,
        percent:    r.percentBps / 100,
        minUsd:     r.minCents / 100,
        maxUsd:     r.maxCents > 0 ? r.maxCents / 100 : null,
      })),
    });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.get("/:methodId", async (req: Request, res: Response) => {
  const { methodId } = req.params;
  try {
    const sb = getSupabase();
    const { data, error } = await sb
      .from("payment_fees")
      .select("*")
      .eq("method_id", methodId)
      .eq("is_active", true)
      .single();

    if (error || !data) {
      res.status(404).json({ success: false, error: "Method fee not found" });
      return;
    }

    res.json({
      success: true,
      data: {
        methodId:        data.method_id,
        methodName:      data.method_name,
        currency:        data.currency,
        provider:        data.provider,
        depositFlatUsd:  parseFloat(data.deposit_flat_usd  || 0),
        depositPct:      parseFloat(data.deposit_pct        || 0),
        depositMinUsd:   parseFloat(data.deposit_min_usd   || 0),
        depositMaxUsd:   parseFloat(data.deposit_max_usd   || 0),
        depositTime:     data.deposit_time,
        withdrawFlatUsd: parseFloat(data.withdraw_flat_usd || 0),
        withdrawPct:     parseFloat(data.withdraw_pct       || 0),
        withdrawMinUsd:  parseFloat(data.withdraw_min_usd  || 1),
        withdrawMaxUsd:  parseFloat(data.withdraw_max_usd  || 0),
        withdrawTime:    data.withdraw_time,
      }
    });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── Fallback valeurs par défaut (si DB injoignable) ──────────
function getDefaultFees(): Record<string, any> {
  const defaultDeposit  = { depositFlatUsd: 1.50, depositPct: 5, depositMinUsd: 1, depositMaxUsd: 0, depositTime: "Instantané" };
  const defaultWithdraw = { withdrawFlatUsd: 1.00, withdrawPct: 5, withdrawMinUsd: 1, withdrawMaxUsd: 0, withdrawTime: "1-24h" };
  const methods = [
    "moncash","natcash","kashpaw",
    "ngn_bank","ngn_card","ngn_pwb",
    "mpesa_ke","airtel_ke","mtn_gh","airtel_gh","vodafone_gh",
    "orange_cm","mtn_cm","orange_ci","mtn_ci",
    "vodafone_eg","orange_eg","etisalat_eg",
    "vodacom_tz","tigo_tz","airtel_tz",
    "eft_za","bank_usd","safaricom_ke",
  ];
  return Object.fromEntries(methods.map(id => [id, {
    methodId: id, ...defaultDeposit, ...defaultWithdraw,
  }]));
}

// Invalider cache (appelé si admin met à jour les frais)
export function invalidateFeesCache() { cache = null; }

export default router;
