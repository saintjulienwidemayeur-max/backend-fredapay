// ============================================================
// Service JWT — Génération et validation des tokens
// Access Token  : 15 minutes
// Refresh Token : 7 jours
// ============================================================

import jwt from "jsonwebtoken";
import crypto from "crypto";
import { logger } from "../utils/logger";
import type { JwtPayload, AuthTokens } from "../types/user";

const getSecret = () => {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET manquant dans .env");
  return secret;
};

const ACCESS_EXPIRES  = "15m";
const REFRESH_EXPIRES = "7d";

export const JwtService = {

  // ── Générer access + refresh tokens ──────────────────────

  generateTokens(userId: string, email: string, role: string): AuthTokens {
    const payload: Omit<JwtPayload, "iat" | "exp"> = { userId, email, role, type: "access" };

    const accessToken = jwt.sign(
      { ...payload, type: "access" },
      getSecret(),
      { expiresIn: ACCESS_EXPIRES }
    );

    const refreshToken = jwt.sign(
      { ...payload, type: "refresh" },
      getSecret(),
      { expiresIn: REFRESH_EXPIRES }
    );

    return { accessToken, refreshToken, expiresIn: 15 * 60 }; // 900 secondes
  },

  // ── Vérifier un access token ──────────────────────────────

  verifyAccessToken(token: string): JwtPayload {
    try {
      const payload = jwt.verify(token, getSecret()) as JwtPayload;
      if (payload.type !== "access") throw new Error("Type de token invalide");
      return payload;
    } catch (err) {
      if (err instanceof jwt.TokenExpiredError) throw new Error("TOKEN_EXPIRED");
      if (err instanceof jwt.JsonWebTokenError) throw new Error("TOKEN_INVALID");
      throw err;
    }
  },

  // ── Vérifier un refresh token ─────────────────────────────

  verifyRefreshToken(token: string): JwtPayload {
    try {
      const payload = jwt.verify(token, getSecret()) as JwtPayload;
      if (payload.type !== "refresh") throw new Error("Type de token invalide");
      return payload;
    } catch (err) {
      if (err instanceof jwt.TokenExpiredError) throw new Error("REFRESH_TOKEN_EXPIRED");
      if (err instanceof jwt.JsonWebTokenError) throw new Error("REFRESH_TOKEN_INVALID");
      throw err;
    }
  },

  // ── Générer un refresh token opaque (sécurisé) ───────────
  // En alternative au JWT refresh token, on peut utiliser un token aléatoire
  generateOpaqueToken(): string {
    return crypto.randomBytes(64).toString("hex");
  },
};
