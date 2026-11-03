import { useState } from "react";
import { BrowserRouter, NavLink, Route, Routes } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { getAdminToken, getApiEnvironment, setAdminToken, setApiEnvironment, type ApiEnvironment } from "./api";
import { LoginPage } from "./pages/LoginPage";
import { SummaryPage } from "./pages/SummaryPage";
import { ProjectsPage } from "./pages/ProjectsPage";
import { TransactionsPage } from "./pages/TransactionsPage";
import { TransactionDetailPage } from "./pages/TransactionDetailPage";
import { WebhooksPage } from "./pages/WebhooksPage";
import { DocsPage } from "./pages/DocsPage";
import { SettingsPage } from "./pages/SettingsPage";
import { AuditPage } from "./pages/AuditPage";

const links = [
  { to: "/", label: "Ringkasan", end: true },
  { to: "/projects", label: "Project" },
  { to: "/transactions", label: "Transaksi" },
  { to: "/webhooks", label: "Webhook gagal" },
  { to: "/settings", label: "Pengaturan" },
  { to: "/audit", label: "Audit" },
  { to: "/docs", label: "Dokumentasi" },
];

export default function App() {
  const queryClient = useQueryClient();
  const [token, setToken] = useState(() => getAdminToken());
  const [environment, setEnvironment] = useState<ApiEnvironment>(() => getApiEnvironment());

  if (!token) {
    return (
      <LoginPage
        onLogin={(value) => {
          setAdminToken(value);
          setToken(value);
        }}
      />
    );
  }

  function logout() {
    setAdminToken("");
    setToken("");
  }

  return (
    <BrowserRouter>
      <div className="app">
        <header className="topbar">
          <div>
            <h1>Gapura Admin</h1>
            <p className="muted">Kelola project, transaksi, dan pengiriman webhook.</p>
          </div>
          <div className="nav">
            {links.map((link) => (
              <NavLink
                key={link.to}
                to={link.to}
                end={link.end}
                className={({ isActive }) => (isActive ? "nav-link active" : "nav-link")}
              >
                {link.label}
              </NavLink>
            ))}
            <label className="env-select">
              Env
              <select
                value={environment}
                onChange={(event) => {
                  const next = event.target.value as ApiEnvironment;
                  setApiEnvironment(next);
                  setEnvironment(next);
                  queryClient.clear();
                }}
              >
                <option value="sandbox">sandbox</option>
                <option value="production">production</option>
              </select>
            </label>
            <button type="button" className="ghost" onClick={logout}>
              Keluar
            </button>
          </div>
        </header>

        <main className="content">
          <Routes>
            <Route path="/" element={<SummaryPage />} />
            <Route path="/projects" element={<ProjectsPage />} />
            <Route path="/transactions" element={<TransactionsPage />} />
            <Route path="/transactions/:merchantOrderId" element={<TransactionDetailPage />} />
            <Route path="/webhooks" element={<WebhooksPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/audit" element={<AuditPage />} />
            <Route path="/docs" element={<DocsPage />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}
