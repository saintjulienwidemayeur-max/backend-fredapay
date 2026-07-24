// ============================================================
// /api/referrals — pwogram parennaj
// ============================================================
// ⚠️ Wout sa a te MANKE nèt — se poutèt sa app la te di "parennaj pa
// fonksyone". Front lan (ReferralScreen.tsx) rele `GET /dashboard`.
import { Router, Request, Response } from "express";
import { requireAuth } from "../middleware/auth";
import { ReferralService } from "../services/referral.service";
import { logger } from "../utils/logger";

const router = Router();

// ── GET /api/referrals/dashboard ────────────────────────────
router.get("/dashboard", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.userId as string;
    const data = await ReferralService.getDashboard(userId);
    res.json({ success: true, data });
  } catch (e: any) {
    logger.warn("referrals/dashboard echwe", { error: e.message });
    res.status(500).json({ success: false, error: "Erreur chargement parrainage" });
  }
});

export default router;
