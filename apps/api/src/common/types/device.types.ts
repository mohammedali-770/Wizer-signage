/**
 * The principal attached to a request authenticated by a device token
 * (Phase 6 player). Strictly scoped to one paired screen — a device token never
 * carries user/dashboard authority.
 */
export interface AuthenticatedDevice {
  /** Device row id. */
  id: string;
  /** Device-generated stable id. */
  deviceId: string;
  /** The single screen this device is bound to. */
  screenId: string;
  /** The owning company. */
  companyId: string;
}
