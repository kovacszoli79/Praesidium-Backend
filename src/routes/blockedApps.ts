import { Router, Request, Response } from 'express';
import { body, param } from 'express-validator';
import { db, blockedApps, users } from '../db';
import { parentOnly } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { generateId } from '../utils/codes';
import { eq, and, desc } from 'drizzle-orm';

const router = Router();

router.post('/', parentOnly, validate([
  body('childId').notEmpty(),
  body('packageName').notEmpty(),
  body('appName').notEmpty(),
  body('blockType').isIn(['always', 'scheduled', 'limit_exceeded']),
  body('schedule').optional().isObject(),
]), async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const child = await db.query.users.findFirst({
      where: and(eq(users.id, req.body.childId), eq(users.parentId, user.id)),
    });

    if (!child) {
      return res.status(403).json({ error: 'Child not found or not your child' });
    }

    const existing = await db.query.blockedApps.findFirst({
      where: and(eq(blockedApps.childId, req.body.childId), eq(blockedApps.packageName, req.body.packageName)),
    });

    if (existing) {
      await db.update(blockedApps).set({
        blockType: req.body.blockType,
        schedule: req.body.schedule || null,
        isActive: true,
      }).where(eq(blockedApps.id, existing.id));

      return res.json({ message: 'App block updated', blocked: { ...existing, blockType: req.body.blockType, isActive: true } });
    }

    const blocked = {
      id: generateId(),
      parentId: user.id,
      childId: req.body.childId,
      packageName: req.body.packageName,
      appName: req.body.appName,
      blockType: req.body.blockType as 'always' | 'scheduled' | 'limit_exceeded',
      schedule: req.body.schedule || null,
      isActive: true,
    };

    await db.insert(blockedApps).values(blocked);
    res.status(201).json({ message: 'App blocked', blocked });
  } catch (error) {
    console.error('Block app error:', error);
    res.status(500).json({ error: 'Failed to block app' });
  }
});

router.get('/:childId', validate([param('childId').notEmpty()]), async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const { childId } = req.params;

    if (user.role === 'parent') {
      const child = await db.query.users.findFirst({
        where: and(eq(users.id, childId), eq(users.parentId, user.id)),
      });
      if (!child) {
        return res.status(403).json({ error: 'Child not found or not your child' });
      }
    } else if (user.id !== childId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const blocked = await db.query.blockedApps.findMany({
      where: and(eq(blockedApps.childId, childId), eq(blockedApps.isActive, true)),
      orderBy: [desc(blockedApps.createdAt)],
    });

    res.json({ blocked });
  } catch (error) {
    console.error('Get blocked apps error:', error);
    res.status(500).json({ error: 'Failed to get blocked apps' });
  }
});

router.delete('/:id', parentOnly, validate([param('id').notEmpty()]), async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const blocked = await db.query.blockedApps.findFirst({
      where: eq(blockedApps.id, req.params.id),
    });

    if (!blocked) {
      return res.status(404).json({ error: 'Blocked app not found' });
    }

    if (blocked.parentId !== user.id) {
      return res.status(403).json({ error: 'Access denied' });
    }

    await db.delete(blockedApps).where(eq(blockedApps.id, req.params.id));
    res.json({ message: 'App unblocked' });
  } catch (error) {
    console.error('Unblock app error:', error);
    res.status(500).json({ error: 'Failed to unblock app' });
  }
});

router.get('/check', async (req: Request, res: Response) => {
  try {
    const user = req.user!;

    const blocked = await db.query.blockedApps.findMany({
      where: and(eq(blockedApps.childId, user.id), eq(blockedApps.isActive, true)),
    });

    const now = new Date();
    const currentDay = now.getDay();
    const currentTime = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');

    const activeBlocks = blocked.filter((b) => {
      if (b.blockType === 'always') return true;
      if (b.blockType === 'scheduled' && b.schedule) {
        const schedule = b.schedule as { days: number[]; startTime: string; endTime: string };
        if (!schedule.days.includes(currentDay)) return false;
        return currentTime >= schedule.startTime && currentTime <= schedule.endTime;
      }
      return true;
    });

    res.json({
      blockedApps: activeBlocks.map((b) => ({
        packageName: b.packageName,
        appName: b.appName,
        blockType: b.blockType,
      })),
    });
  } catch (error) {
    console.error('Check blocked apps error:', error);
    res.status(500).json({ error: 'Failed to check blocked apps' });
  }
});

export default router;
