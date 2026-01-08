import { Router, Request, Response } from 'express';
import { body, param, query } from 'express-validator';
import { db, drivingSessions, drivingEvents, users } from '../db';
import { parentOnly } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { generateId } from '../utils/codes';
import { eq, and, desc, isNull } from 'drizzle-orm';

const router = Router();

// Start driving session (child device)
router.post('/session/start', validate([
  body('latitude').isFloat({ min: -90, max: 90 }),
  body('longitude').isFloat({ min: -180, max: 180 }),
]), async (req: Request, res: Response) => {
    try {
      const user = req.user!;

      // Check if there's already an active session
      const activeSession = await db.query.drivingSessions.findFirst({
        where: and(eq(drivingSessions.userId, user.id), isNull(drivingSessions.endTime)),
      });

      if (activeSession) {
        return res.status(400).json({
          error: 'Active session exists',
          sessionId: activeSession.id,
        });
      }

      const sessionId = generateId();
      const session = {
        id: sessionId,
        userId: user.id,
        startTime: new Date(),
        startLocation: {
          latitude: req.body.latitude,
          longitude: req.body.longitude,
        },
      };

      await db.insert(drivingSessions).values(session);

      res.status(201).json({
        message: 'Driving session started',
        sessionId,
      });
    } catch (error) {
      console.error('Start session error:', error);
      res.status(500).json({ error: 'Failed to start session' });
    }
  }
);

// End driving session
router.post('/session/end', validate([
  body('sessionId').optional().isString(),
  body('latitude').isFloat({ min: -90, max: 90 }),
  body('longitude').isFloat({ min: -180, max: 180 }),
  body('maxSpeed').optional().isFloat({ min: 0 }),
  body('avgSpeed').optional().isFloat({ min: 0 }),
  body('distanceKm').optional().isFloat({ min: 0 }),
]), async (req: Request, res: Response) => {
    try {
      const user = req.user!;

      // Find active session
      let session;
      if (req.body.sessionId) {
        session = await db.query.drivingSessions.findFirst({
          where: and(
            eq(drivingSessions.id, req.body.sessionId),
            eq(drivingSessions.userId, user.id)
          ),
        });
      } else {
        session = await db.query.drivingSessions.findFirst({
          where: and(eq(drivingSessions.userId, user.id), isNull(drivingSessions.endTime)),
        });
      }

      if (!session) {
        return res.status(404).json({ error: 'No active session found' });
      }

      // Get events for this session to calculate counts
      const events = await db.query.drivingEvents.findMany({
        where: eq(drivingEvents.sessionId, session.id),
      });

      const hardBrakes = events.filter((e) => e.eventType === 'hard_brake').length;
      const rapidAccel = events.filter((e) => e.eventType === 'rapid_accel').length;
      const speedingEvents = events.filter((e) => e.eventType === 'speeding').length;

      // Calculate score (simple algorithm)
      let score = 100;
      score -= hardBrakes * 5;
      score -= rapidAccel * 3;
      score -= speedingEvents * 10;
      score = Math.max(0, Math.min(100, score));

      await db
        .update(drivingSessions)
        .set({
          endTime: new Date(),
          endLocation: {
            latitude: req.body.latitude,
            longitude: req.body.longitude,
          },
          maxSpeed: req.body.maxSpeed || session.maxSpeed,
          avgSpeed: req.body.avgSpeed || session.avgSpeed,
          distanceKm: req.body.distanceKm || session.distanceKm,
          hardBrakes,
          rapidAccel,
          score,
        })
        .where(eq(drivingSessions.id, session.id));

      res.json({
        message: 'Driving session ended',
        summary: {
          sessionId: session.id,
          duration: Math.round((Date.now() - session.startTime.getTime()) / 60000),
          distanceKm: req.body.distanceKm || 0,
          hardBrakes,
          rapidAccel,
          score,
        },
      });
    } catch (error) {
      console.error('End session error:', error);
      res.status(500).json({ error: 'Failed to end session' });
    }
  }
);

