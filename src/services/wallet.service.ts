// ============================================================
// Wallet Service v3 — Frais officiels + Limits plan
// ============================================================

import { db } from "../db/store";
import { logger } from "../utils/logger";
import { FeeRules } from "./fee.service";
import { calcDepositFee, calcP2PFee, calcWithdrawalFee,
  FEES, toCents, fromCents, fmt } from "../config/fees.config";
import type { Currency, SendMoneyRequest } from "../types/wallet";
import { NotificationService } from "./notification.service";

export { toCents, fromCents, fmt as formatAmount };

// ── Guard: vérifier si compte peut opérer ────────────────────
export async function assertCanOperate(userId: string, op: "send"|"withdraw"|"deposit"|"card_reload"|"receive") {
  const user = await db.users.findById(userId);
  if (!user) throw new Error("USER_NOT_FOUND");
  if (user.status === "banned") throw new Error("ACCOUNT_CLOSED: Votre compte a été fermé définitivement.");

  // Compte suspendu/verrouillé → UNIQUEMENT recevoir et déposer autorisés
  if (user.status === "suspended") {
    if (op === "receive" || op === "deposit") return; // ← autorisé
    const sub  = await db.subscriptions.findByUserId(userId).catch(() => null);
    const debt = sub ? fmt(sub.debtCents) : "inconnu";
    throw new Error(
      `ACCOUNT_LOCKED: Compte verrouillé. ` +
      `Payez ${debt} pour débloquer. ` +
      `Vous pouvez uniquement recevoir des transferts et recharger votre wallet.`
    );
  }
}

// ── Vérifier limite mensuelle ─────────────────────────────────
async function checkMonthlyLimit(userId: string, amountCents: number) {
  const sub = await db.subscriptions.findByUserId(userId);
  if (!sub || sub.monthlyLimitCents === 0) return; // illimité
  if (sub.monthlyVolumeCents + amountCents > sub.monthlyLimitCents) {
    throw new Error(`MONTHLY_LIMIT_EXCEEDED: Limite ${fmt(sub.monthlyLimitCents)}/mois du plan ${sub.plan} atteinte. Passez au plan supérieur.`);
  }
}

export async function addMonthlyVolume(userId: string, cents: number) {
  const sub = await db.subscriptions.findByUserId(userId);
  if (!sub) return;
  await db.subscriptions.update(userId, { monthly_volume_cents: sub.monthlyVolumeCents + cents });
}

