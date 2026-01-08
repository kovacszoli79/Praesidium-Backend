import { Router, Request, Response } from 'express';
import { body, param, query } from 'express-validator';
import { db, locationRequests, users } from '../db';
import { parentOnly } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { generateId } from '../utils/codes';
import { eq, and, desc } from 'drizzle-orm';

const router = Router();

const EXPIRY_MINUTES = 5;

// Send location request to child (parent only)
router.post(
  '/',
  parentOnly,
  validate([
    body('childId').notEmpty().withMessage('Child ID is required'),
    body('message').optional().isString().isLength({ max: 500 }),
  ]),
  async (req: Request, res: Response) => {
    try {
      const user = req.user!;

      const child = await db.query.users.findFirst({
        where: and(eq(users.id, req.body.childId), eq(users.parentId, user.id)),
      });

      if (!child) {
        return res.status(403).json({ error: 'Child not found or not your child' });
      }

      const requestId = generateId();
      const expiresAt = new Date(Date.now() + EXPIRY_MINUTES * 60 * 1000);

      const request = {
        id: requestId,
        parentId: user.id,
        childId: req.body.childId,
        message: req.body.message || null,
        status: 'pending' as const,
        expiresAt,
      };

      await db.insert(locationRequests).values(request);

      res.status(201).json({
        message: 'Location request sent',
        request: {
          ...request,
          childName: child.displayName,
        },
      });
    } catch (error) {
      console.error('Send location request error:', error);
      res.status(500).json({ error: 'Failed to send location request' });
    }
  }
);

// Get pending location requests (child device polls this)
router.get('/pending', async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const now = new Date();

    const pending = await db.query.locationRequests.findMany({
      where: and(
        eq(locationRequests.childId, user.id),
        eq(locationRequests.status, 'pending')
      ),
      orderBy: [desc(locationRequests.createdAt)],
    });

    // Filter non-expired and expire old ones
    const validPending = pending.filter(r => r.expiresAt > now);

    const requestsWithNames = await Promise.all(
      validPending.map(async (request) => {
        const parent = await db.query.users.findFirst({
          where: eq(users.id, request.parentId),
        });
        return {
          id: request.id,
          message: request.message,
          parentName: parent?.displayName || 'Parent',
          createdAt: request.createdAt,
          expiresAt: request.expiresAt,
        };
      })
    );

    res.json({ requests: requestsWithNames });
  } catch (error) {
    console.error('Get pending location requests error:', error);
    res.status(500).json({ error: 'Failed to get pending requests' });
  }
});

// Respond to location request
router.post(
  '/:id/respond',
  validate([
    param('id').notEmpty(),
    body('latitude').isFloat({ min: -90, max: 90 }).withMessage('Valid latitude required'),
    body('longitude').isFloat({ min: -180, max: 180 }).withMessage('Valid longitude required'),
    body('accuracy').optional().isFloat({ min: 0 }),
    body('address').optional().isString(),
  ]),
  async (req: Request, res: Response) => {
    try {
      const user = req.user!;

      const request = await db.query.locationRequests.findFirst({
        where: eq(locationRequests.id, req.params.id),
      });

      if (!request) {
        return res.status(404).json({ error: 'Request not found' });
      }

      if (request.childId !== user.id) {
        return res.status(403).json({ error: 'Access denied' });
      }

      if (request.status !== 'pending') {
        return res.status(400).json({ error: 'Request already responded or expired' });
      }

      const now = new Date();
      if (request.expiresAt < now) {
        await db
          .update(locationRequests)
          .set({ status: 'expired' })
          .where(eq(locationRequests.id, req.params.id));
        return res.status(400).json({ error: 'Request has expired' });
      }

      const responseLocation = {
        latitude: req.body.latitude,
        longitude: req.body.longitude,
        accuracy: req.body.accuracy || null,
        address: req.body.address || null,
      };

      await db
        .update(locationRequests)
        .set({
          status: 'responded',
          responseLocation,
          respondedAt: now,
        })
        .where(eq(locationRequests.id, req.params.id));

      res.json({ message: 'Location shared successfully' });
    } catch (error) {
      console.error('Respond to location request error:', error);
      res.status(500).json({ error: 'Failed to respond to request' });
    }
  }
);

// Get location request history
router.get(
  '/history',
  validate([query('limit').optional().isInt({ min: 1, max: 100 })]),
  async (req: Request, res: Response) => {
    try {
      const user = req.user!;
      const limit = parseInt(req.query.limit as string) || 50;

      let requests;
      if (user.role === 'parent') {
        requests = await db.query.locationRequests.findMany({
          where: eq(locationRequests.parentId, user.id),
          orderBy: [desc(locationRequests.createdAt)],
          limit,
        });
      } else {
        requests = await db.query.locationRequests.findMany({
          where: eq(locationRequests.childId, user.id),
          orderBy: [desc(locationRequests.createdAt)],
          limit,
        });
      }

      const requestsWithNames = await Promise.all(
        requests.map(async (request) => {
          const parent = await db.query.users.findFirst({
            where: eq(users.id, request.parentId),
          });
          const child = await db.query.users.findFirst({
            where: eq(users.id, request.childId),
          });
          return {
            ...request,
            parentName: parent?.displayName || 'Unknown',
            childName: child?.displayName || 'Unknown',
          };
        })
      );

      res.json({ requests: requestsWithNames });
    } catch (error) {
      console.error('Get location request history error:', error);
      res.status(500).json({ error: 'Failed to get request history' });
    }
  }
);

export default router;
