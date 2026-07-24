// ============================================================
// Routes Wallet & Transfers — Freda Pay
// Base: /api/wallet
// Toutes les routes nécessitent l'authentification JWT
// ============================================================

import { Router, Request, Response } from "express";
import { requireAuth } from "../middleware/auth";
import { validateBody, schemas } from "../middleware/validation";
import { NotificationService } from "../services/notification.service";
import { EmailService } from "../services/email.service";
import { WalletService, toCents, formatAmount } from "../services/wallet.service";
import { Validate } from "../utils/validation";
import { db } from "../db/store";
import { logger } from "../utils/logger";

const router = Router();
router.use(requireAuth); // Toutes les routes protégées

// ── GET /api/wallet/balance ───────────────────────────────────
router.get("/balance", async (req: Request, res: Response) => {
  const userId = req.userId!;
  const user   = await db.users.findById(userId);

  // Créer wallet si pas encore
  await db.wallets.getOrCreate(userId, "USD");

  const balance = await WalletService.getBalance(userId, "USD");

  res.json({
    success: true,
    data: {
      ...balance,
      owner: {
        FredaTag:  `@${user?.FredaTag}`,
        kycStatus:  user?.kycStatus,
        canTransfer: user?.kycStatus === "approved" && user?.status === "active",
      },
      // Virtual account info (Maplerad)
      virtualAccount: {
        accountName:   `${user?.firstname} ${user?.lastname}`,
        accountNumber: user?.kycStatus === "approved" ? null : null,
        routingNumber: null,
        bankName:      "Freda Pay LLC",
        swift:         "FREDAUS33",
      },
    },
  });
});

// ── POST /api/wallet/send ─────────────────────────────────────
// Envoyer de l'argent à un autre utilisateur Freda Pay
router.post("/send", validateBody(schemas.sendMoney), async (req: Request, res: Response) => {
  const userId = req.userId!;
  const user   = await db.users.findById(userId);

  // Vérifier que le compte est actif (KYC recommandé mais pas bloquant)
  if (!user || user.status === "banned" || user.status === "suspended") {
    res.status(403).json({ error: "Compte non autorisé à envoyer de l'argent" });
    return;
  }

  const { toFredaTag: rawTag, toPhone, amount, currency, note } = req.body;
  // Normaliser le tag — retire @ et lowercase
  const toFredaTag = rawTag ? rawTag.replace(/^@/, "").toLowerCase().trim() : undefined;

  if (!toFredaTag && !toPhone) {
    res.status(400).json({ error: "toFredaTag ou toPhone requis" });
    return;
  }

  const amountV = Validate.amount(amount);
  if (!amountV.valid) {
    res.status(400).json({ error: amountV.error });
    return;
  }

  if (amountV.value! < 0.5) {
    res.status(400).json({ error: "Montant minimum: $0.50" });
    return;
  }

  try {
    const result = await WalletService.sendMoney(userId, {
      toFredaTag, toPhone,
      amount: amountV.value!,
      currency: currency || "USD",
      note,
    });

    res.json({ success: true, data: result });

    // ✅ FIX v67: notifikasyon yo DEJA voye nan WalletService.sendMoney()
    // (transaction_received + transaction_sent + checkLowBalance) — PA
    // bezwen revoye yo isit la. SA TE KOZ DOUB NOTIFIKASYON POU CHAK
    // TRANSFÈ P2P — chak moun te resevwa 2 notif + 2 push pou menm bagay la.

    // Email confirmation (pa duplike — WalletService pa voye imèl)
    if (user?.email) {
      void EmailService.sendTransactionNotif(user.email, user.firstname, "sent", result.amount || "", toFredaTag || toPhone || "", result.txnId || "");
    }

  } catch (err) {
    const message = err instanceof Error ? err.message : "Erreur";
    const statusMap: Record<string, number> = {
      RECIPIENT_NOT_FOUND:       404,
      CANNOT_SEND_TO_SELF:       400,
      RECIPIENT_ACCOUNT_INACTIVE: 400,
      INSUFFICIENT_BALANCE:      402,
    };
    res.status(statusMap[message] || 500).json({
      error: message === "INSUFFICIENT_BALANCE"
        ? "Solde insuffisant"
        : message === "RECIPIENT_NOT_FOUND"
        ? "Destinataire introuvable"
        : message,
    });
  }
});

