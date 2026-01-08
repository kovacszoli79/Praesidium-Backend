import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

// Only load dotenv in development (Vercel handles env vars in production)
if (process.env.NODE_ENV !== 'production') {
  dotenv.config();
}

import authRoutes from './routes/auth';
import familyRoutes from './routes/family';
import locationRoutes from './routes/location';
import statusRoutes from './routes/status';
import childRoutes from './routes/child';
import geofenceRoutes from './routes/geofence';
import pingRoutes from './routes/ping';
import locationRequestRoutes from './routes/locationRequest';
import chatRoutes from './routes/chat';
import remindersRoutes from './routes/reminders';
import screenTimeRoutes from './routes/screenTime';
import browsingRoutes from './routes/browsing';
import blockedAppsRoutes from './routes/blockedApps';
import crashRoutes from './routes/crash';
import drivingRoutes from './routes/driving';
import { errorHandler } from './middleware/errorHandler';
import { authMiddleware } from './middleware/auth';

const app = express();
const PORT = process.env.PORT || 3000;

// CORS configuration
const corsOrigins = process.env.CORS_ORIGINS?.split(',') || ['http://localhost:8081'];
app.use(cors({
  origin: corsOrigins,
  credentials: true,
}));

// Body parsing
app.use(express.json());

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Public routes
app.use('/api/auth', authRoutes);

// Protected routes
app.use('/api/family', authMiddleware, familyRoutes);
app.use('/api/location', authMiddleware, locationRoutes);
app.use('/api/status', authMiddleware, statusRoutes);
app.use('/api/children', authMiddleware, childRoutes);
app.use('/api/geofences', authMiddleware, geofenceRoutes);
app.use('/api/ping', authMiddleware, pingRoutes);
app.use('/api/location-request', authMiddleware, locationRequestRoutes);
app.use('/api/chat', authMiddleware, chatRoutes);
app.use('/api/reminders', authMiddleware, remindersRoutes);
app.use('/api/screen-time', authMiddleware, screenTimeRoutes);
app.use('/api/browsing', authMiddleware, browsingRoutes);
app.use('/api/blocked-apps', authMiddleware, blockedAppsRoutes);
app.use('/api/crash', authMiddleware, crashRoutes);
app.use('/api/driving', authMiddleware, drivingRoutes);

// Error handling
app.use(errorHandler);

// 404 handler
app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Only start server in development (not on Vercel)
if (process.env.NODE_ENV !== 'production') {
  app.listen(PORT, () => {
    console.log(`Praesidium API running on port ${PORT}`);
    console.log(`Health check: http://localhost:${PORT}/health`);
  });
}

export default app;
