import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { eq } from 'drizzle-orm';
import { AppError } from './errorHandler';
import { db, users } from '../db';

export interface JwtPayload {
  userId: string;
  email: string;
  role: 'parent' | 'child';
}

// Extended user info attached after DB lookup
export interface AuthenticatedUser {
  id: string;
  email: string;
  displayName: string;
  role: 'parent' | 'child';
  avatar: string | null;
  familyId: string | null;
  parentId: string | null;
  pairingCode: string | null;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}

export const authMiddleware = async (
  req: Request,
  _res: Response,
  next: NextFunction
) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new AppError('No token provided', 401);
    }

    const token = authHeader.substring(7);
    const secret = process.env.JWT_SECRET || 'default-secret';

    const decoded = jwt.verify(token, secret) as JwtPayload;

    // Fetch full user info from database
    const user = await db.query.users.findFirst({
      where: eq(users.id, decoded.userId),
    });

    if (!user) {
      throw new AppError('User not found', 401);
    }

    req.user = {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      role: user.role,
      avatar: user.avatar,
      familyId: user.familyId,
      parentId: user.parentId,
      pairingCode: user.pairingCode,
    };

    next();
  } catch (error) {
    if (error instanceof AppError) {
      next(error);
    } else if (error instanceof jwt.JsonWebTokenError) {
      next(new AppError('Invalid token', 401));
    } else if (error instanceof jwt.TokenExpiredError) {
      next(new AppError('Token expired', 401));
    } else {
      next(new AppError('Authentication failed', 401));
    }
  }
};

export const parentOnly = (
  req: Request,
  _res: Response,
  next: NextFunction
) => {
  if (req.user?.role !== 'parent') {
    return next(new AppError('Parent access required', 403));
  }
  next();
};
