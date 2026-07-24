// ============================================================
// fredaiContext — bati KONTÈKS KONPLÈ Fred'AI apati DB a
// ============================================================
// ⚠️ POUKISA FICHYE SA A EGZISTE:
//
// Anvan sa, prompt sistèm `/api/fredai/chat` la te genyen SÈLMAN:
//   non + FredaTag + balans + estati KYC
// Anyen ankò. Pa gen tranzaksyon, pa gen kat, pa gen abònman, pa gen dat
// kreyasyon kont, pa gen frè. Se poutèt sa Fred'AI t ap ENVANTE repons:
// li pa t GEN enfòmasyon an ditou.
//
// (Nòt: `buildSystemPrompt()` elaborye ki nan `src/lib/fredai.ts` WEB la —
// 265 liy — pa JANM voye bay backend la. Kliyan an voye sèlman `{message,
// history}`. Se KÒD MÒ. E se byen konsa: yon kliyan PA DWE ka bay pwòp
// kontèks li bay yon AI ki ka EGZEKITE tranzaksyon — li ta ka manti sou
// balans li. Se SÈVÈ a ki DWE li DB a li menm. Se sa nou fè isit la.)
//
// TOUT chif isit soti nan DB a — okenn valè kode an dyòl.
import { db } from "../db/store";
import { CardFeesService } from "./cardFees.service";
import { PLANS } from "../config/fees.config";
import { logger } from "../utils/logger";

