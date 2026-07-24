// ============================================================
// Routes Admin — Dashboard staff (RBAC)
// Base: /api/admin
// Wòl: super_admin, admin, comptable, service_client
// ============================================================

import { Router, Request, Response } from "express";
import bcrypt from "bcryptjs";
import { db } from "../db/store";
import { getSupabase } from "../db/supabase";
import { requireAuth, requireAdmin, requireRole } from "../middleware/auth";
import { logger } from "../utils/logger";
import { FeeService } from "../services/fee.service";
import { CardFeesService } from "../services/cardFees.service";
import { MapleradWalletService, MapleradCardService, MapleradCustomerService, isMapleradSandbox } from "../services/maplerad.service";
import { NotificationService } from "../services/notification.service";
import { EmailService } from "../services/email.service";
import { Validate } from "../utils/validation";

const router = Router();
const BCRYPT_ROUNDS = 12;
const STAFF_ROLES = ["admin", "super_admin", "comptable", "service_client"] as const;
type StaffRole = typeof STAFF_ROLES[number];

// Tout wout admin egzije yon sesyon valid + yon wòl staff
router.use(requireAuth, requireAdmin);

// ── GET /api/admin/me ──────────────────────────────────────────
router.get("/me", async (req: Request, res: Response) => {
  const user = await db.users.findById(req.userId!);
  if (!user) { res.status(404).json({ error: "Introuvable" }); return; }
  res.json({ success: true, data: db.users.toPublic(user) });
});

// ============================================================
// GESTION DES ADMINS — super_admin sèlman
// ============================================================

router.get("/admins", requireRole("super_admin"), async (_req: Request, res: Response) => {
  const { data, error } = await getSupabase()
    .from("users").select("*")
    .in("role", STAFF_ROLES as unknown as string[])
    .order("created_at", { ascending: false });
  if (error) { res.status(500).json({ error: error.message }); return; }
  const admins = (data || []).map((r: any) => {
    const { password_hash, ...pub } = r;
    return pub;
  });
  res.json({ success: true, count: admins.length, data: admins });
});

router.post("/admins", requireRole("super_admin"), async (req: Request, res: Response) => {
  const { email, password, firstname, lastname, role } = req.body;

  if (!email || !password || !firstname || !lastname || !role) {
    res.status(400).json({ error: "Chan requis: email, password, firstname, lastname, role" });
    return;
  }
  if (!STAFF_ROLES.includes(role)) {
    res.status(400).json({ error: `Wòl envalid. Valè posib: ${STAFF_ROLES.join(", ")}` });
    return;
  }
  const emailCheck = Validate.email(email);
  if (!emailCheck.valid) { res.status(400).json({ error: emailCheck.error || "Email envalid" }); return; }
  if (String(password).length < 8) { res.status(400).json({ error: "Modpas dwe gen omwen 8 karaktè" }); return; }

  const existing = await db.users.findByEmail(email);
  if (existing) { res.status(409).json({ error: "Yon kont deja egziste ak email sa a" }); return; }

  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  const freddaTag = `staff_${Date.now().toString(36)}`;

  const newAdmin = await db.users.create({
    email: email.toLowerCase(), passwordHash,
    firstname, lastname,
    FredaTag: freddaTag,
    role: role as StaffRole,
    status: "active",
    kycStatus: "not_started",
    emailVerified: true,
    phoneVerified: false,
    twoFactorEnabled: false,
  } as any);

  await db.users.update(newAdmin.id, { createdByAdminId: req.userId } as any).catch(() => null);

  logger.info("Nouvo kont admin kreye", { newAdminId: newAdmin.id, role, createdBy: req.userId });
  res.status(201).json({ success: true, data: db.users.toPublic(newAdmin) });
});