// Record driving event
router.post('/event', validate([
  body('sessionId').notEmpty(),
  body('eventType').isIn(['hard_brake', 'rapid_accel', 'speeding', 'phone_use']),
  body('latitude').isFloat({ min: -90, max: 90 }),
  body('longitude').isFloat({ min: -180, max: 180 }),
  body('speed').optional().isFloat({ min: 0 }),
]), async (req: Request, res: Response) => {
    try {
      const user = req.user!;

      // Verify session belongs to user
      const session = await db.query.drivingSessions.findFirst({
        where: and(
          eq(drivingSessions.id, req.body.sessionId),
          eq(drivingSessions.userId, user.id)
        ),
      });

      if (!session) {
        return res.status(404).json({ error: 'Session not found' });
      }

      if (session.endTime) {
        return res.status(400).json({ error: 'Session already ended' });
      }

      const eventId = generateId();
      const event = {
        id: eventId,
        sessionId: req.body.sessionId,
        eventType: req.body.eventType,
        latitude: req.body.latitude,
        longitude: req.body.longitude,
        speed: req.body.speed || null,
      };

      await db.insert(drivingEvents).values(event);

      // TODO: Send push notification to parents for severe events

      res.status(201).json({
        message: 'Event recorded',
        eventId,
      });
    } catch (error) {
      console.error('Record event error:', error);
      res.status(500).json({ error: 'Failed to record event' });
    }
  }
);

// Get driving history for a child (parent)
router.get('/:childId', parentOnly, validate([
  param('childId').notEmpty(),
  query('limit').optional().isInt({ min: 1, max: 100 }),
]), async (req: Request, res: Response) => {
    try {
      const user = req.user!;
      const { childId } = req.params;
      const limit = parseInt(req.query.limit as string) || 50;

      // Verify child belongs to parent
      const child = await db.query.users.findFirst({
        where: and(eq(users.id, childId), eq(users.parentId, user.id)),
      });

      if (!child) {
        return res.status(403).json({ error: 'Child not found or not your child' });
      }

      const sessions = await db.query.drivingSessions.findMany({
        where: eq(drivingSessions.userId, childId),
        orderBy: [desc(drivingSessions.startTime)],
        limit,
      });

      res.json({ sessions });
    } catch (error) {
      console.error('Get driving history error:', error);
      res.status(500).json({ error: 'Failed to get driving history' });
    }
  }
);

// Get driving stats for a child (parent)
router.get('/:childId/stats', parentOnly, validate([
  param('childId').notEmpty(),
  query('period').optional().isIn(['week', 'month', 'all']),
]), async (req: Request, res: Response) => {
    try {
      const user = req.user!;
      const { childId } = req.params;
      const period = req.query.period as string || 'week';

      // Verify child belongs to parent
      const child = await db.query.users.findFirst({
        where: and(eq(users.id, childId), eq(users.parentId, user.id)),
      });

      if (!child) {
        return res.status(403).json({ error: 'Child not found or not your child' });
      }

      // Get all completed sessions
      const allSessions = await db.query.drivingSessions.findMany({
        where: eq(drivingSessions.userId, childId),
        orderBy: [desc(drivingSessions.startTime)],
      });

      const completedSessions = allSessions.filter((s) => s.endTime);

      // Filter by period
      let sessions = completedSessions;
      const now = Date.now();
      if (period === 'week') {
        const weekAgo = now - 7 * 24 * 60 * 60 * 1000;
        sessions = completedSessions.filter((s) => s.startTime.getTime() > weekAgo);
      } else if (period === 'month') {
        const monthAgo = now - 30 * 24 * 60 * 60 * 1000;
        sessions = completedSessions.filter((s) => s.startTime.getTime() > monthAgo);
      }

      // Calculate stats
      const totalTrips = sessions.length;
      const totalDistance = sessions.reduce((sum, s) => sum + (s.distanceKm || 0), 0);
      const totalHardBrakes = sessions.reduce((sum, s) => sum + (s.hardBrakes || 0), 0);
      const totalRapidAccel = sessions.reduce((sum, s) => sum + (s.rapidAccel || 0), 0);
      const avgScore = sessions.length > 0
        ? Math.round(sessions.reduce((sum, s) => sum + (s.score || 0), 0) / sessions.length)
        : 0;

      res.json({
        period,
        totalTrips,
        totalDistanceKm: Math.round(totalDistance * 10) / 10,
        totalHardBrakes,
        totalRapidAccel,
        avgScore,
      });
    } catch (error) {
      console.error('Get driving stats error:', error);
      res.status(500).json({ error: 'Failed to get driving stats' });
    }
  }
);

export default router;
