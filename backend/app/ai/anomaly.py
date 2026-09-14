from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timedelta

from scipy.stats import poisson

from app.ai.rows import TicketRow


@dataclass
class Burst:
    key: str
    category: str
    location: str | None
    office_ids: set[str] = field(default_factory=set)
    ticket_ids: list[str] = field(default_factory=list)
    count: int = 0
    expected: float = 0.0
    p_value: float = 1.0


def detect_bursts(
    tickets: list[TicketRow],
    now: datetime,
    window_hours: int = 2,
    lookback_days: int = 14,
    min_reporters: int = 3,
    alpha: float = 0.01,
) -> list[Burst]:
    """Detecta picos anómalos (Poisson) de incidencias por categoría y ubicación: posibles fallas masivas."""
    window_start = now - timedelta(hours=window_hours)
    lookback_start = now - timedelta(days=lookback_days)
    baseline_hours = lookback_days * 24 - window_hours

    groups: dict[tuple[str, str], dict] = defaultdict(lambda: {"window": [], "baseline": 0})
    for t in tickets:
        if t.created_at < lookback_start or t.created_at > now:
            continue
        loc = t.office_location or f"office:{t.office_id}"
        for key in ((t.category, loc), (t.category, "*")):
            if t.created_at >= window_start:
                groups[key]["window"].append(t)
            else:
                groups[key]["baseline"] += 1

    bursts: list[Burst] = []
    for (category, loc), g in groups.items():
        window = g["window"]
        reporters = {t.device_id or t.equipment_id or t.id for t in window}
        if len(reporters) < (min_reporters if loc != "*" else min_reporters + 2):
            continue
        expected = max(g["baseline"] * window_hours / baseline_hours, 0.05)
        p = float(poisson.sf(len(reporters) - 1, expected))
        if p < alpha:
            bursts.append(
                Burst(
                    key=f"{category}|{loc}",
                    category=category,
                    location=None if loc == "*" or loc.startswith("office:") else loc,
                    office_ids={t.office_id for t in window},
                    ticket_ids=[t.id for t in window],
                    count=len(reporters),
                    expected=round(expected, 3),
                    p_value=p,
                )
            )
    local_keys = {b.category for b in bursts if not b.key.endswith("|*")}
    return [b for b in bursts if not (b.key.endswith("|*") and b.category in local_keys and len(b.office_ids) <= 1)]
