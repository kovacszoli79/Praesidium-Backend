import { Router, Request, Response } from 'express';
import { body, param, query } from 'express-validator';
import { db, chatMessages, users } from '../db';
import { validate } from '../middleware/validate';
import { generateId } from '../utils/codes';
import { eq, desc, and, lt } from 'drizzle-orm';

const router = Router();

router.get(
  '/messages',
  validate([
    query('limit').optional().isInt({ min: 1, max: 100 }),
    query('before').optional().isString(),
  ]),
  async (req: Request, res: Response) => {
    try {
      const user = req.user!;
      const limit = parseInt(req.query.limit as string) || 50;
      const before = req.query.before as string;
      if (!user.familyId) return res.json({ messages: [] });

      let messages;
      if (before) {
        messages = await db.query.chatMessages.findMany({
          where: and(eq(chatMessages.familyId, user.familyId), lt(chatMessages.id, before)),
          orderBy: [desc(chatMessages.createdAt)],
          limit,
        });
      } else {
        messages = await db.query.chatMessages.findMany({
          where: eq(chatMessages.familyId, user.familyId),
          orderBy: [desc(chatMessages.createdAt)],
          limit,
        });
      }

      const messagesWithSenders = await Promise.all(
        messages.map(async (msg) => {
          const sender = await db.query.users.findFirst({ where: eq(users.id, msg.senderId) });
          return {
            ...msg,
            senderName: sender?.displayName || 'Unknown',
            senderAvatar: sender?.avatar || null,
            senderRole: sender?.role || 'unknown',
            isRead: (msg.readBy || []).includes(user.id),
          };
        })
      );
      res.json({ messages: messagesWithSenders.reverse(), hasMore: messages.length === limit });
    } catch (error) {
      console.error('Get messages error:', error);
      res.status(500).json({ error: 'Failed to get messages' });
    }
  }
);

router.post(
  '/messages',
  validate([
    body('content').notEmpty(),
    body('messageType').optional().isIn(['text', 'location', 'image', 'voice']),
    body('metadata').optional().isObject(),
  ]),
  async (req: Request, res: Response) => {
    try {
      const user = req.user!;
      if (!user.familyId) return res.status(400).json({ error: 'You must be in a family' });

      const message = {
        id: generateId(),
        familyId: user.familyId,
        senderId: user.id,
        messageType: (req.body.messageType || 'text') as 'text' | 'location' | 'image' | 'voice',
        content: req.body.content,
        metadata: req.body.metadata || null,
        readBy: [user.id],
      };
      await db.insert(chatMessages).values(message);
      res.status(201).json({
        message: { ...message, senderName: user.displayName, senderAvatar: user.avatar, senderRole: user.role, isRead: true },
      });
    } catch (error) {
      console.error('Send message error:', error);
      res.status(500).json({ error: 'Failed to send message' });
    }
  }
);

router.delete('/messages/:id', validate([param('id').notEmpty()]), async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const message = await db.query.chatMessages.findFirst({ where: eq(chatMessages.id, req.params.id) });
    if (!message) return res.status(404).json({ error: 'Message not found' });
    if (message.senderId !== user.id) return res.status(403).json({ error: 'You can only delete your own messages' });
    await db.delete(chatMessages).where(eq(chatMessages.id, req.params.id));
    res.json({ message: 'Message deleted' });
  } catch (error) {
    console.error('Delete message error:', error);
    res.status(500).json({ error: 'Failed to delete message' });
  }
});

router.post('/messages/:id/read', validate([param('id').notEmpty()]), async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const message = await db.query.chatMessages.findFirst({ where: eq(chatMessages.id, req.params.id) });
    if (!message) return res.status(404).json({ error: 'Message not found' });
    if (message.familyId !== user.familyId) return res.status(403).json({ error: 'Access denied' });
    const readBy = message.readBy || [];
    if (!readBy.includes(user.id)) {
      readBy.push(user.id);
      await db.update(chatMessages).set({ readBy }).where(eq(chatMessages.id, req.params.id));
    }
    res.json({ message: 'Message marked as read' });
  } catch (error) {
    console.error('Mark read error:', error);
    res.status(500).json({ error: 'Failed to mark message as read' });
  }
});

router.get('/unread-count', async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    if (!user.familyId) return res.json({ count: 0 });
    const messages = await db.query.chatMessages.findMany({ where: eq(chatMessages.familyId, user.familyId) });
    const unreadCount = messages.filter((msg) => !(msg.readBy || []).includes(user.id)).length;
    res.json({ count: unreadCount });
  } catch (error) {
    console.error('Get unread count error:', error);
    res.status(500).json({ error: 'Failed to get unread count' });
  }
});

export default router;
