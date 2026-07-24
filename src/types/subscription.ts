// ============================================================
// Types Subscription — Freda Pay
// ============================================================

export type SubscriptionPlan   = "trial" | "startup" | "pro" | "standard";
export type SubscriptionStatus = "trial" | "active" | "grace" | "locked" | "cancelled";

export interface DbSubscription {
  id:                     string;
  userId:                 string;
  plan:                   SubscriptionPlan;
  status:                 SubscriptionStatus;
  priceCents:             number;
  trialEndsAt?:           Date;
  currentPeriodStart?:    Date;
  currentPeriodEnd?:      Date;
  graceStartedAt?:        Date;
  lockedAt?:              Date;
  cancelledAt?:           Date;
  penaltyApplied:         boolean;
  penaltyAmountCents:     number;
  penaltyAppliedAt?:      Date;
  maxCards:               number;
  monthlyLimitCents:      number;
  fredaiMessagesLimit:    number;
  freeCardsIncluded:      number;
  includesBankAccount:    boolean;
  cardsCreatedThisMonth:  number;
  monthlyVolumeCents:     number;
  fredaiMessagesUsed:     number;
  usageResetAt?:          Date;
  dunningEmailsSent:      number;
  lastDunningAt?:         Date;
  debtCents:              number;
  createdAt:              Date;
  updatedAt:              Date;
}

export interface SubscriptionInfo {
  plan:             SubscriptionPlan;
  status:           SubscriptionStatus;
  label:            string;
  priceCents:       number;
  isLocked:         boolean;
  isGrace:          boolean;
  isTrial:          boolean;
  daysUntilExpiry:  number | null;
  debtCents:        number;
  debtFormatted:    string;
  limits: {
    maxCards:          number;
    monthlyLimitCents: number;
    fredaiMessages:    number;
  };
  usage: {
    monthlyVolumeCents:  number;
    cardsThisMonth:      number;
    fredaiMessages:      number;
  };
  freeCardsRemaining:  number;
  includesBankAccount: boolean;
}
