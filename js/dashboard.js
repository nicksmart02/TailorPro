// =============================================================
// TAILORFLOW — Tableau de bord (KPI réels)
// =============================================================
import { supabase } from "./supabaseClient.js";
import { requireAuth } from "./auth.js";
import { renderNav } from "./nav.js";
import { formatMoney } from "./utils.js";

init();

async function init() {
  const profile = await requireAuth();
  if (!profile) return;
  renderNav(profile, "dashboard");
  await loadKpis();
}

async function loadKpis() {
  const today = new Date().toISOString().slice(0, 10);
  const firstOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();

  // Commandes en cours (pending + in_progress + ready)
  const { count: inProgressCount } = await supabase
    .from("orders")
    .select("id", { count: "exact", head: true })
    .in("status", ["pending", "in_progress", "ready"]);

  // Commandes en retard
  const { count: lateCount } = await supabase
    .from("orders")
    .select("id", { count: "exact", head: true })
    .lt("due_date", today)
    .in("status", ["pending", "in_progress", "ready"]);

  // Chiffre d'affaires du mois (factures émises ce mois-ci)
  const { data: invoicesThisMonth } = await supabase
    .from("invoices")
    .select("amount_total")
    .gte("issued_at", firstOfMonth);

  const revenue = (invoicesThisMonth || []).reduce((sum, inv) => sum + Number(inv.amount_total), 0);

  // Factures impayées ou partielles
  const { count: unpaidCount } = await supabase
    .from("invoices")
    .select("id", { count: "exact", head: true })
    .in("status", ["unpaid", "partial"]);

  document.getElementById("kpi-in-progress").textContent = inProgressCount ?? "—";
  document.getElementById("kpi-late").textContent = lateCount ?? "—";
  document.getElementById("kpi-revenue").textContent = formatMoney(revenue);
  document.getElementById("kpi-unpaid").textContent = unpaidCount ?? "—";
}
