import { Router } from 'express';
import { body, query } from 'express-validator';
import { eq, desc, and, gte, lte, asc } from 'drizzle-orm';
import { db, users, locations } from '../db';
import { validate } from '../middleware/validate';
import { AppError } from '../middleware/errorHandler';
import { generateId } from '../utils/codes';

const router = Router();

// Update current location
router.post(
  '/',
  validate([
    body('latitude').isFloat({ min: -90, max: 90 }),
    body('longitude').isFloat({ min: -180, max: 180 }),
    body('accuracy').optional().isFloat({ min: 0 }),
    body('altitude').optional().isFloat(),
    body('speed').optional().isFloat({ min: 0 }),
    body('heading').optional().isFloat({ min: 0, max: 360 }),
    body('batteryLevel').optional().isInt({ min: 0, max: 100 }),
    body('isCharging').optional().isBoolean(),
    body('dwellTime').optional().isInt({ min: 0 }),
  ]),
  async (req, res, next) => {
    try {
      const {
        latitude,
        longitude,
        accuracy,
        altitude,
        speed,
        heading,
        batteryLevel,
        isCharging,
        dwellTime,
      } = req.body;

      const locationId = generateId();
      const now = new Date();

      await db.insert(locations).values({
        id: locationId,
        userId: req.user!.id,
        latitude,
        longitude,
        accuracy,
        altitude,
        speed,
        heading,
        batteryLevel,
        isCharging: isCharging || false,
        dwellTime,
        timestamp: now,
      });

      // Update user's lastSeen
      await db.update(users)
        .set({ lastSeen: now })
        .where(eq(users.id, req.user!.id));

      const location = await db.query.locations.findFirst({
        where: eq(locations.id, locationId),
      });

      res.status(201).json(location);
    } catch (error) {
      next(error);
    }
  }
);

// Get current user's latest location
router.get('/current', async (req, res, next) => {
  try {
    const location = await db.query.locations.findFirst({
      where: eq(locations.userId, req.user!.id),
      orderBy: desc(locations.timestamp),
    });

    if (!location) {
      throw new AppError('No location data', 404);
    }

    res.json(location);
  } catch (error) {
    next(error);
  }
});

// Get location history (tracks)
router.get(
  '/history',
  validate([
    query('date').optional().isISO8601(),
    query('userId').optional().isString(),
    query('limit').optional().isInt({ min: 1, max: 1000 }),
  ]),
  async (req, res, next) => {
    try {
      const { date, userId, limit } = req.query;
      const requestingUserId = req.user!.id;

      // If userId is specified, check permissions
      let targetUserId = requestingUserId;
      if (userId && userId !== requestingUserId) {
        const targetUser = await db.query.users.findFirst({
          where: eq(users.id, userId as string),
        });

        const requestingUser = await db.query.users.findFirst({
          where: eq(users.id, requestingUserId),
        });

        // Allow if parent of child OR same family
        const isParentOfChild = targetUser?.parentId === requestingUserId;
        const isSameFamily = targetUser?.familyId && targetUser.familyId === requestingUser?.familyId;

        if (!isParentOfChild && !isSameFamily) {
          throw new AppError('Not authorized to view this location history', 403);
        }

        targetUserId = userId as string;
      }

      // Build date filter
      let locationResults;
      if (date) {
        const startOfDay = new Date(date as string);
        startOfDay.setHours(0, 0, 0, 0);
        const endOfDay = new Date(date as string);
        endOfDay.setHours(23, 59, 59, 999);

        locationResults = await db.query.locations.findMany({
          where: and(
            eq(locations.userId, targetUserId),
            gte(locations.timestamp, startOfDay),
            lte(locations.timestamp, endOfDay)
          ),
          orderBy: asc(locations.timestamp),
          limit: limit ? parseInt(limit as string) : 500,
        });
      } else {
        locationResults = await db.query.locations.findMany({
          where: eq(locations.userId, targetUserId),
          orderBy: asc(locations.timestamp),
          limit: limit ? parseInt(limit as string) : 500,
        });
      }

      // Format as track points
      const trackPoints = locationResults.map(loc => ({
        latitude: loc.latitude,
        longitude: loc.longitude,
        timestamp: loc.timestamp.getTime(),
        accuracy: loc.accuracy,
        batteryLevel: loc.batteryLevel,
      }));

      res.json({
        userId: targetUserId,
        date: date || new Date().toISOString().split('T')[0],
        points: trackPoints,
      });
    } catch (error) {
      next(error);
    }
  }
);

// Get specific user's latest location (for family members)
router.get('/user/:userId', async (req, res, next) => {
  try {
    const { userId } = req.params;
    const requestingUserId = req.user!.id;

    // Check if same family
    const targetUser = await db.query.users.findFirst({
      where: eq(users.id, userId),
    });

    const requestingUser = await db.query.users.findFirst({
      where: eq(users.id, requestingUserId),
    });

    if (!targetUser) {
      throw new AppError('User not found', 404);
    }

    if (!targetUser.familyId || targetUser.familyId !== requestingUser?.familyId) {
      throw new AppError('Not authorized', 403);
    }

    const location = await db.query.locations.findFirst({
      where: eq(locations.userId, userId),
      orderBy: desc(locations.timestamp),
    });

    res.json({
      user: {
        id: userId,
        displayName: targetUser.displayName,
        avatar: targetUser.avatar,
        lastSeen: targetUser.lastSeen,
      },
      location: location || null,
    });
  } catch (error) {
    next(error);
  }
});

// Batch update locations (for offline sync)
router.post(
  '/batch',
  validate([
    body('locations').isArray({ min: 1, max: 100 }),
    body('locations.*.latitude').isFloat({ min: -90, max: 90 }),
    body('locations.*.longitude').isFloat({ min: -180, max: 180 }),
    body('locations.*.timestamp').isInt(),
  ]),
  async (req, res, next) => {
    try {
      const { locations: locationsData } = req.body;

      const values = locationsData.map((loc: any) => ({
        id: generateId(),
        userId: req.user!.id,
        latitude: loc.latitude,
        longitude: loc.longitude,
        accuracy: loc.accuracy,
        altitude: loc.altitude,
        speed: loc.speed,
        heading: loc.heading,
        batteryLevel: loc.batteryLevel,
        isCharging: loc.isCharging || false,
        dwellTime: loc.dwellTime,
        timestamp: new Date(loc.timestamp),
      }));

      await db.insert(locations).values(values);

      // Update user's lastSeen
      await db.update(users)
        .set({ lastSeen: new Date() })
        .where(eq(users.id, req.user!.id));

      res.status(201).json({
        message: 'Locations synced',
        count: values.length,
      });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
