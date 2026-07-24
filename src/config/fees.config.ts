// ============================================================
// FREDA PAY — Fee Config & Plan Limits
// Source: fredapay.com/frais (Mai 2026)
// ============================================================

export type Plan = "trial" | "startup" | "pro" | "standard";

export const PLANS: Record<Plan, {
  priceCents:          number;
  maxCards:            number;
  monthlyLimitCents:   number;
  fredaiMessages:      number;
  freeCardsIncluded:   number;
  includesBankAccount: boolean;
  label:               string;
}> = {
  trial:   { priceCents: 0,    maxCards: 2, monthlyLimitCents: 60000,  fredaiMessages: 100, freeCardsIncluded: 0, includesBankAccount: false, label: "Essai gratuit (14 jours)" },
  startup: { priceCents: 300,  maxCards: 2, monthlyLimitCents: 60000,  fredaiMessages: 100, freeCardsIncluded: 0, includesBankAccount: false, label: "Start-Up ($3/mois)"    },
  pro:     { priceCents: 700,  maxCards: 5, monthlyLimitCents: 0,      fredaiMessages: 0,   freeCardsIncluded: 1, includesBankAccount: false, label: "Pro ($7/mois)"         },
  standard:{ priceCents: 1500, maxCards: 0, monthlyLimitCents: 0,      fredaiMessages: 0,   freeCardsIncluded: 2, includesBankAccount: true,  label: "Standard ($15/mois)"  },
};

export const FEES = {
  cardCreation:       { cents: 520,  label: "Émission carte ($5.20)"           },
  bankAccountOpening: { cents: 1200, label: "Compte bancaire US ($12.00)"      },
  walletDeposit:      { flatCents: 150, percentBps: 500, label: "$1.50 + 5%"   },
  p2pTransfer:        { percentBps: 50,  label: "0.5% P2P"                    },
  withdrawal:         { percentBps: 500, minimumCents: 100, label: "5% min $1" },
  cardTxnSuccess:     { cents: 50,  label: "Txn réussie ($0.50)"              },
  cardTxnDeclined:    { cents: 40,  label: "Txn refusée ($0.40)"              },
  lateReactivation:   { cents: 500, label: "Réactivation tardive ($5.00)"     },
} as const;

export const SUBSCRIPTION = {
  trialDays:        14,   // 14 jours d'essai gratuit
  gracePeriodDays:  2,    // 2 jours de grâce après expiration
  latePenaltyDays:  15,   // après 15 jours → pénalité
  latePenaltyCents: 500,  // $5.00 pénalité réactivation tardive
} as const;

export const calcDepositFee = (gross: number) => {
  const fee = FEES.walletDeposit.flatCents + Math.round(gross * FEES.walletDeposit.percentBps / 10000);
  return { fee, net: gross - fee };
};
export const calcP2PFee        = (a: number) => Math.max(1, Math.round(a * FEES.p2pTransfer.percentBps / 10000));
export const calcWithdrawalFee = (a: number) => Math.max(Math.round(a * FEES.withdrawal.percentBps / 10000), FEES.withdrawal.minimumCents);
export const toCents   = (d: number) => Math.round(d * 100);
export const fromCents = (c: number) => c / 100;
export const fmt       = (c: number) => `$${fromCents(c).toFixed(2)}`;