router.patch("/admins/:id", requireRole("super_admin"), async (req: Request, res: Response) => {
  const { id } = req.params;
  const { role, status } = req.body;

  if (id === req.userId) {
    res.status(400).json({ error: "Ou pa ka modifye pwòp kont ou de isit la" });
    return;
  }

  const target = await db.users.findById(id);
  if (!target) { res.status(404).json({ error: "Kont introuvable" }); return; }
  if (!STAFF_ROLES.includes(target.role as StaffRole) && target.role !== "user") {
    res.status(400).json({ error: "Kont sa a pa yon kont staff" }); return;
  }

  if (role !== undefined) {
    if (!STAFF_ROLES.includes(role)) {
      res.status(400).json({ error: `Wòl envalid. Valè posib: ${STAFF_ROLES.join(", ")}` });
      return;
    }
    await db.users.update(id, { role } as any);
  }
  if (status !== undefined) {
    const allowed = ["active", "suspended"];
    if (!allowed.includes(status)) { res.status(400).json({ error: "Status envalid" }); return; }
    await db.users.updateStatus(id, status);
  }

  logger.info("Kont admin modifye", { targetId: id, role, status, by: req.userId });
  res.json({ success: true });
});

router.delete("/admins/:id", requireRole("super_admin"), async (req: Request, res: Response) => {
  const { id } = req.params;
  if (id === req.userId) {
    res.status(400).json({ error: "Ou pa ka retire pwòp aksè ou de isit la" });
    return;
  }
  await db.users.update(id, { role: "user" } as any);
  logger.info("Aksè admin retire", { targetId: id, by: req.userId });
  res.json({ success: true, message: "Aksè admin retire — kont lan tounen yon itilizatè òdinè" });
});

// ============================================================
// VIZIBILITE APLIKASYON — tout wòl staff
// ============================================================

router.get("/stats", async (_req: Request, res: Response) => {
  const [userCount, wallets, cardList, kycSessions, txnCount, staffRes] = await Promise.all([
    db.users.count(),
    db.wallets.list(),
    db.cards.list(),
    db.kyc.list(),
    db.transfers.count(),
    getSupabase().from("users").select("id", { count: "exact", head: true }).in("role", STAFF_ROLES as unknown as string[]),
  ]);

  const totalBalanceCents = wallets.reduce((sum, w: any) => sum + (w.balance || 0), 0);

  res.json({
    success: true,
    data: {
      users: userCount,
      wallets: wallets.length,
      totalBalanceUSD: totalBalanceCents / 100,
      cards: { total: cardList.length, active: cardList.filter((c: any) => c.status === "active").length },
      kyc: {
        total: kycSessions.length,
        approved: kycSessions.filter((s: any) => s.status === "Approved").length,
        pending: kycSessions.filter((s: any) => s.status === "Not Started" || s.status === "In Progress").length,
      },
      transactions: txnCount,
      staffCount: staffRes.count || 0,
    },
  });
});

router.get("/users", requireRole("admin", "super_admin", "service_client"), async (req: Request, res: Response) => {
  const limit = Math.min(parseInt(String(req.query.limit || "50")), 200);
  const q = String(req.query.q || "").trim().toLowerCase();

  let users = await db.users.list(limit);
  if (q) {
    users = users.filter(u =>
      u.email.toLowerCase().includes(q) ||
      `${u.firstname} ${u.lastname}`.toLowerCase().includes(q) ||
      u.FredaTag.toLowerCase().includes(q)
    );
  }
  res.json({ success: true, count: users.length, data: users.map(u => db.users.toPublic(u)) });
});

router.get("/users/:id", requireRole("admin", "super_admin", "service_client"), async (req: Request, res: Response) => {
  const { id } = req.params;
  const user = await db.users.findById(id);
  if (!user) { res.status(404).json({ error: "Itilizatè introuvable" }); return; }

  const [wallet, cards, kyc, transactions] = await Promise.all([
    db.wallets.findByUserId(id),
    db.cards.findByEmail(user.email).catch(() => []),
    db.kyc.findByUserId(id).catch(() => undefined),
    db.ledger.findByUserId(id, 50).catch(() => []),
  ]);

  res.json({
    success: true,
    data: { user: db.users.toPublic(user), wallet, cards, kyc, transactions },
  });
});

