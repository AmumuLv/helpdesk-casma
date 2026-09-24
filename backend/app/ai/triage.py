from collections import Counter
from dataclasses import dataclass, field
from datetime import datetime, timedelta

import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import StratifiedKFold, cross_val_score

from app.ai.taxonomy import CATEGORY_BASE_PRIORITY, LOW_TERMS, URGENT_TERMS
from app.ai.text import contains_term, normalize
from app.models.enums import TicketCategory, TicketPriority


@dataclass
class CategoryPrediction:
    category: TicketCategory
    confidence: float
    ranking: list[tuple[str, float]]


@dataclass
class EquipmentHistorySummary:
    total_365d: int
    incidents_90d: int
    incidents_30d: int
    resolved: int
    top_category: str | None
    recurrence_level: str
    note: str


def summarize_equipment_history(history: list, now: datetime) -> EquipmentHistorySummary:
    """Resume señales históricas del equipo sin depender de un modelo generativo."""
    recent = [item for item in history if item.created_at >= now - timedelta(days=365)]
    last_90 = [item for item in recent if item.created_at >= now - timedelta(days=90)]
    last_30 = [item for item in recent if item.created_at >= now - timedelta(days=30)]
    resolved = [item for item in recent if item.status == "RESUELTO"]

    categories = Counter(item.category for item in recent if item.category)
    top_category = categories.most_common(1)[0][0] if categories else None

    if len(last_90) >= 4 or (top_category and categories[top_category] >= 4):
        recurrence_level = "ALTA"
    elif len(last_90) >= 2 or (top_category and categories[top_category] >= 2):
        recurrence_level = "MEDIA"
    else:
        recurrence_level = "BAJA"

    if not recent:
        note = (
            "Contexto histórico predictivo: no hay incidencias previas registradas "
            "para este equipo en los últimos 365 días."
        )
        return EquipmentHistorySummary(0, 0, 0, 0, None, "BAJA", note)

    category_label = None
    if top_category:
        try:
            category_label = top_category.replace("_", " ").title()
        except AttributeError:
            category_label = str(top_category)

    latest_resolution = next(
        (item.resolution_notes.strip() for item in reversed(recent) if item.resolution_notes and item.resolution_notes.strip()),
        None,
    )
    resolution_text = f" Última solución registrada: {latest_resolution[:220]}." if latest_resolution else ""
    trend_text = (
        " Se observa actividad reciente elevada."
        if len(last_30) >= 2
        else " No se observa un aumento fuerte de incidencias en los últimos 30 días."
    )
    category_text = f" La categoría más frecuente es {category_label}." if category_label else ""

    note = (
        "Contexto histórico predictivo: "
        f"{len(recent)} incidencia(s) en 365 días, {len(last_90)} en 90 días y {len(last_30)} en 30 días; "
        f"{len(resolved)} resuelta(s). Señal de recurrencia: {recurrence_level}."
        f"{category_text}{trend_text}{resolution_text}"
    )
    return EquipmentHistorySummary(
        total_365d=len(recent),
        incidents_90d=len(last_90),
        incidents_30d=len(last_30),
        resolved=len(resolved),
        top_category=top_category,
        recurrence_level=recurrence_level,
        note=note,
    )


class CategoryClassifier:
    def __init__(self, featurizer):
        self.featurizer = featurizer
        self.clf = LogisticRegression(C=6.0, max_iter=3000, class_weight="balanced")

    def fit(self, texts: list[str], labels: list[str], weights: list[float]) -> dict:
        X = self.featurizer.fit_transform(texts)
        y = np.asarray(labels)
        metrics: dict = {"classes": sorted(set(labels))}
        _, counts = np.unique(y, return_counts=True)
        folds = int(min(5, counts.min()))
        if folds >= 2 and len(counts) >= 2:
            cv = StratifiedKFold(n_splits=folds, shuffle=True, random_state=7)
            scores = cross_val_score(LogisticRegression(C=6.0, max_iter=3000, class_weight="balanced"), X, y, cv=cv, scoring="f1_macro")
            metrics["f1_macro_cv"] = round(float(scores.mean()), 4)
        self.clf.fit(X, y, sample_weight=np.asarray(weights))
        return metrics

    def vectorize(self, texts: list[str]):
        return self.featurizer.transform(texts)

    def predict(self, text: str) -> CategoryPrediction:
        probs = self.clf.predict_proba(self.featurizer.transform([text]))[0]
        order = np.argsort(probs)[::-1]
        ranking = [(str(self.clf.classes_[i]), float(probs[i])) for i in order[:3]]
        return CategoryPrediction(TicketCategory(ranking[0][0]), ranking[0][1], ranking)


class PriorityModel:
    """Aprende de las prioridades finales validadas por técnicos; se combina con reglas explicables."""

    _EXPECTED = {TicketPriority.BAJA.value: 0.2, TicketPriority.MEDIA.value: 0.55, TicketPriority.ALTA.value: 0.9}

    def __init__(self, featurizer):
        self.featurizer = featurizer
        self.clf = LogisticRegression(C=2.0, max_iter=3000, class_weight="balanced")

    def fit(self, texts: list[str], labels: list[str]) -> dict:
        X = self.featurizer.transform(texts)
        self.clf.fit(X, np.asarray(labels))
        return {"samples": len(labels)}

    def expected_score(self, text: str) -> float:
        probs = self.clf.predict_proba(self.featurizer.transform([text]))[0]
        return float(sum(self._EXPECTED[str(c)] * p for c, p in zip(self.clf.classes_, probs)))


@dataclass
class PriorityContext:
    text: str
    category: TicketCategory
    office_weight: float = 1.0
    equipment_criticality: int = 1
    equipment_incidents_90d: int = 0
    related_alert: bool = False
    reopened: bool = False


@dataclass
class PriorityResult:
    priority: TicketPriority
    score: float
    reasons: list[str] = field(default_factory=list)


def score_priority(ctx: PriorityContext, learned: PriorityModel | None = None) -> PriorityResult:
    norm = normalize(ctx.text)
    score = CATEGORY_BASE_PRIORITY.get(ctx.category, 0.3)
    reasons: list[str] = []

    hits = [t for t in URGENT_TERMS if contains_term(norm, t)]
    if hits:
        score += min(0.12 * len(hits), 0.3)
        reasons.append("Menciona: " + ", ".join(f"«{h}»" for h in hits[:3]))
    if any(contains_term(norm, t) for t in LOW_TERMS):
        score -= 0.1
        reasons.append("El usuario indica que no es urgente")
    if ctx.office_weight > 1.0:
        score += (ctx.office_weight - 1.0) * 0.3
        reasons.append("Oficina de atención crítica")
    if ctx.equipment_criticality > 1:
        score += (ctx.equipment_criticality - 1) * 0.08
        reasons.append("Equipo marcado como crítico")
    if ctx.equipment_incidents_90d >= 3:
        score += 0.08
        reasons.append(f"Falla recurrente: {ctx.equipment_incidents_90d} incidencias en 90 días")
    if ctx.related_alert:
        score += 0.1
        reasons.append("Coincide con una posible falla masiva activa")
    if ctx.reopened:
        score += 0.1
        reasons.append("El problema volvió a presentarse")

    if learned is not None:
        score = 0.6 * score + 0.4 * learned.expected_score(ctx.text)

    score = float(min(max(score, 0.0), 1.0))
    priority = TicketPriority.ALTA if score >= 0.7 else TicketPriority.MEDIA if score >= 0.4 else TicketPriority.BAJA
    return PriorityResult(priority, round(score, 3), reasons)
