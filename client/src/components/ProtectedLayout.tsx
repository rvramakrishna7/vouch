import { Navigate, Outlet } from "react-router-dom";
import { useAuth, type Role } from "../auth/AuthContext.js";
import { Header } from "./Header.js";

export function getRoleHome(role?: Role): string {
  switch (role) {
    case "creator":
      return "/content";
    case "reviewer":
      return "/reviews";
    case "brand_manager":
      return "/brand-kit";
    default:
      return "/login";
  }
}

export function ProtectedLayout() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="text-sm font-medium text-slate-500">
          Loading session…
        </div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col">
      <Header />
      <main className="max-w-6xl w-full mx-auto p-6 flex-1">
        <Outlet />
      </main>
    </div>
  );
}
