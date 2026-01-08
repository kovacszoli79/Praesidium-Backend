import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core';

// Families table (defined first to avoid circular reference)
export const families = sqliteTable('families', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  inviteCode: text('invite_code').notNull().unique(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
});

// Users table
export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  password: text('password').notNull(),
  displayName: text('display_name').notNull(),
  role: text('role', { enum: ['parent', 'child'] }).notNull(),
  avatar: text('avatar'),
  fcmToken: text('fcm_token'),
  familyId: text('family_id'),
  parentId: text('parent_id'),
  pairingCode: text('pairing_code').unique(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  lastSeen: integer('last_seen', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
});

// Locations table
export const locations = sqliteTable('locations', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  latitude: real('latitude').notNull(),
  longitude: real('longitude').notNull(),
  accuracy: real('accuracy'),
  altitude: real('altitude'),
  speed: real('speed'),
  heading: real('heading'),
  batteryLevel: integer('battery_level'),
  isCharging: integer('is_charging', { mode: 'boolean' }).default(false),
  dwellTime: integer('dwell_time'),
  timestamp: integer('timestamp', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
});

// Status updates table
export const statusUpdates = sqliteTable('status_updates', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  status: text('status', { enum: ['arrived', 'departed', 'safe', 'none'] }).notNull(),
  latitude: real('latitude'),
  longitude: real('longitude'),
  timestamp: integer('timestamp', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
});

// Favorite places table
export const favoritePlaces = sqliteTable('favorite_places', {
  id: text('id').primaryKey(),
  familyId: text('family_id').notNull(),
  name: text('name').notNull(),
  latitude: real('latitude').notNull(),
  longitude: real('longitude').notNull(),
  radius: integer('radius').default(100),
  icon: text('icon'),
  createdById: text('created_by_id').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
});

// Daily stats table
export const dailyStats = sqliteTable('daily_stats', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  date: text('date').notNull(), // YYYY-MM-DD format
  screenTimeMinutes: integer('screen_time_minutes').default(0),
  appUsage: text('app_usage', { mode: 'json' }).$type<Array<{appName: string; packageName: string; icon: string; usageMinutes: number}>>().default([]),
  visitedUrls: text('visited_urls', { mode: 'json' }).$type<Array<{url: string; title: string; timestamp: number}>>().default([]),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
});

// ==================== NEW TABLES ====================

// Geofences table
export const geofences = sqliteTable('geofences', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(), // Parent who created it
  childId: text('child_id'), // Optional: specific child only
  familyId: text('family_id').notNull(),
  name: text('name').notNull(),
  latitude: real('latitude').notNull(),
  longitude: real('longitude').notNull(),
  radius: integer('radius').notNull().default(100), // meters (50-5000)
  type: text('type', { enum: ['circle', 'polygon'] }).notNull().default('circle'),
  color: text('color'),
  icon: text('icon'),
  notifyEnter: integer('notify_enter', { mode: 'boolean' }).default(true),
  notifyExit: integer('notify_exit', { mode: 'boolean' }).default(true),
  isActive: integer('is_active', { mode: 'boolean' }).default(true),
  schedule: text('schedule', { mode: 'json' }).$type<{days: number[]; startTime: string; endTime: string} | null>(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
});

