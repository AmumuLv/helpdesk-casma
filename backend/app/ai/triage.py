from dataclasses import dataclass, field

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
