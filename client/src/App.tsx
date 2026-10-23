import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./auth/AuthContext.js";
import { ProtectedLayout, getRoleHome } from "./components/ProtectedLayout.js";
import { LoginPage } from "./pages/LoginPage.js";
import { ContentPage } from "./pages/ContentPage.js";
import { NewContentPage } from "./pages/NewContentPage.js";
import { ContentDetailPage } from "./pages/ContentDetailPage.js";
import { ReviewsPage } from "./pages/ReviewsPage.js";
import { BrandKitPage } from "./pages/BrandKitPage.js";
import { AuditPage } from "./pages/AuditPage.js";

function CatchAllRedirect() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="text-sm font-medium text-slate-500">Loading…</div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return <Navigate to={getRoleHome(user.role)} replace />;
}

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route element={<ProtectedLayout />}>
            <Route path="/content" element={<ContentPage />} />
            <Route path="/content/new" element={<NewContentPage />} />
            <Route path="/content/:id" element={<ContentDetailPage />} />
            <Route path="/reviews" element={<ReviewsPage />} />
            <Route path="/brand-kit" element={<BrandKitPage />} />
            <Route path="/audit" element={<AuditPage />} />
          </Route>
          <Route path="*" element={<CatchAllRedirect />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