// ── POST /api/wallet/deposit ──────────────────────────────────
// Déposer de l'argent dans le wallet
router.post("/deposit", validateBody(schemas.deposit), async (req: Request, res: Response) => {
  const userId = req.userId!;
  const { amount, paymentMethod, currency } = req.body;

  const allowed = ["card", "ach", "wire", "moncash", "natcash", "crypto"];
  if (!paymentMethod || !allowed.includes(paymentMethod)) {
    res.status(400).json({
      error: `paymentMethod invalide. Valeurs: ${allowed.join(", ")}`,
    });
    return;
  }

  const amountV = Validate.amount(amount);
  if (!amountV.valid) {
    res.status(400).json({ error: amountV.error });
    return;
  }

  if (amountV.value! < 5) {
    res.status(400).json({ error: "Dépôt minimum: $5.00" });
    return;
  }

  try {
    const result = await WalletService.deposit(userId, amountV.value!, paymentMethod, currency || "USD");
    res.json({ success: true, data: result });
    NotificationService.send(userId, "deposit_completed", {
      amount: result.deposited || "", method: paymentMethod
    });
    NotificationService.checkLowBalance(userId, result.newBalance || "");
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erreur";
    res.status(500).json({ error: message });
  }
});

// ── GET /api/wallet/history ───────────────────────────────────
// Historique des transactions
router.get("/history", async (req: Request, res: Response) => {
  const userId = req.userId!;
  const limit  = Math.min(parseInt(String(req.query.limit || "20")), 100);
  const page   = Math.max(parseInt(String(req.query.page || "1")), 1);
  const type   = req.query.type as string | undefined;

  // ✅ FIX v67: ansyen kòd la te chaje TOUT 500 tranzaksyon CHAK FWA
  // (ak avatar lookup pou chak P2P) menm si kliyan an bezwen sèlman 20.
  // Sa te fè endpoint la LANT, espesyalman sou Render free tier.
  // Kounye a nou chaje sèlman sa nou bezwen.
  const totalHistory = await WalletService.getHistory(userId, type ? 500 : limit * page + 10);
  const filtered = type ? totalHistory.filter((t: any) => t.type === type) : totalHistory;

  const total = filtered.length;
  const pages = Math.max(1, Math.ceil(total / limit));
  const offset = (page - 1) * limit;
  const transactions = filtered.slice(offset, offset + limit);

  res.json({
    success: true,
    data: { transactions, total, page, pages, count: transactions.length },
  });
});

// ── GET /api/wallet/transaction/:txnId ────────────────────────
// Détail d'une transaction
router.get("/transaction/:txnId", async (req: Request, res: Response) => {
  const { txnId } = req.params;
  const userId    = req.userId!;

  const transfer = await db.transfers.findByTxnId(txnId);

  if (!transfer) {
    res.status(404).json({ error: "Transaction introuvable" });
    return;
  }

  // Vérifier que la transaction appartient à l'utilisateur
  if (transfer.fromUserId !== userId && transfer.toUserId !== userId) {
    res.status(403).json({ error: "Accès refusé" });
    return;
  }

  res.json({
    success: true,
    data: {
      txnId:       transfer.txnId,
      type:        transfer.type,
      status:      transfer.status,
      amount:      formatAmount(transfer.amount),
      amountRaw:   transfer.amount / 100,
      fee:         formatAmount(transfer.fee),
      total:       formatAmount(transfer.totalAmount),
      currency:    transfer.currency,
      direction:   transfer.toUserId === userId ? "credit" : "debit",
      from:        transfer.fromFredaTag ? `@${transfer.fromFredaTag}` : "Dépôt externe",
      to:          transfer.toFredaTag   ? `@${transfer.toFredaTag}`   : "Externe",
      description: transfer.description,
      note:        transfer.note,
      paymentMethod: transfer.paymentMethod,
      failureReason: transfer.failureReason,
      createdAt:   transfer.createdAt,
      completedAt: transfer.completedAt,
    },
  });
});

