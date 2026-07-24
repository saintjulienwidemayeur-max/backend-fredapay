// ============================================================
// Store — Freda Pay DB Abstraction Layer v3
// ============================================================

import { SupabaseRepo } from "./repository";

const useDB = () => !!(process.env.SUPABASE_URL && process.env.SUPABASE_SECRET_KEY);

export const db = {
  users:         SupabaseRepo.users,
  refreshTokens: SupabaseRepo.refreshTokens,
  wallets:       SupabaseRepo.wallets,
  transfers:     SupabaseRepo.transfers,
  transactions:  SupabaseRepo.transfers,   // alias — fredai/paym routes utilisent db.transactions
  ledger:        SupabaseRepo.ledger,
  subscriptions: SupabaseRepo.subscriptions,
  notifications: SupabaseRepo.notifications,
  kyc:           SupabaseRepo.kyc,
  webhookEvents: SupabaseRepo.webhookEvents,
  auditLogs:     SupabaseRepo.auditLogs,
  cards:         SupabaseRepo.cards,
  announcements: SupabaseRepo.announcements,
  appSettings:   SupabaseRepo.appSettings,
  inboxEmails:   SupabaseRepo.inboxEmails,
  currencyRates: SupabaseRepo.currencyRates,
  pendingEmailVerifications: SupabaseRepo.pendingEmailVerifications,
  pushTokens: SupabaseRepo.pushTokens,
  referrals: SupabaseRepo.referrals,
};
