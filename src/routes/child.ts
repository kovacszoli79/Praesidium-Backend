import { Router } from 'express';
import { body, query } from 'express-validator';
import { eq, desc, and, gte, lte, asc } from 'drizzle-orm';
import { db, users, locations, statusUpdates, dailyStats } from '../db';
import { validate } from '../middleware/validate';
import { AppError } from '../middleware/errorHandler';
import { parentOnly } from '../middleware/auth';
import { generateId } from '../utils/codes';

const router = Router();

// Get all children (for parent)
router.get('/', parentOnly, async (req, res, next) => {
  try {
    const children = await db.query.users.findMany({
      where: eq(users.parentId, req.user!.id),
    });

    const result = await Promise.all(children.map(async (child) => {
      const lastLocation = await db.query.locations.findFirst({
        where: eq(locations.userId, child.id),
        orderBy: desc(locations.timestamp),
      });

      const lastStatus = await db.query.statusUpdates.findFirst({
        where: eq(statusUpdates.userId, child.id),
        orderBy: desc(statusUpdates.timestamp),
      });

      return {
        id: child.id,
        name: child.displayName,
        avatar: child.avatar,
        lastSeen: child.lastSeen,
        location: lastLocation ? {
          latitude: lastLocation.latitude,
          longitude: lastLocation.longitude,
          accuracy: lastLocation.accuracy,
          timestamp: lastLocation.timestamp,
        } : null,
        batteryLevel: lastLocation?.batteryLevel ?? null,
        status: lastStatus?.status || 'none',
      };
    }));

    res.json(result);
  } catch (error) {
    next(error);
  }
});

// Get single child details
router.get('/:childId', parentOnly, async (req, res, next) => {
  try {
    const { childId } = req.params;

    const child = await db.query.users.findFirst({
      where: and(
        eq(users.id, childId),
        eq(users.parentId, req.user!.id)
      ),
    });

    if (!child) {
      throw new AppError('Child not found', 404);
    }

    const lastLocation = await db.query.locations.findFirst({
      where: eq(locations.userId, child.id),
      orderBy: desc(locations.timestamp),
    });

    const lastStatus = await db.query.statusUpdates.findFirst({
      where: eq(statusUpdates.userId, child.id),
      orderBy: desc(statusUpdates.timestamp),
    });

    res.json({
      id: child.id,
      name: child.displayName,
      avatar: child.avatar,
      lastSeen: child.lastSeen,
      createdAt: child.createdAt,
      location: lastLocation ? {
        latitude: lastLocation.latitude,
        longitude: lastLocation.longitude,
        accuracy: lastLocation.accuracy,
        timestamp: lastLocation.timestamp,
      } : null,
      batteryLevel: lastLocation?.batteryLevel ?? null,
      isCharging: lastLocation?.isCharging ?? false,
      status: lastStatus?.status || 'none',
    });
  } catch (error) {
    next(error);
  }
});

// Get child's location track for a specific day
router.get(
  '/:childId/tracks',
  parentOnly,
  validate([
    query('date').optional().isISO8601(),
  ]),
  async (req, res, next) => {
    try {
      const { childId } = req.params;
      const { date } = req.query;

      // Verify parent-child relationship
      const child = await db.query.users.findFirst({
        where: and(
          eq(users.id, childId),
          eq(users.parentId, req.user!.id)
        ),
      });

      if (!child) {
        throw new AppError('Child not found', 404);
      }

      // Build date filter
      const targetDate = date ? new Date(date as string) : new Date();
      const startOfDay = new Date(targetDate);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(targetDate);
      endOfDay.setHours(23, 59, 59, 999);

      const locationResults = await db.query.locations.findMany({
        where: and(
          eq(locations.userId, childId),
          gte(locations.timestamp, startOfDay),
          lte(locations.timestamp, endOfDay)
        ),
        orderBy: asc(locations.timestamp),
      });

      res.json({
        date: targetDate.toISOString().split('T')[0],
        points: locationResults.map(loc => ({
          latitude: loc.latitude,
          longitude: loc.longitude,
          timestamp: loc.timestamp.getTime(),
        })),
      });
    } catch (error) {
      next(error);
    }
  }
);

