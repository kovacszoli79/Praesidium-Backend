import { Router, Request, Response } from 'express';
import { body, param, query } from 'express-validator';
import { db, geofences, geofenceEvents, users } from '../db';
import { authMiddleware, parentOnly } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { generateId } from '../utils/codes';
import { isInsideGeofence, isGeofenceActiveNow } from '../utils/geofence';
import { eq, and, desc } from 'drizzle-orm';

const router = Router();

// Create geofence (parent only)
router.post(
  '/',
  parentOnly,
  validate([
    body('name').notEmpty().withMessage('Name is required'),
    body('latitude').isFloat({ min: -90, max: 90 }).withMessage('Valid latitude required'),
    body('longitude').isFloat({ min: -180, max: 180 }).withMessage('Valid longitude required'),
    body('radius').isInt({ min: 50, max: 5000 }).withMessage('Radius must be between 50-5000 meters'),
    body('childId').optional().isString(),
    body('icon').optional().isString(),
    body('color').optional().isString(),
    body('notifyEnter').optional().isBoolean(),
    body('notifyExit').optional().isBoolean(),
    body('schedule').optional().isObject(),
  ]),
  async (req: Request, res: Response) => {
    try {
      const user = req.user!;

      if (!user.familyId) {
        return res.status(400).json({ error: 'You must be in a family to create geofences' });
      }

      // If childId is provided, verify it's the parent's child
      if (req.body.childId) {
        const child = await db.query.users.findFirst({
          where: and(eq(users.id, req.body.childId), eq(users.parentId, user.id)),
        });
        if (!child) {
          return res.status(403).json({ error: 'Child not found or not your child' });
        }
      }

      const geofenceId = generateId();
      const newGeofence = {
        id: geofenceId,
        userId: user.id,
        familyId: user.familyId,
        childId: req.body.childId || null,
        name: req.body.name,
        latitude: req.body.latitude,
        longitude: req.body.longitude,
        radius: req.body.radius,
        type: 'circle' as const,
        icon: req.body.icon || null,
        color: req.body.color || null,
        notifyEnter: req.body.notifyEnter ?? true,
        notifyExit: req.body.notifyExit ?? true,
        isActive: true,
        schedule: req.body.schedule || null,
      };

      await db.insert(geofences).values(newGeofence);

      res.status(201).json({
        message: 'Geofence created successfully',
        geofence: newGeofence,
      });
    } catch (error) {
      console.error('Create geofence error:', error);
      res.status(500).json({ error: 'Failed to create geofence' });
    }
  }
);

// Get all geofences
router.get('/', async (req: Request, res: Response) => {
  try {
    const user = req.user!;

    if (!user.familyId) {
      return res.json({ geofences: [] });
    }

    const familyGeofences = await db.query.geofences.findMany({
      where: eq(geofences.familyId, user.familyId),
      orderBy: [desc(geofences.createdAt)],
    });

    res.json({ geofences: familyGeofences });
  } catch (error) {
    console.error('Get geofences error:', error);
    res.status(500).json({ error: 'Failed to get geofences' });
  }
});

// Get single geofence
router.get(
  '/:id',
  validate([param('id').notEmpty()]),
  async (req: Request, res: Response) => {
    try {
      const user = req.user!;
      const geofence = await db.query.geofences.findFirst({
        where: eq(geofences.id, req.params.id),
      });

      if (!geofence) {
        return res.status(404).json({ error: 'Geofence not found' });
      }

      if (geofence.familyId !== user.familyId) {
        return res.status(403).json({ error: 'Access denied' });
      }

      res.json({ geofence });
    } catch (error) {
      console.error('Get geofence error:', error);
      res.status(500).json({ error: 'Failed to get geofence' });
    }
  }
);

// Update geofence (parent only)
router.patch(
  '/:id',
  parentOnly,
  validate([
    param('id').notEmpty(),
    body('name').optional().notEmpty(),
    body('latitude').optional().isFloat({ min: -90, max: 90 }),
    body('longitude').optional().isFloat({ min: -180, max: 180 }),
    body('radius').optional().isInt({ min: 50, max: 5000 }),
    body('isActive').optional().isBoolean(),
    body('notifyEnter').optional().isBoolean(),
    body('notifyExit').optional().isBoolean(),
    body('schedule').optional(),
  ]),
  async (req: Request, res: Response) => {
    try {
      const user = req.user!;
      const geofence = await db.query.geofences.findFirst({
        where: eq(geofences.id, req.params.id),
      });

      if (!geofence) {
        return res.status(404).json({ error: 'Geofence not found' });
      }

      if (geofence.userId !== user.id) {
        return res.status(403).json({ error: 'Only the creator can modify this geofence' });
      }

      const updates: Record<string, any> = {};
      if (req.body.name !== undefined) updates.name = req.body.name;
      if (req.body.latitude !== undefined) updates.latitude = req.body.latitude;
      if (req.body.longitude !== undefined) updates.longitude = req.body.longitude;
      if (req.body.radius !== undefined) updates.radius = req.body.radius;
      if (req.body.icon !== undefined) updates.icon = req.body.icon;
      if (req.body.color !== undefined) updates.color = req.body.color;
      if (req.body.isActive !== undefined) updates.isActive = req.body.isActive;
      if (req.body.notifyEnter !== undefined) updates.notifyEnter = req.body.notifyEnter;
      if (req.body.notifyExit !== undefined) updates.notifyExit = req.body.notifyExit;
      if (req.body.schedule !== undefined) updates.schedule = req.body.schedule;
      updates.updatedAt = new Date();

      await db.update(geofences).set(updates).where(eq(geofences.id, req.params.id));

      res.json({
        message: 'Geofence updated successfully',
        geofence: { ...geofence, ...updates },
      });
    } catch (error) {
      console.error('Update geofence error:', error);
      res.status(500).json({ error: 'Failed to update geofence' });
    }
  }
);

