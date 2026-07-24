// ============================================================
// Routes Users — Gestion du profil
// Base: /api/users
// ============================================================

import { Router, Request, Response, NextFunction } from "express";
import { db } from "../db/store";
import { requireAuth, requireAdmin, requireRole } from "../middleware/auth";
import { Validate } from "../utils/validation";
import { logger } from "../utils/logger";

const router = Router();

// ── POST /api/users/push-token ────────────────────────────────
// ✅ NOUVO: enskri token push Expo pou aparèy sa a — itilize pandan
// lansman app la, ak lè yon itilizatè konekte sou yon nouvo aparèy.
router.post("/push-token", requireAuth, async (req: Request, res: Response) => {
  const { token, platform } = req.body;
  if (!token || typeof token !== "string") {
    res.status(400).json({ error: "Token requis" });
    return;
  }
  await db.pushTokens.register(req.userId!, token, platform);
  res.json({ success: true });
});

// ── DELETE /api/users/push-token ──────────────────────────────
// ✅ Retire token la lè itilizatè a dekonekte (evite voye push bay yon
// moun ki pa konekte ankò sou aparèy sa a).
router.delete("/push-token", requireAuth, async (req: Request, res: Response) => {
  const { token } = req.body;
  if (!token) { res.status(400).json({ error: "Token requis" }); return; }
  await db.pushTokens.unregister(token);
  res.json({ success: true });
});

// ── GET /api/users/profile ────────────────────────────────────
// Profil complet de l'utilisateur connecté
router.get("/profile", requireAuth, async (req: Request, res: Response) => {
  const user = await db.users.findById(req.userId!);
  if (!user) {
    res.status(404).json({ error: "Utilisateur introuvable" });
    return;
  }
  res.json({ success: true, data: db.users.toPublic(user) });
});

// ── PATCH /api/users/profile ──────────────────────────────────
// Mettre à jour le profil
router.patch("/profile", requireAuth, async (req: Request, res: Response) => {
  const allowed = ["firstname", "lastname", "phone", "dialCode", "country", "city", "address", "state", "postalCode", "genre"];
  const updates: Record<string, unknown> = {};
  const errors: Record<string, string> = {};

  for (const key of allowed) {
    if (req.body[key] !== undefined) {
      updates[key] = req.body[key];
    }
  }

  // Validation champs modifiés
  if (updates.firstname) {
    const v = Validate.name(updates.firstname as string, "Prénom");
    if (!v.valid) errors.firstname = v.error!;
  }
  if (updates.lastname) {
    const v = Validate.name(updates.lastname as string, "Nom");
    if (!v.valid) errors.lastname = v.error!;
  }
  if (updates.phone) {
    const v = Validate.phone(updates.phone as string);
    if (!v.valid) errors.phone = v.error!;
  }

  // ✅ FIX: `notifPrefs` pa t janm nan lis "allowed" a — bouton "Notifications"
  // nan Pwofil la te reponn 200 OK san janm sove anyen (wè migration 019).
  // Valide chak kle pou nou pa sove done abitrè nan JSONB la.
  if (req.body.notifPrefs !== undefined) {
    if (typeof req.body.notifPrefs !== "object" || req.body.notifPrefs === null || Array.isArray(req.body.notifPrefs)) {
      errors.notifPrefs = "Format invalide";
    } else {
      const NOTIF_PREF_KEYS = ["transfers", "security", "marketing", "news"] as const;
      const clean: Record<string, boolean> = {};
      for (const key of NOTIF_PREF_KEYS) {
        if (typeof req.body.notifPrefs[key] === "boolean") clean[key] = req.body.notifPrefs[key];
      }
      updates.notifPrefs = clean;
    }
  }

  if (Object.keys(errors).length > 0) {
    res.status(400).json({ error: "Données invalides", fields: errors });
    return;
  }

  const updated = await db.users.update(req.userId!, updates);
  if (!updated) {
    res.status(404).json({ error: "Utilisateur introuvable" });
    return;
  }

  logger.info("Profil mis à jour", { userId: req.userId });
  res.json({ success: true, data: db.users.toPublic(updated) });
});

