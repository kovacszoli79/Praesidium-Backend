import { Router } from 'express';
import { body } from 'express-validator';
import { eq, desc, and } from 'drizzle-orm';
import { db, users, families, favoritePlaces, locations, statusUpdates } from '../db';
import { validate } from '../middleware/validate';
import { AppError } from '../middleware/errorHandler';
import { createInviteCode, generateId } from '../utils/codes';
import { parentOnly } from '../middleware/auth';

const router = Router();

// Create family
router.post(
  '/',
  validate([
    body('name').trim().isLength({ min: 1, max: 50 }),
  ]),
  async (req, res, next) => {
    try {
      const { name } = req.body;
      const userId = req.user!.id;

      // Check if user already in a family
      const user = await db.query.users.findFirst({
        where: eq(users.id, userId),
      });

      if (user?.familyId) {
        throw new AppError('You are already in a family', 400);
      }

      const familyId = generateId();
      const now = new Date();

      // Create family
      await db.insert(families).values({
        id: familyId,
        name,
        inviteCode: createInviteCode(),
        createdAt: now,
        updatedAt: now,
      });

      // Update user to be in family
      await db.update(users)
        .set({ familyId, updatedAt: now })
        .where(eq(users.id, userId));

      const family = await db.query.families.findFirst({
        where: eq(families.id, familyId),
      });

      // Get members
      const members = await db.query.users.findMany({
        where: eq(users.familyId, familyId),
      });

      res.status(201).json({
        ...family,
        members: members.map(m => ({
          id: m.id,
          displayName: m.displayName,
          role: m.role,
          avatar: m.avatar,
          lastSeen: m.lastSeen,
        })),
      });
    } catch (error) {
      next(error);
    }
  }
);

// Get current family
router.get('/', async (req, res, next) => {
  try {
    const user = await db.query.users.findFirst({
      where: eq(users.id, req.user!.id),
    });

    if (!user?.familyId) {
      throw new AppError('You are not in a family', 404);
    }

    const family = await db.query.families.findFirst({
      where: eq(families.id, user.familyId),
    });

    const members = await db.query.users.findMany({
      where: eq(users.familyId, user.familyId),
    });

    const places = await db.query.favoritePlaces.findMany({
      where: eq(favoritePlaces.familyId, user.familyId),
    });

    res.json({
      ...family,
      members: members.map(m => ({
        id: m.id,
        displayName: m.displayName,
        role: m.role,
        avatar: m.avatar,
        lastSeen: m.lastSeen,
      })),
      favoritePlaces: places,
    });
  } catch (error) {
    next(error);
  }
});

// Join family with invite code
router.post(
  '/join',
  validate([
    body('inviteCode').trim().isLength({ min: 6, max: 6 }).toUpperCase(),
  ]),
  async (req, res, next) => {
    try {
      const { inviteCode } = req.body;
      const userId = req.user!.id;

      // Check if user already in a family
      const user = await db.query.users.findFirst({
        where: eq(users.id, userId),
      });

      if (user?.familyId) {
        throw new AppError('You are already in a family', 400);
      }

      // Find family by invite code
      const family = await db.query.families.findFirst({
        where: eq(families.inviteCode, inviteCode.toUpperCase()),
      });

      if (!family) {
        throw new AppError('Invalid invite code', 400);
      }

      // Add user to family
      await db.update(users)
        .set({ familyId: family.id, updatedAt: new Date() })
        .where(eq(users.id, userId));

      // Get updated members
      const members = await db.query.users.findMany({
        where: eq(users.familyId, family.id),
      });

      res.json({
        ...family,
        members: members.map(m => ({
          id: m.id,
          displayName: m.displayName,
          role: m.role,
          avatar: m.avatar,
          lastSeen: m.lastSeen,
        })),
      });
    } catch (error) {
      next(error);
    }
  }
);

// Leave family
router.post('/leave', async (req, res, next) => {
  try {
    const userId = req.user!.id;

    const user = await db.query.users.findFirst({
      where: eq(users.id, userId),
    });

    if (!user?.familyId) {
      throw new AppError('You are not in a family', 400);
    }

    const familyId = user.familyId;

    // Remove user from family
    await db.update(users)
      .set({ familyId: null, updatedAt: new Date() })
      .where(eq(users.id, userId));

    // Check if family is empty and delete if so
    const remainingMembers = await db.query.users.findMany({
      where: eq(users.familyId, familyId),
    });

    if (remainingMembers.length === 0) {
      await db.delete(families).where(eq(families.id, familyId));
    }

    res.json({ message: 'Left family successfully' });
  } catch (error) {
    next(error);
  }
});

