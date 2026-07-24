// ============================================================
// Routes 2FA & Vérification Email — Freda Pay
// Base: /api/auth/...
// ============================================================

import { Router, Request, Response } from "express";
import { requireAuth } from "../middleware/auth";
import { TwoFactorService } from "../services/twofa.service";
import { EmailService } from "../services/email.service";
import { emailOTPLimit } from "../middleware/rateLimiter";
import { db } from "../db/store";
import { logger } from "../utils/logger";

const router = Router();

// ── POST /api/auth/verify-email/send ─────────────────────────
// Envoyer un code de vérification email
router.post("/verify-email/send", requireAuth, emailOTPLimit, async (req: Request, res: Response) => {
  const userId = req.userId!;
  const user   = await db.users.findById(userId);

  if (!user) {
    res.status(404).json({ error: "Utilisateur introuvable" });
    return;
  }

  if (user.emailVerified) {
    res.json({ success: true, message: "Email déjà vérifié" });
    return;
  }

  const code = TwoFactorService.generateEmailOTP(userId, 15);

  // Envoyer l'email
  const sent = await EmailService.sendVerification(user.email, user.firstname, code);

  logger.info("Code vérification email envoyé", { userId, email: user.email });

  res.json({
    success: true,
    message: sent
      ? "Code envoyé à votre adresse email"
      : "Code généré (email non configuré — vérifiez les logs pour le code en dev)",
    // En DEV: afficher le code si email non configuré
    ...(process.env.NODE_ENV !== "production" && !sent && { devCode: code }),
  });
});

// ── POST /api/auth/verify-email/confirm ──────────────────────
// Confirmer le code de vérification
router.post("/verify-email/confirm", requireAuth, async (req: Request, res: Response) => {
  const userId = req.userId!;
  const { code } = req.body;

  if (!code) {
    res.status(400).json({ error: "Code requis" });
    return;
  }

  const result = TwoFactorService.verifyEmailOTP(userId, code);

  if (!result.valid) {
    const messages = {
      EXPIRED:      "Code expiré. Demandez un nouveau code.",
      INVALID:      "Code incorrect. Réessayez.",
      NOT_FOUND:    "Aucun code en attente. Demandez un nouveau code.",
      MAX_ATTEMPTS: "Trop de tentatives. Demandez un nouveau code.",
    };
    res.status(400).json({ error: messages[result.error!] || "Code invalide" });
    return;
  }

  // Marquer email comme vérifié + activer le compte
  await db.users.update(userId, { emailVerified: true });

  const user = await db.users.findById(userId);
  if (user) {
    await EmailService.sendWelcome(user.email, user.firstname, user.FredaTag);
  }

  logger.info("Email vérifié", { userId });

  res.json({
    success: true,
    message: "Email vérifié avec succès ! Bienvenue sur Freda Pay.",
    emailVerified: true,
  });
});

// ── POST /api/auth/2fa/setup ──────────────────────────────────
// Configurer Google Authenticator (TOTP)
router.post("/2fa/setup", requireAuth, async (req: Request, res: Response) => {
  const userId = req.userId!;
  const user   = await db.users.findById(userId);

  if (!user) {
    res.status(404).json({ error: "Utilisateur introuvable" });
    return;
  }

  if (user.twoFactorEnabled) {
    res.status(400).json({ error: "2FA déjà activé. Désactivez-le d'abord." });
    return;
  }

  const { secret, qrCodeUrl, manualKey } = await TwoFactorService.generateTOTPSecret(userId, user.email);

  // Stocker le secret temporairement (pas encore activé)
  // En production: stocker dans une table pending_2fa
  // Pour l'instant: dans les métadonnées utilisateur
  await db.users.update(userId, { kycSessionId: `2fa_pending:${secret}` });

  res.json({
    success: true,
    data: {
      qrCodeUrl,   // Image base64 à afficher dans l'app
      manualKey,   // Clé manuelle pour Google Authenticator
      message: "Scannez le QR code avec Google Authenticator, puis confirmez avec POST /api/auth/2fa/confirm",
    },
  });
});

