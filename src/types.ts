/** Shared between the API server and the React app. */

export type AccountRole = 'admin' | 'staff';
export type StaffRole = 'owner' | 'manager' | 'waiter' | 'chef' | 'cashier' | 'host';
export type RestaurantStatus = 'pending' | 'approved' | 'rejected' | 'suspended';

export const STAFF_ROLES: StaffRole[] = ['owner', 'manager', 'cashier', 'host', 'waiter', 'chef'];

/** Roles a manager may hand out. Only owners can create or change owners and managers. */
export const MANAGER_ASSIGNABLE_ROLES: StaffRole[] = ['cashier', 'host', 'waiter', 'chef'];

export interface Account {
  id: string;
  username: string;
  email: string;
  name: string;
  phone: string;
  role: AccountRole;
}

export interface RestaurantMembership {
  restaurantId: string;
  restaurantName: string;
  restaurantStatus: RestaurantStatus;
  statusReason: string;
  role: StaffRole;
}

export interface Session {
  account: Account;
  memberships: RestaurantMembership[];
}

export interface Restaurant {
  id: string;
  name: string;
  phone: string;
  address: string;
  area: string;
  city: string;
  cuisine: string;
  tradeLicenceNo: string;
  vatBin: string;
  status: RestaurantStatus;
  statusReason: string;
  createdAt: string;
  statusChangedAt: string;
}

export interface RestaurantSummary extends Restaurant {
  ownerName: string;
  ownerEmail: string;
  staffCount: number;
}

export interface RestaurantStatusChange {
  id: number;
  restaurantId: string;
  restaurantName: string;
  oldStatus: RestaurantStatus | null;
  newStatus: RestaurantStatus;
  reason: string;
  changedByName: string | null;
  changedAt: string;
}

export interface StaffMember {
  userId: string;
  username: string;
  email: string;
  name: string;
  phone: string;
  role: StaffRole;
  active: boolean;
  joinedAt: string;
}

export interface PlatformStats {
  pending: number;
  approved: number;
  suspended: number;
  rejected: number;
  activeStaff: number;
}

export interface RestaurantApplication {
  ownerName: string;
  ownerEmail: string;
  ownerPhone: string;
  username?: string;
  password: string;
  restaurantName: string;
  restaurantPhone: string;
  address: string;
  area: string;
  city: string;
  cuisine?: string;
  tradeLicenceNo?: string;
  vatBin?: string;
}

export interface NewStaffMember {
  name: string;
  email: string;
  phone?: string;
  username?: string;
  password?: string;
  role: StaffRole;
}