// Get/update child's daily stats
router.get(
  '/:childId/stats',
  parentOnly,
  validate([
    query('date').optional().isISO8601(),
  ]),
  async (req, res, next) => {
    try {
      const { childId } = req.params;
      const { date } = req.query;

      // Verify parent-child relationship
      const child = await db.query.users.findFirst({
        where: and(
          eq(users.id, childId),
          eq(users.parentId, req.user!.id)
        ),
      });

      if (!child) {
        throw new AppError('Child not found', 404);
      }

      const targetDate = date
        ? (date as string)
        : new Date().toISOString().split('T')[0];

      const stats = await db.query.dailyStats.findFirst({
        where: and(
          eq(dailyStats.userId, childId),
          eq(dailyStats.date, targetDate)
        ),
      });

      if (!stats) {
        res.json({
          date: targetDate,
          screenTimeMinutes: 0,
          appUsage: [],
          visitedUrls: [],
        });
        return;
      }

      res.json({
        date: stats.date,
        screenTimeMinutes: stats.screenTimeMinutes,
        appUsage: stats.appUsage,
        visitedUrls: stats.visitedUrls,
      });
    } catch (error) {
      next(error);
    }
  }
);

// Update daily stats (called by child device)
router.post(
  '/stats',
  validate([
    body('date').isISO8601(),
    body('screenTimeMinutes').isInt({ min: 0 }),
    body('appUsage').optional().isArray(),
    body('visitedUrls').optional().isArray(),
  ]),
  async (req, res, next) => {
    try {
      const { date, screenTimeMinutes, appUsage, visitedUrls } = req.body;

      // Only children can update their own stats
      if (req.user!.role !== 'child') {
        throw new AppError('Only children can update stats', 403);
      }

      const dateStr = new Date(date).toISOString().split('T')[0];
      const now = new Date();

      // Check if stats exist for this date
      const existingStats = await db.query.dailyStats.findFirst({
        where: and(
          eq(dailyStats.userId, req.user!.id),
          eq(dailyStats.date, dateStr)
        ),
      });

      if (existingStats) {
        // Update existing
        await db.update(dailyStats)
          .set({
            screenTimeMinutes,
            appUsage: appUsage || [],
            visitedUrls: visitedUrls || [],
            updatedAt: now,
          })
          .where(eq(dailyStats.id, existingStats.id));

        const updated = await db.query.dailyStats.findFirst({
          where: eq(dailyStats.id, existingStats.id),
        });
        res.json(updated);
      } else {
        // Create new
        const statsId = generateId();
        await db.insert(dailyStats).values({
          id: statsId,
          userId: req.user!.id,
          date: dateStr,
          screenTimeMinutes,
          appUsage: appUsage || [],
          visitedUrls: visitedUrls || [],
          createdAt: now,
          updatedAt: now,
        });

        const created = await db.query.dailyStats.findFirst({
          where: eq(dailyStats.id, statsId),
        });
        res.json(created);
      }
    } catch (error) {
      next(error);
    }
  }
);

// Update child's avatar (parent only)
router.patch(
  '/:childId/avatar',
  parentOnly,
  validate([
    body('avatar').isString().isLength({ min: 1, max: 200 }),
  ]),
  async (req, res, next) => {
    try {
      const { childId } = req.params;
      const { avatar } = req.body;

      // Verify parent-child relationship
      const child = await db.query.users.findFirst({
        where: and(
          eq(users.id, childId),
          eq(users.parentId, req.user!.id)
        ),
      });

      if (!child) {
        throw new AppError('Child not found', 404);
      }

      await db.update(users)
        .set({ avatar, updatedAt: new Date() })
        .where(eq(users.id, childId));

      res.json({ message: 'Avatar updated' });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
