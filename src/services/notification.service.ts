// ============================================================
// Service Notifications — Freda Pay
// Gère les notifications in-app + (email/push en production)
// ============================================================

import { db } from "../db/store";
import { logger } from "../utils/logger";
import { PushNotificationService } from "./pushNotification.service";
import type { NotifType, DbNotification } from "../types/notification";

// ✅ FIX: bouton "Notifications" nan Pwofil la (transfers/security/marketing/
// news) te yon demo — okenn notifikasyon pa t janm konsilte chwa itilizatè a
// anvan li voye. Map SÈLMAN kalite notifikasyon ki gen yon koresponn KLÈ ak
// youn nan 2 preferans ki gen VRÈ deklanchè nan app la kounye a (transfers,
// security). Nou pa gate kyc_*/card_blocked/card_unblocked/wallet_tokenization/
// system — se chanjman kritik kont, pa "konfò" — dezaktive "marketing" pa
// dwe janm ka kache yon alèt "kat bloke" pa egzanp.
const PREF_CATEGORY: Partial<Record<NotifType, "transfers" | "security">> = {
  transaction_received: "transfers",
  transaction_sent:      "transfers",
  withdrawal_completed:  "transfers",
  transaction_failed:    "transfers",
  deposit_completed:     "transfers",
  card_funded:           "transfers",
  card_transaction:      "transfers",
  payment_request:       "transfers",
  payment_request_paid:  "transfers",
  low_balance:           "transfers",
  login_new_device:      "security",
  password_changed:      "security",
  "3ds_required":        "security",
};

// ── Templates de notifications ────────────────────────────────

const templates: Record<NotifType, (data: Record<string, unknown>) => { title: string; message: string; priority: DbNotification["priority"] }> = {

  transaction_received: (d) => ({
    title: "Argent reçu",
    message: `${d.amount} reçus de @${d.from}${d.note ? ` — "${d.note}"` : ""}.`,
    priority: "high",
  }),

  transaction_sent: (d) => ({
    title: "Transfert envoyé",
    message: `${d.amount} envoyés à @${d.to}${d.note ? ` — "${d.note}"` : ""}.`,
    priority: "medium",
  }),

  // ✅ v70 — te MANKE nèt. `paym.ts` te rele `transaction_sent` (modèl
  // P2P) pou notifye yon retrè Pay'm, ak chan `method`/`recipient` ke
  // modèl sa a pa menm li — rezilta: notifikasyon an te di
  // "$X envoyé à @undefined" olye pale de retrè a. Modèl separe pou
  // retrè: montre KANAL la (MonCash, NatCash — enfòmasyon itil), JANM
  // "Pay'm" (non founisè teknik nou an, ki pa vle di anyen pou moun nan).
  withdrawal_completed: (d) => ({
    title: "Retrait effectué",
    message: `${d.amount} envoyés vers ${d.provider || "votre compte"}${d.recipient ? ` (${d.recipient})` : ""}. Arrivée dans quelques minutes.`,
    priority: "medium",
  }),

  transaction_failed: (d) => ({
    title: "Transfert échoué",
    message: `Transfert de ${d.amount} vers @${d.to} échoué.${d.reason ? ` ${d.reason}` : ""} Aucun montant prélevé.`,
    priority: "high",
  }),

  deposit_completed: (d) => ({
    title: "Dépôt confirmé",
    message: `${d.amount} crédités sur votre portefeuille via ${d.method}.`,
    priority: "high",
  }),

  card_funded: (d) => ({
    title: "Carte rechargée",
    message: `Carte ···· ${d.lastFour} rechargée de ${d.amount}.`,
    priority: "medium",
  }),

  card_blocked: (d) => ({
    title: "Carte bloquée",
    message: `Carte ···· ${d.lastFour} bloquée. Débloquez-la depuis l'onglet Cartes.`,
    priority: "high",
  }),

  card_unblocked: (d) => ({
    title: "Carte débloquée",
    message: `Carte ···· ${d.lastFour} à nouveau active.`,
    priority: "medium",
  }),

  card_transaction: (d) => ({
    title: "Paiement par carte",
    message: `${d.amount} débités chez ${d.merchant} avec votre carte ···· ${d.lastFour}.`,
    priority: "medium",
  }),

  kyc_approved: (_d) => ({
    title: "Identité vérifiée",
    message: "Identité vérifiée. Toutes les fonctionnalités sont maintenant actives.",
    priority: "critical",
  }),

  kyc_declined: (d) => ({
    title: "Vérification d'identité refusée",
    message: `Vérification d'identité refusée.${d?.reason ? ` ${d.reason}` : ""} Réessayez depuis l'onglet Profil.`,
    priority: "critical",
  }),

  kyc_in_review: (_d) => ({
    title: "Vérification d'identité en cours",
    message: "Dossier en révision manuelle. Décision sous 24-48h.",
    priority: "high",
  }),

  login_new_device: (d) => ({
    title: "Nouvelle connexion détectée",
    message: `Connexion détectée depuis ${d.device || "un nouvel appareil"}${d.time ? ` à ${d.time}` : ""}. Si ce n'est pas vous, changez votre mot de passe.`,
    priority: "critical",
  }),

  password_changed: (_d) => ({
    title: "Mot de passe modifié",
    message: "Mot de passe modifié. Si ce n'est pas vous, contactez le support.",
    priority: "high",
  }),

  payment_request: (d) => ({
    title: "Demande de paiement",
    message: `@${d.from} vous demande ${d.amount}${d.note ? ` — "${d.note}"` : ""}.`,
    priority: "high",
  }),

  payment_request_paid: (d) => ({
    title: "Demande de paiement réglée",
    message: `@${d.by} a réglé votre demande de ${d.amount}.`,
    priority: "high",
  }),

  low_balance: (d) => ({
    title: "Solde bas",
    message: `Votre solde est de ${d.balance}. Pensez à recharger votre portefeuille.`,
    priority: "medium",
  }),

  "3ds_required": (d) => ({
    title: "Validation 3DS requise",
    message: `Approuvez le paiement de ${d.amount} chez ${d.merchant}`,
    priority: "critical",
  }),

  wallet_tokenization: (d) => ({
    title: `${d.wallet} activé`,
    message: `Votre carte Freda Pay a été ajoutée à ${d.wallet}. Code d'activation: ${d.code}`,
    priority: "high",
  }),

  system: (d) => ({
    title: String(d.title || "Information"),
    message: String(d.message || ""),
    priority: "low",
  }),
};

