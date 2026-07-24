// ============================================================
// Routes Pay'm — Depo ak Retrè Ayiti
// POST /api/paym/deposit/init      → kreye tranzaksyon + URL
// POST /api/paym/deposit/verify    → verifye estati
// POST /api/paym/withdraw          → retrè MonCash / NatCash
// GET  /api/paym/methods           → lista metòd yo
// ============================================================

import { Router, Request, Response } from "express";
import { requireAuth }               from "../middleware/auth";
import { logger }                    from "../utils/logger";
import { db }                        from "../db/store";
import { WalletService, assertCanOperate, addMonthlyVolume } from "../services/wallet.service";
import { NotificationService }       from "../services/notification.service";
import { EmailService }              from "../services/email.service";
import { fromCents, toCents } from "../config/fees.config";
import { FeeService, describeDepositFee } from "../services/fee.service";
import { getSupabase } from "../db/supabase";
import { PaymDepositService, PaymWithdrawService, genPaymRef, HTG_TO_USD } from "../services/paym.service";
import type { PaymMethod }           from "../services/paym.service";

const router = Router();

// ── Méthodes disponibles ──────────────────────────────────────
// ✅ v106: EXPÒTE — `fredaiContext.service.ts` bezwen MENM lis EGZAK la.
// Anvan, Fred'AI pa t gen okenn lis metòd; li te ka envante ("Sogebank",
// "Western Union"...). Kounye a li li MENM sous verite a ak app la: si nou
// ajoute yon metòd isit, Fred'AI konnen l otomatikman.
export const METHODS = [
  { id: "moncash",  label: "MonCash",  icon: "moncash", color: "#e63946", available: true },
  { id: "natcash",  label: "NatCash",  icon: "natcash", color: "#2dc653", available: true },
  { id: "kashpaw",  label: "KashPaw",  icon: "kashpaw", color: "#f4a261", available: true },
];

// ── GET /api/paym/methods ─────────────────────────────────────
router.get("/methods", (_req, res) => {
  res.json({ success: true, data: METHODS, rateHTG: HTG_TO_USD });
});

