from collections import Counter
from dataclasses import dataclass, field
from datetime import datetime, timedelta

import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import StratifiedKFold, cross_val_score

from app.ai.taxonomy import CATEGORY_BASE_PRIORITY, CATEGORY_LABELS, LOW_TERMS, URGENT_TERMS
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
    patterns: list[str] = field(default_factory=list)
    recommendations: list[str] = field(default_factory=list)
    evidence: list[str] = field(default_factory=list)
    note: str = ""


_HISTORY_SIGNALS = {
    "ALMACENAMIENTO": {
        "terms": (
            "disco", "ssd", "hdd", "almacenamiento", "lectura", "escritura", "smart",
            "lento", "lenta", "lentitud", "congela", "congelado", "arranque lento",
        ),
        "pattern": "Se repiten síntomas compatibles con almacenamiento o degradación de rendimiento.",
        "recommendation": "Revisar salud SMART del disco/SSD, espacio libre, errores de lectura y tiempos de respuesta antes de reinstalar software.",
    },
    "ENERGIA": {
        "terms": (
            "no enciende", "no prende", "fuente", "corriente", "apagado", "se apaga",
            "reinicia", "reinicio", "estabilizador", "cable de poder",
        ),
        "pattern": "Hay recurrencia de síntomas relacionados con alimentación eléctrica o encendido.",
        "recommendation": "Comprobar fuente de poder, cableado, estabilizador/UPS, temperaturas y eventos de apagado antes de cambiar componentes.",
    },
    "RED": {
        "terms": (
            "internet", "red", "conexion", "conexión", "ip", "gateway", "dns", "ping",
            "desconecta", "sin red", "sin internet", "cable de red",
        ),
        "pattern": "El historial concentra fallas de conectividad o configuración de red.",
        "recommendation": "Validar enlace físico, IP/gateway/DNS, pérdida de paquetes y puerto de switch; comparar con otros equipos de la misma oficina.",
    },
    "IMPRESION": {
        "terms": (
            "impresora", "imprime", "impresion", "impresión", "atasco", "toner", "tóner",
            "cola de impresion", "cola de impresión", "papel",
        ),
        "pattern": "Se observan fallas repetidas relacionadas con impresión.",
        "recommendation": "Revisar cola de impresión, conectividad, controlador, consumibles y mecanismos de arrastre antes de reemplazar la impresora.",
    },
    "SOFTWARE": {
        "terms": (
            "windows", "sistema", "programa", "software", "error", "aplicacion", "aplicación",
            "pantalla azul", "actualizacion", "actualización", "archivo corrupto",
        ),
        "pattern": "El equipo presenta recurrencia de errores de software o sistema operativo.",
        "recommendation": "Revisar Visor de eventos/logs, actualizaciones, integridad del sistema y software instalado antes de formatear o reinstalar.",
    },
    "PERIFERICOS": {
        "terms": (
            "mouse", "teclado", "usb", "puerto", "monitor", "pantalla", "hdmi", "displayport",
        ),
        "pattern": "Se repiten incidencias asociadas a periféricos, puertos o señal de video.",
        "recommendation": "Probar cable/puerto alternativo y periférico conocido como operativo para aislar si la falla está en el accesorio o en el equipo.",
    },
}


def _history_signal_hits(history: list, current_text: str) -> list[tuple[str, int, bool]]:
    current = normalize(current_text)
    hits: list[tuple[str, int, bool]] = []
    for key, rule in _HISTORY_SIGNALS.items():
        past_count = 0
        for item in history:
            item_text = normalize(
                f"{item.subject} {item.description} {item.resolution_notes or ''}"
            )
            if any(contains_term(item_text, term) for term in rule["terms"]):
                past_count += 1
        current_hit = any(contains_term(current, term) for term in rule["terms"])
        if past_count >= 2 or (past_count >= 1 and current_hit):
            hits.append((key, past_count, current_hit))
    return sorted(hits, key=lambda item: (item[2], item[1]), reverse=True)


