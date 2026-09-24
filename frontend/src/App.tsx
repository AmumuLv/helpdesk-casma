import { createBrowserRouter, Navigate, Outlet, useLocation } from "react-router";
import { Spinner } from "./components/ui";
import { useMe } from "./lib/session";
import { ChangePassword } from "./features/auth/ChangePassword";
import { DevicePending } from "./features/auth/DevicePending";
import { OfficeLogin } from "./features/auth/OfficeLogin";
import { StaffLogin } from "./features/auth/StaffLogin";
import { OfficeHome } from "./features/office/OfficeHome";
import { OfficeLayout } from "./features/office/OfficeLayout";
import { ReportFlow } from "./features/office/ReportFlow";
import { TicketStatusPage } from "./features/office/TicketStatusPage";
import { AIInsightsPage } from "./features/staff/AIInsightsPage";
import { AuditPage } from "./features/staff/AuditPage";
import { Dashboard } from "./features/staff/Dashboard";
import { DevicesPage } from "./features/staff/DevicesPage";
import { EquipmentPage } from "./features/staff/EquipmentPage";
import { OfficesPage } from "./features/staff/OfficesPage";
import { OrganizationPage } from "./features/staff/OrganizationPage";
import { StaffLayout } from "./features/staff/StaffLayout";
import { StaffPage } from "./features/staff/StaffPage";

function Entry() {
  const { data: me, isLoading } = useMe();
  if (isLoading) return <Spinner />;
  if (me?.kind === "staff") return <Navigate to="/soporte" replace />;
  if (me?.kind === "office") return <Navigate to={me.office?.device_status === "APROBADO" ? "/oficina" : "/esperando"} replace />;
  return <Navigate to="/ingresar" replace />;
}

function RequireOffice() {
  const { data: me, isLoading } = useMe();
  const location = useLocation();
  if (isLoading) return <Spinner />;
  if (me?.kind !== "office") return <Navigate to={`/ingresar?volver=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  if (me.office?.device_status !== "APROBADO") return <Navigate to="/esperando" replace />;
  return <Outlet />;
}

function RequireStaff({ admin }: { admin?: boolean }) {
  const { data: me, isLoading } = useMe();
  if (isLoading) return <Spinner />;
  if (me?.kind !== "staff" || !me.staff) return <Navigate to="/soporte/ingresar" replace />;
  if (me.staff.must_change_password) return <Navigate to="/soporte/clave" replace />;
  if (admin && me.staff.role !== "ADMIN") return <Navigate to="/soporte" replace />;
  return <Outlet />;
}

export const router = createBrowserRouter([
  { path: "/", element: <Entry /> },
  { path: "/ingresar", element: <OfficeLogin /> },
  { path: "/esperando", element: <DevicePending /> },
  { path: "/soporte/ingresar", element: <StaffLogin /> },
  { path: "/soporte/clave", element: <ChangePassword /> },
  {
    element: <RequireOffice />,
    children: [
      {
        element: <OfficeLayout />,
        children: [
          { path: "/oficina", element: <OfficeHome /> },
          { path: "/oficina/reportar/:issue", element: <ReportFlow /> },
          { path: "/reportar", element: <ReportFlow /> },
          { path: "/oficina/reporte/:id", element: <TicketStatusPage /> },
        ],
      },
    ],
  },
  {
    element: <RequireStaff />,
    children: [
      {
        element: <StaffLayout />,
        children: [
          { path: "/soporte", element: <Dashboard /> },
          { path: "/soporte/equipos", element: <EquipmentPage /> },
          { path: "/soporte/ia", element: <AIInsightsPage /> },
          {
            element: <RequireStaff admin />,
            children: [
              { path: "/soporte/dispositivos", element: <DevicesPage /> },
              { path: "/soporte/oficinas", element: <OfficesPage /> },
              { path: "/soporte/organizacion", element: <OrganizationPage /> },
              { path: "/soporte/personal", element: <StaffPage /> },
              { path: "/soporte/auditoria", element: <AuditPage /> },
            ],
          },
        ],
      },
    ],
  },
  { path: "*", element: <Navigate to="/" replace /> },
]);