// ── POST /api/wallet/request ──────────────────────────────────
// Demander de l'argent à un utilisateur
router.post("/request", validateBody(schemas.requestMoney), async (req: Request, res: Response) => {
  const userId = req.userId!;
  const user   = await db.users.findById(userId);
  const { fromFredaTag, fromPhone, amount, note } = req.body;

  if (!fromFredaTag && !fromPhone) {
    res.status(400).json({ error: "fromFredaTag ou fromPhone requis" });
    return;
  }

  const amountV = Validate.amount(amount);
  if (!amountV.valid) {
    res.status(400).json({ error: amountV.error });
    return;
  }

  // Trouver l'utilisateur demandé
  let target = null;
  if (fromFredaTag) target = await db.users.findByFredaTag(fromFredaTag);
  if (!target && fromPhone) target = await db.users.findByPhone(fromPhone);

  if (!target) {
    res.status(404).json({ error: "Utilisateur introuvable" });
    return;
  }

  // Créer un transfert de type "request"
  const transfer = await db.transfers.create({
    fromUserId:    target.id,
    toUserId:      userId,
    fromFredaTag: target.FredaTag,
    toFredaTag:   user?.FredaTag,
    type:          "request",
    status:        "pending",
    amount:        toCents(amountV.value!),
    currency:      "USD",
    fee:           0,
    totalAmount:   toCents(amountV.value!),
    note,
    description:   `Demande de @${user?.FredaTag}`,
  });

  // Lien de paiement
  const paymentLink = `${process.env.FRONTEND_URL || "http://localhost:5173"}/pay/${transfer.txnId}`;

  logger.info("Demande de paiement créée", {
    txnId: transfer.txnId,
    from: `@${user?.FredaTag}`,
    to: `@${target.FredaTag}`,
    amount: amountV.value,
  });

  // ✅ FIX: pa t gen OKENN notifikasyon voye bay `target` (moun k ap resevwa
  // demand lan) — yo te sèlman ka dekouvri demand lan si yo manyèlman louvri
  // modal "Demandes reçues" a. Kounye a yo resevwa yon notifikasyon dirèk.
  await NotificationService.system(
    target.id,
    "Nouvelle demande de paiement",
    `@${user?.FredaTag} vous demande $${amountV.value!.toFixed(2)} USD${note ? ` — "${note}"` : ""}.`
  ).catch(() => null);

  res.status(201).json({
    success: true,
    data: {
      txnId:       transfer.txnId,
      amount:      formatAmount(toCents(amountV.value!)),
      requestedTo: `@${target.FredaTag}`,
      note,
      paymentLink,
      status:      "pending",
      expiresAt:   new Date(Date.now() + 24 * 60 * 60 * 1000), // 24h
    },
  });
});

// ── PATCH /api/wallet/request/:id/reject ────────────────────────
// ✅ NOUVO: wout sa a pa t janm egziste — bouton "Rejeter" nan app la te
// rele l, men li te toujou echwe an silans (404), afiche "Demande rejetée"
// kanmenm san anyen pa vrèman fèt, e MOUN KI TE MANDE lajan an pa t janm
// konnen demand li a te refize.
router.patch("/request/:id/reject", async (req: Request, res: Response) => {
  const userId = req.userId!;
  const { id } = req.params;

  const transfer = await db.transfers.findByTxnId(id);
  if (!transfer || transfer.type !== "request") {
    res.status(404).json({ error: "Demande introuvable" });
    return;
  }
  // Sekirite: sèlman moun k ap RESEVWA demand lan (sila k ap peye a) ka refize l
  if (transfer.fromUserId !== userId) {
    res.status(403).json({ error: "Ou pa otorizé refize demand sa a" });
    return;
  }
  if (transfer.status !== "pending") {
    res.status(400).json({ error: "Demande sa a deja trete" });
    return;
  }

  // ✅ FIX: "declined"/"rejected" PA nan lis valè `status` CHECK constraint la
  // aksepte (pending/processing/completed/failed/cancelled/reversed) — sa ta
  // rele MENM kalite erè 500 nou te jwenn ak `cards_status_check`. "cancelled"
  // se valè ki egziste deja e ki byen dekri yon demand ki pa t ale pi lwen.
  await db.transfers.updateStatus(transfer.id, "cancelled");

  const rejecter = await db.users.findById(userId);
  // ✅ FIX: `transfer.toUserId` gen tip `string | undefined` (kolòn nan ka
  // vid pou lòt kalite transfè ki pa gen yon kont Freda Pay kòm destinatè).
  // Pou yon "request" li toujou dwe defini (garanti pa wout kreyasyon an),
  // men TypeScript pa konnen sa kontèkstyèlman — sa te bloke bild Render lan
  // net ("Argument of type 'string | undefined' is not assignable to
  // parameter of type 'string'"). Nou gad li dirèkteman olye fòse yon tip.
  if (transfer.toUserId) {
    await NotificationService.system(
      transfer.toUserId,
      "Demande refusée",
      `@${rejecter?.FredaTag || "L'utilisateur"} a refusé votre demande de $${(transfer.amount / 100).toFixed(2)}.`
    ).catch(() => null);
  }

  logger.info("Demande de paiement refusée", { txnId: id, by: userId });
  res.json({ success: true });
});

