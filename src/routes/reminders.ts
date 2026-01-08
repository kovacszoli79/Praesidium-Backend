import { Router, Request, Response } from 'express';
import { body, param } from 'express-validator';
import { db, locationReminders, geofences, users } from '../db';
import { parentOnly } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { generateId } from '../utils/codes';
import { eq, and, desc } from 'drizzle-orm';

const router = Router();

router.post('/', parentOnly, validate([
  body('childId').notEmpty(),
  body('geofenceId').optional().isString(),
  body('triggerType').isIn(['enter', 'exit']),
  body('message').notEmpty(),
  body('isRepeating').optional().isBoolean(),
]), async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const child = await db.query.users.findFirst({ where: and(eq(users.id, req.body.childId), eq(users.parentId, user.id)) });
    if (!child) return res.status(403).json({ error: 'Child not found or not your child' });

    if (req.body.geofenceId) {
      const geofence = await db.query.geofences.findFirst({ where: and(eq(geofences.id, req.body.geofenceId), eq(geofences.familyId, user.familyId!)) });
      if (!geofence) return res.status(404).json({ error: 'Geofence not found' });
    }

    const reminder = {
      id: generateId(),
      parentId: user.id,
      childId: req.body.childId,
      geofenceId: req.body.geofenceId || null,
      triggerType: req.body.triggerType as 'enter' | 'exit',
      message: req.body.message,
      isActive: true,
      isRepeating: req.body.isRepeating ?? true,
    };
    await db.insert(locationReminders).values(reminder);
    res.status(201).json({ message: 'Reminder created', reminder });
  } catch (error) {
    console.error('Create reminder error:', error);
    res.status(500).json({ error: 'Failed to create reminder' });
  }
});

router.get('/', async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const reminders = user.role === 'parent'
      ? await db.query.locationReminders.findMany({ where: eq(locationReminders.parentId, user.id), orderBy: [desc(locationReminders.createdAt)] })
      : await db.query.locationReminders.findMany({ where: eq(locationReminders.childId, user.id), orderBy: [desc(locationReminders.createdAt)] });

    const remindersWithDetails = await Promise.all(reminders.map(async (r) => {
      const geofence = r.geofenceId ? await db.query.geofences.findFirst({ where: eq(geofences.id, r.geofenceId) }) : null;
      const child = await db.query.users.findFirst({ where: eq(users.id, r.childId) });
      return { ...r, geofenceName: geofence?.name || null, childName: child?.displayName || 'Unknown' };
    }));
    res.json({ reminders: remindersWithDetails });
  } catch (error) {
    console.error('Get reminders error:', error);
    res.status(500).json({ error: 'Failed to get reminders' });
  }
});

router.patch('/:id', parentOnly, validate([param('id').notEmpty(), body('message').optional().notEmpty(), body('isActive').optional().isBoolean(), body('isRepeating').optional().isBoolean()]),
  async (req: Request, res: Response) => {
    try {
      const user = req.user!;
      const reminder = await db.query.locationReminders.findFirst({ where: eq(locationReminders.id, req.params.id) });
      if (!reminder) return res.status(404).json({ error: 'Reminder not found' });
      if (reminder.parentId !== user.id) return res.status(403).json({ error: 'Access denied' });

      const updates: Record<string, any> = {};
      if (req.body.message !== undefined) updates.message = req.body.message;
      if (req.body.isActive !== undefined) updates.isActive = req.body.isActive;
      if (req.body.isRepeating !== undefined) updates.isRepeating = req.body.isRepeating;
      await db.update(locationReminders).set(updates).where(eq(locationReminders.id, req.params.id));
      res.json({ message: 'Reminder updated', reminder: { ...reminder, ...updates } });
    } catch (error) {
      console.error('Update reminder error:', error);
      res.status(500).json({ error: 'Failed to update reminder' });
    }
  });

router.delete('/:id', parentOnly, validate([param('id').notEmpty()]), async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const reminder = await db.query.locationReminders.findFirst({ where: eq(locationReminders.id, req.params.id) });
    if (!reminder) return res.status(404).json({ error: 'Reminder not found' });
    if (reminder.parentId !== user.id) return res.status(403).json({ error: 'Access denied' });
    await db.delete(locationReminders).where(eq(locationReminders.id, req.params.id));
    res.json({ message: 'Reminder deleted' });
  } catch (error) {
    console.error('Delete reminder error:', error);
    res.status(500).json({ error: 'Failed to delete reminder' });
  }
});

router.get('/check', async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const reminders = await db.query.locationReminders.findMany({ where: and(eq(locationReminders.childId, user.id), eq(locationReminders.isActive, true)) });

    const remindersWithDetails = await Promise.all(reminders.map(async (r) => {
      const geofence = r.geofenceId ? await db.query.geofences.findFirst({ where: eq(geofences.id, r.geofenceId) }) : null;
      return {
        id: r.id, geofenceId: r.geofenceId, geofenceName: geofence?.name || null,
        geofenceLatitude: geofence?.latitude || null, geofenceLongitude: geofence?.longitude || null,
        geofenceRadius: geofence?.radius || null, triggerType: r.triggerType, message: r.message, isRepeating: r.isRepeating,
      };
    }));
    res.json({ reminders: remindersWithDetails });
  } catch (error) {
    console.error('Check reminders error:', error);
    res.status(500).json({ error: 'Failed to check reminders' });
  }
});

export default router;
