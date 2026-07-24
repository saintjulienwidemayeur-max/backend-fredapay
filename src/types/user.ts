// ============================================================
// Types Users & Auth — Freda Pay
// ============================================================

export interface DbUser {
  id: string;
  email: string;
  passwordHash: string;
  firstname: string;
  lastname: string;
  phone?: string;
  dialCode?: string;
  country?: string;
  city?: string;
  address?: string;
  state?: string;
  postalCode?: string;
  dateOfBirth?: string;
  genre?: string;
  FredaTag: string;           // @username unique
  avatarUrl?: string;
  role: "user" | "admin" | "super_admin" | "comptable" | "service_client";
  status: "pending" | "active" | "suspended" | "banned" | "deleted";
  kycStatus: "not_started" | "pending" | "approved" | "declined";
  kycSessionId?: string;
  emailVerified: boolean;
  phoneVerified: boolean;
  twoFactorEnabled: boolean;
  createdAt: Date;
  updatedAt: Date;
  lastLoginAt?: Date;
  mapleradCustomerId?: string;   // ID client Maplerad
  mapleradTier?: number;         // 0=Tier0, 1=Tier1, 2=Tier2
  usdAccountRef?: string;        // Référence compte USD Maplerad
  kycIdNumber?: string;          // Numéro pièce ID vérifié par Didit
  kycIdType?: string;            // Type: PASSPORT, NIN, DRIVERS_LICENSE, etc.
  kycIdCountry?: string;         // Pays de la pièce ID
  kycFirstName?: string;         // Prénom vérifié sur le document ID (Didit)
  kycLastName?: string;          // Nom vérifié sur le document ID (Didit)
  kycNationality?: string;       // Nationalité extraite du document ID (Didit)
  createdByAdminId?: string;     // Admin qui a créé ce compte (audit, pour comptes staff)
  trialUsed?: boolean;
  // ✅ FIX: te manke — bouton "Notifications" nan Pwofil la pa t janm ka sove
  // preferans (wè migration 019). {transfers, security, marketing, news}
  notifPrefs?: Record<string, boolean>;
  // ✅ v68 — parennaj (wè migration 039)
  referralCode?: string;   // kòd inik moun sa a pataje
  referredBy?: string;     // ID itilizatè ki envite l
}

// Ce qu'on retourne au client (sans passwordHash)
export type PublicUser = Omit<DbUser, "passwordHash">;

export interface RegisterRequest {
  email: string;
  password: string;
  firstname: string;
  lastname: string;
  phone?: string;
  dialCode?: string;
  country?: string;
  city?: string;
  address?: string;
  state?: string;
  postalCode?: string;
  dateOfBirth?: string;
  genre?: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface AuthTokens {
  accessToken: string;          // Expire en 15 min
  refreshToken: string;         // Expire en 7 jours
  expiresIn: number;            // Secondes
}

export interface JwtPayload {
  userId: string;
  email: string;
  role: string;
  type: "access" | "refresh";
  iat?: number;
  exp?: number;
}

export interface DbRefreshToken {
  id: string;
  userId: string;
  token: string;
  expiresAt: Date;
  createdAt: Date;
  revokedAt?: Date;
}
