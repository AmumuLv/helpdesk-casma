from collections import defaultdict
from datetime import datetime, timedelta

import numpy as np
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.metrics import roc_auc_score

from app.ai.rows import PHYSICAL_CATEGORIES, EquipmentRow, TicketRow

FEATURES = [
    "age_years", "inc_30", "inc_90", "inc_365", "days_since_last", "physical_365",
    "distinct_categories_365", "avg_resolution_hours", "model_failure_rate", "is_printer", "is_computer", "criticality",
]
HORIZON_DAYS = 30


def group_by_equipment(tickets: list[TicketRow]) -> dict[str, list[TicketRow]]:
    grouped: dict[str, list[TicketRow]] = defaultdict(list)
    for t in tickets:
        if t.equipment_id:
            grouped[t.equipment_id].append(t)
    return grouped


def model_failure_rates(equipment: list[EquipmentRow], by_eq: dict[str, list[TicketRow]], ref: datetime) -> dict[tuple, float]:
    units: dict[tuple, int] = defaultdict(int)
    failures: dict[tuple, int] = defaultdict(int)
    since = ref - timedelta(days=365)
    for eq in equipment:
        key = ((eq.brand or "").lower(), (eq.model or "").lower())
        if key == ("", ""):
            continue
        units[key] += 1
        failures[key] += sum(1 for t in by_eq.get(eq.id, []) if since < t.created_at <= ref and t.category in PHYSICAL_CATEGORIES)
    return {k: failures[k] / units[k] for k in units if units[k] >= 2}


def feature_vector(eq: EquipmentRow, history: list[TicketRow], rates: dict[tuple, float], ref: datetime) -> list[float]:
    past = [t for t in history if t.created_at <= ref]
    def within(days):
        return [t for t in past if t.created_at > ref - timedelta(days=days)]
    last_365 = within(365)
    resolved = [(t.resolved_at - t.created_at).total_seconds() / 3600 for t in last_365 if t.resolved_at and t.resolved_at <= ref]
    age = (ref - eq.acquired_on).days / 365.25 if eq.acquired_on and eq.acquired_on <= ref else 3.0
    last = max((t.created_at for t in past), default=None)
    return [
        round(age, 2),
        len(within(30)),
        len(within(90)),
        len(last_365),
        min((ref - last).days, 365) if last else 365,
        sum(1 for t in last_365 if t.category in PHYSICAL_CATEGORIES),
        len({t.category for t in last_365}),
        float(np.median(resolved)) if resolved else 0.0,
        rates.get(((eq.brand or "").lower(), (eq.model or "").lower()), 0.0),
        1.0 if eq.type == "IMPRESORA" else 0.0,
        1.0 if eq.type in ("PC", "LAPTOP") else 0.0,
        float(eq.criticality),
    ]


def heuristic_probability(f: list[float]) -> float:
    v = dict(zip(FEATURES, f))
    z = (
        -3.0 + 0.8 * min(v["inc_30"], 3) + 0.3 * min(v["inc_90"], 5) + 0.55 * np.log1p(v["physical_365"])
        + 0.2 * min(max(v["age_years"] - 4, 0), 5) + 0.5 * min(v["model_failure_rate"], 2) + 0.2 * (v["criticality"] - 1)
    )
    return float(min(0.95, 1 / (1 + np.exp(-z))))


def explain(f: list[float]) -> list[str]:
    v = dict(zip(FEATURES, f))
    out = []
    if v["inc_90"] >= 2:
        out.append(f"{int(v['inc_90'])} incidencias en los últimos 90 días")
    if v["physical_365"] >= 2:
        out.append(f"{int(v['physical_365'])} fallas físicas en el último año")
    if v["age_years"] >= 5:
        out.append(f"Antigüedad de {v['age_years']:.0f} años")
    if v["model_failure_rate"] >= 1:
        out.append("Su marca y modelo fallan con frecuencia en la municipalidad")
    if v["inc_365"] >= 3 and v["inc_90"] < 2:
        out.append(f"{int(v['inc_365'])} incidencias en el último año")
    if v["criticality"] >= 2:
        out.append("Equipo crítico para la atención")
    if v["days_since_last"] <= 7:
        out.append("Tuvo una incidencia esta semana")
    return out


class RiskModel:
    """Mantenimiento predictivo: probabilidad de que un equipo presente una incidencia en los próximos 30 días."""

    def __init__(self):
        self.mode = "heuristic"
        self.model: HistGradientBoostingClassifier | None = None

    def fit(self, equipment: list[EquipmentRow], tickets: list[TicketRow], now: datetime) -> dict:
        by_eq = group_by_equipment(tickets)
        X, y, snap = [], [], []
        for i in range(1, 19):
            ref = now - timedelta(days=HORIZON_DAYS * i)
            rates = model_failure_rates(equipment, by_eq, ref)
            for eq in equipment:
                if eq.acquired_on and eq.acquired_on > ref:
                    continue
                hist = by_eq.get(eq.id, [])
                X.append(feature_vector(eq, hist, rates, ref))
                y.append(int(any(ref < t.created_at <= ref + timedelta(days=HORIZON_DAYS) for t in hist)))
                snap.append(i)
        metrics = {"snapshots": len(y), "positives": int(sum(y))}
        if not y:
            return metrics | {"mode": self.mode}
        Xa, ya, sa = np.asarray(X), np.asarray(y), np.asarray(snap)
        train, test = sa > 3, sa <= 3
        pos = int(ya[train].sum())
        if train.sum() >= 80 and pos >= 10 and (train.sum() - pos) >= 10:
            model = HistGradientBoostingClassifier(max_depth=3, learning_rate=0.08, max_iter=250, random_state=7)
            model.fit(Xa[train], ya[train])
            auc = None
            if test.any() and len(set(ya[test])) == 2:
                auc = round(float(roc_auc_score(ya[test], model.predict_proba(Xa[test])[:, 1])), 4)
                metrics["roc_auc_holdout"] = auc
            if auc is not None and auc >= 0.65:
                model.fit(Xa, ya)
                self.model, self.mode = model, "gradient_boosting"
            else:
                self.model, self.mode = None, "heuristic"
                metrics["note"] = "Modelo aprendido descartado por baja precisión en validación temporal; se usa el modelo experto."
        else:
            self.model, self.mode = None, "heuristic"
        return metrics | {"mode": self.mode}

    def score(self, eq: EquipmentRow, history: list[TicketRow], rates: dict[tuple, float], now: datetime) -> tuple[float, list[str]]:
        f = feature_vector(eq, history, rates, now)
        if self.model is not None:
            prob = float(self.model.predict_proba(np.asarray([f]))[0, 1])
        else:
            prob = heuristic_probability(f)
        return round(prob, 3), explain(f)
