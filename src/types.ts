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
  serviceChargePct: number;
  vatPct: number;
  receiptFooter: string;
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

// Service: tables, menu, orders, kitchen and billing.

export type TableShape = 'square' | 'round' | 'long';
export type Station = 'kitchen' | 'tandoor' | 'bar' | 'dessert';
export type TableState = 'free' | 'seated' | 'cooking' | 'ready' | 'served' | 'bill';
export type OrderStatus = 'open' | 'billed' | 'paid' | 'void';
export type TicketStatus = 'new' | 'cooking' | 'ready' | 'served';
export type PaymentMethod = 'cash' | 'card' | 'bkash' | 'nagad';

export const STATIONS: Station[] = ['kitchen', 'tandoor', 'bar', 'dessert'];
export const PAYMENT_METHODS: PaymentMethod[] = ['cash', 'card', 'bkash', 'nagad'];

export interface DiningTable {
  id: string;
  label: string;
  seats: number;
  section: string;
  shape: TableShape;
  sortOrder: number;
  active: boolean;
}

export interface FloorTable {
  tableId: string;
  label: string;
  seats: number;
  section: string;
  shape: TableShape;
  state: TableState;
  orderId: string | null;
  guests: number | null;
  openedAt: string | null;
  serverName: string | null;
  runningTotal: number;
  unsentItems: number;
}

export interface MenuOption {
  id: string;
  name: string;
  priceDelta: number;
}

export interface MenuItem {
  id: string;
  categoryId: string;
  name: string;
  description: string;
  price: number;
  station: Station;
  available: boolean;
  sortOrder: number;
  options: MenuOption[];
}

export interface MenuCategory {
  id: string;
  name: string;
  sortOrder: number;
  items: MenuItem[];
}

export interface OrderLine {
  id: string;
  menuItemId: string;
  name: string;
  unitPrice: number;
  quantity: number;
  options: string[];
  note: string;
  station: Station;
  status: 'draft' | 'sent' | 'void';
  ticketStatus: TicketStatus | null;
  voidReason: string;
}

export interface Order {
  id: string;
  tableId: string;
  tableLabel: string;
  guests: number;
  status: OrderStatus;
  openedAt: string;
  closedAt: string | null;
  serverName: string | null;
  billId: string | null;
  lines: OrderLine[];
}

export interface KitchenTicket {
  id: string;
  number: number;
  status: TicketStatus;
  orderId: string;
  tableLabel: string;
  serverName: string | null;
  sentAt: string;
  startedAt: string | null;
  readyAt: string | null;
  items: { id: string; name: string; quantity: number; options: string[]; note: string; station: Station; void: boolean }[];
}

export interface Payment {
  id: string;
  method: PaymentMethod;
  amount: number;
  tendered: number | null;
  reference: string;
  createdAt: string;
}

export interface Bill {
  id: string;
  orderId: string;
  number: number;
  subtotal: number;
  discount: number;
  serviceChargePct: number;
  serviceCharge: number;
  vatPct: number;
  vat: number;
  total: number;
  paid: number;
  status: 'open' | 'paid';
  createdAt: string;
  paidAt: string | null;
  tableLabel: string;
  guests: number;
  serverName: string | null;
  payments: Payment[];
}

/** A bill with everything needed to print it. */
export interface Receipt {
  bill: Bill;
  lines: OrderLine[];
  restaurant: Restaurant;
}

export interface BillSummary {
  id: string;
  number: number;
  tableLabel: string;
  total: number;
  paid: number;
  status: 'open' | 'paid';
  createdAt: string;
  paidAt: string | null;
  methods: string;
}
