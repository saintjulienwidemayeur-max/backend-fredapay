// ============================================================
// Routes Notifications — Freda Pay
// Base: /api/notifications
// ============================================================

import { Router, Request, Response } from "express";
import { requireAuth, requireAdmin } from "../middleware/auth";
import { NotificationService } from "../services/notification.service";
import { db } from "../db/store";
import { logger } from "../utils/logger";

const router = Router();
router.use(requireAuth);

// ── GET /api/notifications ────────────────────────────────────
router.get("/", async (req: Request, res: Response) => {
  const userId = req.userId!;
  const limit  = Math.min(parseInt(String(req.query.limit || "20")), 100);
  const unreadOnly = req.query.unread === "true";

  let notifs = await db.notifications.findByUserId(userId, limit);
  if (unreadOnly) notifs = notifs.filter(n => !n.isRead);

  res.json({
    success:     true,
    unreadCount: await db.notifications.countUnread(userId),
    count:       notifs.length,
    data:        notifs,
  });
});

// ── PATCH /api/notifications/:id/read ────────────────────────
router.patch("/:id/read", async (req: Request, res: Response) => {
  const ok = await db.notifications.markRead(req.params.id, req.userId!);
  if (!ok) {
    res.status(404).json({ error: "Notification introuvable" });
    return;
  }
  res.json({ success: true, unreadCount: await db.notifications.countUnread(req.userId!) });
});

// ── PATCH /api/notifications/read-all ────────────────────────
router.patch("/read-all", async (req: Request, res: Response) => {
  const count = await db.notifications.markAllRead(req.userId!);
  res.json({ success: true, marked: count, unreadCount: 0 });
});

// ── DELETE /api/notifications/:id ────────────────────────────
router.delete("/:id", async (req: Request, res: Response) => {
  const ok = await db.notifications.delete(req.params.id, req.userId!);
  if (!ok) {
    res.status(404).json({ error: "Notification introuvable" });
    return;
  }
  res.json({ success: true, unreadCount: await db.notifications.countUnread(req.userId!) });
});

// ── GET /api/notifications/unread-count ──────────────────────
router.get("/unread-count", async (req: Request, res: Response) => {
  res.json({ success: true, count: await db.notifications.countUnread(req.userId!) });
});

// ── POST /api/notifications/test ─────────────────────────────
// Route de test — envoyer une notification à soi-même
router.post("/test", async (req: Request, res: Response) => {
  const { type = "system", title = "Test", message = "Notification de test Freda Pay" } = req.body;
  const notif = await NotificationService.send(req.userId!, "system", { title, message });
  res.json({ success: true, data: notif });
});

// ── ADMIN: POST /api/notifications/broadcast ─────────────────
router.post("/broadcast", requireAdmin, async (req: Request, res: Response) => {
  const { title, message } = req.body;
  if (!title || !message) {
    res.status(400).json({ error: "title et message requis" });
    return;
  }
  await NotificationService.broadcast(title, message);
  logger.info("Broadcast envoyé", { admin: req.userId, title });
  res.json({ success: true, message: "Broadcast envoyé à tous les utilisateurs" });
});

export default router;