// ── PATCH /api/users/freddatag ────────────────────────────────
// Changer son FredaTag
router.patch("/freddatag", requireAuth, async (req: Request, res: Response) => {
  const { FredaTag } = req.body;

  const v = Validate.FredaTag(FredaTag);
  if (!v.valid) {
    res.status(400).json({ error: v.error });
    return;
  }

  const clean = FredaTag.startsWith("@") ? FredaTag.slice(1) : FredaTag;

  // Vérifier unicité
  const existing = await db.users.findByFredaTag(clean);
  if (existing && existing.id !== req.userId) {
    res.status(409).json({ error: "Ce FredaTag est déjà utilisé" });
    return;
  }

  const updated = await db.users.update(req.userId!, { FredaTag: clean.toLowerCase() });
  logger.info("FredaTag changé", { userId: req.userId, newTag: clean });
  res.json({ success: true, FredaTag: `@${clean.toLowerCase()}`, data: db.users.toPublic(updated!) });
});

// ── GET /api/users/search ─────────────────────────────────────
router.get("/search", requireAuth, async (req: Request, res: Response) => {
  // Aksepte ?q= oswa ?tag= (frontend itilize ?tag=)
  const raw = ((req.query.q || req.query.tag) as string | undefined)?.trim();

  if (!raw || raw.length < 2) {
    res.status(400).json({ error: "Paramètre trop court (min 2 caractères)" });
    return;
  }

  // Retire @ si présent, lowercase
  const q = raw.startsWith("@") ? raw.slice(1).toLowerCase() : raw.toLowerCase();

  let found = null;

  // 1. Cherche par FredaTag
  found = await db.users.findByFredaTag(q);

  // 2. Si pas trouvé et contient @, cherche par email
  if (!found && raw.includes("@") && !raw.startsWith("@")) {
    found = await db.users.findByEmail(raw.toLowerCase());
  }

  if (!found) {
    res.status(404).json({ error: `Aucun utilisateur trouvé pour "${raw}"` });
    return;
  }

  // Retourner infos publiques + avatarUrl pour afficher la photo
  res.json({
    success: true,
    data: {
      id:        found.id,
      FredaTag:  `@${found.FredaTag}`,
      firstname: found.firstname,
      lastname:  found.lastname,           // nom complet
      avatarUrl: found.avatarUrl || null,  // photo profil depuis Supabase Storage
      status:    found.status,
      kycStatus: found.kycStatus,
    },
  });
});

// ── GET /api/users/by-tag/:tag ────────────────────────────────
// Récupérer un utilisateur par FredaTag
router.get("/by-tag/:tag", requireAuth, async (req: Request, res: Response) => {
  const { tag } = req.params;
  const user = await db.users.findByFredaTag(tag);

  if (!user) {
    res.status(404).json({ error: `Aucun utilisateur avec le tag @${tag}` });
    return;
  }

  res.json({
    success: true,
    data: {
      id: user.id,
      FredaTag: `@${user.FredaTag}`,
      firstname: user.firstname,
      lastname: `${user.lastname.slice(0, 1)}.`,
      kycVerified: user.kycStatus === "approved",
    },
  });
});

// ── GET /api/users/kyc-status ─────────────────────────────────
// Statut KYC de l'utilisateur connecté
router.get("/kyc-status", requireAuth, async (req: Request, res: Response) => {
  const user = await db.users.findById(req.userId!);
  if (!user) {
    res.status(404).json({ error: "Utilisateur introuvable" });
    return;
  }

  res.json({
    success: true,
    kycStatus: user.kycStatus,
    verified: user.kycStatus === "approved",
    accountStatus: user.status,
    canCreateCard: user.kycStatus === "approved" && user.status === "active",
    canTransfer: user.kycStatus === "approved" && user.status === "active",
  });
});

