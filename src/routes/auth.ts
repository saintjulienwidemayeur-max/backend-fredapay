// ============================================================
// Routes Auth — Register, Login, Refresh, Logout, Me
// Base: /api/auth
// ============================================================

import { Router, Request, Response } from "express";
import bcrypt from "bcryptjs";
import { db } from "../db/store";
import { JwtService } from "../services/jwt.service";
import { requireAuth } from "../middleware/auth";
import { Validate } from "../utils/validation";
import { validateBody, schemas } from "../middleware/validation";
import { logger } from "../utils/logger";
import { NotificationService } from "../services/notification.service";
import { EmailService } from "../services/email.service";

// ── Parser User-Agent → nom lisible ──────────────────────────
function parseDevice(ua: string): string {
  if (!ua) return "Appareil inconnu";
  // Mobile
  if (/iPhone/.test(ua))                     return "iPhone";
  if (/iPad/.test(ua))                       return "iPad";
  if (/Android.*Mobile/.test(ua))            return "Android (mobile)";
  if (/Android/.test(ua))                    return "Android (tablette)";
  // Desktop OS
  if (/Windows NT 10/.test(ua))              return "Windows 10 / 11";
  if (/Windows NT 6\.3/.test(ua))            return "Windows 8.1";
  if (/Windows NT 6\.1/.test(ua))            return "Windows 7";
  if (/Macintosh.*Mac OS X 1[5-9]/.test(ua)) return "Mac (macOS 15+)";
  if (/Macintosh.*Mac OS X 14/.test(ua))     return "Mac (macOS Sonoma)";
  if (/Macintosh.*Mac OS X 13/.test(ua))     return "Mac (macOS Ventura)";
  if (/Macintosh/.test(ua))                  return "Mac";
  if (/Linux.*X11/.test(ua))                 return "Linux";
  // Browsers as last resort
  if (/Chrome/.test(ua))                     return "Navigateur Chrome";
  if (/Safari/.test(ua))                     return "Navigateur Safari";
  if (/Firefox/.test(ua))                    return "Navigateur Firefox";
  return "Navigateur web";
}



/**
 * ✅ v69 — Maske yon imèl pou yon "endis sekirize".
 *   jeanpierre@gmail.com → j********e@g***l.com
 * Ase pou moun nan rekonèt PWÒP imèl li, pa ase pou yon lòt moun
 * dekouvri adrès konplè a.
 */
function maskEmail(email: string): string {
  const [user = "", domain = ""] = String(email || "").split("@");
  if (!user || !domain) return "***";
  const maskPart = (v: string) =>
    v.length <= 2 ? v[0] + "*" : v[0] + "*".repeat(Math.max(1, v.length - 2)) + v[v.length - 1];
  const dotIdx = domain.lastIndexOf(".");
  const dName = dotIdx > 0 ? domain.slice(0, dotIdx) : domain;
  const tld = dotIdx > 0 ? domain.slice(dotIdx) : "";
  return `${maskPart(user)}@${maskPart(dName)}${tld}`;
}

const router = Router();
const BCRYPT_ROUNDS = 12;

// ── Vérifier disponibilité DB ────────────────────────────────
const checkDB = async (res: import("express").Response): Promise<boolean> => {
  try {
    await import("../db/store").then(m => m.db.users.count());
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Table doesn't exist yet
    if (msg.includes("relation") || msg.includes("does not exist") || msg.includes("42P01")) {
      res.status(503).json({
        error: "Base de données non initialisée",
        hint: "Exécutez la migration SQL sur Supabase Dashboard → SQL Editor → migrations/001_initial_schema.sql"
      });
      return false;
    }
    return true; // Other errors - let the route handle them
  }
};



