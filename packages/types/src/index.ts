/**
 * @wizer/types
 *
 * Foundational shared domain types and enums for the Wizer Signage platform.
 *
 * This package is consumed directly as TypeScript source (no build step) by
 * both the NestJS API (`apps/api`) and the Next.js dashboard (`apps/dashboard`).
 * It MUST remain dependency-free and runtime-agnostic so it can be imported in
 * any environment (Node, browser, edge).
 *
 * Phase 0 scope: this is the foundational vocabulary only — NOT the full
 * database schema. Entity shapes, DTOs, and feature-specific contracts are
 * introduced in later phases.
 */

/* ========================================================================== *
 * Primitive aliases
 * ========================================================================== */

/**
 * Canonical identifier type used across the platform.
 *
 * IDs are opaque strings (UUID v4 in practice). Keeping this as an alias lets
 * us evolve the representation later without a sweeping refactor.
 */
export type ID = string;

/**
 * ISO-8601 timestamp string (e.g. `2026-06-14T12:34:56.000Z`).
 * Used on the wire; convert to `Date` only at the boundaries where needed.
 */
export type ISODateString = string;

/* ========================================================================== *
 * Identity & access control
 * ========================================================================== */

/**
 * Platform-wide user roles, ordered from most to least privileged.
 *
 * - SUPER_ADMIN      Platform operator (Wizer Signage staff). Cross-tenant.
 * - COMPANY_ADMIN    Owns a tenant/company; manages users, billing, settings.
 * - LOCATION_MANAGER Manages screens and content for assigned locations.
 * - CONTENT_MANAGER  Creates and schedules content; no admin/billing access.
 * - VIEWER           Read-only access (reporting, monitoring).
 */
export enum UserRole {
  SUPER_ADMIN = 'SUPER_ADMIN',
  COMPANY_ADMIN = 'COMPANY_ADMIN',
  LOCATION_MANAGER = 'LOCATION_MANAGER',
  CONTENT_MANAGER = 'CONTENT_MANAGER',
  VIEWER = 'VIEWER',
}

/* ========================================================================== *
 * Devices / screens
 * ========================================================================== */

/**
 * Live connectivity / health state of a screen (player device).
 *
 * - ONLINE   Connected and reporting heartbeats within the expected window.
 * - OFFLINE  No recent heartbeat; presumed disconnected.
 * - WARNING  Online but degraded (e.g. stale content, low storage, errors).
 * - UNPAIRED Registered but not yet bound to a tenant via a pairing code.
 */
export enum ScreenStatus {
  UNPAIRED = 'UNPAIRED',
  PAIRING = 'PAIRING',
  ONLINE = 'ONLINE',
  OFFLINE = 'OFFLINE',
  WARNING = 'WARNING',
  DISABLED = 'DISABLED',
  ARCHIVED = 'ARCHIVED',
}

/** Lifecycle state of a location/branch. */
export enum LocationStatus {
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
  ARCHIVED = 'ARCHIVED',
}

/**
 * Physical/display orientation of a screen.
 *
 * UNKNOWN is used before a device has reported its orientation.
 */
export enum Orientation {
  LANDSCAPE = 'LANDSCAPE',
  PORTRAIT = 'PORTRAIT',
  UNKNOWN = 'UNKNOWN',
}

/* ========================================================================== *
 * Content
 * ========================================================================== */

/**
 * Kind of a content asset/item.
 *
 * PLAYLIST is a container that references an ordered set of other content.
 */
export enum ContentType {
  IMAGE = 'IMAGE',
  VIDEO = 'VIDEO',
  PDF = 'PDF',
  URL = 'URL',
  TEXT = 'TEXT',
  PLAYLIST = 'PLAYLIST',
}

/**
 * Lifecycle state of a content item.
 *
 * - ACTIVE   Usable and schedulable.
 * - ARCHIVED Hidden from default lists but retained and restorable.
 * - TRASH    Soft-deleted; recoverable until the trash retention window lapses.
 * - DELETED  Hard-deleted; tombstone retained for audit/sync purposes only.
 */
export enum ContentStatus {
  ACTIVE = 'ACTIVE',
  ARCHIVED = 'ARCHIVED',
  TRASH = 'TRASH',
  DELETED = 'DELETED',
}

/* ========================================================================== *
 * Billing & subscriptions
 * ========================================================================== */

/**
 * State of a tenant's subscription.
 */
export enum SubscriptionStatus {
  ACTIVE = 'ACTIVE',
  TRIALING = 'TRIALING',
  EXPIRED = 'EXPIRED',
  SUSPENDED = 'SUSPENDED',
  CANCELLED = 'CANCELLED',
}

/**
 * State of an invoice.
 */
export enum InvoiceStatus {
  DRAFT = 'DRAFT',
  UNPAID = 'UNPAID',
  PAID = 'PAID',
  OVERDUE = 'OVERDUE',
  CANCELLED = 'CANCELLED',
}

/* ========================================================================== *
 * Scheduling
 * ========================================================================== */

/**
 * Priority of a schedule entry, expressed with explicit NUMERIC ordering so
 * the playback engine can resolve conflicts deterministically.
 *
 * IMPORTANT: lower numeric value == higher precedence. When two schedules are
 * eligible at the same instant, the one with the smaller number wins.
 *
 *   EMERGENCY (0) > HIGH (10) > CAMPAIGN (20) > NORMAL (30) > FALLBACK (40)
 *
 * Gaps between values leave room to insert intermediate priorities later
 * without renumbering existing data.
 */
export enum SchedulePriority {
  /** Overrides everything (e.g. safety/emergency takeover messaging). */
  EMERGENCY = 0,
  /** High-priority operational content. */
  HIGH = 10,
  /** Time-boxed marketing campaigns. */
  CAMPAIGN = 20,
  /** Default day-to-day scheduling. */
  NORMAL = 30,
  /** Shown only when nothing else is eligible. */
  FALLBACK = 40,
}

/* ========================================================================== *
 * API transport contracts
 * ========================================================================== */

/**
 * Standard error envelope returned by the API on failure.
 */
export interface ApiError {
  /** Stable, machine-readable error code (e.g. `AUTH_INVALID_CREDENTIALS`). */
  code: string;
  /** Human-readable message safe to surface to clients. */
  message: string;
  /** Optional structured details (validation errors, field hints, etc.). */
  details?: Record<string, unknown>;
}

/**
 * Generic, discriminated API response envelope.
 *
 * Use the `success` discriminant to narrow between the data and error shapes:
 *
 * ```ts
 * if (res.success) {
 *   // res.data is T
 * } else {
 *   // res.error is ApiError
 * }
 * ```
 */
export type ApiResponse<T> =
  | { success: true; data: T; error?: never }
  | { success: false; data?: never; error: ApiError };

/**
 * Pagination metadata accompanying a page of results.
 */
export interface PaginationMeta {
  /** 1-based page number. */
  page: number;
  /** Number of items requested per page. */
  pageSize: number;
  /** Total number of items across all pages. */
  total: number;
  /** Total number of pages given `pageSize` and `total`. */
  totalPages: number;
}

/**
 * A single page of results of type `T` together with pagination metadata.
 */
export interface Paginated<T> {
  items: T[];
  meta: PaginationMeta;
}