// ═══════════════════════════════════════════════════════════════
// ROUTES ADMIN
// ═══════════════════════════════════════════════════════════════

// ── GET /api/users/admin/list ─────────────────────────────────
router.get("/admin/list", requireAuth, requireAdmin, async (req: Request, res: Response) => {
  const limit = parseInt(String(req.query.limit || "50"));
  const users = await db.users.list(limit);

  const stats = {
    total:    await db.users.count(),
    active:   users.filter(u => u.status === "active").length,
    pending:  users.filter(u => u.status === "pending").length,
    kycApproved: users.filter(u => u.kycStatus === "approved").length,
  };

  res.json({
    success: true,
    stats,
    data: users.map(u => db.users.toPublic(u)),
  });
});

// ── PATCH /api/users/admin/:userId/status ─────────────────────
router.patch("/admin/:userId/status", requireAuth, requireRole("admin", "super_admin", "service_client"), async (req: Request, res: Response) => {
  const { userId } = req.params;
  const { status } = req.body;

  const allowed = ["active", "pending", "suspended", "banned"];
  if (!allowed.includes(status)) {
    res.status(400).json({ error: `Status invalide. Valeurs: ${allowed.join(", ")}` });
    return;
  }

  await db.users.updateStatus(userId, status);
  logger.info("Statut utilisateur modifié par admin", { targetUser: userId, status, admin: req.userId });
  res.json({ success: true, message: `Statut mis à jour: ${status}` });
});

// ── POST /api/users/avatar ─────────────────────────────────────
// Upload photo profil — stocke dans Supabase Storage bucket "avatars"
import multer from "multer";
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

router.post("/avatar", requireAuth, (req: Request, res: Response, next: NextFunction) => {
  upload.single("avatar")(req as any, res as any, next);
}, async (req: Request & { file?: Express.Multer.File }, res: Response) => {
  const userId = req.userId!;
  if (!req.file) {
    res.status(400).json({ error: "Aucun fichier fourni" });
    return;
  }

  try {
    const { getSupabase } = await import("../db/supabase");
    const sb  = getSupabase();
    const ext  = req.file.mimetype.split("/")[1]?.replace("jpeg", "jpg") || "jpg";
    const path = `${userId}.${ext}`;   // path DANS le bucket: userId.jpg

    // 1. Tente l'upload dans le bucket "avatars"
    const { error: uploadError } = await sb.storage
      .from("avatars")
      .upload(path, req.file.buffer, {
        contentType: req.file.mimetype,
        upsert: true,                  // remplace si existe déjà
      });

    if (uploadError) {
      // Détail de l'erreur pour le debug
      logger.error("Supabase Storage upload error", {
        code:    uploadError.message,
        details: (uploadError as any).error || "",
        hint:    "Vérifiez que le bucket 'avatars' existe dans Supabase Storage avec accès public",
      });
      throw new Error(`Storage: ${uploadError.message}`);
    }

    // 2. Récupérer l'URL publique + cache-busting
    const { data: urlData } = sb.storage.from("avatars").getPublicUrl(path);
    const avatarUrl = `${urlData.publicUrl}?t=${Date.now()}`;

    // 3. Sauvegarder dans la table users
    await db.users.update(userId, { avatarUrl });

    logger.info("Avatar mis à jour", { userId, path });
    res.json({ success: true, data: { avatarUrl } });

  } catch (e: any) {
    const msg = e instanceof Error ? e.message : "Erreur inconnue";
    logger.error("Erreur upload avatar", { userId, error: msg });
    res.status(500).json({
      error:  "Erreur upload avatar",
      detail: msg,
      hint:   "Exécutez le SQL de création du bucket dans Supabase Dashboard → SQL Editor",
    });
  }
});