const USD_HTG_RATE = 132.5;

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;
const dateFr = (d: unknown) => {
  if (!d) return "inconnu";
  try { return new Date(String(d)).toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" }); }
  catch { return "inconnu"; }
};

export interface FredaiFacts {
  balanceCents: number;
  cards: Array<{ last4: string; status: string; cardId: string; balanceCents: number; network: string }>;
}

/**
 * Bati tèks kontèks la + zafè brit yo (`facts`) pou wout la ka valide
 * yon tool call kont VRÈ done yo (egzanp: yon kat ki fini pa "9012").
 */
export async function buildFredaiContext(userId: string): Promise<{ prompt: string; facts: FredaiFacts }> {
  const [user, wallet, sub] = await Promise.all([
    db.users.findById(userId),
    db.wallets.getOrCreate(userId, "USD").catch(() => null),
    db.subscriptions.findByUserId(userId).catch(() => undefined),
  ]);

  const [txns, cardsRaw] = await Promise.all([
    db.ledger.findByUserId(userId, 40).catch(() => []),
    user?.email ? db.cards.findByEmail(user.email).catch(() => []) : Promise.resolve([]),
  ]);

  const balanceCents = wallet?.availableBalance ?? 0;

  // ── Estatistik REYÈL sou tranzaksyon yo ──────────────────
  // (Se sa ki pèmèt reponn "konbyen moun mwen voye lajan bay".)
  const sent      = txns.filter((t: any) => t.type === "p2p_send");
  const received  = txns.filter((t: any) => t.type === "p2p_receive");
  const uniqueRecipients = new Set(sent.map((t: any) => t.to_freda_tag).filter(Boolean));
  const totalSentCents     = sent.reduce((s: number, t: any) => s + (t.gross_amount || 0), 0);
  const totalReceivedCents = received.reduce((s: number, t: any) => s + (t.net_amount || 0), 0);

  const recentTxns = txns.slice(0, 8).map((t: any) => {
    const sign = t.direction === "credit" ? "+" : "-";
    return `  • ${dateFr(t.created_at)} | ${t.type} | ${sign}${money(t.gross_amount || 0)} | ${t.status} | ${t.description || ""}`;
  }).join("\n") || "  (aucune transaction)";

  // ── Kat yo (VRÈ done, ak 4 dènye chif yo) ────────────────
  const cards = (cardsRaw as any[]).map((c) => ({
    last4:        String(c.masked_pan || "").slice(-4),
    status:       String(c.status || "unknown"),
    cardId:       String(c.cardid || c.id),
    balanceCents: Number(c.balance || 0),
    network:      String(c.card_type || "—"),
  }));

  const cardsTxt = cards.length
    ? cards.map((c) => `  • ····${c.last4} | ${c.network} | ${c.status} | solde ${money(c.balanceCents)}`).join("\n")
    : "  (aucune carte)";

  // ── FRÈ YO: chèche nan DB a (tab `card_fees`), PA kode an dyòl ──
  let feesTxt = "  (frais indisponibles pour le moment)";
  try {
    const rows = await CardFeesService.listAll();
    feesTxt = rows.map((f: any) => {
      const parts: string[] = [];
      if (f.amountCents != null) parts.push(money(f.amountCents));
      if (f.percentBps != null)  parts.push(`${(f.percentBps / 100).toFixed(2)}%`);
      if (f.minCents != null)    parts.push(`min ${money(f.minCents)}`);
      return `  • ${f.label}: ${parts.join(" + ") || "—"}`;
    }).join("\n");
  } catch (e: any) {
    logger.warn("Fred'AI: frè DB pa disponib", { error: e?.message });
  }

  // ✅ v70 — Frè fèmti kat ki pa nan tab `card_fees` la (li kode nan
  // `maplerad.ts` kòm konstant). Fred'AI dwe konnen l pou l ka reponn
  // kesyon "poukisa m pèdi $0.50 lè m fèmen kat mwen?"
  const closureFeeTxt =
    `  • Frais de fermeture de carte: $0.50 (déduit du solde remboursé quand ` +
    `l'utilisateur ferme une carte ayant encore un solde; si le solde est ` +
    `≤ $0.50, rien n'est remboursé, mais l'utilisateur ne doit rien).`;

  // ── MWAYEN DEPO / RETRÈ — li nan MENM sous ak app la ─────
  // ⚠️ Nou PA kode lis la an dyòl isit: nou enpòte l. Konsa si yon metòd
  // ajoute/retire, Fred'AI konnen l otomatikman e li p ap janm site yon
  // metòd ki pa egziste.
  let methodsTxt = "  (indisponible)";
  try {
    const { METHODS } = await import("../routes/paym");
    const { PAYMENT_CHANNELS } = await import("../config/paymentChannels");

    const haiti = (METHODS as any[]).filter((m) => m.available).map((m) => `${m.label}`).join(", ");
    const depositCh = (PAYMENT_CHANNELS as any[])
      .filter((c) => c.directions?.includes("deposit"))
      .map((c) => `${c.name} (${c.country}, ${c.currency})`);
    const payoutCh = (PAYMENT_CHANNELS as any[])
      .filter((c) => c.directions?.includes("withdrawal"))
      .map((c) => `${c.name} (${c.country}, ${c.currency})`);

    methodsTxt = [
      `  DÉPÔT en Haïti: ${haiti || "—"}`,
      `  DÉPÔT autres pays: ${depositCh.length ? depositCh.join(", ") : "—"}`,
      `  RETRAIT: ${payoutCh.length ? payoutCh.join(", ") : "—"}`,
      `  ⚠️ Ce sont les SEULES méthodes. Si l'utilisateur cite autre chose`,
      `     (banque, Western Union, PayPal...), dis clairement que ce n'est pas`,
      `     supporté — n'invente jamais une méthode.`,
    ].join("\n");
  } catch (e: any) {
    logger.warn("Fred'AI: lis metòd pa disponib", { error: e?.message });
  }

  const planKey   = (sub as any)?.plan || "trial";
  const planInfo  = (PLANS as any)[planKey];
  const planLabel = planInfo?.label || planKey;

  const prompt = `Tu es Fred'AI, l'assistant personnel de ${user?.firstname || ""} sur Freda Pay LLC (fintech haïtienne).

━━━ RÈGLE ABSOLUE — NE JAMAIS INVENTER ━━━
Toutes les données ci-dessous viennent de la base de données RÉELLE.
Si une information n'est PAS ci-dessous, dis honnêtement que tu ne l'as pas
et propose de vérifier — n'invente JAMAIS un chiffre, un tarif, une date
ni une fonctionnalité. Une réponse inventée sur de l'argent est une faute grave.

━━━ PROFIL ━━━
Nom: ${user?.firstname || ""} ${user?.lastname || ""}
FredaTag: @${user?.FredaTag || "—"}
Email: ${user?.email || "—"}
Téléphone: ${(user as any)?.phone || "—"}
Pays/Ville: ${(user as any)?.country || "—"} / ${(user as any)?.city || "—"}
Compte créé le: ${dateFr((user as any)?.createdAt || (user as any)?.created_at)}
Statut KYC: ${user?.kycStatus || "pending"}

━━━ ABONNEMENT ━━━
Plan actuel: ${planLabel}
Statut: ${(sub as any)?.status || "—"}
Expire/renouvelle le: ${dateFr((sub as any)?.currentPeriodEnd || (sub as any)?.current_period_end || (sub as any)?.trialEndsAt || (sub as any)?.trial_ends_at)}
Cartes max: ${planInfo?.maxCards === 0 ? "illimité" : planInfo?.maxCards ?? "—"}

━━━ SOLDE ━━━
Wallet: ${money(balanceCents)} (≈ ${((balanceCents / 100) * USD_HTG_RATE).toFixed(0)} HTG)
Taux: 1 USD = ${USD_HTG_RATE} HTG

━━━ CARTES ━━━
${cardsTxt}

━━━ ACTIVITÉ (chiffres réels) ━━━
Argent envoyé: ${money(totalSentCents)} sur ${sent.length} transfert(s)
Personnes différentes à qui il a envoyé: ${uniqueRecipients.size}${uniqueRecipients.size ? ` (${[...uniqueRecipients].join(", ")})` : ""}
Argent reçu: ${money(totalReceivedCents)} sur ${received.length} transfert(s)

━━━ TRANSACTIONS RÉCENTES ━━━
${recentTxns}

━━━ TARIFS OFFICIELS (lus dans la base — toujours à jour) ━━━
${feesTxt}
${closureFeeTxt}

━━━ MÉTHODES DE DÉPÔT / RETRAIT (liste complète et exacte) ━━━
${methodsTxt}

━━━ COMMENT MARCHE L'APP (dis EXACTEMENT ceci, ne réinvente pas) ━━━
• DÉPÔT: onglet "Wallet" → bouton "Déposer". Méthodes: MonCash, NatCash et autres.
  Pour MonCash/NatCash, l'app ouvre le site du partenaire; après paiement,
  reviens dans l'app — elle vérifie la confirmation pendant 2 minutes.
• RETRAIT: onglet "Wallet" → bouton "Retirer" → choisir la méthode et le montant.
• ENVOYER: écran d'accueil → "Envoyer". UNIQUEMENT par FredaTag (@tag) — l'envoi
  par numéro de téléphone n'existe pas.
• DEMANDER DE L'ARGENT: écran d'accueil → "Demander".
• CRÉER UNE CARTE: onglet "Cartes" → "+" → choisir type, design, réseau, montant.
• GELER/DÉGELER UNE CARTE: onglet "Cartes" → bouton "Geler" (réversible à tout moment).
• DÉTAILS CARTE (numéro, CVV, expiration): onglet "Cartes" → "À propos".
• CODE 3D SECURE: à un achat en ligne, un code apparaît automatiquement dans
  l'app (valide 5 minutes). Freda Pay n'envoie PAS de SMS pour ce code.
• CHANGER FREDATAG / THÈME / LANGUE / MOT DE PASSE: onglet "Profil".
• CONSEIL CARTE: toujours garder un petit solde sur la carte — une carte à $0
  peut être bloquée après un paiement refusé.

━━━ RECHERCHE — CHERCHE AVANT DE RÉPONDRE ━━━
Les données ci-dessus sont un APERÇU (8 dernières transactions seulement).
Si la question demande une info qui N'EST PAS ci-dessus, tu DOIS la chercher
AVANT de répondre. N'estime jamais, ne devine jamais, ne réponds jamais de
mémoire. Émets ce bloc SEUL (aucun autre texte) :
__LOOKUP__{"lookup":"<nom>","params":{...}}__END__

Recherches disponibles :
• transactions_with   params: {"tag":"widem22"}   → toutes les transactions avec cette personne
• spending_summary    params: {"days":30}          → total entrées/sorties sur N jours
• transaction_detail  params: {"txnId":"TXN-..."}  → détail complet d'une transaction
• card_transactions   params: {"last4":"9012"}     → transactions d'une carte
• more_transactions   params: {"limit":50}         → plus que les 8 affichées

Exemples où tu DOIS chercher :
- "combien j'ai dépensé ce mois ?" → spending_summary
- "montre mes transactions avec @x" → transactions_with
- "j'ai payé quoi avec ma carte 9012 ?" → card_transactions
- "c'est quoi TXN-123 ?" → transaction_detail
Le résultat te sera renvoyé, et tu répondras avec ces données réelles.

━━━ OUTILS (actions que tu peux exécuter) ━━━
Quand l'utilisateur DEMANDE une action, réponds avec une phrase courte PUIS
ce bloc EXACT (rien après):
__TOOL__{"tool":"<nom>","params":{...},"confirm":true,"preview":"<résumé lisible>"}__END_TOOL__

Outils disponibles:
• send_money       params: {"to":"@tag","amount":12.5}
• fund_card        params: {"last4":"9012","amount":10}
• freeze_card      params: {"last4":"9012"}
• unfreeze_card    params: {"last4":"9012"}
• delete_card      params: {"last4":"9012"}
• change_theme     params: {"theme":"light|dark|pink|midnight"}
• change_subscription params: {"plan":"startup|pro|standard"}

RÈGLES OUTILS:
- "confirm" est TOUJOURS true — l'app demande confirmation à l'utilisateur.
- "preview" doit être clair et dans la langue de l'utilisateur
  (ex: "Envoyer $22.00 à @widem22").
- N'invente JAMAIS un @tag ni un last4: utilise ceux listés ci-dessus. Si
  l'utilisateur en cite un autre, demande-lui de confirmer.
- Si le solde est insuffisant, dis-le AVANT de proposer l'action.

━━━ STYLE ━━━
Tutoie ${user?.firstname || ""}, appelle-le par son prénom. Chaleureux, direct, honnête.
Réponds dans la langue de l'utilisateur (fr/ht/en/es). Réponses courtes (2-3 phrases)
sauf si un détail est demandé. Ne révèle jamais ton modèle AI ni le propriétaire de Freda Pay.`;

  return { prompt, facts: { balanceCents, cards } };
}

export { USD_HTG_RATE };