// ── POST /api/auth/register ───────────────────────────────────
router.post("/register", validateBody(schemas.register), async (req: Request, res: Response) => {
  const {
    email, password, firstname, lastname,
    phone, dialCode, country, city, address, state, dateOfBirth, genre,
    referralCode,
  } = req.body;

  // ── Validation ────────────────────────────────────────────
  const errors: Record<string, string> = {};

  const emailV = Validate.email(email);
  if (!emailV.valid) errors.email = emailV.error!;

  const passV = Validate.password(password);
  if (!passV.valid) errors.password = passV.error!;

  const firstV = Validate.name(firstname, "Prénom");
  if (!firstV.valid) errors.firstname = firstV.error!;

  const lastV = Validate.name(lastname, "Nom");
  if (!lastV.valid) errors.lastname = lastV.error!;

  if (phone) {
    const phoneV = Validate.phone(phone);
    if (!phoneV.valid) errors.phone = phoneV.error!;
  }

  if (Object.keys(errors).length > 0) {
    res.status(400).json({ error: "Données invalides", fields: errors });
    return;
  }

  // ── Vérifier unicité email ────────────────────────────────
  const existing = await db.users.findByEmail(email.toLowerCase());
  if (existing) {
    res.status(409).json({ error: "Un compte existe déjà avec cet email" });
    return;
  }

  // ✅ NOUVO: egzije imèl la deja verifye pa flux /register/send-code +
  // /register/verify-code AVAN nou kreye kont la (verifikasyon AVAN modpas).
  const pendingVerif = await db.pendingEmailVerifications.find(email);
  if (!pendingVerif || !pendingVerif.verified) {
    res.status(400).json({ error: "Veuillez d'abord vérifier votre adresse email", fields: { email: "Email non vérifié" } });
    return;
  }

  try {
    // ── Hasher le mot de passe ────────────────────────────────
    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

    // ── Générer un FredaTag unique ──────────────────────────
    let FredaTag = Validate.generateFredaTag(firstname, lastname);
    // S'assurer de l'unicité
    let attempts = 0;
    while (await db.users.findByFredaTag(FredaTag) && attempts < 10) {
      FredaTag = Validate.generateFredaTag(firstname, lastname);
      attempts++;
    }

    // ── Parennaj: rezoud kòd la (si genyen) AVAN kreye kont lan ──────
    // ✅ v68: si moun nan antre yon kòd parennaj valid, nou lye l ak
    // parennè a. Kòd envalid = nou senpleman iyore l (pa yon erè — pa
    // bloke enskripsyon an pou sa).
    let referredBy: string | undefined;
    if (referralCode && String(referralCode).trim()) {
      const referrer = await db.referrals.findUserByCode(String(referralCode)).catch(() => undefined);
      if (referrer) referredBy = referrer.id;
      else logger.info("Kòd parennaj envalid iyore", { code: referralCode });
    }

    // ── ✅ v69 — ANPECHE DOUB KONT (menm moun, lòt imèl) ─────────────
    // Kritè: menm prenon + siyati + dat nesans + peyi.
    // Nou bay yon ENDIS SEKIRIZE (imèl maske: j***n@g***l.com) pou moun
    // nan rekonèt pwòp kont li SAN nou revele yon adrès konplè bay yon
    // moun ki ta ap eseye devine idantite yon lòt.
    const twin = await db.users.findByIdentity(
      firstname, lastname, dateOfBirth, country
    ).catch(() => undefined);

    if (twin) {
      logger.warn("Tantativ doub kont bloke", { existingUserId: twin.id, email: email.toLowerCase() });
      res.status(409).json({
        error: "Vous avez déjà un compte Freda Pay.",
        code: "ACCOUNT_EXISTS",
        hint: maskEmail(twin.email),
        message:
          `Un compte existe déjà à votre nom. Connectez-vous avec ${maskEmail(twin.email)} ` +
          `ou utilisez « Mot de passe oublié » pour y accéder.`,
      });
      return;
    }

    // ── Créer l'utilisateur ───────────────────────────────────
    const user = await db.users.create({
      email: email.toLowerCase(),
      passwordHash,
      firstname: firstname.trim(),
      lastname: lastname.trim(),
      phone: phone || undefined,
      dialCode: dialCode || undefined,
      country: country || undefined,
      city: city || undefined,
      address: address || undefined,
      state: state || undefined,
      dateOfBirth: dateOfBirth || undefined,
      genre: genre || undefined,
      FredaTag,
      role: "user",
      status: "pending",           // Actif après KYC
      kycStatus: "not_started",
      // ✅ Imèl la deja verifye pa flux /register/send-code + /verify-code
      // AVAN kont sa a te menm kreye — pa bezwen re-mande l apre.
      emailVerified: true,
      phoneVerified: false,
      twoFactorEnabled: false,
      // ✅ v68 — parennaj (kòd inik moun sa a jenere otomatik nan repo).
      referredBy,
    } as any);

    // ── Générer les tokens ────────────────────────────────────
    const tokens = JwtService.generateTokens(user.id, user.email, user.role);
    await db.refreshTokens.create(user.id, tokens.refreshToken);

    logger.info("Nouvel utilisateur inscrit", { userId: user.id, email: user.email, FredaTag });

    // ── Créer le trial automatiquement à l'inscription ───────
    try {
      const trialEndsAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
      await db.subscriptions.createTrial(user.id, trialEndsAt);
      await db.users.update(user.id, { trialUsed: true } as any);
      logger.info("Trial 14j créé à l'inscription", { userId: user.id });
    } catch (trialErr) {
      logger.warn("Impossible de créer trial (peut-être déjà existant)", { userId: user.id });
    }

    // ── Auto-enrollment Maplerad (Tier 0 — aucun document requis) ─
    // Fire-and-forget: pa bloke enskripsyon si Maplerad indisponible
    void (async () => {
      try {
        const { MapleradCustomerService } = await import("../services/maplerad.service");
        const { toCountryCode } = await import("../utils/countryCode");
        const result = await MapleradCustomerService.createCustomer({
          first_name: user.firstname,
          last_name:  user.lastname,
          email:      user.email,
          country:    toCountryCode((user as any).country),
        });
        await db.users.update(user.id, { mapleradCustomerId: result.data.id } as any);
        logger.info("Client Maplerad Tier 0 créé à l'inscription", {
          userId: user.id, mapleradId: result.data.id,
        });
      } catch (mprErr: any) {
        const msg = mprErr.message || "";
        // Si déjà inscrit → récupérer l'ID existant
        if (msg.includes("already") || msg.includes("enrolled") || msg.includes("exist")) {
          try {
            const { MapleradCustomerService } = await import("../services/maplerad.service");
            const existingId = await MapleradCustomerService.findCustomerByEmail(user.email);
            if (existingId) {
              await db.users.update(user.id, { mapleradCustomerId: existingId } as any);
              logger.info("ID Maplerad existant récupéré à l'inscription", { userId: user.id, mapleradId: existingId });
            }
          } catch { /* silencieux */ }
        } else {
          logger.warn("Auto-enrollment Maplerad échoué à l'inscription (non bloquant)", {
            userId: user.id, error: msg,
          });
        }
      }
    })();

    NotificationService.system(user.id, "Bienvenue sur Freda Pay !", "Votre compte a été créé avec un essai gratuit de 14 jours. Complétez votre KYC pour activer toutes les fonctionnalités.");

    // ── Envoyer email de bienvenue + code de vérification ────────
    const verificationCode = Math.floor(100000 + Math.random() * 900000).toString();
    // ✅ FIX: kòd la te jenere e voye pa imèl, men li pa t janm SOVE — backend
    // pa t janm ka verifye l apre sa. Kounye a nou sove l ak yon ekspirasyon.
    await db.users.setEmailVerificationCode(user.id, verificationCode).catch(() => null);
    // Email bienvenue + code (fire-and-forget, non bloquant)
    void EmailService.sendWelcome(user.email, user.firstname, user.FredaTag).catch(() => null);
    void EmailService.sendVerification(user.email, user.firstname, verificationCode).catch(() => null);

    // ── Réponse (sans passwordHash) ───────────────────────────
    res.status(201).json({
      success: true,
      message: "Compte créé avec succès",
      user: db.users.toPublic(user),
      tokens,
      nextStep: "Complétez votre KYC sur /api/kyc/start pour activer votre compte",
    });

  } catch (err) {
    const message = err instanceof Error ? err.message : "Erreur";
    if (message === "EMAIL_ALREADY_EXISTS") {
      res.status(409).json({ error: "Email déjà utilisé" });
      return;
    }
    logger.error("Erreur inscription", { email, error: message });
    res.status(500).json({ error: "Erreur lors de la création du compte" });
  }
});

