import type {
  NewStaffMember, PlatformStats, Restaurant, RestaurantApplication, RestaurantStatus, RestaurantStatusChange,
  RestaurantSummary, Session, StaffMember, StaffRole,
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
};
