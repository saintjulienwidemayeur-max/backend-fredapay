// ============================================================
// FREDA PAY — Payment Channels Configuration
// Source: PAYMENT_CHANNELS.docx + Maplerad API docs
// Endpoint: POST /api/maplerad/transfers (payout)
//           POST /api/maplerad/collections/virtual-account (deposit)
// ============================================================

export type TransferScheme = "BANK_TRANSFER" | "MOBILEMONEY" | "MAPLERAD_PAY";

export interface PaymentChannel {
  id:          string;     // Identifiant unique ex: "mtn_gh"
  name:        string;     // Nom affiché: "MTN Mobile Money"
  logo:        string;     // Emoji ou URL logo
  currency:    string;     // "GHS", "NGN", "KES", "XAF", "XOF", "UGX", "TZS"
  country:     string;     // "Ghana", "Nigeria"
  countryCode: string;     // ISO "GH", "NG", "KE"
  scheme:      TransferScheme;
  bank_code?:  string;     // Code banque/telco Maplerad (null = fetch via /banks API)
  minAmount:   number;     // Montant minimum en unité locale
  maxAmount:   number;     // Montant maximum en unité locale
  fee:         string;     // Description frais
  directions:  ("deposit" | "withdrawal")[];
  phonePrefix?: string;    // Préfixe téléphonique pays
  fields:      ChannelField[];  // Champs requis pour ce canal
}

export interface ChannelField {
  key:         string;
  label:       string;
  type:        "text" | "tel" | "number" | "select";
  placeholder?: string;
  required:    boolean;
  options?:    { label: string; value: string }[];
}