// ── POST /api/admin/users/:id/credit ──────────────────────────
// ✅ NOUVO: admin ka ajoute lajan dirèkteman sou balans wallet yon kliyan
// (egzanp: konpansasyon, jès kòmèsyal, korije yon erè). Sa kreye yon antre
// ledger vizib nan istorik kliyan an, pa yon "ekri majik" san tras.
router.post("/users/:id/credit", requireRole("admin", "super_admin", "comptable"), async (req: Request, res: Response) => {
  const { id } = req.params;
  const { amount, reason } = req.body;
  const amountNum = parseFloat(amount);
  if (!amountNum || amountNum <= 0) { res.status(400).json({ error: "Montant invalide" }); return; }
  if (!reason || !String(reason).trim()) { res.status(400).json({ error: "Rezon an obligatwa (pou tras odit la)" }); return; }

  try {
    const user = await db.users.findById(id);
    if (!user) { res.status(404).json({ error: "Itilizatè introuvable" }); return; }

    const amountCents = Math.round(amountNum * 100);
    await db.wallets.credit(id, amountCents);
    await db.ledger.insert({
      userId: id, type: "admin_credit", status: "completed", direction: "credit",
      grossCents: amountCents, feeCents: 0, netCents: amountCents,
      description: `Crédit admin — ${reason}`,
      note: `Par ${req.userId}`,
    }).catch(() => null);

    await NotificationService.system(id, "Crédit reçu", `$${amountNum.toFixed(2)} ont été ajoutés à votre wallet Freda Pay.`).catch(() => null);

    logger.info("Crédit admin sou wallet kliyan", { userId: id, amountCents, reason, by: req.userId });
    res.json({ success: true, message: `$${amountNum.toFixed(2)} ajoutés au wallet de ${user.firstname} ${user.lastname}.` });
  } catch (e: any) {
    logger.error("Erreur crédit admin", { userId: id, error: e.message, by: req.userId });
    res.status(500).json({ error: e.message });
  }
});

router.get("/transactions", requireRole("admin", "super_admin", "comptable"), async (req: Request, res: Response) => {
  const limit = Math.min(parseInt(String(req.query.limit || "200")), 500);
  const txns = await db.transfers.list(limit);
  res.json({ success: true, count: Array.isArray(txns) ? txns.length : 0, data: txns });
});

router.get("/cards", requireRole("admin", "super_admin", "comptable"), async (_req: Request, res: Response) => {
  const cards = await db.cards.list() as any[];
  // ✅ Pa fè konfyans total nan kopi lokal la — toujou re-tcheke VRÈ balans
  // Maplerad la an paralèl pou chak kat ki gen yon ID konfime.
  const syncable = cards.filter(c => c.maplerad_card_id && c.status !== "terminated" && !c.hidden);
  if (syncable.length > 0) {
    await Promise.all(syncable.map(async (c) => {
      try {
        const live = await MapleradCardService.getCard(c.maplerad_card_id);
        if (live?.data && typeof live.data.balance === "number") {
          c.balance = live.data.balance;
          await db.cards.upsert({ cardid: c.cardid, userId: c.user_id, balance: live.data.balance }).catch(() => null);
        }
      } catch (e: any) {
        logger.warn("Échec sync balance carte (admin)", { cardid: c.cardid, error: e.message });
      }
    }));
  }
  res.json({ success: true, count: cards.length, data: cards });
});