// ── POST /api/auth/login ──────────────────────────────────────
router.post("/login", validateBody(schemas.login), async (req: Request, res: Response) => {
  const { email, password } = req.body;

  if (!email || !password) {
    res.status(400).json({ error: "Email et mot de passe requis" });
    return;
  }

  try {
    const user = await db.users.findByEmail(email.toLowerCase());

    // Temps constant anti-timing attack
    const dummyHash = "$2a$12$dummy.hash.to.prevent.timing.attacks.xxxxxxxxxxxxx";
    const isValid = await bcrypt.compare(password, user ? user.passwordHash : dummyHash);

    if (!user || !isValid) {
      logger.warn("Tentative login échouée", { email, ip: req.ip });
      res.status(401).json({ error: "Email ou mot de passe incorrect" });
      return;
    }

    if (user.status === "suspended") {
      res.status(403).json({ error: "Compte suspendu. Contactez le support." });
      return;
    }
    if (user.status === "banned") {
      res.status(403).json({ error: "Compte banni." });
      return;
    }
    if (user.status === "deleted") {
      res.status(403).json({ error: "Ce compte a été supprimé." });
      return;
    }

    // Générer tokens
    const tokens = JwtService.generateTokens(user.id, user.email, user.role);

    // Refresh tokens — non bloquant si table inexistante
    try {
      await db.refreshTokens.revokeAllForUser(user.id);
      await db.refreshTokens.create(user.id, tokens.refreshToken);
    } catch (tokenErr) {
      logger.warn("refresh_tokens DB error (non bloquant)", { err: tokenErr instanceof Error ? tokenErr.message : tokenErr });
    }

    // Màj lastLogin — non bloquant
    try {
      await db.users.updateLastLogin(user.id);
    } catch (updateErr) {
      logger.warn("lastLogin update error (non bloquant)", { err: updateErr instanceof Error ? updateErr.message : updateErr });
    }

    logger.info("Login réussi", { userId: user.id, email: user.email });
    void EmailService.sendSecurityAlert(user.email, user.firstname, "new_login", {
      time:   new Date().toLocaleString("fr-FR"),
      device: parseDevice(req.headers["user-agent"] || ""),
    });

    res.json({
      success: true,
      user:       db.users.toPublic(user),
      tokens,
      kycRequired: user.kycStatus !== "approved",
    });

  } catch (err) {
    const message = err instanceof Error ? err.message : "Erreur serveur";
    logger.error("Login erreur inattendue", { email, message });
    res.status(500).json({ error: "Erreur serveur. Réessayez." });
  }
});