// ── PATCH /api/wallet/request/:id/accept ─────────────────────────
// ✅ NOUVO: wout sa a pa t janm egziste — app la (web ak mobil) te rele
// `/send` DIRÈKTEMAN pou "aksepte" yon demand, san JANM make DEMAND
// ORIJINAL la kòm ranpli. Rezilta: lajan an te vrèman voye, men si moun
// ki te MANDE lajan an ta tcheke estati demand li a, li ta toujou wè
// "En attente" — menm si li te DEJA resevwa lajan an. Wout sa a fè TOU
// DE bagay yo ansanm: voye lajan an AK make demand orijinal la "completed".
router.patch("/request/:id/accept", async (req: Request, res: Response) => {
  const userId = req.userId!;
  const { id } = req.params;

  const transfer = await db.transfers.findByTxnId(id);
  if (!transfer || transfer.type !== "request") {
    res.status(404).json({ error: "Demande introuvable" });
    return;
  }
  // Sekirite: sèlman moun k ap PEYE a (fromUserId) ka aksepte demand lan.
  if (transfer.fromUserId !== userId) {
    res.status(403).json({ error: "Ou pa otorizé aksepte demand sa a" });
    return;
  }
  if (transfer.status !== "pending") {
    res.status(400).json({ error: "Demande sa a deja trete" });
    return;
  }
  if (!transfer.toUserId) {
    res.status(400).json({ error: "Demande envalid — destinatè manke" });
    return;
  }

  const requester = await db.users.findById(transfer.toUserId);
  if (!requester?.FredaTag) {
    res.status(404).json({ error: "Utilisateur introuvable" });
    return;
  }

  // ✅ FIX v51: filè sekirite — si `transfer.amount` pa yon nonm valab (bug
  // mapping ki te la, oswa nenpòt lòt kòz nan lavni), nou refize ak yon
  // mesaj KLÈ olye kite `NaN` pwopaje jouk li fè `sendMoney()` echwe an
  // silans ak yon erè jenerik ki pa esplike anyen.
  if (!Number.isFinite(transfer.amount) || transfer.amount <= 0) {
    logger.error("Demande accept: montan envalid", { txnId: id, rawAmount: transfer.amount });
    res.status(400).json({ error: "Montant de la demande invalide. Contactez le support." });
    return;
  }

  try {
    // ✅ Reyitilize MENM sèvis `sendMoney` ki itilize pou tranzaksyon P2P
    // dirèk yo — sa deja voye notifikasyon "transaction_received"/"sent"
    // otomatikman pou tou de moun yo (fix pi bonè nan sesyon an).
    const result = await WalletService.sendMoney(userId, {
      toFredaTag: requester.FredaTag,
      amount: transfer.amount / 100,
      note: transfer.note || `Paiement demande de @${requester.FredaTag}`,
    });

    // ✅ Make DEMAND ORIJINAL la "completed" — se sa ki te manke pou
    // estati a chanje kòrèkteman sou telefòn moun ki te mande lajan an.
    await db.transfers.updateStatus(transfer.id, "completed");

    logger.info("Demande de paiement acceptée", { txnId: id, by: userId, to: requester.FredaTag });
    res.json({ success: true, data: result });
  } catch (e: any) {
    res.status(400).json({ error: e.message || "Échec du paiement" });
  }
});

