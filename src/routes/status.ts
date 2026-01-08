import { Router } from 'express';
import { body, query } from 'express-validator';
import { eq, desc } from 'drizzle-orm';
import { db, users, statusUpdates } from '../db';
import { validate } from '../middleware/validate';
import { AppError } from '../middleware/errorHandler';
import { generateId } from '../utils/codes';

const router = Router();

// Update status
router.post(
  '/',
  validate([
    body('status').isIn(['arrived', 'departed', 'safe', 'none']),
    body('latitude').optional().isFloat({ min: -90, max: 90 }),
    body('longitude').optional().isFloat({ min: -180, max: 180 }),
  ]),
  async (req, res, next) => {
    try {
      const { status, latitude, longitude } = req.body;

      const statusId = generateId();
      const now = new Date();

      await db.insert(statusUpdates).values({
        id: statusId,
        userId: req.user!.id,
        status,
        latitude,
        longitude,
        timestamp: now,
      });

      // Update user's lastSeen
      await db.update(users)
        .set({ lastSeen: now })
        .where(eq(users.id, req.user!.id));

      const statusUpdate = await db.query.statusUpdates.findFirst({
        where: eq(statusUpdates.id, statusId),
      });

      res.status(201).json(statusUpdate);
    } catch (error) {
      next(error);
    }
  }
);

// Get current user's latest status
router.get('/current', async (req, res, next) => {
  try {
    const status = await db.query.statusUpdates.findFirst({
      where: eq(statusUpdates.userId, req.user!.id),
      orderBy: desc(statusUpdates.timestamp),
    });

    res.json(status || { status: 'none' });
  } catch (error) {
    next(error);
  }
});

// Get status history
router.get(
  '/history',
  validate([
    query('limit').optional().isInt({ min: 1, max: 100 }),
    query('userId').optional().isString(),
  ]),
  async (req, res, next) => {
    try {
      const { limit, userId } = req.query;
      const requestingUserId = req.user!.id;

      let targetUserId = requestingUserId;

      // If userId is specified, check permissions
      if (userId && userId !== requestingUserId) {
        const targetUser = await db.query.users.findFirst({
          where: eq(users.id, userId as string),
        });

        const requestingUser = await db.query.users.findFirst({
          where: eq(users.id, requestingUserId),
        });

        const isParentOfChild = targetUser?.parentId === requestingUserId;
        const isSameFamily = targetUser?.familyId && targetUser.familyId === requestingUser?.familyId;

        if (!isParentOfChild && !isSameFamily) {
          throw new AppError('Not authorized', 403);
        }

        targetUserId = userId as string;
      }

      const statuses = await db.query.statusUpdates.findMany({
        where: eq(statusUpdates.userId, targetUserId),
        orderBy: desc(statusUpdates.timestamp),
        limit: limit ? parseInt(limit as string) : 20,
      });

      res.json(statuses);
    } catch (error) {
      next(error);
    }
  }
);

// Get family members' latest statuses
router.get('/family', async (req, res, next) => {
  try {
    const user = await db.query.users.findFirst({
      where: eq(users.id, req.user!.id),
    });

    if (!user?.familyId) {
      throw new AppError('You are not in a family', 404);
    }

    const familyMembers = await db.query.users.findMany({
      where: eq(users.familyId, user.familyId),
    });

    const result = await Promise.all(familyMembers.map(async (member) => {
      const latestStatus = await db.query.statusUpdates.findFirst({
        where: eq(statusUpdates.userId, member.id),
        orderBy: desc(statusUpdates.timestamp),
      });

      return {
        id: member.id,
        displayName: member.displayName,
        avatar: member.avatar,
        lastSeen: member.lastSeen,
        latestStatus: latestStatus || null,
      };
    }));

    res.json(result);
  } catch (error) {
    next(error);
  }
});

export default router;
