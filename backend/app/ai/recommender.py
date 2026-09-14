from collections import defaultdict
from dataclasses import dataclass

import numpy as np

from app.ai.rows import TicketRow


@dataclass
class TechCandidate:
    id: str
    name: str
    specialties: set[str]
    open_count: int


def technician_stats(tickets: list[TicketRow]) -> dict[str, dict[str, tuple[int, float]]]:
    hours: dict[str, dict[str, list[float]]] = defaultdict(lambda: defaultdict(list))
    for t in tickets:
        if t.assigned_to_id and t.resolved_at:
            hours[t.assigned_to_id][t.category].append((t.resolved_at - t.created_at).total_seconds() / 3600)
    return {tech: {cat: (len(v), float(np.median(v))) for cat, v in cats.items()} for tech, cats in hours.items()}


def recommend(category: str, candidates: list[TechCandidate], stats: dict) -> tuple[TechCandidate | None, list[str]]:
    best, best_score, best_reasons = None, float("-inf"), []
    for c in candidates:
        reasons, score = [], 0.0
        if category in c.specialties:
            score += 2.0
            reasons.append("Especialista en esta categoría")
        count, median_h = stats.get(c.id, {}).get(category, (0, 0.0))
        if count:
            score += min(count / 10, 1.0) + 1.0 / (1 + median_h / 24)
            reasons.append(f"Resolvió {count} casos similares (mediana {median_h:.1f} h)")
        score -= 0.35 * c.open_count
        reasons.append(f"{c.open_count} casos abiertos")
        if score > best_score:
            best, best_score, best_reasons = c, score, reasons
    return best, best_reasons
