// ============================================================
// Service 2FA — Freda Pay
// TOTP (Google Authenticator) + Email OTP
// ============================================================

import speakeasy from "speakeasy";
import QRCode from "qrcode";
import crypto from "crypto";
import { logger } from "../utils/logger";

// Store OTP email en mémoire (remplacer par Redis en production)
const _emailOTPs = new Map<string, { code: string; expiresAt: Date; attempts: number }>();

export const TwoFactorService = {

  // ── TOTP (Google Authenticator) ───────────────────────────────

  /**
   * Générer un secret TOTP pour un utilisateur
   * Retourne le secret + QR code à afficher dans l'app
   */
  async generateTOTPSecret(userId: string, email: string): Promise<{
    secret: string;
    qrCodeUrl: string;
    manualKey: string;
  }> {
    const secret = speakeasy.generateSecret({
      name: `Freda Pay (${email})`,
      issuer: "Freda Pay",
      length: 32,
    });

    const qrCodeUrl = await QRCode.toDataURL(secret.otpauth_url!);

    logger.info("Secret TOTP généré", { userId });

    return {
      secret:     secret.base32,
      qrCodeUrl,                    // Image base64 du QR code
      manualKey:  secret.base32,    // Clé manuelle si pas de scanner
    };
  },

  /**
   * Vérifier un code TOTP
   */
  verifyTOTP(secret: string, token: string): boolean {
    return speakeasy.totp.verify({
      secret,
      encoding: "base32",
      token,
      window: 2,  // Tolérance ±2 périodes (60 secondes)
    });
  },

  // ── Email OTP ─────────────────────────────────────────────────

  /**
   * Générer un code OTP à 6 chiffres pour l'email
   */
  generateEmailOTP(userId: string, ttlMinutes = 10): string {
    // Supprimer ancien OTP si existe
    _emailOTPs.delete(userId);

    const code = crypto.randomInt(100000, 999999).toString();
    const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000);

    _emailOTPs.set(userId, { code, expiresAt, attempts: 0 });

    logger.debug("OTP généré", { userId, expires: expiresAt.toISOString() });
    return code;
  },

  /**
   * Vérifier un code OTP email
   */
  verifyEmailOTP(userId: string, inputCode: string): {
    valid: boolean;
    error?: "EXPIRED" | "INVALID" | "NOT_FOUND" | "MAX_ATTEMPTS";
  } {
    const stored = _emailOTPs.get(userId);

    if (!stored) {
      return { valid: false, error: "NOT_FOUND" };
    }

    if (new Date() > stored.expiresAt) {
      _emailOTPs.delete(userId);
      return { valid: false, error: "EXPIRED" };
    }

    if (stored.attempts >= 5) {
      _emailOTPs.delete(userId);
      return { valid: false, error: "MAX_ATTEMPTS" };
    }

    if (stored.code !== inputCode.trim()) {
      _emailOTPs.set(userId, { ...stored, attempts: stored.attempts + 1 });
      return { valid: false, error: "INVALID" };
    }

    // Code valide — supprimer (usage unique)
    _emailOTPs.delete(userId);
    logger.info("OTP vérifié avec succès", { userId });
    return { valid: true };
  },

  /**
   * Vérifier le code de vérification email (même logique)
   */
  verifyEmailCode(userId: string, code: string) {
    return this.verifyEmailOTP(userId, code);
  },

  // ── Codes de récupération ─────────────────────────────────────

  /**
   * Générer 8 codes de récupération uniques
   * À sauvegarder par l'utilisateur en cas de perte du téléphone
   */
  generateRecoveryCodes(): string[] {
    return Array.from({ length: 8 }, () =>
      crypto.randomBytes(4).toString("hex").toUpperCase()
        .match(/.{4}/g)!.join("-")
    );
  },

  /**
   * Hasher les codes de récupération pour stockage sécurisé
   */
  hashRecoveryCodes(codes: string[]): string[] {
    return codes.map(code =>
      crypto.createHash("sha256").update(code).digest("hex")
    );
  },

  /**
   * Vérifier un code de récupération
   */
  verifyRecoveryCode(inputCode: string, hashedCodes: string[]): {
    valid: boolean;
    remainingCodes: string[];
  } {
    const hash = crypto.createHash("sha256")
      .update(inputCode.replace(/-/g, "").toUpperCase())
      .digest("hex");

    const idx = hashedCodes.indexOf(hash);
    if (idx === -1) return { valid: false, remainingCodes: hashedCodes };

    // Supprimer le code utilisé
    const remaining = [...hashedCodes];
    remaining.splice(idx, 1);
    return { valid: true, remainingCodes: remaining };
  },
};
