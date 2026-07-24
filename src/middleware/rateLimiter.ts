// ============================================================
// Rate Limiting Avancé — Freda Pay
// Par IP, par userId, par route sensible
// ============================================================

import { Request, Response, NextFunction } from "express";
import { logger } from "../utils/logger";

// ── Store en mémoire pour les compteurs ──────────────────────
interface RateEntry {
  count: number;
  resetAt: Date;
  blocked: boolean;
  blockedUntil?: Date;
}

const _store = new Map<string, RateEntry>();

// Nettoyage périodique (éviter memory leak)
setInterval(() => {
  const now = new Date();
  for (const [key, entry] of _store.entries()) {
    if (entry.resetAt < now && !entry.blocked) {
      _store.delete(key);
    }
  }
}, 5 * 60 * 1000); // Toutes les 5 minutes

// ── Factory de middleware ─────────────────────────────────────

interface RateLimitConfig {
  windowMs:  number;   // Fenêtre en ms
  max:       number;   // Max requêtes par fenêtre
  keyFn?:    (req: Request) => string;  // Clé personnalisée
  blockMs?:  number;   // Durée de blocage si dépassé
  message?:  string;
  skipSuccessfulRequests?: boolean;
}

export const createRateLimit = (config: RateLimitConfig) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    // Clé par défaut: IP
    const key = config.keyFn
      ? config.keyFn(req)
      : `ip:${req.ip}`;

    const now = new Date();
    const entry = _store.get(key);

    // Initialiser si première requête
    if (!entry || entry.resetAt < now) {
      _store.set(key, {
        count: 1,
        resetAt: new Date(now.getTime() + config.windowMs),
        blocked: false,
      });
      next();
      return;
    }

    // Vérifier si bloqué
    if (entry.blocked && entry.blockedUntil) {
      if (entry.blockedUntil > now) {
        const retryAfter = Math.ceil((entry.blockedUntil.getTime() - now.getTime()) / 1000);
        res.setHeader("Retry-After", retryAfter);
        res.status(429).json({
          error: config.message || "Trop de requêtes",
          retryAfter,
          blockedUntil: entry.blockedUntil.toISOString(),
        });
        return;
      }
      // Débloquer après la période
      _store.set(key, { count: 1, resetAt: new Date(now.getTime() + config.windowMs), blocked: false });
      next();
      return;
    }

    // Incrémenter
    entry.count++;
    _store.set(key, entry);

    // Ajouter headers informatifs
    res.setHeader("X-RateLimit-Limit",     config.max);
    res.setHeader("X-RateLimit-Remaining", Math.max(0, config.max - entry.count));
    res.setHeader("X-RateLimit-Reset",     Math.ceil(entry.resetAt.getTime() / 1000));

    if (entry.count > config.max) {
      // Bloquer si configuré
      if (config.blockMs) {
        const blockedUntil = new Date(now.getTime() + config.blockMs);
        _store.set(key, { ...entry, blocked: true, blockedUntil });
        logger.warn("Rate limit — blocage temporaire", { key, until: blockedUntil.toISOString() });
      }

      logger.warn("Rate limit dépassé", { key, count: entry.count, max: config.max });
      const retryAfter = Math.ceil((entry.resetAt.getTime() - now.getTime()) / 1000);
      res.setHeader("Retry-After", retryAfter);
      res.status(429).json({
        error: config.message || "Trop de requêtes. Réessayez dans quelques minutes.",
        retryAfter,
      });
      return;
    }

    next();
  };
};

// ── Limites prédéfinies ───────────────────────────────────────

/** Global — toutes les routes */
export const globalLimit = createRateLimit({
  windowMs: 15 * 60 * 1000,  // 15 minutes
  max:      200,
  message:  "Trop de requêtes depuis cette IP",
});

/** Auth — login/register (anti brute-force) */
export const authLimit = createRateLimit({
  windowMs: 15 * 60 * 1000,  // 15 minutes
  max:      process.env.NODE_ENV === "production" ? 10 : 100,  // 100 en dev
  blockMs:  process.env.NODE_ENV === "production" ? 60 * 60 * 1000 : 60 * 1000,  // 1h prod, 1min dev
  message:  "Trop de tentatives d'authentification. Réessayez dans 1 heure.",
  keyFn:    (req) => `auth:${req.ip}:${(req.body?.email || "").toLowerCase()}`,
});

/** Sensible — transferts, KYC, 2FA */
export const sensitiveLimit = createRateLimit({
  windowMs: 60 * 1000,        // 1 minute
  max:      10,
  message:  "Trop de requêtes sur cette opération sensible",
  keyFn:    (req) => `sensitive:${req.userId || req.ip}`,
});

/** Par utilisateur — requêtes API générales */
export const perUserLimit = createRateLimit({
  windowMs: 60 * 1000,        // 1 minute
  max:      300,               // 300/min (augmenté — 5 hooks × 30s polling = 10/min)
  message:  "Limite de requêtes atteinte pour ce compte",
  keyFn:    (req) => `user:${req.userId || req.ip}`,
});

/** Wallet/transfers — anti-spam de transferts */
export const transferLimit = createRateLimit({
  windowMs: 60 * 1000,        // 1 minute
  max:      5,
  blockMs:  5 * 60 * 1000,   // Bloqué 5 min si dépassé
  message:  "Trop de transferts en peu de temps. Patientez quelques minutes.",
  keyFn:    (req) => `transfer:${req.userId || req.ip}`,
});

/** Email OTP — anti-spam d'envoi d'emails */
export const emailOTPLimit = createRateLimit({
  windowMs: 60 * 1000,        // 1 minute
  max:      3,
  blockMs:  10 * 60 * 1000,  // Bloqué 10 min
  message:  "Trop de demandes de code. Attendez 10 minutes.",
  keyFn:    (req) => `emailotp:${req.userId || req.ip}`,
});

/** Webhook — pour Maplerad/Didit */
export const webhookLimit = createRateLimit({
  windowMs: 60 * 1000,
  max:      120,
  message:  "Rate limit webhook",
});

/** Reset all rate limits (DEV ONLY) */
export const resetRateLimits = () => {
  _store.clear();
  logger.info("Rate limits reset");
};

