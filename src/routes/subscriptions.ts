// ============================================================
// Routes Subscriptions — /api/subscriptions
// ============================================================

import { Router, Request, Response } from "express";
import { requireAuth } from "../middleware/auth";
import { db } from "../db/store";
import { getSupabase } from "../db/supabase";
import { PLANS, fmt } from "../config/fees.config";
import { logger } from "../utils/logger";
import { NotificationService } from "../services/notification.service";
import { EmailService } from "../services/email.service";
import type { SubscriptionPlan } from "../types/subscription";

const router = Router();

// ── GET /api/subscriptions/me ──────────────────────────────────
router.get("/me", requireAuth, async (req: Request, res: Response) => {
  const userId = req.userId!;
  try {
    let info = await db.subscriptions.getInfo(userId);
    if (!info) {
      try {
        const trialEndsAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
        await db.subscriptions.createTrial(userId, trialEndsAt);
        info = await db.subscriptions.getInfo(userId);
      } catch { }
    }
    if (!info) {
      return res.json({
        success: true,
        data: {
          plan: "trial", status: "trial", label: "Essai gratuit 14 jours",
          priceCents: 0, isLocked: false, isGrace: false, isTrial: true,
          daysUntilExpiry: 14, debtCents: 0, debtFormatted: "$0.00",
          limits: { maxCards: 2, monthlyLimitCents: 60000, fredaiMessages: 100 },
          usage:  { monthlyVolumeCents: 0, cardsThisMonth: 0, fredaiMessages: 0 },
        },
      });
    }

    // ── Deteksyon trial ekspire — NOTIFYE sèlman, pa debite ──
    // Debi rive SÈLMAN via POST /subscriptions/choose
    // Pa debite isi pou evite doub debi si moun louvri paj la + tape bouton
    const sub = await db.subscriptions.findByUserId(userId);
    if (sub && sub.plan === "trial" && sub.status === "trial" && sub.trialEndsAt) {
      const now      = new Date();
      const trialEnd = new Date(sub.trialEndsAt);
      if (now > trialEnd) {
        // Trial ekspire → mete status "grace" si pa déjà fait
        const alreadyGrace = (sub.status as string) === "grace";
        if (!alreadyGrace) {
          const startupPrice = PLANS.startup.priceCents;
          await db.subscriptions.update(userId, {
            status:            "grace",
            grace_started_at:  now.toISOString(),
            debt_cents:        startupPrice,
          });
          await NotificationService.system(userId,
            "Essai gratuit expiré",
            `Votre essai gratuit de 14 jours a expiré. Choisissez un plan payant (Start-Up ${fmt(startupPrice)}/mois) pour continuer à utiliser Freda Pay.`
          );
          logger.info("Trial expiré → grace (via /me)", { userId });
        }
        // Recharger les infos après modification
        info = await db.subscriptions.getInfo(userId);
      }
    }

    res.json({ success: true, data: info });
  } catch (err) {
    logger.error("subscriptions/me", { err });
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── GET /api/subscriptions/plans ──────────────────────────────
router.get("/plans", (_req: Request, res: Response) => {
  const allPlans = [
    // Trial gratuit 14 jours
    {
      id: "trial", label: "Essai gratuit", priceCents: 0,
      priceFormatted: "Gratuit",
      trialDays: 14,
      maxCards: 2, monthlyLimit: fmt(60000),
      fredaiMessages: 100, freeCardsIncluded: 0, includesBankAccount: false,
      features: [
        "14 jours gratuits, aucune carte requise",
        "Jusqu'à 2 cartes virtuelles",
        "Limite $600/mois",
        "100 messages Fred'AI",
        "Accès complet à Freda Pay",
      ],
      highlight: false,
    },
    ...Object.entries(PLANS)
      .filter(([k]) => k !== "trial")
      .map(([key, p]) => ({
        id: key, label: p.label, priceCents: p.priceCents,
        priceFormatted: fmt(p.priceCents),
        trialDays: 0,
        maxCards: p.maxCards === 0 ? "Illimité" : p.maxCards,
        monthlyLimit: p.monthlyLimitCents === 0 ? "Illimité" : fmt(p.monthlyLimitCents),
        fredaiMessages: p.fredaiMessages === 0 ? "Illimité" : p.fredaiMessages,
        freeCardsIncluded: p.freeCardsIncluded,
        includesBankAccount: p.includesBankAccount,
        features: buildFeatures(key as SubscriptionPlan, p),
        highlight: key === "pro",
      })),
  ];
  res.json({ success: true, data: allPlans });
});

function buildFeatures(plan: SubscriptionPlan, p: typeof PLANS[SubscriptionPlan]) {
  const f = [
    p.maxCards === 0 ? "Cartes illimitées*" : `Jusqu'à ${p.maxCards} cartes actives`,
    p.monthlyLimitCents === 0 ? "Aucune limite standard*" : `Limite ${fmt(p.monthlyLimitCents)}/mois`,
    p.fredaiMessages === 0 ? "Fred'AI illimité" : `${p.fredaiMessages} messages Fred'AI/mois`,
  ];
  if (p.freeCardsIncluded > 0) f.push(`${p.freeCardsIncluded} carte(s) gratuite(s) incluse(s)`);
  if (p.includesBankAccount) f.push("Compte bancaire USD inclus");
  if (plan === "pro") f.push("Support 24/7", "Cashback 0.05% éligible");
  if (plan === "standard") f.push("Support prioritaire spécialisé");
  return f;
}

// ── POST /api/subscriptions/choose ────────────────────────────
// Choisir un plan payant (débite le wallet) ou trial (gratuit)
router.post("/choose", requireAuth, async (req: Request, res: Response) => {
  const userId = req.userId!;
  const { plan } = req.body;

  const validPlans = ["trial", "startup", "pro", "standard"];
  if (!plan || !validPlans.includes(plan)) {
    res.status(400).json({ error: "Plan invalide. Choisissez: trial, startup, pro ou standard" });
    return;
  }

  // Trial — bloqué si déjà utilisé (une seule fois par compte)
  if (plan === "trial") {
    try {
      const user = await db.users.findById(userId);
      // Vérifier si trial déjà utilisé via colonne trial_used
      if ((user as any)?.trialUsed) {
        res.status(403).json({
          error: "L'essai gratuit a déjà été utilisé sur ce compte. Choisissez un plan payant.",
          code: "TRIAL_ALREADY_USED",
        });
        return;
      }
      // Vérifier aussi si une subscription existe déjà
      const existingSub = await db.subscriptions.findByUserId(userId);
      if (existingSub && existingSub.plan !== "trial") {
        res.status(403).json({
          error: "Vous avez déjà un abonnement actif. L'essai gratuit n'est plus disponible.",
          code: "TRIAL_NOT_AVAILABLE",
        });
        return;
      }
      const trialEndsAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
      await db.subscriptions.createTrial(userId, trialEndsAt).catch(async () => {
        await db.subscriptions.update(userId, {
          plan: "trial", status: "trial",
          trial_ends_at: trialEndsAt.toISOString(),
        });
      });
      // Marquer trial_used sur l'utilisateur
      await db.users.update(userId, { trialUsed: true } as any);
      await db.users.updateStatus(userId, "active");
      logger.info("Trial activé", { userId });
      res.json({ success: true, data: await db.subscriptions.getInfo(userId) });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
    return;
  }

  // Plans payants
  const p = PLANS[plan as SubscriptionPlan];
  if (!p) { res.status(400).json({ error: "Plan inconnu" }); return; }

  // ── Guard anti-double-débit ────────────────────────────────
  // Bloke si: même plan déjà actif OU dette existante (payer via /pay-debt)
  const currentSub = await db.subscriptions.findByUserId(userId);

  // Cas 1: Plan déjà actif → pas de débit
  if (currentSub && currentSub.plan === plan && currentSub.status === "active") {
    res.json({ success: true, data: await db.subscriptions.getInfo(userId), alreadyActive: true });
    return;
  }

  // Cas 2: Utilisateur en grace avec dette → forcer paiement via /pay-debt
  // pour éviter qu'il paie /pay-debt ET /choose (double débit)
  if (currentSub && currentSub.status === "grace" && currentSub.debtCents > 0) {
    // Accepter seulement si le plan choisi correspond au plan dû
    // Redirect logique: /choose en grace = même chose que /pay-debt
    const wallet = await db.wallets.findByUserId(userId);
    const available = wallet?.availableBalance || 0;
    if (available < currentSub.debtCents) {
      res.status(402).json({
        error: `Solde insuffisant. ${fmt(currentSub.debtCents)} requis pour sortir de la période de grâce.`,
        required: currentSub.debtCents, available,
      });
      return;
    }
    // Débiter la dette existante (pas le prix du nouveau plan si différent)
    const toPay = currentSub.debtCents;
    await db.wallets.debit(userId, toPay);
    await db.ledger.insert({
      userId, type: "subscription_fee", status: "completed", direction: "debit",
      grossCents: toPay, feeCents: 0, netCents: toPay,
      description: `Activation plan ${p.label} (règlement période de grâce)`,
    });
    await db.subscriptions.choosePlan(userId, plan as SubscriptionPlan);
    await db.users.updateStatus(userId, "active");
    await NotificationService.system(userId, `Plan ${p.label} activé`, `Compte déverrouillé. Bienvenue sur le plan ${plan}.`);
    const userGrace = await db.users.findById(userId);
    if (userGrace) {
      const nextR = new Date(Date.now() + 30*24*60*60*1000).toLocaleDateString("fr-FR", { day:"2-digit", month:"long", year:"numeric" });
      EmailService.sendPlanActivated(userGrace.email, userGrace.firstname, plan, p.label, fmt(toPay), nextR, []).catch(() => null);
    }
    res.json({ success: true, data: await db.subscriptions.getInfo(userId) });
    return;
  }

  const wallet   = await db.wallets.findByUserId(userId);
  const available = wallet?.availableBalance || 0;

  if (available < p.priceCents) {
    // Solde insuffisant → indiquer le manque mais permettre de choisir quand même
    // (on créera le plan mais marque dette)
    res.status(402).json({
      error: `Solde insuffisant. ${fmt(p.priceCents)} requis (vous avez ${fmt(available)}).`,
      required: p.priceCents, available,
      shortfall: p.priceCents - available,
      hint: "Rechargez votre wallet pour activer ce plan.",
    });
    return;
  }

  try {
    // Débiter le wallet
    await db.wallets.debit(userId, p.priceCents);
    await db.ledger.insert({
      userId, type: "subscription_fee", status: "completed", direction: "debit",
      grossCents: p.priceCents, feeCents: 0, netCents: p.priceCents,
      description: `Abonnement ${p.label}`,
    });

    const sub = await db.subscriptions.choosePlan(userId, plan as SubscriptionPlan);
    await db.users.updateStatus(userId, "active");

    await NotificationService.system(userId,
      `Plan ${p.label} activé`,
      `Bienvenue sur le plan ${plan}. Votre abonnement est actif pour 30 jours.`
    );

    // Email de confirmation abonnement (pa sendWelcome — imèl dedye)
    const user = await db.users.findById(userId);
    if (user) {
      const nextRenewal = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
        .toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" });
      const planFeatures: Record<string, string[]> = {
        startup: ["2 cartes virtuelles USD", "Limite $600/mois", "500 messages Fred'AI", "Support prioritaire"],
        pro:     ["5 cartes virtuelles USD", "Limite $2,000/mois", "Messages Fred'AI illimités", "Compte bancaire USD", "Support VIP 24/7"],
        standard:["Cartes virtuelles illimitées", "Limite $10,000/mois", "Fred'AI illimité", "Compte USD dédié", "API Access", "Gestionnaire dédié"],
      };
      EmailService.sendPlanActivated(
        user.email,
        user.firstname,
        plan,
        p.label,
        fmt(p.priceCents),
        nextRenewal,
        planFeatures[plan] || [],
      ).catch(() => null);
    }

    logger.info("Plan payant activé", { userId, plan, priceCents: p.priceCents });
    res.json({ success: true, data: await db.subscriptions.getInfo(userId) });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/subscriptions/cancel ────────────────────────────
// Annuler — accès jusqu'à fin période, puis verrouillé
router.post("/cancel", requireAuth, async (req: Request, res: Response) => {
  const userId = req.userId!;
  try {
    const sub = await db.subscriptions.findByUserId(userId);
    if (!sub) { res.status(404).json({ error: "Aucun abonnement actif" }); return; }
    if (sub.status === "cancelled" || sub.plan === "trial") {
      res.status(400).json({ error: "Impossible d'annuler cet abonnement" }); return;
    }

    await getSupabase().from("subscriptions").update({
      status: "cancelled", cancelled_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    }).eq("user_id", userId);

    await NotificationService.system(userId,
      "Abonnement annulé",
      `Votre accès reste actif jusqu'à la fin de la période en cours. Après cette date, votre compte sera verrouillé jusqu'au choix d'un nouveau plan. Vous pourrez uniquement recevoir des transferts et effectuer des dépôts.`
    );

    logger.info("Abonnement annulé", { userId });
    res.json({
      success: true,
      message: "Abonnement annulé. Compte actif jusqu'à fin de période.",
      data: { status: "cancelled", cancelledAt: new Date().toISOString() },
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/subscriptions/pay-debt ──────────────────────────
router.post("/pay-debt", requireAuth, async (req: Request, res: Response) => {
  const userId = req.userId!;
  const sub = await db.subscriptions.findByUserId(userId);
  if (!sub) { res.status(404).json({ error: "Abonnement introuvable" }); return; }
  if (sub.debtCents === 0) { res.json({ success: true, message: "Aucune dette" }); return; }

  const wallet = await db.wallets.findByUserId(userId);
  if (!wallet || wallet.availableBalance < sub.debtCents) {
    res.status(402).json({
      error: `Solde insuffisant. ${fmt(sub.debtCents)} requis.`,
      debtCents: sub.debtCents, debtFormatted: fmt(sub.debtCents),
      available: wallet?.availableBalance || 0,
    }); return;
  }

  try {
    await db.wallets.debit(userId, sub.debtCents);
    await db.ledger.insert({
      userId, type: "subscription_fee", status: "completed", direction: "debit",
      grossCents: sub.debtCents, feeCents: 0, netCents: sub.debtCents,
      description: `Paiement dette abonnement (${fmt(sub.debtCents)})`,
    });

    const nextEnd = new Date(); nextEnd.setMonth(nextEnd.getMonth() + 1);
    await db.subscriptions.update(userId, {
      status: "active", debt_cents: 0, grace_started_at: null, locked_at: null,
      penalty_applied: false, dunning_emails_sent: 0,
      current_period_start: new Date().toISOString(),
      current_period_end: nextEnd.toISOString(),
    });
    await db.users.updateStatus(userId, "active");
    await getSupabase().from("cards").update({ status: "active", paused_at: null })
      .eq("user_id", userId).eq("status", "paused");

    await NotificationService.system(userId, "Dette payée — Compte déverrouillé !", "Toutes vos cartes ont été réactivées.");
    res.json({ success: true, data: await db.subscriptions.getInfo(userId) });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