// ── NotificationService ───────────────────────────────────────

export const NotificationService = {

  // ── Envoyer une notification ──────────────────────────────────
  async send(
    userId: string,
    type: NotifType,
    data: Record<string, unknown> = {}
  ): Promise<DbNotification | null> {
    // ✅ FIX: respekte preferans itilizatè a kounye a (wè PREF_CATEGORY pi wo).
    const category = PREF_CATEGORY[type];
    if (category) {
      const user = await db.users.findById(userId).catch(() => undefined);
      const prefs = (user as any)?.notifPrefs;
      if (prefs && prefs[category] === false) {
        logger.info(`Notification ${type} non-envoyée (préférence ${category} désactivée)`, { userId });
        return null;
      }
    }

    const template = templates[type](data);

    const notif = await db.notifications.create({
      userId,
      type,
      title:    template.title,
      message:  template.message,
      data,
      isRead:   false,
      priority: template.priority,
    });

    logger.info(`Notification envoyée: ${type}`, {
      userId,
      title: template.title,
      priority: template.priority,
    });

    // ✅ NOUVO: konplete sa ki te yon TODO — voye push pou tout notifikasyon
    // (pa sèlman "critical") depi se yon app finansye kote itilizatè yo vle
    // konnen touswit lè lajan yo deplase. `void` = pa bloke repons lan.
    void PushNotificationService.sendToUser(userId, template.title, template.message, { type, ...data });

    return notif;
  },

  // ── Notification de transaction reçue ────────────────────────
  async transactionReceived(toUserId: string, amount: string, fromTag: string, note?: string): Promise<void> {
    void this.send(toUserId, "transaction_received", { amount, from: fromTag, note });
  },

  // ── Notification de transaction envoyée ──────────────────────
  async transactionSent(fromUserId: string, amount: string, toTag: string, note?: string): Promise<void> {
    void this.send(fromUserId, "transaction_sent", { amount, to: toTag, note });
  },

  // ── KYC status change ────────────────────────────────────────
  async kycStatusChanged(userId: string, status: "approved" | "declined" | "in_review", reason?: string): Promise<void> {
    const typeMap = {
      approved:  "kyc_approved"  as NotifType,
      declined:  "kyc_declined"  as NotifType,
      in_review: "kyc_in_review" as NotifType,
    };
    void this.send(userId, typeMap[status], reason ? { reason } : {});
  },

  // ── Alerte sécurité ───────────────────────────────────────────
  async securityAlert(userId: string, type: "login_new_device" | "password_changed", data: Record<string, unknown> = {}): Promise<void> {
    void this.send(userId, type, data);
  },

  // ── Low balance check ────────────────────────────────────────
  async checkLowBalance(userId: string, balanceFormatted: string, threshold = 1000): Promise<void> {
    const wallet = await db.wallets.findByUserId(userId, "USD");
    if (wallet && wallet.balance < threshold) {
      void this.send(userId, "low_balance", { balance: balanceFormatted });
    }
  },

  // ── 3DS alert ────────────────────────────────────────────────
  async alert3DS(userId: string, amount: string, merchant: string): Promise<void> {
    void this.send(userId, "3ds_required", { amount, merchant });
  },

  // ── Wallet tokenization ───────────────────────────────────────
  async walletTokenization(userId: string, walletName: string, activationCode: string): Promise<void> {
    void this.send(userId, "wallet_tokenization", { wallet: walletName, code: activationCode });
  },

  // ── System message ────────────────────────────────────────────
  async system(userId: string, title: string, message: string): Promise<void> {
    void this.send(userId, "system", { title, message });
  },

  // ── Broadcast à tous les utilisateurs ────────────────────────
  async broadcast(title: string, message: string): Promise<void> {
    const users = await db.users.list(1000);
    users.forEach(u => this.system(u.id, title, message));
    logger.info(`Broadcast envoyé à ${users.length} utilisateurs`, { title });
  },
};