// Geofence events table
export const geofenceEvents = sqliteTable('geofence_events', {
  id: text('id').primaryKey(),
  geofenceId: text('geofence_id').notNull(),
  childId: text('child_id').notNull(),
  eventType: text('event_type', { enum: ['enter', 'exit', 'dwell'] }).notNull(),
  latitude: real('latitude').notNull(),
  longitude: real('longitude').notNull(),
  timestamp: integer('timestamp', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
});

// Ping requests table
export const pingRequests = sqliteTable('ping_requests', {
  id: text('id').primaryKey(),
  parentId: text('parent_id').notNull(),
  childId: text('child_id').notNull(),
  type: text('type', { enum: ['sound', 'vibrate', 'both'] }).notNull().default('sound'),
  soundType: text('sound_type', { enum: ['alarm', 'ring', 'beep'] }),
  duration: integer('duration').default(30), // seconds
  volume: integer('volume').default(100), // 0-100
  message: text('message'),
  status: text('status', { enum: ['pending', 'delivered', 'acknowledged', 'failed'] }).notNull().default('pending'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  deliveredAt: integer('delivered_at', { mode: 'timestamp' }),
  acknowledgedAt: integer('acknowledged_at', { mode: 'timestamp' }),
});

// Location requests table ("Where are you?")
export const locationRequests = sqliteTable('location_requests', {
  id: text('id').primaryKey(),
  parentId: text('parent_id').notNull(),
  childId: text('child_id').notNull(),
  status: text('status', { enum: ['pending', 'responded', 'expired'] }).notNull().default('pending'),
  message: text('message'),
  responseLocation: text('response_location', { mode: 'json' }).$type<{latitude: number; longitude: number; accuracy: number; address?: string} | null>(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  respondedAt: integer('responded_at', { mode: 'timestamp' }),
  expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
});

// Chat messages table
export const chatMessages = sqliteTable('chat_messages', {
  id: text('id').primaryKey(),
  familyId: text('family_id').notNull(),
  senderId: text('sender_id').notNull(),
  messageType: text('message_type', { enum: ['text', 'location', 'image', 'voice'] }).notNull().default('text'),
  content: text('content').notNull(),
  metadata: text('metadata', { mode: 'json' }).$type<Record<string, any> | null>(),
  readBy: text('read_by', { mode: 'json' }).$type<string[]>().default([]),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
});

// Screen time limits table
export const screenTimeLimits = sqliteTable('screen_time_limits', {
  id: text('id').primaryKey(),
  parentId: text('parent_id').notNull(),
  childId: text('child_id').notNull(),
  type: text('type', { enum: ['daily_total', 'app_specific', 'category'] }).notNull(),
  packageName: text('package_name'), // For app-specific limits
  category: text('category'), // For category limits
  limitMinutes: integer('limit_minutes').notNull(),
  isActive: integer('is_active', { mode: 'boolean' }).default(true),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
});

// Blocked apps table
export const blockedApps = sqliteTable('blocked_apps', {
  id: text('id').primaryKey(),
  parentId: text('parent_id').notNull(),
  childId: text('child_id').notNull(),
  packageName: text('package_name').notNull(),
  appName: text('app_name').notNull(),
  blockType: text('block_type', { enum: ['always', 'scheduled', 'limit_exceeded'] }).notNull(),
  schedule: text('schedule', { mode: 'json' }).$type<{days: number[]; startTime: string; endTime: string} | null>(),
  isActive: integer('is_active', { mode: 'boolean' }).default(true),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
});

// Browsing history table
export const browsingHistory = sqliteTable('browsing_history', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  url: text('url').notNull(),
  title: text('title'),
  domain: text('domain').notNull(),
  duration: integer('duration'), // seconds
  visitedAt: integer('visited_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
});

// Blocked websites table
export const blockedWebsites = sqliteTable('blocked_websites', {
  id: text('id').primaryKey(),
  parentId: text('parent_id').notNull(),
  childId: text('child_id').notNull(),
  domain: text('domain').notNull(),
  blockType: text('block_type', { enum: ['domain', 'keyword'] }).notNull(),
  keyword: text('keyword'),
  isActive: integer('is_active', { mode: 'boolean' }).default(true),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
});

// Crash events table
export const crashEvents = sqliteTable('crash_events', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  latitude: real('latitude').notNull(),
  longitude: real('longitude').notNull(),
  speed: real('speed'),
  impactForce: real('impact_force').notNull(), // G-force
  eventType: text('event_type', { enum: ['potential_crash', 'confirmed_crash', 'false_alarm'] }).notNull(),
  status: text('status', { enum: ['detected', 'user_ok', 'emergency_sent'] }).notNull().default('detected'),
  emergencyContacts: text('emergency_contacts', { mode: 'json' }).$type<string[] | null>(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  respondedAt: integer('responded_at', { mode: 'timestamp' }),
});

// Location reminders table
export const locationReminders = sqliteTable('location_reminders', {
  id: text('id').primaryKey(),
  parentId: text('parent_id').notNull(),
  childId: text('child_id').notNull(),
  geofenceId: text('geofence_id'),
  triggerType: text('trigger_type', { enum: ['enter', 'exit'] }).notNull(),
  message: text('message').notNull(),
  isActive: integer('is_active', { mode: 'boolean' }).default(true),
  isRepeating: integer('is_repeating', { mode: 'boolean' }).default(true),
  lastTriggered: integer('last_triggered', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
});

// Driving sessions table
export const drivingSessions = sqliteTable('driving_sessions', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  startTime: integer('start_time', { mode: 'timestamp' }).notNull(),
  endTime: integer('end_time', { mode: 'timestamp' }),
  startLocation: text('start_location', { mode: 'json' }).$type<{latitude: number; longitude: number}>().notNull(),
  endLocation: text('end_location', { mode: 'json' }).$type<{latitude: number; longitude: number} | null>(),
  maxSpeed: real('max_speed').default(0),
  avgSpeed: real('avg_speed').default(0),
  hardBrakes: integer('hard_brakes').default(0),
  rapidAccel: integer('rapid_accel').default(0),
  distanceKm: real('distance_km').default(0),
  score: integer('score'), // 0-100
});

// Driving events table
export const drivingEvents = sqliteTable('driving_events', {
  id: text('id').primaryKey(),
  sessionId: text('session_id').notNull(),
  eventType: text('event_type', { enum: ['hard_brake', 'rapid_accel', 'speeding', 'phone_use'] }).notNull(),
  latitude: real('latitude').notNull(),
  longitude: real('longitude').notNull(),
  speed: real('speed'),
  timestamp: integer('timestamp', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
});

// Types
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Family = typeof families.$inferSelect;
export type Location = typeof locations.$inferSelect;
export type StatusUpdate = typeof statusUpdates.$inferSelect;
export type FavoritePlace = typeof favoritePlaces.$inferSelect;
export type DailyStats = typeof dailyStats.$inferSelect;
export type Geofence = typeof geofences.$inferSelect;
export type GeofenceEvent = typeof geofenceEvents.$inferSelect;
export type PingRequest = typeof pingRequests.$inferSelect;
export type LocationRequest = typeof locationRequests.$inferSelect;
export type ChatMessage = typeof chatMessages.$inferSelect;
export type ScreenTimeLimit = typeof screenTimeLimits.$inferSelect;
export type BlockedApp = typeof blockedApps.$inferSelect;
export type BrowsingHistory = typeof browsingHistory.$inferSelect;
export type BlockedWebsite = typeof blockedWebsites.$inferSelect;
export type CrashEvent = typeof crashEvents.$inferSelect;
export type LocationReminder = typeof locationReminders.$inferSelect;
export type DrivingSession = typeof drivingSessions.$inferSelect;
export type DrivingEvent = typeof drivingEvents.$inferSelect;
