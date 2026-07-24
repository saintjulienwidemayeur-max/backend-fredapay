// ============================================================
// Middleware Auth — Protéger les routes avec JWT
// ============================================================

import { Request, Response, NextFunction } from "express";
import { JwtService } from "../services/jwt.service";
import { db } from "../db/store";
import { logger } from "../utils/logger";
import type { JwtPayload } from "../types/user";
import { runWithDemoContext, isDemoEmail } from "../services/demoMode.service";

declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
      userId?: string;
    }
  }
}

export const requireAuth = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Non authentifié", hint: "Ajoutez: Authorization: Bearer <token>" });
    return;
  }

  const token = authHeader.slice(7);

  try {
    const payload = JwtService.verifyAccessToken(token);
    const user = await db.users.findById(payload.userId);

    if (!user) { res.status(401).json({ error: "Utilisateur introuvable" }); return; }
    if (user.status === "suspended" || user.status === "banned") {
      res.status(403).json({ error: `Compte ${user.status}. Contactez le support.` }); return;
    }

    req.user = payload;
    req.userId = payload.userId;

    // ✅ v66 — KONT DEMO (App Store / Play Store review).
    // Nou make rekèt la kòm "demo" pou tout dire li. Sèvis patnè yo
    // (Maplerad, Pay'm, Didit) li drapo sa a epi yo retounen repons
    // simile olye yo frape rezo a. Wè demoMode.service.ts.
    const isDemo = (user as any).isDemo === true
      || (user as any).is_demo === true
      || isDemoEmail(user.email);
    (req as any).isDemo = isDemo;
    if (isDemo) { runWithDemoContext(true, payload.userId, next); return; }

    next();
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erreur auth";
    if (message === "TOKEN_EXPIRED") {
      res.status(401).json({ error: "Token expiré", code: "TOKEN_EXPIRED", hint: "Utilisez POST /api/auth/refresh" });
      return;
    }
    logger.warn("Token JWT invalide", { ip: req.ip });
    res.status(401).json({ error: "Token invalide" });
  }
};

export const requireAdmin = (req: Request, res: Response, next: NextFunction): void => {
  const staffRoles = ["admin", "super_admin", "comptable", "service_client"];
  if (!req.user || !staffRoles.includes(req.user.role)) {
    res.status(403).json({ error: "Accès réservé aux administrateurs" });
    return;
  }
  next();
};

/**
 * Middleware RBAC générique — autorise seulement les rôles listés.
 * Exemple: requireRole("super_admin") ou requireRole("admin", "comptable")
 */
export const requireRole = (...roles: string[]) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user || !roles.includes(req.user.role)) {
      res.status(403).json({ error: "Accès refusé pour votre rôle", requiredRoles: roles });
      return;
    }
    next();
  };
};

export const optionalAuth = async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith("Bearer ")) {
    try {
      const payload = JwtService.verifyAccessToken(authHeader.slice(7));
      req.user = payload;
      req.userId = payload.userId;
    } catch { /* continue sans auth */ }
  }
  next();
};
