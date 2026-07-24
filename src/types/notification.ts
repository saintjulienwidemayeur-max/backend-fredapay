// ============================================================
// Types Notifications — Freda Pay
// ============================================================

export type NotifType =
  | "transaction_received"    // Argent reçu
  | "transaction_sent"        // Argent envoyé
  | "withdrawal_completed"    // Retrait Mobile Money effectué (MonCash, NatCash…)
  | "transaction_failed"      // Transfert échoué
  | "deposit_completed"       // Dépôt confirmé
  | "card_funded"             // Carte rechargée
  | "card_blocked"            // Carte bloquée
  | "card_unblocked"          // Carte débloquée
  | "card_transaction"        // Transaction sur carte
  | "kyc_approved"            // KYC approuvé
  | "kyc_declined"            // KYC refusé
  | "kyc_in_review"           // KYC en révision
  | "login_new_device"        // Connexion nouveau appareil
  | "password_changed"        // Mot de passe modifié
  | "payment_request"         // Demande de paiement reçue
  | "payment_request_paid"    // Demande payée
  | "low_balance"             // Solde bas
  | "3ds_required"            // Authentification 3DS requise
  | "wallet_tokenization"     // Google/Apple Pay activé
  | "system";                 // Message système

export interface DbNotification {
  id: string;
  userId: string;
  type: NotifType;
  title: string;
  message: string;
  data?: Record<string, unknown>;  // Données supplémentaires (txnId, amount...)
  isRead: boolean;
  priority: "low" | "medium" | "high" | "critical";
  createdAt: Date;
  readAt?: Date;
}