// ── DELETE /api/admin/cards/:cardId ───────────────────────────
// ✅ NOUVO: admin/service_client ka siprime yon kat kliyan dirèkteman (egzanp
// si yon kliyan rele pou mande sa). Menm konpòtman ak DELETE /api/maplerad/
// cards/:cardId kliyan an itilize (tèminezon PÈMANAN sou Maplerad —
// https://maplerad.dev/reference/freeze-a-card-1 — anvan l kache lokalman).
router.delete("/cards/:cardId", requireRole("admin", "super_admin", "service_client"), async (req: Request, res: Response) => {
  const { cardId } = req.params;
  try {
    const local = await db.cards.findByCardId(cardId) as any;
    if (!local) { res.status(404).json({ error: "Carte introuvable" }); return; }

    if (local.status !== "terminated") {
      try {
        const realId = local.maplerad_card_id || cardId;
        await MapleradCardService.terminateCard(realId);
        logger.info("Kat tèmine pa admin", { cardId, realId, by: req.userId });
      } catch (termErr: any) {
        logger.warn("Echèk tèminezon pa admin — kontinye siprimasyon lokal kanmenm", {
          cardId, error: termErr.message, by: req.userId,
        });
      }
    }

    await db.cards.upsert({ cardid: cardId, userId: local.user_id, status: "terminated", hidden: true });
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/kyc", requireRole("admin", "super_admin", "service_client"), async (_req: Request, res: Response) => {
  const sessions = await db.kyc.list();
  const stats = {
    total:    sessions.length,
    approved: sessions.filter((s: any) => s.status === "Approved").length,
    pending:  sessions.filter((s: any) => s.status === "Not Started" || s.status === "In Progress").length,
    declined: sessions.filter((s: any) => s.status === "Declined").length,
    inReview: sessions.filter((s: any) => s.status === "In Review").length,
  };
  res.json({ success: true, stats, data: sessions });
});

router.get("/webhooks", requireRole("admin", "super_admin"), async (_req: Request, res: Response) => {
  const events = await db.webhookEvents.list(100) as Record<string, unknown>[];
  const stats = {
    total:     events.length,
    processed: events.filter(e => e.status === "processed").length,
    failed:    events.filter(e => e.status === "failed").length,
    received:  events.filter(e => e.status === "received").length,
    duplicate: events.filter(e => e.status === "duplicate").length,
  };
  res.json({ success: true, stats, events });
});

router.get("/health", requireRole("admin", "super_admin"), async (_req: Request, res: Response) => {
  res.json({
    status: "ok",
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    env: process.env.NODE_ENV,
    db: {
      cards:        (await db.cards.list()).length,
      transactions: (await db.transfers.list(9999)).length,
      webhooks:     (await db.webhookEvents.list(9999)).length,
      kycSessions:  (await db.kyc.list()).length,
      wallets:      (await db.wallets.list()).length,
      transfers:    await db.transfers.count(),
    },
  });
});

// ============================================================
// FRÈ / PRIX — admin, super_admin, comptable
// ============================================================

router.get("/fees", requireRole("admin", "super_admin", "comptable"), async (_req: Request, res: Response) => {
  const { data, error } = await getSupabase().from("payment_fees").select("*").order("provider").order("method_id");
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json({ success: true, data });
});

router.patch("/fees/:methodId", requireRole("admin", "super_admin", "comptable"), async (req: Request, res: Response) => {
  const { methodId } = req.params;
  const allowedFields = [
    "deposit_flat_usd", "deposit_pct", "deposit_min_usd", "deposit_max_usd",
    "withdraw_flat_usd", "withdraw_pct", "withdraw_min_usd", "withdraw_max_usd",
    "deposit_time", "withdraw_time", "is_active",
  ];
  const updates: Record<string, unknown> = {};
  for (const f of allowedFields) if (req.body[f] !== undefined) updates[f] = req.body[f];
  if (Object.keys(updates).length === 0) { res.status(400).json({ error: "Okenn chan valid pou modifye" }); return; }
  updates.updated_at = new Date().toISOString();

  const { data, error } = await getSupabase().from("payment_fees").update(updates).eq("method_id", methodId).select().single();
  if (error || !data) { res.status(404).json({ error: error?.message || "Metòd introuvable" }); return; }

  FeeService.invalidateCache?.();
  logger.info("Frè metòd modifye", { methodId, updates, by: req.userId });
  res.json({ success: true, data });
});

router.get("/card-fees", requireRole("admin", "super_admin", "comptable"), async (_req: Request, res: Response) => {
  const fees = await CardFeesService.listAll();
  res.json({ success: true, data: fees });
});

// ============================================================
// MAPLERAD ISSUING — Balans SPEND/TREASURY (admin, super_admin)
// ============================================================

// ── GET /api/admin/maplerad/wallets ──────────────────────────
// Konsilte balans SPEND/TREASURY Freda Pay sou Maplerad
router.get("/maplerad/wallets", requireRole("admin", "super_admin"), async (_req: Request, res: Response) => {
  try {
    const result = await MapleradWalletService.getWallets();
    res.json({ success: true, sandbox: isMapleradSandbox(), data: result.data });
  } catch (e: any) {
    res.status(502).json({ error: e.message || "Erreur Maplerad" });
  }
});

// ── GET /api/admin/maplerad/customer-status/:userId ──────────
// ✅ NOUVO: dyagnostik pou pwoblèm "Business card vs Customer card" —
// montre EGZAKTEMAN tier/estati yon kliyan genyen sou Maplerad (pa yon
// estimasyon lokal), pou n ka konfime si Tier 2 reyèlman konplete oswa si
// li echwe an silans (egzanp: imaj plasholder nan upgrade Tier 2 rejte).
router.get("/maplerad/customer-status/:userId", requireRole("admin", "super_admin"), async (req: Request, res: Response) => {
  try {
    const user = await db.users.findById(req.params.userId);
    if (!user) { res.status(404).json({ error: "Utilisateur introuvable" }); return; }
    const customerId = (user as any).mapleradCustomerId;
    if (!customerId) {
      res.json({ success: true, data: { enrolled: false, reason: "Pa gen mapleradCustomerId lokalman" } });
      return;
    }
    const result = await MapleradCustomerService.getCustomer(customerId);
    res.json({
      success: true,
      data: {
        localTier:      (user as any).mapleradTier ?? null,
        customerId,
        mapleradRaw:    result.data,  // ← montre tier/status EGZAKT jan Maplerad wè l
      },
    });
  } catch (e: any) {
    res.status(502).json({ error: e.message || "Erreur Maplerad" });
  }
});

// ── POST /api/admin/maplerad/sandbox-fund ────────────────────
// SANDBOX SÈLMAN — kredite wallet tès la epi deplase l nan SPEND
// (SPEND se sèl kote operasyon kat yo ka pran lajan, dapre Maplerad)
router.post("/maplerad/sandbox-fund", requireRole("admin", "super_admin"), async (req: Request, res: Response) => {
  if (!isMapleradSandbox()) {
    res.status(403).json({ error: "Wout sa a disponib sèlman ak kle sandbox Maplerad — ou konekte an mòd live." });
    return;
  }
  const amount   = parseFloat(req.body.amount);
  const currency = (req.body.currency || "USD").toUpperCase();
  if (!amount || amount <= 0) { res.status(400).json({ error: "Montan envalid" }); return; }

  try {
    // 1. Kredite wallet tès la (lajan fiktif sandbox)
    await MapleradWalletService.creditTestWallet(amount, currency);
    // 2. Deplase l nan SPEND — sèl wallet operasyon kat yo ka itilize
    await MapleradWalletService.fundWallet({
      currency, source_wallet_type: "TREASURY", destination_wallet_type: "SPEND", amount,
    });

    const wallets = await MapleradWalletService.getWallets();
    logger.info("Sandbox Maplerad fonn", { amount, currency, by: req.userId });
    res.json({ success: true, message: `$${amount} ${currency} ajoute nan SPEND wallet`, data: wallets.data });
  } catch (e: any) {
    logger.error("Erreur fonn sandbox Maplerad", { error: e.message, by: req.userId });
    res.status(502).json({ error: e.message || "Erreur Maplerad" });
  }
});

// ── POST /api/admin/maplerad/backfill-card-ids ────────────────
// Repare kat KI KREYE ANVAN fix `maplerad_card_id` la — matche chak
// kat lokal ki manke `maplerad_card_id` ak lis kat Maplerad la pa `masked_pan`.
router.post("/maplerad/backfill-card-ids", requireRole("admin", "super_admin"), async (_req: Request, res: Response) => {
  try {
    const [localCards, mapleradRes] = await Promise.all([
      db.cards.list(),
      MapleradCardService.getCards(),
    ]);
    const mapleradCards = mapleradRes.data || [];

    const fixed: string[] = [];
    const notFound: string[] = [];
    const alreadyOk: string[] = [];

    for (const c of localCards as any[]) {
      if (c.maplerad_card_id) { alreadyOk.push(c.cardid); continue; }
      const match = mapleradCards.find((mc: any) => mc.masked_pan && mc.masked_pan === c.masked_pan);
      if (match) {
        await db.cards.upsert({ cardid: c.cardid, userId: c.user_id, mapleradCardId: match.id }).catch(() => null);
        fixed.push(c.cardid);
      } else {
        notFound.push(c.cardid);
      }
    }

    logger.info("Backfill maplerad_card_id", { fixed: fixed.length, notFound: notFound.length, alreadyOk: alreadyOk.length });
    res.json({ success: true, fixed, notFound, alreadyOk: alreadyOk.length });
  } catch (e: any) {
    res.status(502).json({ error: e.message || "Erreur Maplerad" });
  }
});

router.patch("/card-fees/:key", requireRole("admin", "super_admin", "comptable"), async (req: Request, res: Response) => {
  const { key } = req.params;
  const { amountCents, percentBps, minCents, maxCents, label } = req.body;
  try {
    const updated = await CardFeesService.update(key, req.userId!, { amountCents, percentBps, minCents, maxCents, label });
    logger.info("Frè kat modifye", { key, by: req.userId });
    res.json({ success: true, data: updated });
  } catch (e: any) {
    res.status(404).json({ error: e.message || "Frè introuvable" });
  }
});

// ============================================================
// ABÒNMAN KADO — yon itilizatè oswa TOUT itilizatè yo
// ============================================================

// ── POST /api/admin/users/:id/gift-subscription ───────────────
// ✅ NOUVO: bay yon kliyan yon plan gratis (`choosePlan` se yon operasyon
// DB SÈLMAN — li pa touche wallet la ditou, kontrèman ak wout /choose
// kliyan an itilize a, ki debite wallet la SEPAREMAN apre).
router.post("/users/:id/gift-subscription", requireRole("admin", "super_admin"), async (req: Request, res: Response) => {
  const { id } = req.params;
  const { plan } = req.body;
  if (!plan || !["trial", "start-up", "pro", "standard"].includes(plan)) {
    res.status(400).json({ error: "Plan envalid (trial, start-up, pro, standard)" });
    return;
  }
  try {
    const user = await db.users.findById(id);
    if (!user) { res.status(404).json({ error: "Itilizatè introuvable" }); return; }
    await db.subscriptions.choosePlan(id, plan);
    await NotificationService.system(id, "🎁 Abonnement offert !", `Vous avez reçu le plan ${plan} gratuitement pendant 1 mois. Merci d'être avec Freda Pay !`).catch(() => null);
    logger.info("Abònman kado bay yon itilizatè", { userId: id, plan, by: req.userId });
    res.json({ success: true, message: `Plan ${plan} offert à ${user.firstname} ${user.lastname}.` });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/admin/gift-subscription-all ──────────────────────
// ⚠️ Aksyon lou — touche TOUT itilizatè yo. Rezève pou super_admin sèlman.
router.post("/gift-subscription-all", requireRole("super_admin"), async (req: Request, res: Response) => {
  const { plan } = req.body;
  if (!plan || !["trial", "start-up", "pro", "standard"].includes(plan)) {
    res.status(400).json({ error: "Plan envalid (trial, start-up, pro, standard)" });
    return;
  }
  try {
    const { data: users, error } = await getSupabase().from("users").select("id").eq("role", "user");
    if (error) throw new Error(error.message);
    let count = 0;
    for (const u of users || []) {
      await db.subscriptions.choosePlan((u as any).id, plan).catch((e: any) =>
        logger.warn("Echèk kado abònman pou yon itilizatè", { userId: (u as any).id, error: e.message })
      );
      count++;
    }
    logger.info("Abònman kado bay TOUT itilizatè yo", { plan, count, by: req.userId });
    res.json({ success: true, message: `Plan ${plan} offert à ${count} utilisateur(s).` });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ============================================================
// IMÈL — voye bay yon itilizatè oswa tout itilizatè yo
// ============================================================

// ── POST /api/admin/users/:id/email ────────────────────────────
router.post("/users/:id/email", requireRole("admin", "super_admin", "service_client"), async (req: Request, res: Response) => {
  const { id } = req.params;
  const { subject, message } = req.body;
  if (!subject?.trim() || !message?.trim()) { res.status(400).json({ error: "Sujet ak mesaj obligatwa" }); return; }
  try {
    const user = await db.users.findById(id);
    if (!user) { res.status(404).json({ error: "Itilizatè introuvable" }); return; }
    const sent = await EmailService.sendAdminMessage(user.email, user.firstname, subject, message);
    if (!sent) { res.status(502).json({ error: "Echèk voye imèl la (verifye kle Brevo a)" }); return; }
    logger.info("Imèl admin voye bay yon itilizatè", { userId: id, subject, by: req.userId });
    res.json({ success: true, message: `Email envoyé à ${user.email}.` });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/admin/email/broadcast ────────────────────────────
// ⚠️ Aksyon lou — voye bay TOUT itilizatè yo. Rezève pou super_admin sèlman.
router.post("/email/broadcast", requireRole("super_admin"), async (req: Request, res: Response) => {
  const { subject, message } = req.body;
  if (!subject?.trim() || !message?.trim()) { res.status(400).json({ error: "Sujet ak mesaj obligatwa" }); return; }
  try {
    const { data: users, error } = await getSupabase().from("users").select("id, email, firstname").eq("role", "user");
    if (error) throw new Error(error.message);
    let sentCount = 0, failCount = 0;
    for (const u of (users || []) as any[]) {
      const ok = await EmailService.sendAdminMessage(u.email, u.firstname, subject, message).catch(() => false);
      if (ok) sentCount++; else failCount++;
    }
    logger.info("Imèl difize bay TOUT itilizatè yo", { subject, sentCount, failCount, by: req.userId });
    res.json({ success: true, message: `Email envoyé à ${sentCount} utilisateur(s)${failCount ? ` (${failCount} échec(s))` : ""}.` });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ============================================================
// ANONS / BANNYÈ APP LA
// ============================================================

router.get("/announcements", requireRole(...STAFF_ROLES), async (_req: Request, res: Response) => {
  const data = await db.announcements.list();
  res.json({ success: true, data });
});

router.post("/announcements", requireRole("admin", "super_admin"), async (req: Request, res: Response) => {
  const { message, isScrolling, tone } = req.body;
  if (!message?.trim()) { res.status(400).json({ error: "Mesaj la obligatwa" }); return; }
  try {
    const data = await db.announcements.create({ message, isScrolling, tone, createdByAdminId: req.userId! });
    logger.info("Anons kreye", { id: (data as any).id, by: req.userId });
    res.json({ success: true, data });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.patch("/announcements/:id", requireRole("admin", "super_admin"), async (req: Request, res: Response) => {
  const { id } = req.params;
  const { message, isScrolling, tone } = req.body;
  const patch: Record<string, unknown> = {};
  if (message !== undefined) patch.message = message;
  if (isScrolling !== undefined) patch.is_scrolling = isScrolling;
  if (tone !== undefined) patch.tone = tone;
  try {
    const data = await db.announcements.update(id, patch);
    res.json({ success: true, data });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ✅ Garanti YON SÈL anons aktif alafwa — dezaktive tout lòt anvan.
router.post("/announcements/:id/activate", requireRole("admin", "super_admin"), async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    await db.announcements.deactivateAll();
    const data = await db.announcements.update(id, { is_active: true });
    logger.info("Anons aktive", { id, by: req.userId });
    res.json({ success: true, data });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/announcements/:id/deactivate", requireRole("admin", "super_admin"), async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const data = await db.announcements.update(id, { is_active: false });
    res.json({ success: true, data });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.delete("/announcements/:id", requireRole("admin", "super_admin"), async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    await db.announcements.delete(id);
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ============================================================
// MÒD MENTNANS ("Hors service")
// ============================================================

router.get("/maintenance", requireRole(...STAFF_ROLES), async (_req: Request, res: Response) => {
  const data = await db.appSettings.get("maintenance_mode");
  res.json({ success: true, data: data || { enabled: false, message: "" } });
});

router.post("/maintenance", requireRole("admin", "super_admin"), async (req: Request, res: Response) => {
  const { enabled, message } = req.body;
  try {
    const data = await db.appSettings.set("maintenance_mode", {
      enabled: !!enabled, message: message || "",
    }, req.userId);
    logger.info("Mòd mentnans chanje", { enabled: !!enabled, by: req.userId });
    res.json({ success: true, data: data.value });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ============================================================
// INBOX — contact@fredapay.com / support@fredapay.com
// ============================================================

router.get("/inbox", requireRole("admin", "super_admin", "service_client"), async (req: Request, res: Response) => {
  const mailbox = req.query.mailbox ? String(req.query.mailbox) : undefined;
  const data = await db.inboxEmails.list(mailbox, 300);
  res.json({ success: true, count: Array.isArray(data) ? data.length : 0, data });
});

router.get("/inbox/:id", requireRole("admin", "super_admin", "service_client"), async (req: Request, res: Response) => {
  const { id } = req.params;
  const email = await db.inboxEmails.findById(id);
  if (!email) { res.status(404).json({ error: "Imèl introuvable" }); return; }
  // Chak fwa admin ouvri yon imèl, make l li
  if (!email.is_read) await db.inboxEmails.markRead(id).catch(() => null);
  const thread = email.thread_id ? await db.inboxEmails.findByThreadId(email.thread_id as string) : [email];
  res.json({ success: true, data: { email, thread } });
});

// ── POST /api/admin/inbox/:id/reply ────────────────────────────
// Reponn dirèkteman nan konvèsasyon an — voye pa Brevo, epi sove yon kopi
// "outbound" nan menm thread la pou istorik konvèsasyon an rete konplè.
router.post("/inbox/:id/reply", requireRole("admin", "super_admin", "service_client"), async (req: Request, res: Response) => {
  const { id } = req.params;
  const { message } = req.body;
  if (!message?.trim()) { res.status(400).json({ error: "Mesaj la obligatwa" }); return; }
  try {
    const original = await db.inboxEmails.findById(id);
    if (!original) { res.status(404).json({ error: "Imèl introuvable" }); return; }

    const subject = String(original.subject || "").startsWith("Re:") ? String(original.subject) : `Re: ${original.subject || "Votre message"}`;
    const sent = await EmailService.sendAdminMessage(
      String(original.from_email), String(original.from_name || original.from_email), subject, message
    );
    if (!sent) { res.status(502).json({ error: "Echèk voye repons lan (verifye kle Brevo a)" }); return; }

    await db.inboxEmails.create({
      direction: "outbound",
      mailbox: original.mailbox,
      from_email: original.mailbox,
      from_name: "Freda Pay",
      to_email: original.from_email,
      subject,
      body_text: message,
      thread_id: original.thread_id || original.id,
      is_read: true,
      replied_by_admin_id: req.userId,
    });
    // Si se te premye mesaj nan yon "thread" ki pa t gen `thread_id` (kaz kote
    // premye imèl la pa t gen youn), make orijinal la kòm rasin thread la kounye a.
    if (!original.thread_id) await getSupabase().from("inbox_emails").update({ thread_id: original.id }).eq("id", original.id);

    logger.info("Repons Inbox voye", { emailId: id, to: original.from_email, by: req.userId });
    res.json({ success: true, message: `Réponse envoyée à ${original.from_email}.` });
  } catch (e: any) {
    logger.error("Erreur repons Inbox", { emailId: id, error: e.message, by: req.userId });
    res.status(500).json({ error: e.message });
  }
});

// ============================================================
// TAUX CHANJ DEVIZ
// ============================================================

router.get("/currency-rates", requireRole(...STAFF_ROLES), async (_req: Request, res: Response) => {
  const data = await db.currencyRates.list();
  res.json({ success: true, data });
});

router.patch("/currency-rates/:currency", requireRole("admin", "super_admin", "comptable"), async (req: Request, res: Response) => {
  const { currency } = req.params;
  const { usdRate } = req.body;
  const rate = parseFloat(usdRate);
  if (!rate || rate <= 0) { res.status(400).json({ error: "Taux envalid" }); return; }
  try {
    const data = await db.currencyRates.update(currency.toUpperCase(), rate, req.userId);
    logger.info("Taux chanj modifye", { currency, usdRate: rate, by: req.userId });
    res.json({ success: true, data });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
