"use client";

import { useState } from "react";
import { FinancialsTab } from "./FinancialsTab";
import { RoutesTab } from "./RoutesTab";
import { SettingsModal } from "./SettingsModal";

export function AppShell() {
  const [activeTab, setActiveTab] = useState<"rotas" | "financeiro">("rotas");
  const [settingsOpen, setSettingsOpen] = useState(false);

  return (
    <div className="shell">
      <header className="topbar">
        <div>
          <h1 className="brand-title">Correios Floripa Ops</h1>
          <p className="subtitle">
            CEE Av. Diomicio de Freitas, 1899 · CEPs 88010-000 a 88059-999 ·
            10 km/L · R$ 2,11/entrega
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <nav className="tabs" aria-label="Abas principais">
            <button
              type="button"
              className={`tab-btn ${activeTab === "rotas" ? "active" : ""}`}
              onClick={() => setActiveTab("rotas")}
            >
              Rotas
            </button>
            <button
              type="button"
              className={`tab-btn ${activeTab === "financeiro" ? "active" : ""}`}
              onClick={() => setActiveTab("financeiro")}
            >
              Financeiro
            </button>
          </nav>
          <button
            type="button"
            className="btn-outline"
            onClick={() => setSettingsOpen(true)}
          >
            Parametros
          </button>
        </div>
      </header>

      {activeTab === "rotas" ? <RoutesTab /> : <FinancialsTab />}

      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
      />
    </div>
  );
}
