import type {
  Bill, BillSummary, DiningTable, FloorTable, KitchenTicket, MenuCategory, MenuItem, NewStaffMember, Order, PaymentMethod,
  PlatformStats, Receipt, Restaurant, RestaurantApplication, RestaurantStatus, RestaurantStatusChange, RestaurantSummary,
  Session, StaffMember, StaffRole, Station, TableShape, TicketStatus, AvailableTable, NewReservation, Reservation, WaitlistEntry,
  Ingredient, RecipeLine, StockMovement, StockUnit,
} from '../types';

export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

/** Fired when the server says the session is gone, so the app can return to sign-in. */
export const UNAUTHORIZED_EVENT = 'dineniro:unauthorized';

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (response.status === 204) return undefined as T;
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 && path !== '/api/auth/login' && path !== '/api/auth/me') {
      window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
    }
    throw new ApiError(data?.error || `Request failed (HTTP ${response.status})`, response.status);
  }
  return data as T;
}

const enc = encodeURIComponent;

export const api = {
  async currentSession(): Promise<Session | null> {
    return (await request<{ session: Session | null }>('GET', '/api/auth/me')).session;
  },
  async login(identifier: string, password: string): Promise<Session> {
    return (await request<{ session: Session }>('POST', '/api/auth/login', { identifier, password })).session;
  },
  logout: () => request<void>('POST', '/api/auth/logout'),
  async apply(application: RestaurantApplication): Promise<Session> {
    return (await request<{ session: Session }>('POST', '/api/restaurants', application)).session;
  },

  restaurant: (restaurantId: string) =>
    request<{ restaurant: Restaurant; role: StaffRole }>('GET', `/api/restaurants/${enc(restaurantId)}`),
  staff: (restaurantId: string) => request<StaffMember[]>('GET', `/api/restaurants/${enc(restaurantId)}/staff`),
  addStaff: (restaurantId: string, member: NewStaffMember) =>
    request<{ member: StaffMember; createdAccount: boolean }>('POST', `/api/restaurants/${enc(restaurantId)}/staff`, member),
  updateStaff: (restaurantId: string, userId: string, change: { role?: StaffRole; active?: boolean }) =>
    request<StaffMember>('PATCH', `/api/restaurants/${enc(restaurantId)}/staff/${enc(userId)}`, change),
  removeStaff: (restaurantId: string, userId: string) =>
    request<void>('DELETE', `/api/restaurants/${enc(restaurantId)}/staff/${enc(userId)}`),

  platformStats: () => request<PlatformStats>('GET', '/api/admin/stats'),
  restaurants: (status?: RestaurantStatus) =>
    request<RestaurantSummary[]>('GET', `/api/admin/restaurants${status ? `?status=${status}` : ''}`),
  setRestaurantStatus: (id: string, status: RestaurantStatus, reason = '') =>
    request<Restaurant>('PUT', `/api/admin/restaurants/${enc(id)}/status`, { status, reason }),
  auditTrail: () => request<RestaurantStatusChange[]>('GET', '/api/admin/restaurants/audit'),

  /** Calls scoped to one restaurant. */
  at(restaurantId: string) {
    const r = (path: string) => `/api/restaurants/${enc(restaurantId)}${path}`;
    return {
      saveSettings: (settings: { serviceChargePct?: number; vatPct?: number; receiptFooter?: string }) =>
        request<Restaurant>('PATCH', r('/settings'), settings),
      tables: () => request<DiningTable[]>('GET', r('/tables')),
      saveTable: (table: { id?: string; label: string; seats: number; section?: string; shape?: TableShape; sortOrder?: number; active?: boolean }) =>
        table.id ? request<DiningTable>('PUT', r(`/tables/${enc(table.id)}`), table) : request<DiningTable>('POST', r('/tables'), table),
      menu: () => request<MenuCategory[]>('GET', r('/menu')),
      saveCategory: (category: { id?: string; name: string; sortOrder?: number }) =>
        category.id ? request('PUT', r(`/categories/${enc(category.id)}`), category) : request('POST', r('/categories'), category),
      deleteCategory: (id: string) => request<void>('DELETE', r(`/categories/${enc(id)}`)),
      saveMenuItem: (item: {
        id?: string; categoryId: string; name: string; description?: string; price: number; station?: Station; available?: boolean;
        options?: { name: string; priceDelta?: number }[];
      }) => (item.id ? request<MenuItem>('PUT', r(`/menu-items/${enc(item.id)}`), item) : request<MenuItem>('POST', r('/menu-items'), item)),

      floor: () => request<FloorTable[]>('GET', r('/floor')),
      seat: (tableId: string, guests: number) => request<Order>('POST', r('/orders'), { tableId, guests }),
      order: (orderId: string) => request<Order>('GET', r(`/orders/${enc(orderId)}`)),
      addItem: (orderId: string, line: { menuItemId: string; quantity: number; optionIds: string[]; note?: string }) =>
        request<Order>('POST', r(`/orders/${enc(orderId)}/items`), line),
      setQuantity: (orderId: string, lineId: string, quantity: number) =>
        request<Order>('PATCH', r(`/orders/${enc(orderId)}/items/${enc(lineId)}`), { quantity }),
      voidLine: (orderId: string, lineId: string, reason: string) =>
        request<Order>('POST', r(`/orders/${enc(orderId)}/items/${enc(lineId)}/void`), { reason }),
      send: (orderId: string) => request<Order>('POST', r(`/orders/${enc(orderId)}/send`)),
      cancelOrder: (orderId: string) => request<Order>('POST', r(`/orders/${enc(orderId)}/void`)),

      kitchen: () => request<{ tickets: KitchenTicket[]; serverTime: string }>('GET', r('/kitchen')),
      advance: (ticketId: string, from: TicketStatus) =>
        request<{ id: string; status: TicketStatus }>('POST', r(`/kitchen/${enc(ticketId)}/advance`), { from }),

      prepareBill: (orderId: string, discount = 0) => request<Bill>('POST', r(`/orders/${enc(orderId)}/bill`), { discount }),
      bills: () => request<BillSummary[]>('GET', r('/bills')),
      receipt: (billId: string) => request<Receipt>('GET', r(`/bills/${enc(billId)}`)),
      pay: (billId: string, payment: { method: PaymentMethod; amount: number; tendered?: number; reference?: string }) =>
        request<Bill>('POST', r(`/bills/${enc(billId)}/payments`), payment),

      reservations: (from: string, to: string) =>
        request<Reservation[]>('GET', r(`/reservations?from=${enc(from)}&to=${enc(to)}`)),
      availability: (startsAt: string, minutes: number, party: number, ignore?: string) =>
        request<AvailableTable[]>('GET', r(`/availability?startsAt=${enc(startsAt)}&minutes=${minutes}&party=${party}${ignore ? `&ignore=${enc(ignore)}` : ''}`)),
      book: (booking: NewReservation & { id?: string }) =>
        booking.id ? request<Reservation>('PUT', r(`/reservations/${enc(booking.id)}`), booking) : request<Reservation>('POST', r('/reservations'), booking),
      closeBooking: (id: string, status: 'cancelled' | 'no_show') => request<Reservation>('POST', r(`/reservations/${enc(id)}/close`), { status }),
      seatBooking: (id: string) => request<{ orderId: string }>('POST', r(`/reservations/${enc(id)}/seat`)),
      waitlist: () => request<WaitlistEntry[]>('GET', r('/waitlist')),
      addToWaitlist: (entry: { guestName: string; phone?: string; partySize: number; quotedMinutes?: number; note?: string }) =>
        request<WaitlistEntry>('POST', r('/waitlist'), entry),
      waitlistLeft: (id: string) => request<void>('POST', r(`/waitlist/${enc(id)}/left`)),
      seatFromWaitlist: (id: string, tableId: string) => request<{ orderId: string }>('POST', r(`/waitlist/${enc(id)}/seat`), { tableId }),

      ingredients: () => request<Ingredient[]>('GET', r('/ingredients')),
      saveIngredient: (ingredient: { id?: string; name: string; category?: string; unit: StockUnit; parLevel?: number; unitCost?: number; supplier?: string; active?: boolean }) =>
        ingredient.id ? request<Ingredient>('PUT', r(`/ingredients/${enc(ingredient.id)}`), ingredient) : request<Ingredient>('POST', r('/ingredients'), ingredient),
      recordStock: (ingredientId: string, change: { kind: 'delivery' | 'count' | 'waste'; quantity: number; unitCost?: number; note?: string }) =>
        request<Ingredient>('POST', r(`/ingredients/${enc(ingredientId)}/stock`), change),
      stockHistory: (ingredientId: string) => request<StockMovement[]>('GET', r(`/ingredients/${enc(ingredientId)}/history`)),
      recipe: (menuItemId: string) => request<RecipeLine[]>('GET', r(`/recipes/${enc(menuItemId)}`)),
      saveRecipe: (menuItemId: string, lines: { ingredientId: string; quantity: number }[]) =>
        request<RecipeLine[]>('PUT', r(`/recipes/${enc(menuItemId)}`), { lines }),
    };
  },
};
