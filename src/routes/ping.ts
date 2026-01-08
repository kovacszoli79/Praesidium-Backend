import { Router, Request, Response } from 'express';
import { body, param, query } from 'express-validator';
import { db, pingRequests, users } from '../db';
import { parentOnly } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { generateId } from '../utils/codes';
import { eq, and, desc } from 'drizzle-orm';

const router = Router();

// Send ping to child (parent only)
router.post(
  '/',
  parentOnly,
  validate([
    body('childId').notEmpty().withMessage('Child ID is required'),
    body('type').isIn(['sound', 'vibrate', 'both']).withMessage('Type must be sound, vibrate, or both'),
    body('soundType').optional().isIn(['alarm', 'ring', 'beep']),
    body('duration').optional().isInt({ min: 5, max: 120 }),
    body('volume').optional().isInt({ min: 0, max: 100 }),
    body('message').optional().isString().isLength({ max: 500 }),
  ]),
  async (req: Request, res: Response) => {
    try {
      const user = req.user!;

      // Verify child belongs to parent
      const child = await db.query.users.findFirst({
        where: and(eq(users.id, req.body.childId), eq(users.parentId, user.id)),
      });

      if (!child) {
        return res.status(403).json({ error: 'Child not found or not your child' });
      }

      const pingId = generateId();
      const ping = {
        id: pingId,
        parentId: user.id,
        childId: req.body.childId,
        type: req.body.type as 'sound' | 'vibrate' | 'both',
        soundType: req.body.soundType || null,
        duration: req.body.duration || 30,
        volume: req.body.volume || 100,
        message: req.body.message || null,
        status: 'pending' as const,
      };

      await db.insert(pingRequests).values(ping);

      res.status(201).json({
        message: 'Ping sent successfully',
        ping: {
          ...ping,
          childName: child.displayName,
        },
      });
    } catch (error) {
      console.error('Send ping error:', error);
      res.status(500).json({ error: 'Failed to send ping' });
    }
  }
);

// Get pending pings (child device polls this)
router.get('/pending', async (req: Request, res: Response) => {
  try {
    const user = req.user!;

    const pendingPings = await db.query.pingRequests.findMany({
      where: and(
        eq(pingRequests.childId, user.id),
        eq(pingRequests.status, 'pending')
      ),
      orderBy: [desc(pingRequests.createdAt)],
    });

    // Get parent names and mark as delivered
    const pingsWithParentNames = await Promise.all(
      pendingPings.map(async (ping) => {
        const parent = await db.query.users.findFirst({
          where: eq(users.id, ping.parentId),
        });

        await db
          .update(pingRequests)
          .set({ status: 'delivered', deliveredAt: new Date() })
          .where(eq(pingRequests.id, ping.id));

        return {
          id: ping.id,
          type: ping.type,
          soundType: ping.soundType,
          duration: ping.duration,
          volume: ping.volume,
          message: ping.message,
          parentName: parent?.displayName || 'Parent',
          createdAt: ping.createdAt,
        };
      })
    );

    res.json({ pings: pingsWithParentNames });
  } catch (error) {
    console.error('Get pending pings error:', error);
    res.status(500).json({ error: 'Failed to get pending pings' });
  }
});

// Acknowledge ping
router.patch(
  '/:id/acknowledge',
  validate([param('id').notEmpty()]),
  async (req: Request, res: Response) => {
    try {
      const user = req.user!;

      const ping = await db.query.pingRequests.findFirst({
        where: eq(pingRequests.id, req.params.id),
      });

      if (!ping) {
        return res.status(404).json({ error: 'Ping not found' });
      }

      if (ping.childId !== user.id) {
        return res.status(403).json({ error: 'Access denied' });
      }

      await db
        .update(pingRequests)
        .set({ status: 'acknowledged', acknowledgedAt: new Date() })
        .where(eq(pingRequests.id, req.params.id));

      res.json({ message: 'Ping acknowledged' });
    } catch (error) {
      console.error('Acknowledge ping error:', error);
      res.status(500).json({ error: 'Failed to acknowledge ping' });
    }
  }
);

// Get ping history
router.get(
  '/history',
  validate([query('limit').optional().isInt({ min: 1, max: 100 })]),
  async (req: Request, res: Response) => {
    try {
      const user = req.user!;
      const limit = parseInt(req.query.limit as string) || 50;

      let pings;
      if (user.role === 'parent') {
        pings = await db.query.pingRequests.findMany({
          where: eq(pingRequests.parentId, user.id),
          orderBy: [desc(pingRequests.createdAt)],
          limit,
        });
      } else {
        pings = await db.query.pingRequests.findMany({
          where: eq(pingRequests.childId, user.id),
          orderBy: [desc(pingRequests.createdAt)],
          limit,
        });
      }

      const pingsWithNames = await Promise.all(
        pings.map(async (ping) => {
          const parent = await db.query.users.findFirst({
            where: eq(users.id, ping.parentId),
          });
          const child = await db.query.users.findFirst({
            where: eq(users.id, ping.childId),
          });
          return {
            ...ping,
            parentName: parent?.displayName || 'Unknown',
            childName: child?.displayName || 'Unknown',
          };
        })
      );

      res.json({ pings: pingsWithNames });
    } catch (error) {
      console.error('Get ping history error:', error);
      res.status(500).json({ error: 'Failed to get ping history' });
    }
  }
);

export default router;
