// ============================================================
// Routes Cron — deklanche travay pwograme depi yon sèvis deyò
// ============================================================
// ✅ NOUVO v105 — POUKISA WOUT SA A EGZISTE:
//
// Sou Render (plan gratis/estanda), sèvis la DÒMI apre inaktivite. Yon
// `setTimeout(... jouk 12:00 UTC)` PA GEN GARANTI li kouri: si sèvis la
// dòmi a 11:00, minitè a mouri avè l. Sa afekte DEJA `subscription.cron.ts`
// (frè abònman!) — se pa yon pwoblèm nouvo, men li vin pi vizib ak bonjou
// chak maten an.
//
// Solisyon fyab: yon sèvis deyò rele wout sa a chak jou —
//   • Render Cron Job (sèvis apa, peye)
//   • cron-job.org (gratis)
//   • GitHub Actions (`schedule:`)
//
// Egzanp:
//   curl -X POST https://<backend>/api/cron/morning \
//        -H "x-cron-secret: $CRON_SECRET"
//
// ⚠️ Wout la PWOTEJE ak `CRON_SECRET`. Si varyab la pa defini, wout la
// REFIZE tout apèl (403) — nou PA kite yon wout ki ka voye push bay tout
// itilizatè yo louvri a nenpòt moun sou entènèt la.
import { Router, Request, Response } from "express";
import { runMorningGreeting } from "../cron/morningGreeting.cron";
import { logger } from "../utils/logger";

const router = Router();

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;                       // pa konfigire → fèmen
  const given = req.headers["x-cron-secret"];
  return typeof given === "string" && given === secret;
}

// ── POST /api/cron/morning ───────────────────────────────────
router.post("/morning", async (req: Request, res: Response) => {
  if (!authorized(req)) {
    logger.warn("[CRON] apèl refize (secret pa bon oswa pa konfigire)");
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  try {
    const result = await runMorningGreeting();
    res.json({ success: true, ...result });
  } catch (e: any) {
    logger.error("[CRON] /morning echwe", { message: e?.message });
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/cron/subscriptions ─────────────────────────────
router.post("/subscriptions", async (req: Request, res: Response) => {
  if (!authorized(req)) { res.status(403).json({ error: "Forbidden" }); return; }
  try {
    const { runDailySubscriptionCron } = await import("../cron/subscription.cron");
    await runDailySubscriptionCron();
    res.json({ success: true });
  } catch (e: any) {
    logger.error("[CRON] /subscriptions echwe", { message: e?.message });
    res.status(500).json({ error: e.message });
  }
});

export default router;