// ============================================================
export const WalletService = {

  async getBalance(userId: string, currency: Currency = "USD") {
    const wallet = await db.wallets.getOrCreate(userId, currency);
    const subInfo = await db.subscriptions.getInfo(userId);
    return {
      currency,
      balance:            fromCents(wallet.balance),
      availableBalance:   fromCents(wallet.availableBalance),
      pendingBalance:     fromCents(wallet.pendingBalance),
      formatted:          fmt(wallet.balance),
      formattedAvailable: fmt(wallet.availableBalance),
      subscription: subInfo,
    };
  },

  // ── Dépôt wallet: $1.50 + 5% ─────────────────────────────
  async deposit(userId: string, amountDollars: number, paymentMethod: string, currency: Currency = "USD") {
    await assertCanOperate(userId, "deposit");
    const grossCents = toCents(amountDollars);
    if (grossCents < 500)    throw new Error("MIN_DEPOSIT: Minimum $5.00");
    if (grossCents > 500000) throw new Error("MAX_DEPOSIT: Maximum $5,000.00");

    // ✅ v66 — frè a soti nan DB (`fee_rules.wallet_deposit`), pa nan kòd la.
    const { fee, label: feeLabel } = await FeeRules.calc("wallet_deposit", grossCents);
    const net = grossCents - fee;
    if (net <= 0) throw new Error(`AMOUNT_TOO_LOW: Insuffisant après frais (${feeLabel})`);

    const txnId = await db.ledger.insert({
      userId, type: "deposit", status: "completed", direction: "credit",
      grossCents, feeCents: fee, netCents: net, feeLabel,
      description: `Dépôt wallet via ${paymentMethod}`,
      paymentMethod,
    });

    await db.wallets.credit(userId, net, currency);
    await addMonthlyVolume(userId, net);

    const wallet = await db.wallets.findByUserId(userId, currency);
    logger.info("Dépôt wallet", { txnId, userId, gross: fmt(grossCents), fee: fmt(fee), net: fmt(net) });

    return {
      success: true, txnId,
      gross: fmt(grossCents), fee: fmt(fee), feeCents: fee, feeNote: feeLabel,
      deposited: fmt(net),
      newBalance: fmt(wallet?.balance || 0),
    };
  },

  // ── P2P Transfer: 0.5% ───────────────────────────────────
  async sendMoney(fromUserId: string, req: SendMoneyRequest) {
    await assertCanOperate(fromUserId, "send");
    const amountCents = toCents(req.amount);
    if (amountCents < 50) throw new Error("MIN_TRANSFER: Minimum $0.50");

    const currency = req.currency || "USD";
    await checkMonthlyLimit(fromUserId, amountCents);

    let toUser = null;
    if (req.toFredaTag) {
      const cleanTag = req.toFredaTag.replace(/^@/, "").toLowerCase().trim();
      toUser = await db.users.findByFredaTag(cleanTag);
    }
    else if (req.toPhone) toUser = await db.users.findByPhone(req.toPhone);
    if (!toUser) throw new Error("RECIPIENT_NOT_FOUND");
    if (toUser.id === fromUserId) throw new Error("CANNOT_SEND_TO_SELF");
    if (toUser.status === "banned") throw new Error("RECIPIENT_ACCOUNT_CLOSED");

    const fromUser = await db.users.findById(fromUserId);
    // ✅ v66 — frè a soti nan DB (`fee_rules.p2p_transfer`).
    const { fee, label: feeLabel } = await FeeRules.calc("p2p_transfer", amountCents);
    const totalDebit = amountCents + fee;          // montant + frais débités ensemble

    const wallet = await db.wallets.getOrCreate(fromUserId, currency);
    if (wallet.availableBalance < totalDebit) {
      // NOTE: Frais $0.40 txn échouée = uniquement pour les cartes virtuelles (pas P2P)
      throw new Error(`INSUFFICIENT_BALANCE: Solde insuffisant. Requis: ${fmt(totalDebit)} (${fmt(amountCents)} + ${fmt(fee)} — ${feeLabel})`);
    }

    await db.wallets.debit(fromUserId, totalDebit, currency);   // débite montant + frais
    await db.wallets.credit(toUser.id, amountCents, currency);  // crédite montant net au destinataire
    await addMonthlyVolume(fromUserId, amountCents);

    const txnId = await db.ledger.insert({
      userId: fromUserId, fromUserId, toUserId: toUser.id,
      fromFredaTag: fromUser?.FredaTag, toFredaTag: toUser.FredaTag,
      type: "p2p_send", status: "completed", direction: "debit",
      grossCents: totalDebit,    // montant total débité (montant + frais)
      feeCents:   fee,
      feeLabel,
      netCents:   amountCents,   // montant net envoyé au destinataire
      description: `Envoi à @${toUser.FredaTag}`, note: req.note,
    });
    await db.ledger.insert({
      txnId: `${txnId}-R`, userId: toUser.id, fromUserId, toUserId: toUser.id,
      fromFredaTag: fromUser?.FredaTag, toFredaTag: toUser.FredaTag,
      type: "p2p_receive", status: "completed", direction: "credit",
      grossCents: amountCents, feeCents: 0, netCents: amountCents,
      description: `Reçu de @${fromUser?.FredaTag}`, note: req.note,
    });

    // ✅ FIX: pa t gen OKENN notifikasyon pou tranzaksyon P2P (ni voye ni
    // resevwa) — "transaction_received" pa t janm rele NENPÒT KOTE nan
    // kòd la. Sa vle di moun ki resevwa lajan pa t janm konnen san yo pa
    // rafrechi app la manyèlman. `void` = pa bloke repons lan pou echèk
    // notifikasyon (best-effort, jan lòt kote yo fè l).
    void NotificationService.send(toUser.id, "transaction_received", {
      amount: fmt(amountCents), from: fromUser?.FredaTag, note: req.note,
    });
    // ✅ FIX v105 "alèt balans ba pa janm rive": `checkLowBalance()` te
    // rele SÈLMAN apre yon DEPO (wallet.ts:153) — men yon depo FÈ MONTE
    // balans lan! Se apre yon DEBI (voye lajan, rechaje kat) balans lan
    // desann anba sèy la. Alèt la pa t prèske janm deklanche.
    void NotificationService.checkLowBalance(fromUserId, "").catch(() => null);
    void NotificationService.send(fromUserId, "transaction_sent", {
      amount: fmt(amountCents), to: toUser.FredaTag, note: req.note,
    });

    const newWallet = await db.wallets.findByUserId(fromUserId, currency);
    logger.info("P2P Transfer", { txnId, from: fromUser?.FredaTag, to: toUser.FredaTag, amount: fmt(amountCents) });

    return {
      success:      true,
      txnId,
      amount:       fmt(amountCents),
      amountCents,
      fee:          fmt(fee),
      feeCents:     fee,
      grossCents:   amountCents + fee,
      gross:        fmt(amountCents + fee),
      feeNote:      feeLabel,
      total:        fmt(totalDebit),
      recipient:    { FredaTag: `@${toUser.FredaTag}`, firstname: toUser.firstname },
      newBalance:   fmt(newWallet?.balance || 0),
      newBalanceCents: newWallet?.balance || 0,
    };
  },

  // ── Retrait: 5%, min $1.00 ────────────────────────────────
  async withdraw(userId: string, amountDollars: number, currency: Currency = "USD") {
    await assertCanOperate(userId, "withdraw");
    const amountCents = toCents(amountDollars);
    if (amountCents < 200) throw new Error("MIN_WITHDRAWAL: Minimum $2.00");

    // ✅ v66 — frè a soti nan DB (`fee_rules.wallet_withdrawal`).
    const { fee, label: feeLabel } = await FeeRules.calc("wallet_withdrawal", amountCents);
    const netCents = amountCents - fee;
    if (netCents <= 0) throw new Error(`AMOUNT_TOO_LOW: Insuffisant après frais (${feeLabel})`);
    await db.wallets.debit(userId, amountCents, currency);

    const txnId = await db.ledger.insert({
      userId, type: "withdrawal", status: "completed", direction: "debit",
      grossCents: amountCents, feeCents: fee, netCents, feeLabel,
      description: "Retrait wallet",
    });

    const wallet = await db.wallets.findByUserId(userId, currency);
    return {
      success: true, txnId,
      gross: fmt(amountCents), fee: fmt(fee), feeCents: fee, feeNote: feeLabel,
      net: fmt(netCents),
      newBalance: fmt(wallet?.balance || 0),
    };
  },

  async getHistory(userId: string, limit = 30) {
    const rows = await db.ledger.findByUserId(userId, limit);

    // Pour les P2P, charger les avatars des partenaires
    const tagCache: Map<string, string | null> = new Map();
    const getAvatar = async (tag: string | undefined): Promise<string | null> => {
      if (!tag) return null;
      if (tagCache.has(tag)) return tagCache.get(tag) ?? null;
      try {
        const user = await db.users.findByFredaTag(tag.replace(/^@/, ""));
        const url  = user?.avatarUrl || null;
        tagCache.set(tag, url);
        return url;
      } catch { return null; }
    };

    return await Promise.all(rows.map(async (r: any) => {
      const fromTag = r.from_freda_tag;
      const toTag   = r.to_freda_tag;
      const isP2P   = r.type === "p2p_send" || r.type === "p2p_receive";

      let fromAvatarUrl: string | null = null;
      let toAvatarUrl:   string | null = null;
      if (isP2P) {
        [fromAvatarUrl, toAvatarUrl] = await Promise.all([
          getAvatar(fromTag), getAvatar(toTag),
        ]);
      }

      return {
        txnId:         r.txn_id,
        type:          r.type,
        status:        r.status,
        direction:     r.direction,
        amount:        fromCents(r.net_amount || 0),
        amountRaw:     fromCents(r.net_amount || 0),
        fee:           fromCents(r.fee_amount || 0),
        feeCents:      r.fee_amount || 0,
        // ✅ v66 — tèks frè a jan li te ye lè tranzaksyon an fèt.
        // Detay tranzaksyon an montre l konsa moun nan konnen EGZAKTEMAN
        // ki frè yo te aplike, e poukisa.
        feeLabel:      r.fee_label || null,
        gross:         fromCents(r.gross_amount || 0),
        grossCents:    r.gross_amount || 0,
        currency:      r.currency || "USD",
        fromFredaTag:  fromTag,
        toFredaTag:    toTag,
        fromAvatarUrl,
        toAvatarUrl,
        description:   r.description,
        note:          r.note,
        paymentMethod: r.payment_method,
        createdAt:     r.created_at,
        completedAt:   r.completed_at,
      };
    }));
  },
};
