import { Router, Request, Response } from 'express';
import { body, param, query } from 'express-validator';
import { db, screenTimeLimits, dailyStats, users } from '../db';
import { parentOnly } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { generateId } from '../utils/codes';
import { eq, and, desc, gte, lte } from 'drizzle-orm';

const router = Router();

router.post('/usage', validate([
  body('date').matches(/^\d{4}-\d{2}-\d{2}$/),
  body('screenTimeMinutes').isInt({ min: 0 }),
  body('appUsage').isArray(),
]), async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const { date, screenTimeMinutes, appUsage } = req.body;
    const existing = await db.query.dailyStats.findFirst({ where: and(eq(dailyStats.userId, user.id), eq(dailyStats.date, date)) });

    if (existing) {
      await db.update(dailyStats).set({ screenTimeMinutes, appUsage, updatedAt: new Date() }).where(eq(dailyStats.id, existing.id));
    } else {
      await db.insert(dailyStats).values({ id: generateId(), userId: user.id, date, screenTimeMinutes, appUsage });
    }
    res.json({ message: 'Usage data uploaded' });
  } catch (error) {
    console.error('Upload usage error:', error);
    res.status(500).json({ error: 'Failed to upload usage data' });
  }
});

router.get('/:childId', parentOnly, validate([param('childId').notEmpty(), query('startDate').optional().matches(/^\d{4}-\d{2}-\d{2}$/), query('endDate').optional().matches(/^\d{4}-\d{2}-\d{2}$/)]),
  async (req: Request, res: Response) => {
    try {
      const user = req.user!;
      const { childId } = req.params;
      const child = await db.query.users.findFirst({ where: and(eq(users.id, childId), eq(users.parentId, user.id)) });
      if (!child) return res.status(403).json({ error: 'Child not found or not your child' });

      const startDate = req.query.startDate as string || new Date().toISOString().split('T')[0];
      const endDate = req.query.endDate as string || startDate;
      const stats = await db.query.dailyStats.findMany({ where: and(eq(dailyStats.userId, childId), gte(dailyStats.date, startDate), lte(dailyStats.date, endDate)), orderBy: [desc(dailyStats.date)] });
      res.json({ stats });
    } catch (error) {
      console.error('Get screen time error:', error);
      res.status(500).json({ error: 'Failed to get screen time data' });
    }
  });

router.get('/:childId/summary', parentOnly, validate([param('childId').notEmpty(), query('period').optional().isIn(['day', 'week', 'month'])]),
  async (req: Request, res: Response) => {
    try {
      const user = req.user!;
      const { childId } = req.params;
      const period = req.query.period as string || 'week';
      const child = await db.query.users.findFirst({ where: and(eq(users.id, childId), eq(users.parentId, user.id)) });
      if (!child) return res.status(403).json({ error: 'Child not found or not your child' });

      const now = new Date();
      let startDate: string;
      if (period === 'day') startDate = now.toISOString().split('T')[0];
      else if (period === 'week') startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      else startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

      const stats = await db.query.dailyStats.findMany({ where: and(eq(dailyStats.userId, childId), gte(dailyStats.date, startDate)), orderBy: [desc(dailyStats.date)] });
      const totalScreenTime = stats.reduce((sum, s) => sum + (s.screenTimeMinutes || 0), 0);
      const avgScreenTime = stats.length > 0 ? Math.round(totalScreenTime / stats.length) : 0;

      const appTotals = new Map<string, { appName: string; packageName: string; totalMinutes: number }>();
      for (const stat of stats) {
        for (const app of stat.appUsage || []) {
          const existing = appTotals.get(app.packageName);
          if (existing) existing.totalMinutes += app.usageMinutes;
          else appTotals.set(app.packageName, { appName: app.appName, packageName: app.packageName, totalMinutes: app.usageMinutes });
        }
      }
      const topApps = Array.from(appTotals.values()).sort((a, b) => b.totalMinutes - a.totalMinutes).slice(0, 10);
      res.json({ period, daysTracked: stats.length, totalScreenTimeMinutes: totalScreenTime, avgScreenTimeMinutes: avgScreenTime, topApps });
    } catch (error) {
      console.error('Get summary error:', error);
      res.status(500).json({ error: 'Failed to get summary' });
    }
  });

router.post('/limits', parentOnly, validate([body('childId').notEmpty(), body('type').isIn(['daily_total', 'app_specific', 'category']), body('limitMinutes').isInt({ min: 1 }), body('packageName').optional().isString(), body('category').optional().isString()]),
  async (req: Request, res: Response) => {
    try {
      const user = req.user!;
      const child = await db.query.users.findFirst({ where: and(eq(users.id, req.body.childId), eq(users.parentId, user.id)) });
      if (!child) return res.status(403).json({ error: 'Child not found or not your child' });

      const limit = {
        id: generateId(), parentId: user.id, childId: req.body.childId,
        type: req.body.type as 'daily_total' | 'app_specific' | 'category',
        packageName: req.body.packageName || null, category: req.body.category || null, limitMinutes: req.body.limitMinutes, isActive: true,
      };
      await db.insert(screenTimeLimits).values(limit);
      res.status(201).json({ message: 'Limit created', limit });
    } catch (error) {
      console.error('Create limit error:', error);
      res.status(500).json({ error: 'Failed to create limit' });
    }
  });

router.get('/limits/:childId', validate([param('childId').notEmpty()]), async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const { childId } = req.params;
    if (user.role === 'parent') {
      const child = await db.query.users.findFirst({ where: and(eq(users.id, childId), eq(users.parentId, user.id)) });
      if (!child) return res.status(403).json({ error: 'Child not found or not your child' });
    } else if (user.id !== childId) {
      return res.status(403).json({ error: 'Access denied' });
    }
    const limits = await db.query.screenTimeLimits.findMany({ where: eq(screenTimeLimits.childId, childId), orderBy: [desc(screenTimeLimits.createdAt)] });
    res.json({ limits });
  } catch (error) {
    console.error('Get limits error:', error);
    res.status(500).json({ error: 'Failed to get limits' });
  }
});

router.delete('/limits/:id', parentOnly, validate([param('id').notEmpty()]), async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const limit = await db.query.screenTimeLimits.findFirst({ where: eq(screenTimeLimits.id, req.params.id) });
    if (!limit) return res.status(404).json({ error: 'Limit not found' });
    if (limit.parentId !== user.id) return res.status(403).json({ error: 'Access denied' });
    await db.delete(screenTimeLimits).where(eq(screenTimeLimits.id, req.params.id));
    res.json({ message: 'Limit deleted' });
  } catch (error) {
    console.error('Delete limit error:', error);
    res.status(500).json({ error: 'Failed to delete limit' });
  }
});

export default router;
