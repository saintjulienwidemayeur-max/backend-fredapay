// ============================================================
// Validation des entrées utilisateur
// ============================================================

export const Validate = {

  email(email: string): { valid: boolean; error?: string } {
    if (!email) return { valid: false, error: "Email requis" };
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!re.test(email)) return { valid: false, error: "Format email invalide" };
    if (email.length > 254) return { valid: false, error: "Email trop long" };
    return { valid: true };
  },

  password(password: string): { valid: boolean; error?: string; score: number } {
    if (!password) return { valid: false, error: "Mot de passe requis", score: 0 };
    if (password.length < 8) return { valid: false, error: "Minimum 8 caractères", score: 0 };
    if (password.length > 128) return { valid: false, error: "Mot de passe trop long", score: 0 };

    let score = 0;
    if (password.length >= 12)        score++;
    if (/[a-z]/.test(password))       score++;
    if (/[A-Z]/.test(password))       score++;
    if (/[0-9]/.test(password))       score++;
    if (/[^A-Za-z0-9]/.test(password)) score++;

    return { valid: true, score };
  },

  name(name: string, field = "Nom"): { valid: boolean; error?: string } {
    if (!name?.trim()) return { valid: false, error: `${field} requis` };
    if (name.length < 2) return { valid: false, error: `${field} trop court (min 2 caractères)` };
    if (name.length > 50) return { valid: false, error: `${field} trop long (max 50 caractères)` };
    if (!/^[a-zA-ZÀ-ÿ\s'-]+$/.test(name)) return { valid: false, error: `${field} contient des caractères invalides` };
    return { valid: true };
  },

  phone(phone: string): { valid: boolean; error?: string } {
    if (!phone) return { valid: true }; // optionnel
    const cleaned = phone.replace(/[\s\-\(\)]/g, "");
    if (!/^\+?[0-9]{7,15}$/.test(cleaned)) return { valid: false, error: "Numéro de téléphone invalide" };
    return { valid: true };
  },

  FredaTag(tag: string): { valid: boolean; error?: string } {
    const clean = tag.startsWith("@") ? tag.slice(1) : tag;
    if (!clean) return { valid: false, error: "FredaTag requis" };
    if (clean.length < 3) return { valid: false, error: "FredaTag trop court (min 3 caractères)" };
    if (clean.length > 20) return { valid: false, error: "FredaTag trop long (max 20 caractères)" };
    if (!/^[a-zA-Z0-9_]+$/.test(clean)) return { valid: false, error: "FredaTag: lettres, chiffres et _ seulement" };
    return { valid: true };
  },

  amount(amount: unknown): { valid: boolean; error?: string; value?: number } {
    const num = parseFloat(String(amount));
    if (isNaN(num)) return { valid: false, error: "Montant invalide" };
    if (num <= 0) return { valid: false, error: "Le montant doit être positif" };
    if (num > 100000) return { valid: false, error: "Montant trop élevé (max $100,000)" };
    return { valid: true, value: Math.round(num * 100) / 100 };
  },

  // Générer un FredaTag unique depuis prénom + nom
  generateFredaTag(firstname: string, lastname: string): string {
    // Max 8 chars base + 3 chiffres = 11 total max (ex: @jeanpau387)
    const base = `${firstname.toLowerCase()}${lastname.slice(0, 3).toLowerCase()}`
      .replace(/[^a-z0-9]/g, "")
      .slice(0, 8);   // max 8 chars avant suffix
    const suffix = Math.floor(Math.random() * 999).toString().padStart(3, "0");
    return `${base}${suffix}`;
  },
};