// ── GET /api/wallet/summary ───────────────────────────────────
// Résumé du mois en cours
router.get("/summary", async (req: Request, res: Response) => {
  const userId  = req.userId!;
  const history = await WalletService.getHistory(userId, 200);

  const now       = new Date();
  const startMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  const thisMonth = history.filter((t: Record<string, unknown>) =>
    new Date(t.createdAt as string | Date) >= startMonth && t.status === "completed"
  );

  const totalReceived = thisMonth
    .filter((t: Record<string, unknown>) => t.direction === "credit")
    .reduce((sum: number, t: Record<string, unknown>) => sum + (t.amountRaw as number), 0);

  const totalSent = thisMonth
    .filter((t: Record<string, unknown>) => t.direction === "debit" && t.type !== "fee")
    .reduce((sum: number, t: Record<string, unknown>) => sum + (t.amountRaw as number), 0);

  const balance = await WalletService.getBalance(userId, "USD");

  res.json({
    success: true,
    data: {
      balance:          balance.formatted,
      balanceRaw:       balance.balance,
      month: {
        received: `$${totalReceived.toFixed(2)}`,
        sent:     `$${totalSent.toFixed(2)}`,
        txCount:  thisMonth.length,
      },
      recent: history.slice(0, 5),
    },
  });
});

export default router;

// ── GET /api/wallet/payment-methods ──────────────────────────
// Retourne les moyens de paiement disponibles pour recharge
router.get("/payment-methods", async (_req: Request, res: Response) => {
  res.json({
    success: true,
    data: {
      methods: [
        {
          id: "card",
          name: "Carte bancaire",
          description: "Visa, Mastercard",
          icon: "credit-card",
          fee: "1.5%",
          minAmount: 5,
          maxAmount: 10000,
          available: true,
        },
        {
          id: "bank_transfer",
          name: "Virement bancaire",
          description: "ACH / Wire",
          icon: "building-2",
          fee: "0%",
          minAmount: 10,
          maxAmount: 50000,
          available: true,
        },
        {
          id: "mobile_money",
          name: "Mobile Money",
          description: "MonCash, NatCash",
          icon: "smartphone",
          fee: "2%",
          minAmount: 1,
          maxAmount: 2000,
          available: true,
        },
      ],
      currency: "USD",
      provider: "maplerad",
    },
  });
});

// ── POST /api/wallet/create-virtual-account ───────────────────
// Ouvrir un compte USD virtuel via Maplerad
router.post("/create-virtual-account", async (req: Request, res: Response) => {
  const userId = req.userId!;
  try {
    const { MapleradCollectionService } = await import("../services/maplerad.service");
    const user = await db.users.findById(userId);
    if (!user) { res.status(404).json({ error: "Utilisateur introuvable" }); return; }

    const customerId = (user as any).mapleradCustomerId;
    if (!customerId) {
      res.status(400).json({
        error: "Enregistrement requis",
        detail: "Complétez d'abord vos informations d'identité dans la section Carte.",
        code: "CUSTOMER_REQUIRED",
        redirectTo: "/carte",
      });
      return;
    }

    const result = await MapleradCollectionService.createVirtualAccount(customerId);
    await db.users.update(userId, { usdAccountRef: result.data.id } as any).catch(() => null);

    logger.info("Compte virtuel Maplerad créé", { userId, accountId: result.data.id });
    res.json({
      success: true,
      data: {
        id:             result.data.id,
        bank_name:      result.data.bank_name,
        account_number: result.data.account_number,
        account_name:   result.data.account_name,
        currency:       result.data.currency,
        message:        "Effectuez un virement vers ce compte. Les fonds seront crédités automatiquement.",
      },
    });
  } catch (e: any) {
    logger.error("VBA Maplerad creation error", { error: e.message });
    res.status(500).json({ error: e.message });
  }
});
