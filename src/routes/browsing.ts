import { Router, Request, Response } from 'express';
import { body, param, query } from 'express-validator';
import { db, browsingHistory, blockedWebsites, users } from '../db';
import { parentOnly } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { generateId } from '../utils/codes';
import { eq, and, desc } from 'drizzle-orm';

const router = Router();

router.post('/history', validate([body('entries').isArray()]), async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const records = req.body.entries.map((entry: any) => ({
      id: generateId(), userId: user.id, url: entry.url, title: entry.title || null,
      domain: entry.domain, duration: entry.duration || null, visitedAt: entry.visitedAt ? new Date(entry.visitedAt) : new Date(),
    }));
    if (records.length > 0) await db.insert(browsingHistory).values(records);
    res.json({ message: `${records.length} entries uploaded` });
  } catch (error) {
    console.error('Upload browsing history error:', error);
    res.status(500).json({ error: 'Failed to upload browsing history' });
  }
});

router.get('/:childId', parentOnly, validate([param('childId').notEmpty(), query('limit').optional().isInt({ min: 1, max: 500 })]),
  async (req: Request, res: Response) => {
    try {
      const user = req.user!;
      const { childId } = req.params;
      const limit = parseInt(req.query.limit as string) || 100;
      const child = await db.query.users.findFirst({ where: and(eq(users.id, childId), eq(users.parentId, user.id)) });
      if (!child) return res.status(403).json({ error: 'Child not found or not your child' });

      const history = await db.query.browsingHistory.findMany({ where: eq(browsingHistory.userId, childId), orderBy: [desc(browsingHistory.visitedAt)], limit });
      res.json({ history });
    } catch (error) {
      console.error('Get browsing history error:', error);
      res.status(500).json({ error: 'Failed to get browsing history' });
    }
  });

router.post('/blocked', parentOnly, validate([body('childId').notEmpty(), body('domain').notEmpty(), body('blockType').isIn(['domain', 'keyword']), body('keyword').optional().isString()]),
  async (req: Request, res: Response) => {
    try {
      const user = req.user!;
      const child = await db.query.users.findFirst({ where: and(eq(users.id, req.body.childId), eq(users.parentId, user.id)) });
      if (!child) return res.status(403).json({ error: 'Child not found or not your child' });

      const blocked = {
        id: generateId(), parentId: user.id, childId: req.body.childId, domain: req.body.domain,
        blockType: req.body.blockType as 'domain' | 'keyword', keyword: req.body.keyword || null, isActive: true,
      };
      await db.insert(blockedWebsites).values(blocked);
      res.status(201).json({ message: 'Website blocked', blocked });
    } catch (error) {
      console.error('Block website error:', error);
      res.status(500).json({ error: 'Failed to block website' });
    }
  });

router.get('/blocked/:childId', validate([param('childId').notEmpty()]), async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const { childId } = req.params;
    if (user.role === 'parent') {
      const child = await db.query.users.findFirst({ where: and(eq(users.id, childId), eq(users.parentId, user.id)) });
      if (!child) return res.status(403).json({ error: 'Child not found or not your child' });
    } else if (user.id !== childId) {
      return res.status(403).json({ error: 'Access denied' });
    }
    const blocked = await db.query.blockedWebsites.findMany({ where: and(eq(blockedWebsites.childId, childId), eq(blockedWebsites.isActive, true)), orderBy: [desc(blockedWebsites.createdAt)] });
    res.json({ blocked });
  } catch (error) {
    console.error('Get blocked websites error:', error);
    res.status(500).json({ error: 'Failed to get blocked websites' });
  }
});

router.delete('/blocked/:id', parentOnly, validate([param('id').notEmpty()]), async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const blocked = await db.query.blockedWebsites.findFirst({ where: eq(blockedWebsites.id, req.params.id) });
    if (!blocked) return res.status(404).json({ error: 'Blocked site not found' });
    if (blocked.parentId !== user.id) return res.status(403).json({ error: 'Access denied' });
    await db.delete(blockedWebsites).where(eq(blockedWebsites.id, req.params.id));
    res.json({ message: 'Website unblocked' });
  } catch (error) {
    console.error('Unblock website error:', error);
    res.status(500).json({ error: 'Failed to unblock website' });
  }
});

router.get('/blocked/check', async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const blocked = await db.query.blockedWebsites.findMany({ where: and(eq(blockedWebsites.childId, user.id), eq(blockedWebsites.isActive, true)) });
    res.json({
      blockedDomains: blocked.filter((b) => b.blockType === 'domain').map((b) => b.domain),
      blockedKeywords: blocked.filter((b) => b.blockType === 'keyword').map((b) => b.keyword).filter(Boolean),
    });
  } catch (error) {
    console.error('Check blocked sites error:', error);
    res.status(500).json({ error: 'Failed to check blocked sites' });
  }
});

export default router;