// ============================================================
// TOUS LES CANAUX DE PAIEMENT
// ============================================================
export const PAYMENT_CHANNELS: PaymentChannel[] = [

  // ══════════════════════════════════════════════════════════
  // NIGERIA — NGN
  // ══════════════════════════════════════════════════════════
  {
    id:          "ngn_bank",
    name:        "Virement Bancaire Nigeria",
    logo:        "🏦",
    currency:    "NGN",
    country:     "Nigeria",
    countryCode: "NG",
    scheme:      "BANK_TRANSFER",
    minAmount:   100,       // ₦100
    maxAmount:   1_000_000, // ₦1,000,000
    fee:         "₦10 flat",
    directions:  ["deposit", "withdrawal"],
    phonePrefix: "+234",
    fields: [
      { key: "account_number", label: "Numéro de compte NUBAN", type: "text", placeholder: "0690000000", required: true },
      { key: "bank_code",      label: "Banque",                 type: "select", required: true, options: [] }, // Chargé depuis API
      { key: "account_name",   label: "Nom du titulaire",       type: "text", placeholder: "John Doe", required: false },
    ],
  },

  // ══════════════════════════════════════════════════════════
  // GHANA — GHS Mobile Money
  // ══════════════════════════════════════════════════════════
  {
    id:          "mtn_gh",
    name:        "MTN Mobile Money Ghana",
    logo:        "📱",
    currency:    "GHS",
    country:     "Ghana",
    countryCode: "GH",
    scheme:      "MOBILEMONEY",
    bank_code:   "MTN",     // Code Maplerad pour MTN Ghana
    minAmount:   1,
    maxAmount:   3_000,
    fee:         "1% (min 6 GHS)",
    directions:  ["deposit", "withdrawal"],
    phonePrefix: "+233",
    fields: [
      { key: "account_number", label: "Numéro MTN MoMo", type: "tel", placeholder: "024XXXXXXX", required: true },
      { key: "account_name",   label: "Nom du titulaire", type: "text", placeholder: "John Doe", required: true },
    ],
  },
  {
    id:          "telecel_gh",
    name:        "Telecel Cash (Vodafone) Ghana",
    logo:        "📱",
    currency:    "GHS",
    country:     "Ghana",
    countryCode: "GH",
    scheme:      "MOBILEMONEY",
    bank_code:   "VODAFONE",
    minAmount:   1,
    maxAmount:   3_000,
    fee:         "1% (min 6 GHS)",
    directions:  ["withdrawal"],
    phonePrefix: "+233",
    fields: [
      { key: "account_number", label: "Numéro Telecel", type: "tel", placeholder: "020XXXXXXX", required: true },
      { key: "account_name",   label: "Nom du titulaire", type: "text", placeholder: "John Doe", required: true },
    ],
  },
  {
    id:          "airteltigo_gh",
    name:        "AirtelTigo Money Ghana",
    logo:        "📱",
    currency:    "GHS",
    country:     "Ghana",
    countryCode: "GH",
    scheme:      "MOBILEMONEY",
    bank_code:   "TIGO",
    minAmount:   1,
    maxAmount:   3_000,
    fee:         "1% (min 6 GHS)",
    directions:  ["withdrawal"],
    phonePrefix: "+233",
    fields: [
      { key: "account_number", label: "Numéro AirtelTigo", type: "tel", placeholder: "027XXXXXXX", required: true },
      { key: "account_name",   label: "Nom du titulaire", type: "text", placeholder: "John Doe", required: true },
    ],
  },

  // Ghana Bank Transfer
  {
    id:          "bank_gh",
    name:        "Virement Bancaire Ghana",
    logo:        "🏦",
    currency:    "GHS",
    country:     "Ghana",
    countryCode: "GH",
    scheme:      "BANK_TRANSFER",
    minAmount:   1,
    maxAmount:   3_000,
    fee:         "1% (min 6 GHS)",
    directions:  ["withdrawal"],
    phonePrefix: "+233",
    fields: [
      { key: "account_number", label: "Numéro de compte",  type: "text",   placeholder: "XXXXXXXXXXX", required: true },
      { key: "bank_code",      label: "Banque",            type: "select", required: true, options: [
        { label: "GCB Bank",              value: "GCB" },
        { label: "MTN Mobile Money",      value: "MTN" },
        { label: "Ecobank Ghana",         value: "ECOBANK" },
        { label: "Fidelity Bank Ghana",   value: "FIDELITY" },
        { label: "Stanbic Bank Ghana",    value: "STANBIC" },
        { label: "Zenith Bank Ghana",     value: "ZENITH" },
        { label: "Absa Bank Ghana",       value: "ABSA" },
        { label: "Access Bank Ghana",     value: "ACCESS" },
        { label: "CalBank",               value: "CAL" },
        { label: "GT Bank Ghana",         value: "GTBANK" },
        { label: "UBA Ghana",             value: "UBA" },
        { label: "Standard Chartered",    value: "SCB" },
        { label: "Republic Bank",         value: "REPUBLIC" },
        { label: "First Atlantic Bank",   value: "FAB" },
        { label: "G-Money",               value: "GMONEY" },
        { label: "Societe Generale",      value: "SGGHANA" },
        { label: "ZEEPAY",                value: "ZEEPAY" },
      ]},
      { key: "account_name", label: "Nom du titulaire", type: "text", placeholder: "John Doe", required: false },
    ],
  },

  // ══════════════════════════════════════════════════════════
  // KENYA — KES Mobile Money
  // ══════════════════════════════════════════════════════════
  {
    id:          "mpesa_ke",
    name:        "M-PESA Kenya",
    logo:        "📱",
    currency:    "KES",
    country:     "Kenya",
    countryCode: "KE",
    scheme:      "MOBILEMONEY",
    bank_code:   "MPESA",
    minAmount:   20,
    maxAmount:   50_000,
    fee:         "1% (min 150 KES)",
    directions:  ["deposit", "withdrawal"],
    phonePrefix: "+254",
    fields: [
      { key: "account_number", label: "Numéro M-PESA",    type: "tel",  placeholder: "254XXXXXXXXX", required: true },
      { key: "account_name",   label: "Nom du titulaire", type: "text", placeholder: "John Doe",     required: true },
    ],
  },
  {
    id:          "airtel_ke",
    name:        "Airtel Money Kenya",
    logo:        "📱",
    currency:    "KES",
    country:     "Kenya",
    countryCode: "KE",
    scheme:      "MOBILEMONEY",
    bank_code:   "AIRTEL",
    minAmount:   20,
    maxAmount:   50_000,
    fee:         "1% (min 150 KES)",
    directions:  ["withdrawal"],
    phonePrefix: "+254",
    fields: [
      { key: "account_number", label: "Numéro Airtel",    type: "tel",  placeholder: "254XXXXXXXXX", required: true },
      { key: "account_name",   label: "Nom du titulaire", type: "text", placeholder: "John Doe",     required: true },
    ],
  },

  // ══════════════════════════════════════════════════════════
  // CAMEROON — XAF Mobile Money
  // ══════════════════════════════════════════════════════════
  {
    id:          "mtn_cm",
    name:        "MTN Mobile Money Cameroun",
    logo:        "📱",
    currency:    "XAF",
    country:     "Cameroun",
    countryCode: "CM",
    scheme:      "MOBILEMONEY",
    bank_code:   "531",   // Code Maplerad pour MTN XAF
    minAmount:   200,
    maxAmount:   2_000_000,
    fee:         "2.5%",
    directions:  ["deposit", "withdrawal"],
    phonePrefix: "+237",
    fields: [
      { key: "account_number", label: "Numéro MTN MoMo",  type: "tel",  placeholder: "237XXXXXXXXX", required: true },
      { key: "account_name",   label: "Nom du titulaire", type: "text", placeholder: "John Doe",     required: true },
    ],
  },
  {
    id:          "orange_cm",
    name:        "Orange Money Cameroun",
    logo:        "📱",
    currency:    "XAF",
    country:     "Cameroun",
    countryCode: "CM",
    scheme:      "MOBILEMONEY",
    bank_code:   "ORANGE_CM",
    minAmount:   200,
    maxAmount:   2_000_000,
    fee:         "2.5%",
    directions:  ["withdrawal"],
    phonePrefix: "+237",
    fields: [
      { key: "account_number", label: "Numéro Orange Money", type: "tel",  placeholder: "237XXXXXXXXX", required: true },
      { key: "account_name",   label: "Nom du titulaire",   type: "text", placeholder: "John Doe",     required: true },
    ],
  },

  // ══════════════════════════════════════════════════════════
  // IVORY COAST — XOF Mobile Money
  // ══════════════════════════════════════════════════════════
  {
    id:          "mtn_ci",
    name:        "MTN Mobile Money Côte d'Ivoire",
    logo:        "📱",
    currency:    "XOF",
    country:     "Côte d'Ivoire",
    countryCode: "CI",
    scheme:      "MOBILEMONEY",
    bank_code:   "MTN_CI",
    minAmount:   200,
    maxAmount:   2_000_000,
    fee:         "2.5%",
    directions:  ["deposit", "withdrawal"],
    phonePrefix: "+225",
    fields: [
      { key: "account_number", label: "Numéro MTN MoMo",  type: "tel",  placeholder: "225XXXXXXXXX", required: true },
      { key: "account_name",   label: "Nom du titulaire", type: "text", placeholder: "John Doe",     required: true },
    ],
  },
  {
    id:          "orange_ci",
    name:        "Orange Money Côte d'Ivoire",
    logo:        "📱",
    currency:    "XOF",
    country:     "Côte d'Ivoire",
    countryCode: "CI",
    scheme:      "MOBILEMONEY",
    bank_code:   "ORANGE_CI",
    minAmount:   200,
    maxAmount:   2_000_000,
    fee:         "2.5%",
    directions:  ["withdrawal"],
    phonePrefix: "+225",
    fields: [
      { key: "account_number", label: "Numéro Orange Money", type: "tel",  placeholder: "225XXXXXXXXX", required: true },
      { key: "account_name",   label: "Nom du titulaire",   type: "text", placeholder: "John Doe",     required: true },
    ],
  },
  {
    id:          "moov_ci",
    name:        "Moov Money Côte d'Ivoire",
    logo:        "📱",
    currency:    "XOF",
    country:     "Côte d'Ivoire",
    countryCode: "CI",
    scheme:      "MOBILEMONEY",
    bank_code:   "MOOV_CI",
    minAmount:   200,
    maxAmount:   2_000_000,
    fee:         "2.5%",
    directions:  ["withdrawal"],
    phonePrefix: "+225",
    fields: [
      { key: "account_number", label: "Numéro Moov Money", type: "tel",  placeholder: "225XXXXXXXXX", required: true },
      { key: "account_name",   label: "Nom du titulaire",  type: "text", placeholder: "John Doe",    required: true },
    ],
  },

  // ══════════════════════════════════════════════════════════
  // BENIN — XOF Mobile Money
  // ══════════════════════════════════════════════════════════
  {
    id:          "mtn_bj",
    name:        "MTN Mobile Money Bénin",
    logo:        "📱",
    currency:    "XOF",
    country:     "Bénin",
    countryCode: "BJ",
    scheme:      "MOBILEMONEY",
    bank_code:   "MTN_BJ",
    minAmount:   200,
    maxAmount:   2_000_000,
    fee:         "2.5%",
    directions:  ["withdrawal"],
    phonePrefix: "+229",
    fields: [
      { key: "account_number", label: "Numéro MTN MoMo",  type: "tel",  placeholder: "229XXXXXXXXX", required: true },
      { key: "account_name",   label: "Nom du titulaire", type: "text", placeholder: "John Doe",     required: true },
    ],
  },
  {
    id:          "orange_bj",
    name:        "Orange Money Bénin",
    logo:        "📱",
    currency:    "XOF",
    country:     "Bénin",
    countryCode: "BJ",
    scheme:      "MOBILEMONEY",
    bank_code:   "ORANGE_BJ",
    minAmount:   200,
    maxAmount:   2_000_000,
    fee:         "2.5%",
    directions:  ["withdrawal"],
    phonePrefix: "+229",
    fields: [
      { key: "account_number", label: "Numéro Orange Money", type: "tel",  placeholder: "229XXXXXXXXX", required: true },
      { key: "account_name",   label: "Nom du titulaire",   type: "text", placeholder: "John Doe",     required: true },
    ],
  },
  {
    id:          "moov_bj",
    name:        "Moov Money Bénin",
    logo:        "📱",
    currency:    "XOF",
    country:     "Bénin",
    countryCode: "BJ",
    scheme:      "MOBILEMONEY",
    bank_code:   "MOOV_BJ",
    minAmount:   200,
    maxAmount:   2_000_000,
    fee:         "2.5%",
    directions:  ["withdrawal"],
    phonePrefix: "+229",
    fields: [
      { key: "account_number", label: "Numéro Moov Money",  type: "tel",  placeholder: "229XXXXXXXXX", required: true },
      { key: "account_name",   label: "Nom du titulaire",   type: "text", placeholder: "John Doe",     required: true },
    ],
  },
  {
    id:          "celtis_bj",
    name:        "Celtis Bénin",
    logo:        "📱",
    currency:    "XOF",
    country:     "Bénin",
    countryCode: "BJ",
    scheme:      "MOBILEMONEY",
    bank_code:   "CELTIS_BJ",
    minAmount:   200,
    maxAmount:   2_000_000,
    fee:         "2.5%",
    directions:  ["deposit", "withdrawal"],
    phonePrefix: "+229",
    fields: [
      { key: "account_number", label: "Numéro Celtis",      type: "tel",  placeholder: "229XXXXXXXXX", required: true },
      { key: "account_name",   label: "Nom du titulaire",   type: "text", placeholder: "John Doe",     required: true },
    ],
  },

  // ══════════════════════════════════════════════════════════
  // UGANDA — UGX Mobile Money
  // ══════════════════════════════════════════════════════════
  {
    id:          "mtn_ug",
    name:        "MTN Mobile Money Uganda",
    logo:        "📱",
    currency:    "UGX",
    country:     "Uganda",
    countryCode: "UG",
    scheme:      "MOBILEMONEY",
    bank_code:   "MTN_UG",
    minAmount:   500,
    maxAmount:   5_000_000,
    fee:         "2.5%",
    directions:  ["withdrawal"],
    phonePrefix: "+256",
    fields: [
      { key: "account_number", label: "Numéro MTN MoMo",  type: "tel",  placeholder: "256XXXXXXXXX", required: true },
      { key: "account_name",   label: "Nom du titulaire", type: "text", placeholder: "John Doe",     required: true },
    ],
  },
  {
    id:          "airtel_ug",
    name:        "Airtel Money Uganda",
    logo:        "📱",
    currency:    "UGX",
    country:     "Uganda",
    countryCode: "UG",
    scheme:      "MOBILEMONEY",
    bank_code:   "AIRTEL_UG",
    minAmount:   500,
    maxAmount:   5_000_000,
    fee:         "2.5%",
    directions:  ["withdrawal"],
    phonePrefix: "+256",
    fields: [
      { key: "account_number", label: "Numéro Airtel Money", type: "tel",  placeholder: "256XXXXXXXXX", required: true },
      { key: "account_name",   label: "Nom du titulaire",   type: "text", placeholder: "John Doe",     required: true },
    ],
  },

  // ══════════════════════════════════════════════════════════
  // TANZANIA — TZS Mobile Money
  // ══════════════════════════════════════════════════════════
  {
    id:          "tigo_tz",
    name:        "Tigo Pesa Tanzania",
    logo:        "📱",
    currency:    "TZS",
    country:     "Tanzania",
    countryCode: "TZ",
    scheme:      "MOBILEMONEY",
    bank_code:   "TIGO_TZ",
    minAmount:   500,
    maxAmount:   5_000_000,
    fee:         "2.5%",
    directions:  ["withdrawal"],
    phonePrefix: "+255",
    fields: [
      { key: "account_number", label: "Numéro Tigo Pesa",  type: "tel",  placeholder: "255XXXXXXXXX", required: true },
      { key: "account_name",   label: "Nom du titulaire",  type: "text", placeholder: "John Doe",     required: true },
    ],
  },
  {
    id:          "airtel_tz",
    name:        "Airtel Money Tanzania",
    logo:        "📱",
    currency:    "TZS",
    country:     "Tanzania",
    countryCode: "TZ",
    scheme:      "MOBILEMONEY",
    bank_code:   "AIRTEL_TZ",
    minAmount:   500,
    maxAmount:   5_000_000,
    fee:         "2.5%",
    directions:  ["withdrawal"],
    phonePrefix: "+255",
    fields: [
      { key: "account_number", label: "Numéro Airtel Money", type: "tel",  placeholder: "255XXXXXXXXX", required: true },
      { key: "account_name",   label: "Nom du titulaire",   type: "text", placeholder: "John Doe",     required: true },
    ],
  },
  {
    id:          "halo_tz",
    name:        "HaloPesa Tanzania",
    logo:        "📱",
    currency:    "TZS",
    country:     "Tanzania",
    countryCode: "TZ",
    scheme:      "MOBILEMONEY",
    bank_code:   "HALO_TZ",
    minAmount:   500,
    maxAmount:   5_000_000,
    fee:         "2.5%",
    directions:  ["withdrawal"],
    phonePrefix: "+255",
    fields: [
      { key: "account_number", label: "Numéro HaloPesa",  type: "tel",  placeholder: "255XXXXXXXXX", required: true },
      { key: "account_name",   label: "Nom du titulaire", type: "text", placeholder: "John Doe",    required: true },
    ],
  },

  // ══════════════════════════════════════════════════════════
  // USD — Compte Virtuel ACH/Fedwire (Deposit uniquement)
  // ══════════════════════════════════════════════════════════
  {
    id:          "usd_ach",
    name:        "Virement Bancaire USD (ACH / Fedwire)",
    logo:        "🏦",
    currency:    "USD",
    country:     "International",
    countryCode: "US",
    scheme:      "BANK_TRANSFER",
    minAmount:   1,
    maxAmount:   1_000,
    fee:         "Variable selon rail (ACH / Fedwire)",
    directions:  ["deposit", "withdrawal"],
    phonePrefix: "+1",
    fields: [
      { key: "counterparty_id", label: "ID Destinataire",   type: "text", placeholder: "ctp_xxxxxxxx", required: true },
      { key: "memo",            label: "Mémo",             type: "text", placeholder: "Paiement Freda Pay", required: false },
      { key: "payment_rail",    label: "Rail de paiement", type: "select", required: true, options: [
        { label: "ACH (1-3 jours ouvrés)",        value: "ACH" },
        { label: "ACH Accéléré (même jour)",      value: "ACH-ACCELERATED" },
        { label: "Fedwire (quelques heures)",     value: "FEDWIRE" },
      ]},
    ],
  },
];

