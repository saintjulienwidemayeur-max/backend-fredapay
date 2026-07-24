// ============================================================
// FREDA PAY — Données officielles pour Fred'AI
// Source: fredapay.com (Mai 2026)
// Fred'AI utilise ce fichier pour répondre aux questions clients
// ============================================================

export const FREDAPAY_INFO = {
  company: {
    name: "FREDA PAY LLC",
    group: "Freda Group",
    address: "30 N Gould St Ste R, Sheridan, WY 82801, États-Unis",
    email: "contact@fredapay.com",
    website: "https://fredapay.com",
    description:
      "Freda Pay est une plateforme fintech mondiale née dans les Caraïbes. Elle permet la création de cartes virtuelles USD, l'accès à un compte bancaire américain et des paiements internationaux pour Haïti, l'Afrique, les Caraïbes et l'Amérique du Sud.",
    legalStatus:
      "Enregistrée dans l'État du Wyoming (USA). Opère en tant que Money Services Business (MSB) auprès du FinCEN.",
    lastUpdated: "Mai 2026",
  },

  services: [
    "Création et gestion de compte utilisateur",
    "Accès à des comptes en USD via des partenaires financiers agréés",
    "Envoi et réception de fonds",
    "Dépôts et retraits",
    "Cartes de débit virtuelles (Mastercard / Visa)",
    "Consultation des transactions",
    "Assistant intelligent Fred'AI",
  ],

  important_note:
    "Freda Pay N'EST PAS une banque. Les services bancaires, comptes USD, cartes et paiements sont fournis par des partenaires financiers agréés.",

  // ── FRAIS (fredapay.com/frais) ────────────────────────────────
  fees: {
    oneTime: [
      { service: "Carte Mastercard virtuelle", fee: "5,20 USD / carte émise" },
      { service: "Ouverture de compte bancaire USD (USA)", fee: "12,00 USD (frais de création)" },
    ],
    perTransaction: [
      { type: "Transaction réussie (frais standard)", fee: "0,50 USD" },
      { type: "Transaction échouée (solde insuffisant)", fee: "0,40 USD" },
    ],
    deposit: [
      { method: "Dépôt standard", fee: "1,50 USD + 5% du montant" },
    ],
    subscriptions: [
      {
        name: "Start-Up",
        price: "3 USD/mois",
        features: [
          "Accès complet à Freda Pay",
          "Jusqu'à 2 cartes actives",
          "Limite 600 USD / mois",
          "100 messages Fred'AI / mois",
        ],
      },
      {
        name: "Pro",
        price: "7 USD/mois",
        popular: true,
        features: [
          "Accès complet à Freda Pay",
          "Jusqu'à 5 cartes actives",
          "Fred'AI illimité",
          "Support client 24/7",
          "1 carte gratuite incluse",
          "Cashback 0,05% éligible",
        ],
      },
      {
        name: "Standard",
        price: "15 USD/mois",
        features: [
          "Compte bancaire USD inclus",
          "2 cartes gratuites incluses",
          "Cartes illimitées*",
          "Support prioritaire spécialisé",
          "Aucune limite standard*",
        ],
        note: "* Soumis aux contrôles AML/KYC et aux politiques des partenaires bancaires.",
      },
    ],
    generalConditions: [
      "Tous les frais sont non remboursables sauf indication contraire.",
      "Les frais peuvent varier selon le pays et le partenaire financier.",
      "Des frais additionnels des réseaux Visa / Mastercard peuvent s'appliquer.",
      "Freda Pay se réserve le droit de modifier les tarifs avec préavis raisonnable.",
      "Tous les montants sont en USD sauf mention contraire.",
    ],
  },

  // ── CONDITIONS D'UTILISATION (fredapay.com/conditions) ───────
  termsOfService: {
    url: "https://fredapay.com/conditions",
    lastUpdated: "Mai 2026",
    eligibility: [
      "Être âgé d'au moins 18 ans",
      "Être légalement autorisé à utiliser des services financiers dans sa juridiction",
      "Fournir des informations exactes, complètes et à jour",
      "Protéger ses identifiants, mots de passe et appareils",
    ],
    kyc_aml: [
      "Documents d'identité",
      "Preuve d'adresse",
      "Informations complémentaires",
      "Vérification biométrique",
      "Toute documentation requise par les partenaires de conformité",
    ],
    prohibitedUses: [
      "Utiliser les services à des fins frauduleuses ou illégales",
      "Fournir de fausses informations",
      "Contourner les obligations réglementaires",
      "Accéder sans autorisation aux systèmes de Freda Pay",
      "Perturber le fonctionnement de la plateforme",
      "Utiliser les comptes ou cartes pour des activités interdites",
    ],
    fredAI_disclaimer:
      "Les réponses de Fred'AI sont fournies à titre informatif uniquement et ne constituent pas un conseil financier, juridique ou fiscal.",
    transactions:
      "Toutes les transactions initiées depuis votre compte sont présumées autorisées par vous. Les délais varient selon les banques partenaires, réseaux de paiement et contrôles de conformité.",
    errors:
      "Toute erreur ou transaction non autorisée doit être signalée dès que possible à contact@fredapay.com.",
    governingLaw: "Lois de l'État du Wyoming, États-Unis. Certaines activités locales peuvent également être soumises aux lois applicables en Haïti.",
  },

  // ── POLITIQUE DE CONFIDENTIALITÉ (fredapay.com/confidentialite) ─
  privacyPolicy: {
    url: "https://fredapay.com/confidentialite",
    lastUpdated: "Mai 2026",
    dataCollected: {
      identity: ["Nom, prénom, date de naissance", "Adresse postale et pays de résidence", "Pièce d'identité", "Selfie et données biométriques (si requis)", "Numéro de téléphone et email"],
      financial: ["Historique des transactions", "Soldes de compte", "Informations sur les méthodes de paiement", "Numéros partiels de carte"],
      technical: ["Adresse IP et localisation approximative", "Type d'appareil et système d'exploitation", "Journaux de connexion", "Identifiants de session"],
    },
    dataSharingWith: [
      "Partenaires financiers agréés (comptes USD, cartes, paiements)",
      "Prestataires KYC/AML",
      "Autorités compétentes (si requis par la loi)",
      "FinCEN (USA) — en tant que MSB enregistré",
      "Freda Group (société affiliée)",
      "Prestataires techniques (hébergement, cloud, sécurité)",
    ],
    neverSold: "Freda Pay ne vend, ne loue et ne cède JAMAIS vos données personnelles à des tiers à des fins publicitaires ou commerciales.",
    security: [
      "Chiffrement AES-256 (données au repos et en transit TLS 1.2+)",
      "Authentification à deux facteurs (2FA)",
      "Surveillance continue et détection d'intrusion",
      "Certification PCI-DSS Level 1",
      "Accès restreint au personnel autorisé",
      "Audits de sécurité réguliers",
    ],
    retention: {
      kycAndFinancial: "Minimum 5 ans après la clôture du compte (obligation AML)",
      transactionLogs: "5 à 7 ans selon la juridiction",
      support: "3 ans après la résolution",
      marketing: "Jusqu'au retrait du consentement",
    },
    userRights: [
      "Droit d'accès — obtenir une copie de vos données",
      "Droit de rectification — corriger des données inexactes",
      "Droit à l'effacement — demander la suppression (sous réserve des obligations légales)",
      "Droit à la portabilité — recevoir vos données dans un format structuré",
      "Droit d'opposition — vous opposer à certains traitements",
      "Retrait du consentement — pour les traitements basés sur le consentement",
    ],
    contact: "contact@fredapay.com",
  },

  // ── CONTEXTE SYSTEM PROMPT pour Fred'AI ───────────────────────
  fredAI_systemContext: `Tu es Fred'AI, l'assistant intelligent de Freda Pay.

IDENTITÉ :
- Tu t'appelles Fred'AI (ou Freda AI)
- Tu es l'assistant officiel de Freda Pay, une plateforme fintech basée aux USA (Wyoming), opérée par FREDA PAY LLC, membre du groupe Freda Group
- Freda Pay propose des cartes virtuelles USD, comptes bancaires américains, envoi/réception de fonds, et des paiements internationaux — notamment pour Haïti, les Caraïbes et l'Afrique

FRAIS PRINCIPAUX (à communiquer clairement) :
- Carte Mastercard virtuelle : 5,20 USD / carte
- Compte bancaire USD : 12,00 USD (ouverture)
- Transaction réussie : 0,50 USD de frais standard
- Transaction échouée (solde insuffisant) : 0,40 USD
- Dépôt : 1,50 USD + 5% du montant
- Plans : Start-Up 3$/mois · Pro 7$/mois (populaire) · Standard 15$/mois

TES CAPACITÉS :
- Répondre aux questions sur les services, frais, plans d'abonnement
- Expliquer les conditions d'utilisation et la politique de confidentialité
- Aider l'utilisateur à naviguer dans l'application
- Initier ou guider des opérations avec l'autorisation explicite du titulaire
- Fournir des recommandations sur les produits Freda Pay

LIMITES IMPORTANTES :
- Tu fournis des informations à titre INFORMATIF uniquement
- Tu ne donnes PAS de conseils financiers, juridiques ou fiscaux
- Tu ne garantis pas l'exactitude permanente de toutes les informations
- Pour les problèmes de compte sécurité : rediriger vers contact@fredapay.com

STYLE :
- Sois chaleureux, professionnel et concis
- Réponds dans la langue de l'utilisateur (français, créole haïtien, anglais)
- Utilise des emojis avec modération pour rendre la conversation agréable
- En cas de doute sur une opération financière spécifique, invite l'utilisateur à contacter le support`,
};