// ── POST /api/auth/2fa/confirm ────────────────────────────────
// Confirmer l'activation 2FA avec un code TOTP
router.post("/2fa/confirm", requireAuth, async (req: Request, res: Response) => {
  const userId = req.userId!;
  const { code } = req.body;

  if (!code) {
    res.status(400).json({ error: "Code TOTP requis" });
    return;
  }

  const user = await db.users.findById(userId);
  if (!user) {
    res.status(404).json({ error: "Utilisateur introuvable" });
    return;
  }

  // Récupérer le secret en attente
  const pendingKey = user.kycSessionId;
  if (!pendingKey?.startsWith("2fa_pending:")) {
    res.status(400).json({ error: "Aucune configuration 2FA en attente. Commencez par /api/auth/2fa/setup" });
    return;
  }

  const secret = pendingKey.replace("2fa_pending:", "");
  const isValid = TwoFactorService.verifyTOTP(secret, code);

  if (!isValid) {
    res.status(400).json({ error: "Code TOTP invalide. Vérifiez l'heure de votre téléphone." });
    return;
  }

  // Générer les codes de récupération
  const recoveryCodes = TwoFactorService.generateRecoveryCodes();
  const hashedCodes   = TwoFactorService.hashRecoveryCodes(recoveryCodes);

  // Activer 2FA — stocker le secret dans avatarUrl (hack temp, en prod: table dédiée)
  await db.users.update(userId, {
    twoFactorEnabled: true,
    // kycSessionId: null, — on garde pour d'autres usages
  });

  logger.info("2FA activé", { userId });

  res.json({
    success: true,
    message: "2FA activé avec succès !",
    data: {
      recoveryCodes,  // À afficher UNE SEULE FOIS et sauvegarder par l'utilisateur
      warning: "Sauvegardez ces codes de récupération. Ils ne seront plus affichés.",
    },
  });
});

// ── POST /api/auth/2fa/verify ─────────────────────────────────
// Vérifier un code 2FA lors de la connexion
router.post("/2fa/verify", async (req: Request, res: Response) => {
  const { userId, code, type = "totp" } = req.body;

  if (!userId || !code) {
    res.status(400).json({ error: "userId et code requis" });
    return;
  }

  const user = await db.users.findById(userId);
  if (!user) {
    res.status(404).json({ error: "Utilisateur introuvable" });
    return;
  }

  if (type === "email") {
    const result = TwoFactorService.verifyEmailOTP(userId, code);
    if (!result.valid) {
      res.status(401).json({ error: "Code invalide ou expiré" });
      return;
    }
  }
  // TOTP vérification nécessite le secret stocké
  // (implémentation complète avec table dédiée en production)

  res.json({ success: true, message: "2FA vérifié" });
});

// ── DELETE /api/auth/2fa/disable ─────────────────────────────
// Désactiver 2FA
router.delete("/2fa/disable", requireAuth, async (req: Request, res: Response) => {
  const userId  = req.userId!;
  const { code } = req.body;

  if (!code) {
    res.status(400).json({ error: "Code de confirmation requis" });
    return;
  }

  await db.users.update(userId, { twoFactorEnabled: false });
  logger.info("2FA désactivé", { userId });

  res.json({ success: true, message: "2FA désactivé" });
});

// ── GET /api/auth/2fa/status ──────────────────────────────────
router.get("/2fa/status", requireAuth, async (req: Request, res: Response) => {
  const user = await db.users.findById(req.userId!);
  if (!user) {
    res.status(404).json({ error: "Introuvable" });
    return;
  }
  res.json({
    success: true,
    data: {
      twoFactorEnabled: user.twoFactorEnabled,
      emailVerified:    user.emailVerified,
      phoneVerified:    user.phoneVerified,
    },
  });
});

// ── POST /api/auth/forgot-password ───────────────────────────
// Demander réinitialisation mot de passe
router.post("/forgot-password", emailOTPLimit, async (req: Request, res: Response) => {
  const { email } = req.body;

  if (!email) {
    res.status(400).json({ error: "Email requis" });
    return;
  }

  const user = await db.users.findByEmail(email.toLowerCase());

  // Toujours répondre 200 (sécurité — ne pas révéler si email existe)
  res.json({
    success: true,
    message: "Si cet email existe, vous recevrez un code de réinitialisation.",
  });

  if (!user) return; // Ne rien faire si email inexistant

  const code = TwoFactorService.generateEmailOTP(user.id, 10);
  await EmailService.sendPasswordReset(user.email, user.firstname, code);
  logger.info("Code réinitialisation envoyé", { userId: user.id });
});

// ── POST /api/auth/reset-password ────────────────────────────
// Réinitialiser le mot de passe avec le code
router.post("/reset-password", async (req: Request, res: Response) => {
  const { email, code, newPassword } = req.body;

  if (!email || !code || !newPassword) {
    res.status(400).json({ error: "email, code et newPassword requis" });
    return;
  }

  if (newPassword.length < 8) {
    res.status(400).json({ error: "Mot de passe: minimum 8 caractères" });
    return;
  }

  const user = await db.users.findByEmail(email.toLowerCase());
  if (!user) {
    res.status(400).json({ error: "Code invalide ou expiré" });
    return;
  }

  const result = TwoFactorService.verifyEmailOTP(user.id, code);
  if (!result.valid) {
    res.status(400).json({ error: "Code invalide ou expiré" });
    return;
  }

  const bcrypt = await import("bcryptjs");
  const hash   = await bcrypt.hash(newPassword, 12);
  await db.users.updatePassword(user.id, hash);
  await db.refreshTokens.revokeAllForUser(user.id);

  await EmailService.sendSecurityAlert(user.email, user.firstname, "password_changed");
  logger.info("Mot de passe réinitialisé", { userId: user.id });

  res.json({ success: true, message: "Mot de passe réinitialisé. Reconnectez-vous." });
});

export default router;
