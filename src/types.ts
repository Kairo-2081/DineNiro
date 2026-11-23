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
export type TableState = 'free' | 'reserved' | 'seated' | 'cooking' | 'ready' | 'served' | 'bill';
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
  /** The table's next upcoming booking in the next 12 hours, if any. */
  nextBooking: { id: string; startsAt: string; guestName: string; partySize: number } | null;
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
  /** How many more portions recorded stock allows; null when the dish has no recipe. */
  portionsLeft: number | null;
  /** Ingredient cost of one portion at current prices; null when the dish has no recipe. */
  foodCost: number | null;
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

// Reservations and the waitlist.

export type ReservationStatus = 'booked' | 'seated' | 'completed' | 'cancelled' | 'no_show';

export interface Reservation {
  id: string;
  tableId: string;
  tableLabel: string;
  guestName: string;
  phone: string;
  partySize: number;
  startsAt: string;
  endsAt: string;
  status: ReservationStatus;
  note: string;
  orderId: string | null;
  createdByName: string | null;
}

export interface NewReservation {
  tableId: string;
  guestName: string;
  phone?: string;
  partySize: number;
  startsAt: string;
  durationMinutes: number;
  note?: string;
}

export interface AvailableTable {
  tableId: string;
  label: string;
  seats: number;
  section: string;
}

export interface WaitlistEntry {
  id: string;
  guestName: string;
  phone: string;
  partySize: number;
  quotedMinutes: number;
  note: string;
  addedAt: string;
}

// Inventory.

export type StockUnit = 'kg' | 'g' | 'l' | 'ml' | 'pc';
export const STOCK_UNITS: StockUnit[] = ['kg', 'g', 'l', 'ml', 'pc'];
export type StockReason = 'sale' | 'void' | 'delivery' | 'count' | 'waste';

export interface Ingredient {
  id: string;
  name: string;
  category: string;
  unit: StockUnit;
  onHand: number;
  parLevel: number;
  unitCost: number;
  supplier: string;
  active: boolean;
  usedToday: number;
  usedPerDay: number;
  /** Number of dishes whose recipe uses it. */
  dishes: number;
}

export interface StockMovement {
  id: number;
  change: number;
  reason: StockReason;
  note: string;
  dish: string | null;
  tableLabel: string | null;
  recordedByName: string | null;
  createdAt: string;
}

export interface RecipeLine {
  ingredientId: string;
  name: string;
  unit: StockUnit;
  quantity: number;
  unitCost: number;
}
