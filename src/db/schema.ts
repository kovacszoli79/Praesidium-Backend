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

// Types
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Family = typeof families.$inferSelect;
export type Location = typeof locations.$inferSelect;
export type StatusUpdate = typeof statusUpdates.$inferSelect;
export type FavoritePlace = typeof favoritePlaces.$inferSelect;
export type DailyStats = typeof dailyStats.$inferSelect;