def summarize_equipment_history(
    history: list,
    now: datetime,
    current_text: str = "",
    equipment_type: str | None = None,
) -> EquipmentHistorySummary:
    """Resume historial y produce recomendaciones explicables basadas en patrones observados."""
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
        return EquipmentHistorySummary(
            total_365d=0,
            incidents_90d=0,
            incidents_30d=0,
            resolved=0,
            top_category=None,
            recurrence_level="BAJA",
            patterns=[],
            recommendations=[
                "No hay historial suficiente para predecir una causa recurrente; realizar diagnóstico inicial estándar."
            ],
            evidence=[],
            note=(
                "Contexto histórico predictivo: no hay incidencias previas registradas "
                "para este equipo en los últimos 365 días."
            ),
        )

    signals = _history_signal_hits(recent, current_text)
    patterns: list[str] = []
    recommendations: list[str] = []
    evidence: list[str] = []

    for key, count, current_hit in signals[:3]:
        rule = _HISTORY_SIGNALS[key]
        patterns.append(rule["pattern"])
        recommendations.append(rule["recommendation"])
        evidence.append(
            f"{count} incidencia(s) histórica(s) contienen señales de {key.lower()}"
            + (" y el reporte actual presenta señales similares." if current_hit else ".")
        )

    if top_category:
        try:
            category = TicketCategory(top_category)
            category_label = CATEGORY_LABELS.get(category, top_category.replace("_", " ").title())
        except ValueError:
            category_label = str(top_category).replace("_", " ").title()

        count = categories[top_category]
        if count >= 2:
            patterns.append(f"La categoría {category_label} se repite en {count} incidencia(s) del último año.")
            evidence.append(f"Categoría histórica predominante: {category_label} ({count}/{len(recent)}).")

    if recurrence_level == "ALTA" and len(resolved) >= 2:
        recommendations.append(
            "La falla es recurrente pese a soluciones anteriores; verificar la causa raíz antes de repetir la misma reparación."
        )

    if len(last_30) >= 2:
        recommendations.append(
            "Existe concentración reciente de incidencias; comprobar si el deterioro está aumentando y documentar pruebas antes de cerrar el ticket."
        )

    if not recommendations:
        type_fallback = {
            "CPU": "Realizar diagnóstico base de energía, almacenamiento, memoria y temperaturas; documentar el resultado antes de reemplazar piezas.",
            "LAPTOP": "Revisar batería/cargador, almacenamiento, memoria y temperaturas como diagnóstico base.",
            "IMPRESORA": "Revisar conectividad, controlador, cola de impresión y consumibles como diagnóstico base.",
            "MONITOR": "Revisar alimentación, cable de video, puerto y prueba cruzada con otro monitor.",
            "MOUSE": "Probar otro puerto USB y un mouse conocido como operativo para aislar la falla.",
            "TECLADO": "Probar otro puerto USB y un teclado conocido como operativo para aislar la falla.",
        }
        recommendations.append(
            type_fallback.get(
                equipment_type or "",
                "Realizar diagnóstico técnico estándar y registrar evidencias para enriquecer futuros análisis."
            )
        )

    latest_resolution = next(
        (
            item.resolution_notes.strip()
            for item in reversed(recent)
            if item.resolution_notes and item.resolution_notes.strip()
        ),
        None,
    )
    resolution_text = f" Última solución registrada: {latest_resolution[:220]}." if latest_resolution else ""

    note = (
        "Contexto histórico predictivo: "
        f"{len(recent)} incidencia(s) en 365 días, {len(last_90)} en 90 días y {len(last_30)} en 30 días; "
        f"{len(resolved)} resuelta(s). Señal de recurrencia: {recurrence_level}."
    )
    if patterns:
        note += " Patrón: " + " ".join(patterns[:2])
    if recommendations:
        note += " Recomendación inicial: " + " ".join(recommendations[:2])
    note += resolution_text

    return EquipmentHistorySummary(
        total_365d=len(recent),
        incidents_90d=len(last_90),
        incidents_30d=len(last_30),
        resolved=len(resolved),
        top_category=top_category,
        recurrence_level=recurrence_level,
        patterns=patterns[:4],
        recommendations=recommendations[:4],
        evidence=evidence[:4],
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
