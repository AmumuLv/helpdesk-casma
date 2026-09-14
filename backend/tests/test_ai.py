from datetime import datetime, timedelta, timezone

from app.ai.anomaly import detect_bursts
from app.ai.features import build_featurizer
from app.ai.rows import TicketRow
from app.ai.seed import seed_samples
from app.ai.triage import CategoryClassifier, PriorityContext, score_priority
from app.models.enums import TicketCategory, TicketPriority


def test_category_classifier_learns_seed():
    texts, labels = seed_samples()
    model = CategoryClassifier(build_featurizer("tfidf", ""))
    metrics = model.fit(texts, labels, [1.0] * len(texts))
    assert metrics["f1_macro_cv"] > 0.8
    assert model.predict("la impresora no jala las hojas y se atasca").category == TicketCategory.IMPRESORA
    assert model.predict("no puedo ingresar al siaf me sale error").category == TicketCategory.SISTEMAS_MUNICIPALES
    assert model.predict("no hay internet en toda la oficina").category == TicketCategory.RED_INTERNET


def test_priority_rules():
    high = score_priority(PriorityContext("sale humo del cpu en caja, publico esperando", TicketCategory.HARDWARE, office_weight=1.6))
    low = score_priority(PriorityContext("cambiar fondo de pantalla cuando pueda", TicketCategory.OTRO))
    assert high.priority == TicketPriority.ALTA and high.reasons
    assert low.priority == TicketPriority.BAJA


def _row(i, created, category="RED_INTERNET", location="Piso 2"):
    return TicketRow(id=str(i), number=str(i), office_id=f"o{i % 3}", office_location=location, device_id=f"d{i}", equipment_id=None,
                     category=category, category_source="IA", priority="MEDIA", status="PENDIENTE", subject="", description="",
                     created_at=created, resolved_at=None, assigned_to_id=None, resolution_notes=None)


def test_burst_detection():
    now = datetime.now(timezone.utc)
    rows = [_row(i, now - timedelta(days=3 + i)) for i in range(4)]
    rows += [_row(100 + i, now - timedelta(minutes=10 * i)) for i in range(5)]
    bursts = detect_bursts(rows, now)
    assert any(b.category == "RED_INTERNET" and b.location == "Piso 2" and b.count == 5 for b in bursts)
