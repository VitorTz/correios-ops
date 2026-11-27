"use client";

import { useEffect, useState } from "react";

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
}

interface AppSettingsDto {
  depotName: string;
  depotCep: string;
  depotLat: number;
  depotLng: number;
  walkRadiusMeters: number;
  kmPerLiter: string;
  ratePerPackageBrl: string;
  fuelPriceBrl: string;
}

export function SettingsModal({ open, onClose }: SettingsModalProps) {
  const [form, setForm] = useState<AppSettingsDto | null>(null);
  const [saving, setSaving] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setStatusMsg(null);
    fetch("/api/settings")
      .then((r) => r.json())
      .then((data: { settings?: AppSettingsDto }) => {
        if (data.settings) setForm(data.settings);
      });
  }, [open]);

  if (!open) return null;

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!form) return;
    setSaving(true);
    setStatusMsg(null);
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          depotName: form.depotName,
          depotCep: form.depotCep,
          depotLat: Number(form.depotLat),
          depotLng: Number(form.depotLng),
          walkRadiusMeters: Number(form.walkRadiusMeters),
          kmPerLiter: Number.parseFloat(form.kmPerLiter),
          ratePerPackageBrl: Number.parseFloat(form.ratePerPackageBrl),
          fuelPriceBrl: Number.parseFloat(form.fuelPriceBrl),
        }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setStatusMsg(data.error ?? "Erro ao salvar configuracoes.");
        return;
      }
      setStatusMsg("Parametros salvos. Novas rotas usarao estes valores.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15, 23, 42, 0.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
        zIndex: 50,
      }}
    >
      <div
        className="panel"
        style={{ width: "100%", maxWidth: 540, marginTop: 0 }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <h2 style={{ margin: 0 }}>Parametros Globais (Novas Rotas)</h2>
          <button type="button" className="tab-btn" onClick={onClose}>
            Fechar
          </button>
        </div>

        {!form ? (
          <p className="subtitle" style={{ marginTop: 12 }}>
            Carregando...
          </p>
        ) : (
          <form
            onSubmit={handleSave}
            style={{ display: "grid", gap: 12, marginTop: 16 }}
          >
            <label>
              <span className="subtitle">Nome da Base (Partida/Retorno)</span>
              <input
                type="text"
                value={form.depotName}
                onChange={(e) => setForm({ ...form, depotName: e.target.value })}
                style={{ width: "100%", padding: 8, borderRadius: 8, border: "1px solid var(--border)" }}
              />
            </label>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
              <label>
                <span className="subtitle">CEP Base</span>
                <input
                  type="text"
                  value={form.depotCep}
                  onChange={(e) => setForm({ ...form, depotCep: e.target.value })}
                  style={{ width: "100%", padding: 8, borderRadius: 8, border: "1px solid var(--border)" }}
                />
              </label>
              <label>
                <span className="subtitle">Latitude</span>
                <input
                  type="number"
                  step="any"
                  value={form.depotLat}
                  onChange={(e) =>
                    setForm({ ...form, depotLat: Number(e.target.value) })
                  }
                  style={{ width: "100%", padding: 8, borderRadius: 8, border: "1px solid var(--border)" }}
                />
              </label>
              <label>
                <span className="subtitle">Longitude</span>
                <input
                  type="number"
                  step="any"
                  value={form.depotLng}
                  onChange={(e) =>
                    setForm({ ...form, depotLng: Number(e.target.value) })
                  }
                  style={{ width: "100%", padding: 8, borderRadius: 8, border: "1px solid var(--border)" }}
                />
              </label>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <label>
                <span className="subtitle">Raio Adjacente a pe (m)</span>
                <input
                  type="number"
                  min={20}
                  max={1000}
                  value={form.walkRadiusMeters}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      walkRadiusMeters: Number(e.target.value),
                    })
                  }
                  style={{ width: "100%", padding: 8, borderRadius: 8, border: "1px solid var(--border)" }}
                />
              </label>
              <label>
                <span className="subtitle">Consumo (km/L)</span>
                <input
                  type="number"
                  step="0.1"
                  value={form.kmPerLiter}
                  onChange={(e) =>
                    setForm({ ...form, kmPerLiter: e.target.value })
                  }
                  style={{ width: "100%", padding: 8, borderRadius: 8, border: "1px solid var(--border)" }}
                />
              </label>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <label>
                <span className="subtitle">Ganho por entrega (R$)</span>
                <input
                  type="number"
                  step="0.01"
                  value={form.ratePerPackageBrl}
                  onChange={(e) =>
                    setForm({ ...form, ratePerPackageBrl: e.target.value })
                  }
                  style={{ width: "100%", padding: 8, borderRadius: 8, border: "1px solid var(--border)" }}
                />
              </label>
              <label>
                <span className="subtitle">Preco combustivel (R$/L)</span>
                <input
                  type="number"
                  step="0.01"
                  value={form.fuelPriceBrl}
                  onChange={(e) =>
                    setForm({ ...form, fuelPriceBrl: e.target.value })
                  }
                  style={{ width: "100%", padding: 8, borderRadius: 8, border: "1px solid var(--border)" }}
                />
              </label>
            </div>

            {statusMsg && (
              <div style={{ fontSize: 13, fontWeight: 600, color: "var(--teal)" }}>
                {statusMsg}
              </div>
            )}

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button type="button" className="tab-btn" onClick={onClose}>
                Cancelar
              </button>
              <button type="submit" className="btn-primary" disabled={saving}>
                {saving ? "Salvando..." : "Salvar Parametros"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