// ── POST /api/paym/deposit/init ───────────────────────────────
router.post("/deposit/init", requireAuth, async (req: Request, res: Response) => {
  const userId = req.userId!;
  const { amountUSD, method } = req.body;

  if (!amountUSD || isNaN(parseFloat(amountUSD))) {
    res.status(400).json({ error: "amountUSD requis" });
    return;
  }
  if (!method || !["moncash", "natcash", "kashpaw", "all"].includes(method)) {
    res.status(400).json({ error: "method invalide (moncash | natcash | kashpaw | all)" });
    return;
  }

  const amountUSDf  = parseFloat(amountUSD);
  if (amountUSDf < 1) {
    res.status(400).json({ error: "Montant minimum: $1.00 USD" });
    return;
  }

  // Frè Freda Pay (appliqués côté wallet à la confirmation)
  const grossCents  = toCents(amountUSDf);
  const { fee, net } = await FeeService.calcDepositFee(grossCents, method);
  const amountHTG   = Math.round(amountUSDf * HTG_TO_USD);

  // Konvèti method kashpaw → all (Pay'm pa gen "kashpaw" separe, li pase via "all")
  const paymMethod: "moncash" | "natcash" | "all" =
    method === "kashpaw" ? "all" : method;

  try {
    const referenceId = genPaymRef("DEP");

    // Sove pending deposit nan DB pou on-confirm
    // ✅ FIX KRITIK: te gen SÈLMAN `fromUserId` isit — `user_id` te rete NULL.
    // Depi `findByUserId()` filtre sou `user_id` (fix P2P doub la), depo Pay'm
    // sa yo t ap DISPARÈT nèt nan istorik la. `userId` se pwopriyetè liy lan.
    await db.ledger.insert({
      userId,
      fromUserId:    userId,
      type:          "deposit",
      status:        "pending",
      direction:     "credit",
      grossCents,
      feeCents:      fee,
      netCents:      net,
      description:   `Dépôt ${method === "moncash" ? "MonCash" : method === "natcash" ? "NatCash" : "Freda Pay"}`,
      paymentMethod: method,
      externalRef:   referenceId,
    }).catch(() => null); // fire-and-forget

    const result = await PaymDepositService.createDeposit({
      amountHTG,
      method: paymMethod,
      referenceId,
    });

    logger.info("Pay'm dépôt initié", { userId, amountUSDf, amountHTG, method, referenceId });

    res.json({
      success:       true,
      data: {
        redirectUrl:   result.url,
        // ✅ v66 — KONT DEMO: `redirectUrl` la se yon adrès faktis
        // (demo.fredapay.local). Si app la te louvri l nan navigatè a,
        // revizè App Store la ta tonbe sou yon paj mouri epi li pa ta ka
        // fini depo a. Ak drapo sa a, app la SOTE navigatè a epi li ale
        // dirèkteman nan verifikasyon — ki konfime touswit an demo.
        demo:          (req as any).isDemo === true,
        transactionId: result.transactionId,
        referenceId:   result.referenceId,
        amountUSD:     amountUSDf,
        amountHTG,
        grossAmountUSD: fromCents(grossCents),
        feeUSD:         fromCents(fee),
        netUSD:         fromCents(net),
        method,
        rateHTG:       HTG_TO_USD,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erreur lors du dépôt. Veuillez réessayer.";
    logger.error("Pay'm dépôt init erreur", { userId, message });
    res.status(502).json({ error: message });
  }
});

// ── POST /api/paym/deposit/verify ─────────────────────────────
router.post("/deposit/verify", requireAuth, async (req: Request, res: Response) => {
  const userId = req.userId!;
  const { referenceId } = req.body;

  if (!referenceId) {
    res.status(400).json({ error: "referenceId requis" });
    return;
  }

  try {
    const result = await PaymDepositService.verifyDeposit(referenceId);

    if (result.confirmed) {
      const supa = getSupabase();

      // ✅ FIX: Vérifye si déjà crédité — chèche par external_ref (pa txn_id, ki pa jamn menm valè
      // ke referenceId; ansyen kòd la te toujou retounen "introuvable" e pa t janm bloke doub kredi)
      const { data: existingEntry } = await supa.from("transactions_ledger")
        .select("id, status").eq("external_ref", referenceId).limit(1).maybeSingle();

      if (existingEntry?.status === "completed") {
        res.json({ success: true, data: { ...result, alreadyCredited: true } });
        return;
      }

      // Kont dwe kapab opere (pa bloke/suspann) — menm garanti ke WalletService.deposit te bay
      await assertCanOperate(userId, "deposit");

      // ✅ FIX BALANS: montan net la deja kalkile e deja konfime pa Pay'm/FeeService.
      // Ansyen kòd la te repase l nan WalletService.deposit(), ki (1) aplike yon 2yèm frè
      // e (2) egzije yon minimòm $5.00 SOU MONTAN NET LA — pandan Pay'm aksepte depo apati $1.
      // Rezilta: nenpòt depo MonCash/NatCash ki bay yon net anba $5 (donk anba ~$6.32 brit)
      // te fè erè "MIN_DEPOSIT" san wallet la pa janm kredite, byenke lajan an te deja pati.
      // Kounye a nou kredite dirèkteman montan net FeeService te kalkile a — san repase l.
      const grossCents = toCents(result.amountUSD);
      const { fee, net } = await FeeService.calcDepositFee(grossCents, result.method || "paym");
      // ✅ v66 — tèks frè a, konstwi depi `payment_fees` (pa metòd).
      const feeLabel = await describeDepositFee(result.method || "paym");
      const user = await db.users.findById(userId);

      if (net <= 0) throw new Error("AMOUNT_TOO_LOW: Montant insuffisant après frais");

      await db.wallets.credit(userId, net, "USD");
      await addMonthlyVolume(userId, net);

      if (existingEntry?.id) {
        // Mete ajou antre "pending" ki te la deja a → "completed"
        await supa.from("transactions_ledger").update({
          status: "completed", gross_amount: grossCents, fee_amount: fee, net_amount: net,
          fee_label: feeLabel,
          completed_at: new Date().toISOString(),
        }).eq("id", existingEntry.id);
      } else {
        // Pa t gen antre pending (ka ensèten) → kreye younn kanmenm pou istorik la konplè
        await db.ledger.insert({
          userId, fromUserId: userId, type: "deposit", status: "completed", direction: "credit",
          grossCents, feeCents: fee, netCents: net,
          description: `Dépôt ${result.method === "moncash" ? "MonCash" : result.method === "natcash" ? "NatCash" : "Freda Pay"}`,
          paymentMethod: result.method, externalRef: referenceId,
        }).catch(() => null);
      }

      logger.info("Pay\'m dépôt confirmé en DB", { referenceId, grossCents, fee, net });

      // Notifications
      NotificationService.send(userId, "deposit_completed", {
        amount: `$${fromCents(net).toFixed(2)}`,
        method: result.method,
      });

      if (user) {
        void EmailService.sendTransactionNotif(
          user.email, user.firstname,
          "received",
          `$${fromCents(net).toFixed(2)}`,
          `Dépôt ${result.method === "moncash" ? "MonCash" : result.method === "natcash" ? "NatCash" : "Freda Pay"}`,
          result.transactionId
        );
      }

      logger.info("Pay'm dépôt confirmé + wallet crédité", {
        userId, amountHTG: result.amountHTG, netUSD: fromCents(net), method: result.method,
      });
    }

    res.json({
      success: true,
      data: {
        confirmed:     result.confirmed,
        amountHTG:     result.amountHTG,
        amountUSD:     result.amountUSD,
        transactionId: result.transactionId,
        method:        result.method,
        date:          result.date,
        heure:         result.heure,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erreur vérification";
    logger.error("Pay'm verify erreur", { userId, referenceId, message });
    res.status(502).json({ error: message });
  }
});

// ── POST /api/paym/withdraw ───────────────────────────────────
router.post("/withdraw", requireAuth, async (req: Request, res: Response) => {
  const userId = req.userId!;
  const { amountUSD, method, recipient } = req.body;

  // Validasyon
  if (!amountUSD || isNaN(parseFloat(amountUSD))) {
    res.status(400).json({ error: "amountUSD requis" });
    return;
  }
  if (!["moncash", "natcash"].includes(method)) {
    res.status(400).json({ error: "method invalide pour retrait (moncash | natcash)" });
    return;
  }
  if (!recipient || recipient.length < 8) {
    res.status(400).json({ error: "recipient invalide — format: 509XXXXXXXX ou 8 chiffres" });
    return;
  }
  // Normaliser: ajouter 509 si pas présent
  const normalizedRecipient = recipient.startsWith("509") ? recipient : `509${recipient.replace(/\D/g, "")}`;
  if (!/^509\d{8}$/.test(normalizedRecipient)) {
    res.status(400).json({ error: "Numéro invalide — doit être 509 + 8 chiffres" });
    return;
  }

  const amountUSDf = parseFloat(amountUSD);
  if (amountUSDf <= 0) { res.status(400).json({ error: "Montant invalide" }); return; }
  // Valider min/max depuis DB
  const validErr = await FeeService.validateWithdrawAmount(amountUSDf, method as string);
  if (validErr) { res.status(400).json({ error: validErr }); return; }

  const grossCents = toCents(amountUSDf);
  const user = await db.users.findById(userId);
  if (!user) { res.status(404).json({ error: "Utilisateur introuvable" }); return; }

  const wallet = await WalletService.getBalance(userId);
  const feeCents   = await FeeService.calcWithdrawFee(grossCents, method);
  const totalCents = grossCents + feeCents;  // montant total à débiter (montant + frais)
  const amountHTG  = Math.round(amountUSDf * HTG_TO_USD);

  // Vérif solde wallet (en dollars, comme retourné par getBalance)
  if (wallet.availableBalance < fromCents(totalCents)) {
    res.status(400).json({
      error: `Solde insuffisant. Requis: $${fromCents(totalCents).toFixed(2)} (montant + frais 5%). Disponible: $${wallet.availableBalance.toFixed(2)}`,
    });
    return;
  }

  try {
    // Débiter directement en cents (évite double calcul de frais)
    await db.wallets.debit(userId, totalCents, "USD");

    // Executer le retrait Pay'm (3 étapes HMAC v1.3)
    const result = await PaymWithdrawService.withdraw({
      amountHTG,
      method:    method as "moncash" | "natcash",
      recipient: normalizedRecipient,
    });

    // Enregistrer dans le ledger
    await db.ledger.insert({
      userId,
      type:          "withdrawal",
      status:        "completed",
      direction:     "debit",
      grossCents:    totalCents,   // total débité
      feeCents,                   // frais 5%
      netCents:      grossCents,   // montant net
      description:   `Retrait ${method === "moncash" ? "MonCash" : method === "natcash" ? "NatCash" : "Freda Pay"} → ${normalizedRecipient}`,
      paymentMethod: method,
      externalRef:   result.reference,
    }).catch(() => null);

    // Notifications
    // ✅ v70 FIX — ansyen modèl "transaction_sent" la se pou tranzaksyon
    // P2P, li li chan `to`/`note` — men isit la nou te voye `method`/
    // `recipient`, ke modèl sa a pa rekonèt. Rezilta: notifikasyon an te
    // di "$X envoyé à @undefined". Modèl "withdrawal_completed" la kòrèk
    // e li montre non kanal la (MonCash/NatCash), jamè "Pay'm".
    NotificationService.send(userId, "withdrawal_completed", {
      amount: `$${amountUSDf.toFixed(2)}`,
      provider: method === "moncash" ? "MonCash" : method === "natcash" ? "NatCash" : "Freda Pay",
      recipient,
    });

    void EmailService.sendTransactionNotif(
      user.email, user.firstname,
      "sent",
      `$${amountUSDf.toFixed(2)}`,
      `${method === "moncash" ? "MonCash" : "NatCash"} (${recipient})`,
      result.transactionId
    );

    logger.info("Pay'm retrait succès", {
      userId, amountUSDf, amountHTG, method, recipient, txId: result.transactionId,
    });

    res.json({
      success: true,
      data: {
        transactionId: result.transactionId,
        apiReference:  result.apiReference,
        reference:     result.reference,
        amountUSD:     amountUSDf,
        amountHTG:     result.amountHTG,
        feeUSD:        fromCents(feeCents),
        totalUSD:      fromCents(totalCents),
        paymFeeHTG:    result.fee,
        recipient,
        method,
        balanceAfterUSD: wallet.availableBalance - fromCents(totalCents),
      },
    });
  } catch (err) {
    // Rembourser le wallet si Pay'm a échoué
    try {
      await db.wallets.credit(userId, totalCents, "USD");  // rembourse exactement ce qui a été débité
      await db.ledger.insert({
        userId, type: "refund", status: "completed", direction: "credit",
        grossCents: totalCents, feeCents: 0, netCents: totalCents,
        description: `Remboursement retrait Freda Pay échoué`,
      }).catch(() => null);
      logger.warn("Pay'm retrait échoué — wallet remboursé", { userId, totalCents });
    } catch (refundErr) {
      logger.error("Pay'm retrait + remboursement échoués — INTERVENTION MANUELLE REQUISE", { userId, totalCents, refundErr });
    }
    const message = err instanceof Error ? err.message : "Erreur lors du retrait. Veuillez réessayer.";
    logger.error("Pay'm retrait erreur", { userId, message });
    res.status(502).json({ error: message });
  }
});

export default router;
