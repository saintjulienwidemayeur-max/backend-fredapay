// ============================================================
// Cron — Subscription Lifecycle Manager
// Kouri chak jou 02:00 UTC
// Logik: Trial 14j → Rappel J-3 → Expiry → Auto-Startup → Grace 2j → Lock
// ============================================================

import { getSupabase } from "../db/supabase";
import { db } from "../db/store";
import { PLANS, SUBSCRIPTION, fmt } from "../config/fees.config";
import { logger } from "../utils/logger";
import { EmailService } from "../services/email.service";
import { NotificationService } from "../services/notification.service";
import type { SubscriptionPlan } from "../types/subscription";

const sb = () => getSupabase();

async function tryAutoRenew(userId: string, amountCents: number): Promise<boolean> {
  if (amountCents <= 0) return true;
  const wallet = await db.wallets.findByUserId(userId);
  if (!wallet || wallet.availableBalance < amountCents) return false;
  await db.wallets.debit(userId, amountCents);
  await db.ledger.insert({
    userId, type: "subscription_fee", status: "completed", direction: "debit",
    grossCents: amountCents, feeCents: 0, netCents: amountCents,
    description: "Renouvellement abonnement automatique",
  });
  return true;
}

async function pauseAllCards(userId: string) {
  await sb().from("cards").update({ status: "paused", paused_at: new Date().toISOString() })
    .eq("user_id", userId).eq("status", "active");
}

async function resetMonthlyUsage(userId: string) {
  await db.subscriptions.update(userId, {
    monthly_volume_cents: 0, cards_created_this_month: 0,
    fredai_messages_used: 0, usage_reset_at: new Date().toISOString(),
  });
}

