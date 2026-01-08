import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { body } from 'express-validator';
import { eq } from 'drizzle-orm';
import { db, users, families } from '../db';
import { validate } from '../middleware/validate';
import { AppError } from '../middleware/errorHandler';
import { createPairingCode, generateId } from '../utils/codes';
import { authMiddleware } from '../middleware/auth';

const router = Router();

// Register
router.post(
  '/register',
  validate([
    body('email').isEmail().normalizeEmail(),
    body('password').isLength({ min: 4 }),
    body('displayName').trim().isLength({ min: 1, max: 50 }),
    body('role').isIn(['parent', 'child']),
    body('pairingCode').optional().matches(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/),
  ]),
  async (req, res, next) => {
    try {
      const { email, password, displayName, role, pairingCode } = req.body;

      // Check if email already exists
      const existingUser = await db.query.users.findFirst({
        where: eq(users.email, email),
      });
      if (existingUser) {
        throw new AppError('Email already registered', 400);
      }

      // If child registration, validate pairing code
      let parentUser = null;
      if (role === 'child') {
        if (!pairingCode) {
          throw new AppError('Pairing code required for child registration', 400);
        }

        parentUser = await db.query.users.findFirst({
          where: eq(users.pairingCode, pairingCode),
        });

        if (!parentUser) {
          throw new AppError('Invalid pairing code', 400);
        }
      }

      // Hash password
      const hashedPassword = await bcrypt.hash(password, 10);

      const userId = generateId();
      const now = new Date();

      // Create user
      await db.insert(users).values({
        id: userId,
        email,
        password: hashedPassword,
        displayName,
        role,
        parentId: parentUser?.id || null,
        familyId: parentUser?.familyId || null,
        pairingCode: role === 'parent' ? createPairingCode() : null,
        createdAt: now,
        updatedAt: now,
        lastSeen: now,
      });

      const user = await db.query.users.findFirst({
        where: eq(users.id, userId),
      });

      // Clear the used pairing code from parent and generate new one
      if (parentUser) {
        await db.update(users)
          .set({ pairingCode: createPairingCode(), updatedAt: new Date() })
          .where(eq(users.id, parentUser.id));
      }

      // Generate JWT
      const token = jwt.sign(
        { userId: user!.id, email: user!.email, role: user!.role },
        process.env.JWT_SECRET || 'default-secret',
        { expiresIn: '7d' }
      );

      res.status(201).json({
        message: 'Registration successful',
        user: {
          id: user!.id,
          email: user!.email,
          displayName: user!.displayName,
          role: user!.role,
          pairingCode: user!.pairingCode,
          familyId: user!.familyId,
          createdAt: user!.createdAt,
        },
        token,
      });
    } catch (error) {
      next(error);
    }
  }
);

// Login
router.post(
  '/login',
  validate([
    body('email').isEmail().normalizeEmail(),
    body('password').notEmpty(),
  ]),
  async (req, res, next) => {
    try {
      const { email, password } = req.body;

      // Find user
      const user = await db.query.users.findFirst({
        where: eq(users.email, email),
      });

      if (!user) {
        throw new AppError('Invalid email or password', 401);
      }

      // Check password
      const isValidPassword = await bcrypt.compare(password, user.password);
      if (!isValidPassword) {
        throw new AppError('Invalid email or password', 401);
      }

      // Update last seen
      await db.update(users)
        .set({ lastSeen: new Date() })
        .where(eq(users.id, user.id));

      // Get family if exists
      let family = null;
      if (user.familyId) {
        family = await db.query.families.findFirst({
          where: eq(families.id, user.familyId),
        });
      }

      // Generate JWT
      const token = jwt.sign(
        { userId: user.id, email: user.email, role: user.role },
        process.env.JWT_SECRET || 'default-secret',
        { expiresIn: '7d' }
      );

      res.json({
        message: 'Login successful',
        user: {
          id: user.id,
          email: user.email,
          displayName: user.displayName,
          role: user.role,
          avatar: user.avatar,
          pairingCode: user.pairingCode,
          family: family ? { id: family.id, name: family.name, inviteCode: family.inviteCode } : null,
        },
        token,
      });
    } catch (error) {
      next(error);
    }
  }
);

// Get current user
router.get('/me', authMiddleware, async (req, res, next) => {
  try {
    const user = await db.query.users.findFirst({
      where: eq(users.id, req.user!.userId),
    });

    if (!user) {
      throw new AppError('User not found', 404);
    }

    // Get family if exists
    let family = null;
    if (user.familyId) {
      family = await db.query.families.findFirst({
        where: eq(families.id, user.familyId),
      });
    }

    // Get children if parent
    const children = await db.query.users.findMany({
      where: eq(users.parentId, user.id),
    });

    res.json({
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      role: user.role,
      avatar: user.avatar,
      pairingCode: user.pairingCode,
      family: family ? { id: family.id, name: family.name, inviteCode: family.inviteCode } : null,
      children: children.map(c => ({
        id: c.id,
        displayName: c.displayName,
        avatar: c.avatar,
        lastSeen: c.lastSeen,
      })),
      createdAt: user.createdAt,
      lastSeen: user.lastSeen,
    });
  } catch (error) {
    next(error);
  }
});

// Update FCM token
router.patch('/fcm-token', authMiddleware, async (req, res, next) => {
  try {
    const { fcmToken } = req.body;

    await db.update(users)
      .set({ fcmToken, updatedAt: new Date() })
      .where(eq(users.id, req.user!.userId));

    res.json({ message: 'FCM token updated' });
  } catch (error) {
    next(error);
  }
});

// Generate new pairing code (for parents)
router.post('/pairing-code', authMiddleware, async (req, res, next) => {
  try {
    if (req.user!.role !== 'parent') {
      throw new AppError('Only parents can generate pairing codes', 403);
    }

    const pairingCode = createPairingCode();

    await db.update(users)
      .set({ pairingCode, updatedAt: new Date() })
      .where(eq(users.id, req.user!.userId));

    res.json({ pairingCode });
  } catch (error) {
    next(error);
  }
});

export default router;