// ── POST /api/auth/refresh ────────────────────────────────────
router.post("/refresh", async (req: Request, res: Response) => {
  const { refreshToken } = req.body;

  if (!refreshToken) {
    res.status(400).json({ error: "refreshToken requis" });
    return;
  }

  try {
    // Vérifier signature JWT
    const payload = JwtService.verifyRefreshToken(refreshToken);

    // Vérifier en DB (token pas révoqué, pas expiré)
    const stored = await db.refreshTokens.find(refreshToken);
    if (!stored) {
      res.status(401).json({ error: "Refresh token invalide ou révoqué" });
      return;
    }

    // Vérifier que l'utilisateur existe
    const user = await db.users.findById(payload.userId);
    if (!user || user.status === "banned") {
      res.status(401).json({ error: "Utilisateur invalide" });
      return;
    }

    // Rotation du refresh token
    const tokens = JwtService.generateTokens(user.id, user.email, user.role);
    try {
      await db.refreshTokens.revoke(refreshToken);
      await db.refreshTokens.create(user.id, tokens.refreshToken);
    } catch (tokenErr) {
      logger.warn("refresh_tokens rotation error (non bloquant)", { err: tokenErr instanceof Error ? tokenErr.message : tokenErr });
    }

    logger.debug("Tokens rafraîchis", { userId: user.id });
    res.json({ success: true, tokens });

  } catch (err) {
    const message = err instanceof Error ? err.message : "Erreur refresh";
    logger.warn("Refresh token invalide", { message });
    res.status(401).json({ error: message });
  }
});