// ── Helper: récupérer le contexte Fred'AI pour le system prompt ──
export function getFredAISystemPrompt(userContext?: {
  name?: string;
  FredaTag?: string;
  balance?: number;
  kycStatus?: string;
  subscription?: string;
}): string {
  let prompt = FREDAPAY_INFO.fredAI_systemContext;

  if (userContext) {
    prompt += `\n\nCONTEXTE UTILISATEUR ACTUEL :`;
    if (userContext.name)         prompt += `\n- Nom : ${userContext.name}`;
    if (userContext.FredaTag)     prompt += `\n- FredaTag : @${userContext.FredaTag}`;
    if (userContext.balance !== undefined) prompt += `\n- Solde wallet : ${(userContext.balance / 100).toFixed(2)} USD`;
    if (userContext.kycStatus)    prompt += `\n- Statut KYC : ${userContext.kycStatus}`;
    if (userContext.subscription) prompt += `\n- Plan actif : ${userContext.subscription}`;
  }

  return prompt;
}

// ── Helper: résumé frais pour réponse rapide Fred'AI ─────────────
export function getFeeSummary(): string {
  return `📋 **Frais Freda Pay (Mai 2026)**

💳 **Frais uniques**
• Carte Mastercard virtuelle : 5,20 USD
• Compte bancaire USD : 12,00 USD

💸 **Frais par transaction**
• Transaction réussie : 0,50 USD
• Transaction échouée : 0,40 USD

📥 **Dépôt**
• 1,50 USD + 5% du montant

📦 **Plans mensuels**
• Start-Up : 3 USD/mois (2 cartes, 600 USD/mois)
• Pro : 7 USD/mois (5 cartes, Fred'AI illimité ⭐)
• Standard : 15 USD/mois (compte USD inclus, cartes illimitées)

Tous les frais sont affichés avant validation. Aucun frais caché.`;
}

export default FREDAPAY_INFO;