// Regenerate invite code (parent only)
router.post('/regenerate-code', parentOnly, async (req, res, next) => {
  try {
    const user = await db.query.users.findFirst({
      where: eq(users.id, req.user!.id),
    });

    if (!user?.familyId) {
      throw new AppError('You are not in a family', 400);
    }

    const newCode = createInviteCode();

    await db.update(families)
      .set({ inviteCode: newCode, updatedAt: new Date() })
      .where(eq(families.id, user.familyId));

    res.json({ inviteCode: newCode });
  } catch (error) {
    next(error);
  }
});

// Get family members with latest location
router.get('/members', async (req, res, next) => {
  try {
    const user = await db.query.users.findFirst({
      where: eq(users.id, req.user!.id),
    });

    if (!user?.familyId) {
      throw new AppError('You are not in a family', 404);
    }

    const members = await db.query.users.findMany({
      where: eq(users.familyId, user.familyId),
    });

    const membersWithLocation = await Promise.all(members.map(async (member) => {
      const lastLocation = await db.query.locations.findFirst({
        where: eq(locations.userId, member.id),
        orderBy: desc(locations.timestamp),
      });

      const lastStatus = await db.query.statusUpdates.findFirst({
        where: eq(statusUpdates.userId, member.id),
        orderBy: desc(statusUpdates.timestamp),
      });

      return {
        id: member.id,
        displayName: member.displayName,
        role: member.role,
        avatar: member.avatar,
        lastSeen: member.lastSeen,
        lastLocation: lastLocation || null,
        lastStatus: lastStatus || null,
      };
    }));

    res.json(membersWithLocation);
  } catch (error) {
    next(error);
  }
});

// Add favorite place
router.post(
  '/places',
  validate([
    body('name').trim().isLength({ min: 1, max: 50 }),
    body('latitude').isFloat({ min: -90, max: 90 }),
    body('longitude').isFloat({ min: -180, max: 180 }),
    body('radius').optional().isInt({ min: 50, max: 1000 }),
    body('icon').optional().isString(),
  ]),
  async (req, res, next) => {
    try {
      const { name, latitude, longitude, radius, icon } = req.body;
      const userId = req.user!.id;

      const user = await db.query.users.findFirst({
        where: eq(users.id, userId),
      });

      if (!user?.familyId) {
        throw new AppError('You are not in a family', 400);
      }

      const placeId = generateId();

      await db.insert(favoritePlaces).values({
        id: placeId,
        name,
        latitude,
        longitude,
        radius: radius || 100,
        icon,
        familyId: user.familyId,
        createdById: userId,
        createdAt: new Date(),
      });

      const place = await db.query.favoritePlaces.findFirst({
        where: eq(favoritePlaces.id, placeId),
      });

      res.status(201).json(place);
    } catch (error) {
      next(error);
    }
  }
);

// Get favorite places
router.get('/places', async (req, res, next) => {
  try {
    const user = await db.query.users.findFirst({
      where: eq(users.id, req.user!.id),
    });

    if (!user?.familyId) {
      throw new AppError('You are not in a family', 404);
    }

    const places = await db.query.favoritePlaces.findMany({
      where: eq(favoritePlaces.familyId, user.familyId),
    });

    // Get creator names
    const placesWithCreator = await Promise.all(places.map(async (place) => {
      const creator = await db.query.users.findFirst({
        where: eq(users.id, place.createdById),
      });
      return {
        ...place,
        createdBy: { displayName: creator?.displayName || 'Unknown' },
      };
    }));

    res.json(placesWithCreator);
  } catch (error) {
    next(error);
  }
});

// Delete favorite place
router.delete('/places/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user!.id;

    const user = await db.query.users.findFirst({
      where: eq(users.id, userId),
    });

    if (!user?.familyId) {
      throw new AppError('You are not in a family', 400);
    }

    const place = await db.query.favoritePlaces.findFirst({
      where: eq(favoritePlaces.id, id),
    });

    if (!place || place.familyId !== user.familyId) {
      throw new AppError('Place not found', 404);
    }

    // Only creator or parent can delete
    if (place.createdById !== userId && user.role !== 'parent') {
      throw new AppError('Not authorized to delete this place', 403);
    }

    await db.delete(favoritePlaces).where(eq(favoritePlaces.id, id));

    res.json({ message: 'Place deleted' });
  } catch (error) {
    next(error);
  }
});

export default router;
