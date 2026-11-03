import { BrowserRouter, NavLink, Route, Routes } from "react-router-dom";
import { SummaryPage } from "./pages/SummaryPage";
import { ProjectsPage } from "./pages/ProjectsPage";
import { TransactionsPage } from "./pages/TransactionsPage";
import { TransactionDetailPage } from "./pages/TransactionDetailPage";
import { WebhooksPage } from "./pages/WebhooksPage";

const links = [
  { to: "/", label: "Ringkasan", end: true },
  { to: "/projects", label: "Project" },
  { to: "/transactions", label: "Transaksi" },
  { to: "/webhooks", label: "Webhook gagal" },
];

export default function App() {
  return (
    <BrowserRouter>
      <div className="app">
        <header className="topbar">
          <div>
            <h1>Gapura Admin</h1>
            <p className="muted">Kelola project, transaksi, dan pengiriman webhook.</p>
          </div>
          <nav className="nav">
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
          </nav>
        </header>

        <main className="content">
          <Routes>
            <Route path="/" element={<SummaryPage />} />
            <Route path="/projects" element={<ProjectsPage />} />
            <Route path="/transactions" element={<TransactionsPage />} />
            <Route path="/transactions/:merchantOrderId" element={<TransactionDetailPage />} />
            <Route path="/webhooks" element={<WebhooksPage />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}