// ── PATCH /api/users/biometric ────────────────────────────────
// ✅ NOUVO v105: app la siyale lè moun nan aktive/dezaktive biometrik li.
// Backend la bezwen konnen sa pou l SISPANN voye rapèl "aktive biometrik"
// la (wè morningGreeting.cron.ts). Se yon senp drapo — okenn done
// biometrik pa janm kite aparèy la (Face ID/anprent rete nan Secure
// Enclave/Keystore telefòn nan; nou pa wè yo e nou pa vle wè yo).
router.patch("/biometric", requireAuth, async (req: Request, res: Response) => {
  const userId  = req.userId!;
  const enabled = Boolean(req.body?.enabled);
  try {
    const { getSupabase } = await import("../db/supabase");
    const { error } = await getSupabase().from("users")
      .update({ biometric_enabled: enabled }).eq("id", userId);
    if (error) throw new Error(error.message);
    res.json({ success: true, data: { biometricEnabled: enabled } });
  } catch (e: any) {
    logger.error("biometric flag echwe", { userId, message: e?.message });
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/users/check-tag?tag=xxx ─────────────────────────
// Vérifier disponibilité d'un FredaTag
router.get("/check-tag", requireAuth, async (req: Request, res: Response) => {
  const raw = (req.query.tag as string || "").trim().replace(/^@/, "").toLowerCase();

  if (!raw || raw.length < 3) {
    res.json({ available: false, error: "Min 3 caractères" }); return;
  }
  if (!/^[a-z0-9_]{3,12}$/.test(raw)) {
    res.json({ available: false, error: "Lettres minuscules, chiffres et _ uniquement (3-12 chars)" }); return;
  }

  const existing = await db.users.findByFredaTag(raw);
  const isSelf   = existing?.id === req.userId;

  res.json({
    available: !existing || isSelf,
    tag:       raw,
    taken:     !!existing && !isSelf,
  });
});

// ── PATCH /api/users/change-tag ───────────────────────────────
// Changer son FredaTag
router.patch("/change-tag", requireAuth, async (req: Request, res: Response) => {
  const userId = req.userId!;
  const raw    = (req.body.tag as string || "").trim().replace(/^@/, "").toLowerCase();

  if (!/^[a-z0-9_]{3,12}$/.test(raw)) {
    res.status(400).json({ error: "Tag invalide (3-12 chars, lettres minuscules/chiffres/_)" }); return;
  }

  const existing = await db.users.findByFredaTag(raw);
  if (existing && existing.id !== userId) {
    res.status(409).json({ error: `@${raw} est déjà pris` }); return;
  }

  try {
    // ✅ FIX KRITIK: `db.users.update()` PA leve yon eksepsyon lè Supabase
    // echwe — li retounen `undefined` an silans (wè repository.ts: `if
    // (error||!row) return undefined`). Ansyen kòd la te IGNORE valè
    // retounen an e li te toujou reponn `{ success: true }`. Rezilta: app
    // la te di "FredaTag changé en @xxx !", men ANYEN pa t sove — apre
    // `refreshUser()` ansyen tag la te retounen. Se MENM bug silansye ak
    // `db.cards.updateStatus` la (korije nan v97). Kounye a nou VERIFYE
    // rezilta a e nou reponn yon vrè erè si li echwe.
    const updated = await db.users.update(userId, { FredaTag: raw });
    if (!updated || updated.FredaTag !== raw) {
      logger.error("FredaTag PA sove (echèk DB silansye)", { userId, newTag: raw });
      res.status(500).json({ error: "Impossible d'enregistrer le FredaTag. Réessayez." });
      return;
    }
    logger.info("FredaTag changé", { userId, newTag: raw });
    res.json({ success: true, data: { FredaTag: updated.FredaTag }, message: `FredaTag changé en @${raw}` });
  } catch (e: any) {
    logger.error("FredaTag change erreur", { userId, message: e?.message });
    res.status(500).json({ error: e.message });
  }
});

export default router;
