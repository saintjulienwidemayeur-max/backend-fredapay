// ============================================================
// GET /api/app-status/* — wout PIBLIK (san auth) pou app kliyan an
// pran estati aktyèl la: anons aktif + mòd mentnans.
// ============================================================

import { Router, Request, Response } from "express";
import { db } from "../db/store";

const router = Router();

// ── GET /api/app-status/announcement ────────────────────────────
router.get("/announcement", async (_req: Request, res: Response) => {
  try {
    const active = await db.announcements.getActive();
    if (!active) { res.json({ success: true, data: null }); return; }
    res.json({
      success: true,
      data: {
        id: active.id,
        message: active.message,
        isScrolling: active.is_scrolling,
        tone: active.tone,
      },
    });
  } catch {
    // ✅ Si sa echwe, app la kontinye fonksyone nòmalman — yon anons ki pa
    // parèt pa dwe janm bloke oswa kraze eksperyans kliyan an.
    res.json({ success: true, data: null });
  }
});

// ── GET /api/app-status/maintenance ─────────────────────────────
router.get("/maintenance", async (_req: Request, res: Response) => {
  try {
    const setting = await db.appSettings.get("maintenance_mode");
    res.json({ success: true, data: setting || { enabled: false, message: "" } });
  } catch {
    // ✅ Menm rezon — an ka echèk, sipoze app la DISPONIB (pa bloke kliyan
    // yo akoz yon erè teknik nan verifikasyon an limenm).
    res.json({ success: true, data: { enabled: false, message: "" } });
  }
});

// ── GET /api/app-status/currency-rates ──────────────────────────
router.get("/currency-rates", async (_req: Request, res: Response) => {
  try {
    const rates = await db.currencyRates.list() as any[];
    // ✅ Frontend lan mande yon fòm { NGN: 1600, KES: 130, ... } senp pou l
    // ka ranplase KORA_CURRENCIES.usdRate ki te kode an dir anvan.
    const map: Record<string, number> = {};
    for (const r of rates) map[r.currency] = parseFloat(r.usd_rate);
    res.json({ success: true, data: map });
  } catch {
    res.json({ success: true, data: {} });
  }
});

export default router;