export async function runDailySubscriptionCron(): Promise<void> {
  const now = new Date();
  logger.info(`[CRON] Subscription Lifecycle — ${now.toISOString()}`);

  const stats = { processed: 0, reminded: 0, renewed: 0, autoStartup: 0, graced: 0, locked: 0 };
  const subs  = await db.subscriptions.listAllForCron();

  for (const sub of subs) {
    try {
      stats.processed++;
      const userId = sub.userId;
      const user   = await db.users.findById(userId);
      if (!user) continue;

      // ── 1. TRIAL — 14 jours ──────────────────────────────────────
      if (sub.plan === "trial" && sub.status === "trial" && sub.trialEndsAt) {
        const trialEnd    = new Date(sub.trialEndsAt);
        const daysLeft    = Math.ceil((trialEnd.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
        const reminderKey = `trial_reminder_${userId}`;

        // Rappel J-3 avant fin trial
        if (daysLeft === 3 && sub.dunningEmailsSent < 1) {
          await NotificationService.system(userId,
            "Votre essai gratuit expire dans 3 jours",
            `Choisissez un plan (Start-Up $3/mois, Pro $7/mois, Standard $15/mois) avant le ${trialEnd.toLocaleDateString("fr-FR")} pour continuer à utiliser Freda Pay. Après expiration, votre compte sera verrouillé.`
          );
          // Email reminder (sendTrialReminder optionnel)
          await db.subscriptions.update(userId, { dunning_emails_sent: 1 });
          stats.reminded++;
        }

        // Rappel J-1
        if (daysLeft === 1 && sub.dunningEmailsSent < 2) {
          await NotificationService.system(userId,
            "Votre essai gratuit expire demain !",
            `Dernière chance ! Choisissez un plan maintenant pour éviter le verrouillage de votre compte.`
          );
          await db.subscriptions.update(userId, { dunning_emails_sent: 2 });
        }

        // Trial expiré → essayer auto-startup
        if (now > trialEnd) {
          const startupPrice = PLANS.startup.priceCents;
          const renewed = await tryAutoRenew(userId, startupPrice);

          if (renewed) {
            // Auto-Startup réussi
            await db.subscriptions.choosePlan(userId, "startup");
            await db.users.updateStatus(userId, "active");
            await NotificationService.system(userId,
              "Plan Start-Up activé automatiquement",
              `Votre essai a expiré. Le plan Start-Up ($3/mois) a été activé automatiquement. Vous pouvez changer de plan à tout moment.`
            );
            // Email plan activated (sendPlanActivated optionnel)
            stats.autoStartup++;
          } else {
            // Pas assez de fonds → Grace 2 jours (solde en rouge = insuffisant)
            const graceEnd = new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000);
            await db.subscriptions.update(userId, {
              status: "grace", grace_started_at: now.toISOString(),
              debt_cents: startupPrice,
            });
            await NotificationService.system(userId,
              "Essai expiré — Rechargez votre wallet",
              `Votre essai gratuit a expiré. Votre solde est insuffisant pour le plan Start-Up ($3.00). Rechargez votre wallet avant le ${graceEnd.toLocaleDateString("fr-FR")} sinon votre compte sera verrouillé.`
            );
            stats.graced++;
          }
        }
        continue;
      }

      // ── 2. GRACE PERIOD — 2 jours après trial expiré sans paiement ─
      if (sub.status === "grace" && sub.graceStartedAt) {
        const graceEnd  = new Date(new Date(sub.graceStartedAt).getTime() + 2 * 24 * 60 * 60 * 1000);
        const debtCents = sub.debtCents || PLANS.startup.priceCents;

        // Essayer de débiter chaque jour
        const renewed = await tryAutoRenew(userId, debtCents);
        if (renewed) {
          await db.subscriptions.choosePlan(userId, (sub.plan || "startup") as SubscriptionPlan);
          await db.users.updateStatus(userId, "active");
          await NotificationService.system(userId, "Compte réactivé", "Votre abonnement a été renouvelé avec succès.");
          stats.renewed++;
          continue;
        }

        // Grace expirée → verrouiller
        if (now > graceEnd) {
          await db.subscriptions.update(userId, { status: "locked", locked_at: now.toISOString() });
          await db.users.updateStatus(userId, "suspended");
          await pauseAllCards(userId);
          await NotificationService.system(userId,
            "Compte verrouillé",
            `Votre compte est verrouillé. Vous pouvez uniquement recevoir des transferts et effectuer des dépôts. Rechargez votre wallet et choisissez un plan pour débloquer.`
          );
          stats.locked++;
        }
        continue;
      }

      // ── 3. PLAN ACTIF — renouvellement en fin de période ─────────
      if (sub.status === "active" && sub.currentPeriodEnd) {
        const periodEnd = new Date(sub.currentPeriodEnd);
        const daysLeft  = Math.ceil((periodEnd.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

        // Rappel J-3 avant renouvellement
        if (daysLeft === 3 && sub.dunningEmailsSent === 0 && sub.priceCents > 0) {
          await NotificationService.system(userId,
            "Renouvellement dans 3 jours",
            `Votre abonnement ${sub.plan} sera renouvelé le ${periodEnd.toLocaleDateString("fr-FR")} pour ${fmt(sub.priceCents)}. Assurez-vous d'avoir suffisamment de fonds.`
          );
          await db.subscriptions.update(userId, { dunning_emails_sent: 1 });
          stats.reminded++;
        }

        // Période expirée → renouveler
        if (now > periodEnd) {
          if ((sub.status as string) === "cancelled") {
            // Annulé → verrouiller directement
            await db.subscriptions.update(userId, { status: "locked", locked_at: now.toISOString() });
            await db.users.updateStatus(userId, "suspended");
            await pauseAllCards(userId);
            await NotificationService.system(userId,
              "Abonnement expiré — Compte verrouillé",
              "Votre abonnement annulé a expiré. Choisissez un nouveau plan pour débloquer votre compte."
            );
            stats.locked++;
            continue;
          }

          // Essayer de renouveler
          const renewed = await tryAutoRenew(userId, sub.priceCents);
          if (renewed) {
            const nextEnd = new Date(periodEnd); nextEnd.setMonth(nextEnd.getMonth() + 1);
            await db.subscriptions.update(userId, {
              status: "active", debt_cents: 0, dunning_emails_sent: 0,
              current_period_start: now.toISOString(),
              current_period_end: nextEnd.toISOString(),
            });
            await resetMonthlyUsage(userId);
            stats.renewed++;
          } else {
            // Pas de fonds → grace
            const graceEnd = new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000);
            await db.subscriptions.update(userId, {
              status: "grace", grace_started_at: now.toISOString(),
              debt_cents: sub.priceCents,
            });
            await NotificationService.system(userId,
              "Renouvellement échoué",
              `Solde insuffisant pour renouveler votre plan ${sub.plan} (${fmt(sub.priceCents)}). Vous avez 2 jours pour recharger avant le verrouillage.`
            );
            stats.graced++;
          }
        }
        continue;
      }

    } catch (e: any) {
      logger.error(`[CRON] Erreur pour user ${sub.userId}`, { error: e.message });
    }
  }

  logger.info(`[CRON] Résultats`, stats);
}


// ── Scheduler wrapper ────────────────────────────────────────
export function scheduleDailyCron(): void {
  // Kouri tout sèk 24h (02:00 UTC)
  const now   = new Date();
  const next  = new Date(now);
  next.setUTCHours(2, 0, 0, 0);
  if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
  const delay = next.getTime() - now.getTime();

  setTimeout(() => {
    runDailySubscriptionCron().catch(e => logger.error("[CRON] Fatal", { e }));
    setInterval(() => {
      runDailySubscriptionCron().catch(e => logger.error("[CRON] Fatal", { e }));
    }, 24 * 60 * 60 * 1000);
  }, delay);

  logger.info(`[CRON] Prochaine exécution dans ${Math.round(delay/1000/60)} minutes`);
}