// ── POST /api/auth/logout ─────────────────────────────────────
router.post("/logout", requireAuth, async (req: Request, res: Response) => {
  const { refreshToken } = req.body;

  if (refreshToken) {
    await db.refreshTokens.revoke(refreshToken);
  }

  // Option: révoquer TOUS les refresh tokens (déconnexion de tous les appareils)
  if (req.body.allDevices && req.userId) {
    await db.refreshTokens.revokeAllForUser(req.userId);
  }

  logger.info("Logout", { userId: req.userId });
  res.json({ success: true, message: "Déconnecté avec succès" });
});

// ── GET /api/auth/me ──────────────────────────────────────────
router.get("/me", requireAuth, async (req: Request, res: Response) => {
  const user = await db.users.findById(req.userId!);

  if (!user) {
    res.status(404).json({ error: "Utilisateur introuvable" });
    return;
  }

  res.json({
    success: true,
    user: db.users.toPublic(user),
  });
});

// ── POST /api/auth/register/send-code ───────────────────────────
// ✅ NOUVO: verifye adrès imèl la AVAN kont la menm kreye — pou n ka mande
// itilizatè a konfime imèl li AVAN l rive nan etap modpas la (pa gen
// `requireAuth` la esprè, paske kont lan pa egziste ankò).
router.post("/register/send-code", async (req: Request, res: Response) => {
  const { email, firstname } = req.body;
  if (!email || !String(email).includes("@")) {
    res.status(400).json({ error: "Email invalide" });
    return;
  }
  const existing = await db.users.findByEmail(String(email).toLowerCase());
  if (existing) {
    res.status(409).json({ error: "Un compte existe déjà avec cet email" });
    return;
  }

  const code = Math.floor(100000 + Math.random() * 900000).toString();
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 min
  await db.pendingEmailVerifications.upsert(email, code, expiresAt);
  void EmailService.sendVerification(email, firstname || "", code).catch(() => null);

  logger.info("Kòd verifikasyon pre-kont voye", { email });
  res.json({ success: true, message: "Code envoyé" });
});

// ── POST /api/auth/register/verify-code ─────────────────────────
router.post("/register/verify-code", async (req: Request, res: Response) => {
  const { email, code } = req.body;
  if (!email || !code || typeof code !== "string" || code.length !== 6) {
    res.status(400).json({ error: "Code à 6 chiffres requis" });
    return;
  }
  const pending = await db.pendingEmailVerifications.find(email);
  if (!pending || pending.code !== code || new Date(pending.expires_at as string) < new Date()) {
    res.status(400).json({ error: "Code invalide ou expiré" });
    return;
  }
  await db.pendingEmailVerifications.markVerified(email);
  logger.info("Imèl verifye anvan kreyasyon kont", { email });
  res.json({ success: true });
});

// ── POST /api/auth/verify-email/send ────────────────────────────
// ✅ NOUVO: VerifyEmail.tsx (frontend) deja bati e li rele wout sa a —
// men li pa t janm egziste nan backend la. Jenere yon nouvo kòd, sove l,
// voye l pa imèl.
router.post("/verify-email/send", requireAuth, async (req: Request, res: Response) => {
  const user = await db.users.findById(req.userId!);
  if (!user) { res.status(404).json({ error: "Utilisateur introuvable" }); return; }

  if (user.emailVerified) {
    res.json({ success: true, alreadyVerified: true });
    return;
  }

  const code = Math.floor(100000 + Math.random() * 900000).toString();
  await db.users.setEmailVerificationCode(user.id, code);
  void EmailService.sendVerification(user.email, user.firstname, code).catch(() => null);

  logger.info("Kòd verifikasyon imèl re-voye", { userId: user.id });
  res.json({ success: true, message: "Code envoyé" });
});

// ── POST /api/auth/verify-email/confirm ─────────────────────────
router.post("/verify-email/confirm", requireAuth, async (req: Request, res: Response) => {
  const { code } = req.body;
  if (!code || typeof code !== "string" || code.length !== 6) {
    res.status(400).json({ error: "Code à 6 chiffres requis" });
    return;
  }

  const ok = await db.users.verifyEmailCode(req.userId!, code);
  if (!ok) {
    res.status(400).json({ error: "Code invalide ou expiré" });
    return;
  }

  logger.info("Email vérifié avec succès", { userId: req.userId });
  res.json({ success: true, message: "Email vérifié" });
});

