import { AuthProvider, useAuth } from './contexts/AuthContext';
import { Landing } from './components/Landing';
import { AdminConsole } from './components/admin/AdminConsole';
import { RestaurantWorkspace } from './components/restaurant/RestaurantWorkspace';
import { BrandSeal } from './components/brand';

function Screens() {
  const { session, isLoading } = useAuth();
  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center" aria-busy="true">
        <BrandSeal size={200} animate />
      </div>
    );
  }
  if (!session) return <Landing />;
  if (session.account.role === 'admin') return <AdminConsole />;
  // Keyed by account so switching users never shows the previous person's restaurant.
  return <RestaurantWorkspace key={session.account.id} />;
}

export default function App() {
  return (
    <AuthProvider>
      <Screens />
    </AuthProvider>
  );
}
