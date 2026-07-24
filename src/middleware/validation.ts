// ============================================================
// Validation Avanse — Freda Pay
// Middleware de validation pour toutes les routes
// ============================================================

import { Request, Response, NextFunction } from "express";

// ── Types ─────────────────────────────────────────────────────

interface ValidationRule {
  field: string;
  rules: RuleFn[];
  optional?: boolean;
}

type RuleFn = (value: unknown, field: string) => string | null;

interface ValidationError {
  field: string;
  message: string;
}

// ── Règles de validation réutilisables ────────────────────────

export const rules = {
  required(): RuleFn {
    return (v, f) => (v === undefined || v === null || v === "") ? `${f} est requis` : null;
  },

  string(): RuleFn {
    return (v, f) => typeof v !== "string" ? `${f} doit être une chaîne de caractères` : null;
  },

  minLength(min: number): RuleFn {
    return (v, f) => typeof v === "string" && v.length < min ? `${f} doit contenir au moins ${min} caractères` : null;
  },

  maxLength(max: number): RuleFn {
    return (v, f) => typeof v === "string" && v.length > max ? `${f} ne peut pas dépasser ${max} caractères` : null;
  },

  email(): RuleFn {
    return (v, f) => {
      if (typeof v !== "string") return null;
      const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      return !re.test(v) ? `${f}: format email invalide` : null;
    };
  },

  password(): RuleFn {
    return (v, f) => {
      if (typeof v !== "string") return null;
      if (v.length < 8) return `${f}: minimum 8 caractères`;
      return null;
    };
  },

  number(): RuleFn {
    return (v, f) => {
      const n = Number(v);
      return isNaN(n) ? `${f} doit être un nombre` : null;
    };
  },

  positiveNumber(): RuleFn {
    return (v, f) => {
      const n = Number(v);
      return isNaN(n) || n <= 0 ? `${f} doit être un nombre positif` : null;
    };
  },

  min(min: number): RuleFn {
    return (v, f) => {
      const n = Number(v);
      return !isNaN(n) && n < min ? `${f} doit être au moins ${min}` : null;
    };
  },

  max(max: number): RuleFn {
    return (v, f) => {
      const n = Number(v);
      return !isNaN(n) && n > max ? `${f} ne peut pas dépasser ${max}` : null;
    };
  },

  oneOf(values: string[]): RuleFn {
    return (v, f) => {
      if (!values.includes(String(v))) {
        return `${f} doit être l'une des valeurs: ${values.join(", ")}`;
      }
      return null;
    };
  },

  pattern(regex: RegExp, msg: string): RuleFn {
    return (v, f) => {
      if (typeof v !== "string") return null;
      return !regex.test(v) ? `${f}: ${msg}` : null;
    };
  },

  noXSS(): RuleFn {
    return (v, f) => {
      if (typeof v !== "string") return null;
      const dangerous = /<script|javascript:|on\w+\s*=/i;
      return dangerous.test(v) ? `${f} contient des caractères non autorisés` : null;
    };
  },

  uuid(): RuleFn {
    return (v, f) => {
      if (typeof v !== "string") return null;
      const re = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      return !re.test(v) ? `${f}: format UUID invalide` : null;
    };
  },

  fredaTag(): RuleFn {
    return (v, f) => {
      if (typeof v !== "string") return null;
      const clean = v.startsWith("@") ? v.slice(1) : v;
      if (!/^[a-zA-Z0-9_]{3,20}$/.test(clean)) {
        return `${f}: 3-20 caractères, lettres/chiffres/underscore uniquement`;
      }
      return null;
    };
  },

  phone(): RuleFn {
    return (v, f) => {
      if (typeof v !== "string") return null;
      const cleaned = v.replace(/[\s\-\(\)]/g, "");
      if (!/^\+?[0-9]{7,15}$/.test(cleaned)) {
        return `${f}: numéro de téléphone invalide`;
      }
      return null;
    };
  },

  date(): RuleFn {
    return (v, f) => {
      if (typeof v !== "string") return null;
      const d = new Date(v);
      return isNaN(d.getTime()) ? `${f}: format de date invalide` : null;
    };
  },

  boolean(): RuleFn {
    return (v, f) => typeof v !== "boolean" ? `${f} doit être un booléen` : null;
  },
};

// ── Moteur de validation ──────────────────────────────────────

function validate(data: Record<string, unknown>, schema: ValidationRule[]): ValidationError[] {
  const errors: ValidationError[] = [];

  for (const { field, rules: fieldRules, optional } of schema) {
    const value = data[field];
    const isEmpty = value === undefined || value === null || value === "";

    if (optional && isEmpty) continue;

    for (const rule of fieldRules) {
      const error = rule(value, field);
      if (error) {
        errors.push({ field, message: error });
        break; // Un seul message par champ
      }
    }
  }

  return errors;
}

// ── Middleware factory ────────────────────────────────────────

export const validateBody = (schema: ValidationRule[]) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    const errors = validate(req.body || {}, schema);
    if (errors.length > 0) {
      res.status(400).json({
        error: "Données invalides",
        fields: errors.reduce((acc, e) => {
          acc[e.field] = e.message;
          return acc;
        }, {} as Record<string, string>),
        details: errors,
      });
      return;
    }
    next();
  };
};

// ── Schémas de validation prédéfinis ─────────────────────────