// ── PATCH /api/auth/password ──────────────────────────────────
router.patch("/password", validateBody(schemas.changePassword), requireAuth, async (req: Request, res: Response) => {
  const { currentPassword, newPassword } = req.body;

  if (!currentPassword || !newPassword) {
    res.status(400).json({ error: "currentPassword et newPassword requis" });
    return;
  }

  const passV = Validate.password(newPassword);
  if (!passV.valid) {
    res.status(400).json({ error: passV.error });
    return;
  }

  const user = await db.users.findById(req.userId!);
  if (!user) {
    res.status(404).json({ error: "Utilisateur introuvable" });
    return;
  }

  const isValid = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!isValid) {
    res.status(401).json({ error: "Mot de passe actuel incorrect" });
    return;
  }

  const newHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
  await db.users.updatePassword(user.id, newHash);

  // Révoquer tous les refresh tokens (forcer reconnexion)
  await db.refreshTokens.revokeAllForUser(user.id);

  logger.info("Mot de passe changé", { userId: user.id });
  NotificationService.securityAlert(user.id, "password_changed");
  res.json({ success: true, message: "Mot de passe mis à jour. Reconnectez-vous." });
});

// ── DELETE /api/auth/account ─────────────────────────────────
// ✅ NOUVO: Apple (5.1.1(v)) AK Google TOU DE mande app finansye yo ofri
// efasman kont ANNDAN app la. Nou egzije modpas la (pou konfime se vrèman
// mèt kont lan, pa yon sesyon vòlè), e nou verifye pa gen lajan/kat aktif
// ki gen balans anvan nou aksepte — sa ta lakòz lajan "pèdi" san rezon.
router.delete("/account", requireAuth, async (req: Request, res: Response) => {
  const { password } = req.body;
  if (!password) {
    res.status(400).json({ error: "Mot de passe requis pour confirmer la suppression" });
    return;
  }

  const user = await db.users.findById(req.userId!);
  if (!user) {
    res.status(404).json({ error: "Utilisateur introuvable" });
    return;
  }

  const isValid = await bcrypt.compare(password, user.passwordHash);
  if (!isValid) {
    res.status(401).json({ error: "Mot de passe incorrect" });
    return;
  }

  // ✅ Anpeche efase yon kont ki gen lajan — itilizatè a dwe retire l anvan.
  const wallet = await db.wallets.findByUserId(user.id, "USD");
  if (wallet && wallet.balance > 100) { // >$1.00, tolerans pousyè pou frè rezidyèl
    res.status(400).json({ error: "Retirez votre solde avant de supprimer votre compte", code: "BALANCE_NOT_ZERO", balance: wallet.balance });
    return;
  }
  const userCards = await db.cards.findByEmail(user.email) as Array<Record<string, unknown>>;
  const activeCardWithBalance = userCards.find((c) => c.status !== "terminated" && ((c.balance as number) || 0) > 100);
  if (activeCardWithBalance) {
    res.status(400).json({ error: "Videz et supprimez vos cartes avant de supprimer votre compte", code: "CARDS_NOT_EMPTY" });
    return;
  }

  // ✅ Anonimize done pèsonèl yo (pa efase liy istorik/ledger — obligasyon
  // konfòmite kontab), epi make kont lan "deleted" — imèl orijinal la
  // lib pou reyitilize si moun nan vle re-enskri pita.
  const anonymizedEmail = `deleted+${user.id}@fredapay.com`;
  await db.users.update(user.id, {
    email: anonymizedEmail,
    firstname: "Compte", lastname: "Supprimé",
    phone: undefined, address: undefined, city: undefined, state: undefined,
    avatarUrl: undefined,
  });
  await db.users.updateStatus(user.id, "deleted");
  await db.refreshTokens.revokeAllForUser(user.id);

  logger.info("Kont itilizatè efase", { userId: user.id, originalEmail: user.email });
  res.json({ success: true, message: "Votre compte a été supprimé." });
});

export default router;