// ── Helpers ───────────────────────────────────────────────────

/** Tous les canaux pour une direction (deposit ou withdrawal) */
export const getChannelsByDirection = (direction: "deposit" | "withdrawal") =>
  PAYMENT_CHANNELS.filter(c => c.directions.includes(direction));

/** Canaux pour une devise spécifique */
export const getChannelsByCurrency = (currency: string) =>
  PAYMENT_CHANNELS.filter(c => c.currency === currency);

/** Trouver un canal par ID */
export const getChannelById = (id: string) =>
  PAYMENT_CHANNELS.find(c => c.id === id);

/** Grouper les canaux par pays */
export const getChannelsByCountry = (): Record<string, PaymentChannel[]> =>
  PAYMENT_CHANNELS.reduce((acc, ch) => {
    if (!acc[ch.country]) acc[ch.country] = [];
    acc[ch.country].push(ch);
    return acc;
  }, {} as Record<string, PaymentChannel[]>);

/** Toutes les devises disponibles (uniques) */
export const SUPPORTED_CURRENCIES = [...new Set(PAYMENT_CHANNELS.map(c => c.currency))];

/** Map devise → frais */
export const TRANSFER_FEES: Record<string, { type: "flat" | "percent"; value: number; min?: number; unit: string }> = {
  NGN: { type: "flat",    value: 10,   unit: "₦"  },
  GHS: { type: "percent", value: 1,    min: 6,     unit: "GHS" },
  KES: { type: "percent", value: 1,    min: 150,   unit: "KES" },
  XAF: { type: "percent", value: 2.5,  unit: "XAF" },
  XOF: { type: "percent", value: 2.5,  unit: "XOF" },
  UGX: { type: "percent", value: 2.5,  unit: "UGX" },
  TZS: { type: "percent", value: 2.5,  unit: "TZS" },
  USD: { type: "flat",    value: 0,    unit: "$"  },
};

/** Calculer frais estimés */
export const estimateFee = (currency: string, amount: number): number => {
  const fee = TRANSFER_FEES[currency];
  if (!fee) return 0;
  if (fee.type === "flat") return fee.value;
  const pct = amount * (fee.value / 100);
  return fee.min ? Math.max(pct, fee.min) : pct;
};