// Delete geofence (parent only)
router.delete(
  '/:id',
  parentOnly,
  validate([param('id').notEmpty()]),
  async (req: Request, res: Response) => {
    try {
      const user = req.user!;
      const geofence = await db.query.geofences.findFirst({
        where: eq(geofences.id, req.params.id),
      });

      if (!geofence) {
        return res.status(404).json({ error: 'Geofence not found' });
      }

      if (geofence.userId !== user.id) {
        return res.status(403).json({ error: 'Only the creator can delete this geofence' });
      }

      // Delete related events first
      await db.delete(geofenceEvents).where(eq(geofenceEvents.geofenceId, req.params.id));
      await db.delete(geofences).where(eq(geofences.id, req.params.id));

      res.json({ message: 'Geofence deleted successfully' });
    } catch (error) {
      console.error('Delete geofence error:', error);
      res.status(500).json({ error: 'Failed to delete geofence' });
    }
  }
);

// Get geofence events
router.get(
  '/:id/events',
  validate([
    param('id').notEmpty(),
    query('limit').optional().isInt({ min: 1, max: 100 }),
  ]),
  async (req: Request, res: Response) => {
    try {
      const user = req.user!;
      const limit = parseInt(req.query.limit as string) || 50;

      const geofence = await db.query.geofences.findFirst({
        where: eq(geofences.id, req.params.id),
      });

      if (!geofence) {
        return res.status(404).json({ error: 'Geofence not found' });
      }

      if (geofence.familyId !== user.familyId) {
        return res.status(403).json({ error: 'Access denied' });
      }

      const events = await db.query.geofenceEvents.findMany({
        where: eq(geofenceEvents.geofenceId, req.params.id),
        orderBy: [desc(geofenceEvents.timestamp)],
        limit,
      });

      // Get child names for events
      const eventsWithNames = await Promise.all(
        events.map(async (event) => {
          const child = await db.query.users.findFirst({
            where: eq(users.id, event.childId),
          });
          return {
            ...event,
            childName: child?.displayName || 'Unknown',
          };
        })
      );

      res.json({ events: eventsWithNames });
    } catch (error) {
      console.error('Get geofence events error:', error);
      res.status(500).json({ error: 'Failed to get geofence events' });
    }
  }
);

// Check position against geofences (child device calls this)
router.post(
  '/check',
  validate([
    body('latitude').isFloat({ min: -90, max: 90 }).withMessage('Valid latitude required'),
    body('longitude').isFloat({ min: -180, max: 180 }).withMessage('Valid longitude required'),
  ]),
  async (req: Request, res: Response) => {
    try {
      const user = req.user!;
      const { latitude, longitude } = req.body;

      if (!user.familyId) {
        return res.json({ events: [], currentZones: [] });
      }

      // Get active geofences for this user's family
      const familyGeofences = await db.query.geofences.findMany({
        where: and(
          eq(geofences.familyId, user.familyId),
          eq(geofences.isActive, true)
        ),
      });

      // Filter geofences that apply to this child
      const applicableGeofences = familyGeofences.filter(
        (g) => !g.childId || g.childId === user.id
      );

      // Filter by schedule
      const activeGeofences = applicableGeofences.filter((g) =>
        isGeofenceActiveNow(g.schedule)
      );

      // Get last known geofence state for this child
      const lastEvents = await db.query.geofenceEvents.findMany({
        where: eq(geofenceEvents.childId, user.id),
        orderBy: [desc(geofenceEvents.timestamp)],
        limit: activeGeofences.length,
      });

      // Build map of last known state per geofence
      const lastStateMap = new Map<string, 'enter' | 'exit'>();
      for (const event of lastEvents) {
        if (!lastStateMap.has(event.geofenceId) && (event.eventType === 'enter' || event.eventType === 'exit')) {
          lastStateMap.set(event.geofenceId, event.eventType);
        }
      }

      const events: Array<{
        geofenceId: string;
        geofenceName: string;
        eventType: 'enter' | 'exit';
        timestamp: Date;
      }> = [];

      const currentZones: string[] = [];

      for (const geofence of activeGeofences) {
        const isInside = isInsideGeofence(
          latitude,
          longitude,
          geofence.latitude,
          geofence.longitude,
          geofence.radius
        );

        const lastState = lastStateMap.get(geofence.id);

        if (isInside) {
          currentZones.push(geofence.name);

          // If we just entered (wasn't inside before)
          if (lastState !== 'enter' && geofence.notifyEnter) {
            const eventId = generateId();
            const event = {
              id: eventId,
              geofenceId: geofence.id,
              childId: user.id,
              eventType: 'enter' as const,
              latitude,
              longitude,
              timestamp: new Date(),
            };
            await db.insert(geofenceEvents).values(event);
            events.push({
              geofenceId: geofence.id,
              geofenceName: geofence.name,
              eventType: 'enter',
              timestamp: event.timestamp,
            });
          }
        } else {
          // If we just exited (was inside before)
          if (lastState === 'enter' && geofence.notifyExit) {
            const eventId = generateId();
            const event = {
              id: eventId,
              geofenceId: geofence.id,
              childId: user.id,
              eventType: 'exit' as const,
              latitude,
              longitude,
              timestamp: new Date(),
            };
            await db.insert(geofenceEvents).values(event);
            events.push({
              geofenceId: geofence.id,
              geofenceName: geofence.name,
              eventType: 'exit',
              timestamp: event.timestamp,
            });
          }
        }
      }

      res.json({ events, currentZones });
    } catch (error) {
      console.error('Check geofence error:', error);
      res.status(500).json({ error: 'Failed to check geofences' });
    }
  }
);

export default router;