export const schemas = {

  register: [
    { field: "firstname", rules: [rules.required(), rules.string(), rules.minLength(2), rules.maxLength(50), rules.noXSS()] },
    { field: "lastname",  rules: [rules.required(), rules.string(), rules.minLength(2), rules.maxLength(50), rules.noXSS()] },
    { field: "email",     rules: [rules.required(), rules.string(), rules.email()] },
    { field: "password",  rules: [rules.required(), rules.string(), rules.password(), rules.maxLength(128)] },
    { field: "phone",     rules: [rules.string(), rules.phone()], optional: true },
    { field: "dialCode",  rules: [rules.string(), rules.pattern(/^\+\d{1,4}$/, "format invalide ex: +509")], optional: true },
    { field: "country",   rules: [rules.string(), rules.minLength(2), rules.maxLength(50), rules.noXSS()], optional: true },
    { field: "city",      rules: [rules.string(), rules.maxLength(100), rules.noXSS()], optional: true },
    { field: "address",   rules: [rules.string(), rules.maxLength(200), rules.noXSS()], optional: true },
    { field: "dateOfBirth", rules: [rules.string(), rules.date()], optional: true },
    { field: "genre",     rules: [rules.string(), rules.oneOf(["Homme", "Femme", "Autre"])], optional: true },
    { field: "referralCode", rules: [rules.string(), rules.maxLength(32), rules.noXSS()], optional: true },
  ],

  login: [
    { field: "email",    rules: [rules.required(), rules.string(), rules.email()] },
    { field: "password", rules: [rules.required(), rules.string(), rules.minLength(1)] },
  ],

  changePassword: [
    { field: "currentPassword", rules: [rules.required(), rules.string()] },
    { field: "newPassword",     rules: [rules.required(), rules.string(), rules.password(), rules.maxLength(128)] },
  ],

  sendMoney: [
    { field: "amount",       rules: [rules.required(), rules.positiveNumber(), rules.min(0.5), rules.max(10000)] },
    { field: "toFredaTag",  rules: [rules.string(), rules.fredaTag()], optional: true },
    { field: "toPhone",      rules: [rules.string(), rules.phone()], optional: true },
    { field: "note",         rules: [rules.string(), rules.maxLength(200), rules.noXSS()], optional: true },
    { field: "currency",     rules: [rules.string(), rules.oneOf(["USD", "EUR", "HTG", "CAD", "GBP"])], optional: true },
  ],

  deposit: [
    { field: "amount",        rules: [rules.required(), rules.positiveNumber(), rules.min(5), rules.max(50000)] },
    { field: "paymentMethod", rules: [rules.required(), rules.string(), rules.oneOf(["card", "ach", "wire", "moncash", "natcash", "crypto"])] },
    { field: "currency",      rules: [rules.string(), rules.oneOf(["USD", "EUR", "HTG", "CAD", "GBP"])], optional: true },
  ],

  requestMoney: [
    { field: "amount",        rules: [rules.required(), rules.positiveNumber(), rules.min(0.5), rules.max(10000)] },
    { field: "fromFredaTag", rules: [rules.string(), rules.fredaTag()], optional: true },
    { field: "fromPhone",     rules: [rules.string(), rules.phone()], optional: true },
    { field: "note",          rules: [rules.string(), rules.maxLength(200), rules.noXSS()], optional: true },
  ],

  createCard: [
    { field: "firstname", rules: [rules.required(), rules.string(), rules.minLength(2), rules.maxLength(50)] },
    { field: "lastname",  rules: [rules.required(), rules.string(), rules.minLength(2), rules.maxLength(50)] },
    { field: "email",     rules: [rules.required(), rules.string(), rules.email()] },
    { field: "initialload", rules: [rules.positiveNumber(), rules.max(1000)], optional: true },
  ],

  spendControl: [
    { field: "email",       rules: [rules.required(), rules.string(), rules.email()] },
    { field: "cardid",      rules: [rules.required(), rules.string()] },
    { field: "description", rules: [rules.required(), rules.string(), rules.maxLength(200)] },
    { field: "type",        rules: [rules.required(), rules.oneOf(["purchase", "blockedMcc"])] },
    { field: "period",      rules: [rules.required(), rules.oneOf(["daily", "monthly", "yearly"])] },
    { field: "limit",       rules: [rules.required(), rules.positiveNumber(), rules.max(100000)] },
  ],

  kycStart: [
    { field: "userId", rules: [rules.required(), rules.string(), rules.minLength(3)] },
    { field: "email",  rules: [rules.required(), rules.string(), rules.email()] },
    { field: "locale", rules: [rules.string(), rules.oneOf(["fr", "en", "es", "pt", "ar", "zh"])], optional: true },
  ],

  FredaTag: [
    { field: "FredaTag", rules: [rules.required(), rules.string(), rules.fredaTag()] },
  ],

  updateProfile: [
    { field: "firstname", rules: [rules.string(), rules.minLength(2), rules.maxLength(50), rules.noXSS()], optional: true },
    { field: "lastname",  rules: [rules.string(), rules.minLength(2), rules.maxLength(50), rules.noXSS()], optional: true },
    { field: "phone",     rules: [rules.string(), rules.phone()], optional: true },
    { field: "city",      rules: [rules.string(), rules.maxLength(100), rules.noXSS()], optional: true },
    { field: "address",   rules: [rules.string(), rules.maxLength(200), rules.noXSS()], optional: true },
    { field: "country",   rules: [rules.string(), rules.maxLength(50), rules.noXSS()], optional: true },
  ],
};
