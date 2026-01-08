import { Router, Request, Response } from 'express';
import { body, param, query } from 'express-validator';
import { db, crashEvents, users } from '../db';
import { validate } from '../middleware/validate';
import { generateId } from '../utils/codes';
import { eq, desc } from 'drizzle-orm';

const router = Router();

router.post('/detect', validate([
  body('latitude').isFloat({ min: -90, max: 90 }),
  body('longitude').isFloat({ min: -180, max: 180 }),
  body('speed').optional().isFloat({ min: 0 }),
  body('impactForce').isFloat({ min: 0 }),
]), async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const eventId = generateId();
    const event = {
      id: eventId,
      userId: user.id,
      latitude: req.body.latitude,
      longitude: req.body.longitude,
      speed: req.body.speed || null,
      impactForce: req.body.impactForce,
      eventType: 'potential_crash' as const,
      status: 'detected' as const,
      emergencyContacts: null,
    };

    await db.insert(crashEvents).values(event);

    res.status(201).json({
      message: 'Crash event recorded',
      event: { id: eventId, status: 'detected', message: 'Please respond to confirm you are okay' },
    });
  } catch (error) {
    console.error('Detect crash error:', error);
    res.status(500).json({ error: 'Failed to record crash event' });
  }
});

router.post('/:id/respond', validate([
  param('id').notEmpty(),
  body('response').isIn(['ok', 'help']),
]), async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const event = await db.query.crashEvents.findFirst({ where: eq(crashEvents.id, req.params.id) });

    if (!event) return res.status(404).json({ error: 'Crash event not found' });
    if (event.userId !== user.id) return res.status(403).json({ error: 'Access denied' });
    if (event.status !== 'detected') return res.status(400).json({ error: 'Event already responded' });

    const newStatus = req.body.response === 'ok' ? 'user_ok' : 'emergency_sent';
    const newEventType = req.body.response === 'ok' ? 'false_alarm' : 'confirmed_crash';

    await db.update(crashEvents).set({
      status: newStatus as 'user_ok' | 'emergency_sent',
      eventType: newEventType as 'false_alarm' | 'confirmed_crash',
      respondedAt: new Date(),
    }).where(eq(crashEvents.id, req.params.id));

    res.json({ message: req.body.response === 'ok' ? 'Glad you are okay!' : 'Emergency contacts notified' });
  } catch (error) {
    console.error('Respond to crash error:', error);
    res.status(500).json({ error: 'Failed to respond to crash event' });
  }
});

router.get('/history', validate([query('limit').optional().isInt({ min: 1, max: 100 })]), async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const limit = parseInt(req.query.limit as string) || 50;

    let events;
    if (user.role === 'parent') {
      const children = await db.query.users.findMany({ where: eq(users.parentId, user.id) });
      const childIds = children.map((c) => c.id);

      if (childIds.length === 0) return res.json({ events: [] });

      events = [];
      for (const childId of childIds) {
        const childEvents = await db.query.crashEvents.findMany({
          where: eq(crashEvents.userId, childId),
          orderBy: [desc(crashEvents.createdAt)],
          limit: Math.ceil(limit / childIds.length),
        });
        events.push(...childEvents);
      }
      events.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      events = events.slice(0, limit);
    } else {
      events = await db.query.crashEvents.findMany({
        where: eq(crashEvents.userId, user.id),
        orderBy: [desc(crashEvents.createdAt)],
        limit,
      });
    }

    const eventsWithNames = await Promise.all(
      events.map(async (event) => {
        const eventUser = await db.query.users.findFirst({ where: eq(users.id, event.userId) });
        return { ...event, userName: eventUser?.displayName || 'Unknown' };
      })
    );

    res.json({ events: eventsWithNames });
  } catch (error) {
    console.error('Get crash history error:', error);
    res.status(500).json({ error: 'Failed to get crash history' });
  }
});

export default router;
