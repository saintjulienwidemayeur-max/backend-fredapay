// ============================================================
// Types Wallet & Transfers — Freda Pay
// ============================================================

export type Currency = "USD" | "HTG" | "EUR" | "CAD" | "GBP";

export interface DbWallet {
  id: string;
  userId: string;
  currency: Currency;
  balance: number;          // En centimes (ex: $10.50 = 1050)
  availableBalance: number; // Balance disponible (hors montants en attente)
  pendingBalance: number;   // Montants en attente de confirmation
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export type TransferStatus =
  | "pending"
  | "processing"
  | "completed"
  | "failed"
  | "cancelled"
  | "reversed";

export type TransferType =
  | "send"           // Envoi à un autre utilisateur Freda Pay
  | "receive"        // Réception d'un autre utilisateur
  | "deposit"        // Dépôt depuis carte/bank/crypto
  | "withdrawal"     // Retrait vers bank
  | "card_funding"   // Rechargement carte (Maplerad)
  | "card_refund"    // Remboursement depuis carte
  | "fee"            // Frais
  | "conversion"     // Conversion de devises
  | "request"        // Demande de paiement (reçue/envoyée)
  | "ach"            // Virement ACH
  | "wire";          // Wire transfer

export interface DbTransfer {
  id: string;
  txnId: string;             // ID unique Freda Pay: FP-XXXX-XXXX
  fromUserId?: string;       // null si dépôt externe
  toUserId?: string;         // null si retrait externe
  fromFredaTag?: string;
  toFredaTag?: string;
  type: TransferType;
  status: TransferStatus;
  amount: number;            // En centimes
  currency: Currency;
  fee: number;               // Frais en centimes
  feeLabel?: string;         // ✅ v66 — tèks frè a nan moman tranzaksyon an
  totalAmount: number;       // amount + fee
  description?: string;
  note?: string;
  paymentMethod?: string;    // card, ach, wire, moncash, crypto...
  externalRef?: string;      // Ref externe (Maplerad, etc.)
  metadata?: Record<string, unknown>;
  failureReason?: string;
  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date;
}

export interface SendMoneyRequest {
  toFredaTag?: string;
  toPhone?: string;
  amount: number;            // En USD
  currency?: Currency;
  note?: string;
}

export interface RequestMoneyRequest {
  fromFredaTag?: string;
  fromPhone?: string;
  amount: number;
  currency?: Currency;
  note?: string;
}

export interface DepositRequest {
  amount: number;
  currency?: Currency;
  paymentMethod: "card" | "ach" | "wire" | "moncash" | "natcash" | "crypto";
  externalRef?: string;
}

// Balance formatée pour l'affichage
export interface WalletBalance {
  currency: Currency;
  balance: string;           // "$10.50"
  balanceRaw: number;        // 1050 (centimes)
  available: string;
  pending: string;
}
