import React from 'react';
import { api } from '../../lib/api';
import type { Restaurant, RestaurantMembership, Session, StaffRole } from '../../types';

export type Screen =
  | { name: 'floor' }
  | { name: 'order'; orderId: string }
  | { name: 'kitchen' }
  | { name: 'bills'; billId?: string }
  | { name: 'bookings' }
  | { name: 'stock' }
  | { name: 'reports' }
  | { name: 'setup' }
  | { name: 'team' };

export type ScreenName = Screen['name'];

/** Which side-menu screens each role sees. The API enforces the same rules; this only hides what would be refused. */
export const SCREENS_FOR_ROLE: Record<StaffRole, ScreenName[]> = {
  owner: ['floor', 'bookings', 'kitchen', 'bills', 'stock', 'reports', 'setup', 'team'],
  manager: ['floor', 'bookings', 'kitchen', 'bills', 'stock', 'reports', 'setup', 'team'],
  waiter: ['floor', 'bookings', 'kitchen', 'bills'],
  host: ['floor', 'bookings'],
  cashier: ['floor', 'bookings', 'bills'],
  chef: ['kitchen', 'stock'],
};

export function homeScreen(role: StaffRole): Screen {
  if (role === 'chef') return { name: 'kitchen' };
  if (role === 'cashier') return { name: 'bills' };
  return { name: 'floor' };
}

export const can = {
  order: (role: StaffRole) => ['owner', 'manager', 'waiter'].includes(role),
  seat: (role: StaffRole) => ['owner', 'manager', 'waiter', 'host'].includes(role),
  supervise: (role: StaffRole) => role === 'owner' || role === 'manager',
  bill: (role: StaffRole) => ['owner', 'manager', 'cashier', 'waiter'].includes(role),
  takePayment: (role: StaffRole) => ['owner', 'manager', 'cashier'].includes(role),
  cook: (role: StaffRole) => ['owner', 'manager', 'chef'].includes(role),
  book: (role: StaffRole) => ['owner', 'manager', 'host', 'waiter'].includes(role),
};

interface WorkspaceValue {
  session: Session;
  membership: RestaurantMembership;
  role: StaffRole;
  restaurant: Restaurant;
  setRestaurant: (restaurant: Restaurant) => void;
  calls: ReturnType<typeof api.at>;
  screen: Screen;
  go: (screen: Screen) => void;
  /** Where to go once a table is seated: the order for those who take orders, the floor for hosts. */
  afterSeating: (orderId: string) => void;
  switchRestaurant: (restaurantId: string) => void;
}

export const WorkspaceContext = React.createContext<WorkspaceValue | undefined>(undefined);

export function useWorkspace(): WorkspaceValue {
  const value = React.useContext(WorkspaceContext);
  if (!value) throw new Error('useWorkspace must be used inside a restaurant workspace');
  return value;
}
