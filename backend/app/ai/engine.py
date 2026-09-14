import asyncio
import logging
import os
import tempfile
from collections import Counter
from dataclasses import dataclass
from datetime import datetime, timedelta
from functools import lru_cache
from pathlib import Path

import joblib
from beanie import PydanticObjectId

from app.ai.anomaly import detect_bursts
from app.ai.features import build_featurizer
from app.ai.messages import alert_texts, briefing, user_message
from app.ai.recommender import TechCandidate, recommend, technician_stats
from app.ai.risk import RiskModel, group_by_equipment, model_failure_rates
from app.ai.rows import EquipmentRow, TicketRow
from app.ai.seed import seed_samples
from app.ai.similarity import CaseDoc, SimilarityIndex
from app.ai.taxonomy import CATEGORY_LABELS, QUICK_ISSUES
from app.ai.text import normalize
from app.ai.triage import CategoryClassifier, PriorityContext, PriorityModel, score_priority
from app.core.config import get_settings
from app.core.timeutil import aware, utcnow
from app.models import AIModelRecord, Announcement, Equipment, Office, StaffUser, Ticket
from app.models.enums import QuickIssue, StaffRole, TicketCategory, TicketStatus
from app.models.ticket import AIAnalysis, SimilarCase

log = logging.getLogger("helpdesk.ai")
ARTIFACT = "engine.joblib"

_TICKET_PROJECTION = {
    "number": 1, "office_id": 1, "office_location": 1, "device_id": 1, "equipment_id": 1, "category": 1,
    "category_source": 1, "priority": 1, "status": 1, "subject": 1, "description": 1, "created_at": 1,
    "assigned_to_id": 1, "resolution": 1,
}


def _sid(value) -> str | None:
    return str(value) if value else None


async def load_ticket_rows(since: datetime, extra: dict | None = None) -> list[TicketRow]:
    query = {"deleted_at": None, "created_at": {"$gte": since}} | (extra or {})
    cursor = Ticket.get_pymongo_collection().find(query, _TICKET_PROJECTION).sort("created_at", 1)
    rows = []
    for d in await cursor.to_list(None):
        res = d.get("resolution") or {}
        rows.append(
            TicketRow(
                id=str(d["_id"]), number=d.get("number", ""), office_id=str(d.get("office_id")),
                office_location=d.get("office_location"), device_id=_sid(d.get("device_id")),
                equipment_id=_sid(d.get("equipment_id")), category=d.get("category", "OTRO"),
                category_source=d.get("category_source", "IA"), priority=d.get("priority", "MEDIA"),
                status=d.get("status", "PENDIENTE"), subject=d.get("subject", ""), description=d.get("description", ""),
                created_at=aware(d["created_at"]), resolved_at=aware(res.get("resolved_at")),
                assigned_to_id=_sid(d.get("assigned_to_id")), resolution_notes=res.get("notes"),
            )
        )
    return rows


def equipment_row(e: Equipment) -> EquipmentRow:
    return EquipmentRow(
        id=str(e.id), code=e.patrimonial_code, type=e.type.value, brand=e.brand, model=e.model,
        office_id=_sid(e.office_id), acquired_on=aware(e.acquired_on), criticality=e.criticality, status=e.status.value,
    )


async def load_equipment_rows() -> list[EquipmentRow]:
    return [equipment_row(e) for e in await Equipment.find_all().to_list()]


@dataclass
class TriageRequest:
    subject: str
    description: str
    quick_issue: QuickIssue | None
    office: Office
    equipment: Equipment | None = None
    exclude_ticket_id: str | None = None
    reopened: bool = False
    category_hint: TicketCategory | None = None


class AIEngine:
    def __init__(self):
        s = get_settings()
        self.dir = Path(s.model_dir)
        self.backend = s.ai_embeddings
        self.model_name = s.ai_embedding_model
        self.state: dict | None = None
        self._lock = asyncio.Lock()

    @property
    def version(self) -> str | None:
        return self.state["version"] if self.state else None

    def load(self) -> bool:
        path = self.dir / ARTIFACT
        if not path.exists():
            return False
        try:
            state = joblib.load(path)
        except Exception:
            log.exception("No se pudo cargar el modelo de IA")
            return False
        if state.get("backend") != self.backend:
            return False
        self.state = state
        return True

    async def ensure_ready(self) -> None:
        if self.state is None and not self.load():
            await self.train()

    async def train(self) -> AIModelRecord:
        async with self._lock:
            now = utcnow()
            tickets = await load_ticket_rows(now - timedelta(days=730))
            equipment = await load_equipment_rows()
            state, record = await asyncio.to_thread(self._fit, tickets, equipment, now)
            await asyncio.to_thread(self._save, state)
            self.state = state
            doc = AIModelRecord(**record)
            await doc.insert()
            log.info("Modelo de IA entrenado: %s", record)
            return doc

    def _fit(self, tickets: list[TicketRow], equipment: list[EquipmentRow], now: datetime):
        seed_texts, seed_labels = seed_samples()
        verified = [t for t in tickets if t.category_source == "TECNICO" or t.status == TicketStatus.RESUELTO.value]
        featurizer = build_featurizer(self.backend, self.model_name)
        category = CategoryClassifier(featurizer)
        category_metrics = category.fit(
            seed_texts + [t.text for t in verified],
            seed_labels + [t.category for t in verified],
            [1.0] * len(seed_texts) + [3.0] * len(verified),
        )
        priority, priority_metrics = None, {"mode": "reglas", "samples": len(verified)}
        counts = Counter(t.priority for t in verified)
        if len(verified) >= 60 and len(counts) >= 2 and min(counts.values()) >= 5:
            priority = PriorityModel(featurizer)
            priority_metrics = priority.fit([t.text for t in verified], [t.priority for t in verified]) | {"mode": "reglas+aprendizaje"}
        cases = [CaseDoc(t.id, t.number, t.subject, t.text, t.resolution_notes) for t in tickets if t.status == "RESUELTO" and t.resolution_notes]
        similarity = SimilarityIndex()
        similarity.build(category.vectorize, cases[-5000:])
        risk = RiskModel()
        risk_metrics = risk.fit(equipment, tickets, now)
        version = now.strftime("%Y%m%d%H%M%S")
        state = {
            "version": version, "backend": self.backend, "trained_at": now, "category": category, "priority": priority,
            "similarity": similarity, "risk": risk, "tech_stats": technician_stats(tickets),
            "model_rates": model_failure_rates(equipment, group_by_equipment(tickets), now),
        }
        record = {
            "version": version, "backend": self.backend,
            "samples": {"seed": len(seed_texts), "verified_tickets": len(verified), "cases": len(cases), "equipment": len(equipment)},
            "metrics": {"category": category_metrics, "priority": priority_metrics, "risk": risk_metrics},
        }
        return state, record

    def _save(self, state: dict) -> None:
        self.dir.mkdir(parents=True, exist_ok=True)
        fd, tmp = tempfile.mkstemp(dir=self.dir, suffix=".tmp")
        os.close(fd)
        joblib.dump(state, tmp, compress=3)
        os.replace(tmp, self.dir / ARTIFACT)

    async def _candidates(self) -> list[TechCandidate]:
        staff = await StaffUser.find({"active": True}).to_list()
        cursor = Ticket.get_pymongo_collection().find(
            {"status": {"$ne": TicketStatus.RESUELTO.value}, "deleted_at": None, "assigned_to_id": {"$ne": None}}, {"assigned_to_id": 1}
        )
        open_counts = Counter(str(d["assigned_to_id"]) for d in await cursor.to_list(None))
        return [
            TechCandidate(str(s.id), s.full_name, {c.value for c in s.specialties}, open_counts.get(str(s.id), 0))
            for s in staff
            if s.role == StaffRole.TECNICO or s.specialties
        ]

    async def analyze(self, req: TriageRequest) -> AIAnalysis:
        await self.ensure_ready()
        now = utcnow()
        history: list[TicketRow] = []
        if req.equipment:
            history = await load_ticket_rows(now - timedelta(days=400), {"equipment_id": req.equipment.id})
            history = [h for h in history if h.id != req.exclude_ticket_id]
        alerts = await Announcement.find({"office_ids": req.office.id, "active_until": {"$gt": now}}).to_list()
        candidates = await self._candidates()
        return await asyncio.to_thread(self._analyze_sync, req, self.state, history, alerts, candidates, now)

    def _analyze_sync(self, req, st, history, alerts, candidates, now) -> AIAnalysis:
        text = f"{req.subject}. {req.description}".strip()
        info = QUICK_ISSUES.get(req.quick_issue) if req.quick_issue else None
        words = len(normalize(req.description).split())
        pred = st["category"].predict(text)

        if req.category_hint:
            category, confidence = req.category_hint, 1.0
        elif info and info.category != TicketCategory.OTRO and (words < 3 or (pred.category != info.category and pred.confidence < 0.6)):
            category = info.category
            confidence = max(0.75, pred.confidence) if pred.category == info.category else 0.75
        elif pred.confidence < 0.3:
            category, confidence = TicketCategory.OTRO, pred.confidence
        else:
            category, confidence = pred.category, pred.confidence

        risk, factors, incidents_90d, eq_desc = None, [], 0, None
        if req.equipment:
            eq = req.equipment
            risk, factors = st["risk"].score(equipment_row(eq), history, st["model_rates"], now)
            incidents_90d = sum(1 for h in history if h.created_at > now - timedelta(days=90))
            name = " ".join(x for x in (eq.brand, eq.model) if x) or eq.type.value
            eq_desc = f"{name} ({eq.patrimonial_code})" + (f", IP {eq.ip_address}" if eq.ip_address else "")

        alert = next((a for a in alerts if a.category in (None, category)), None)
        prio = score_priority(
            PriorityContext(
                text=text, category=category, office_weight=req.office.priority_weight,
                equipment_criticality=req.equipment.criticality if req.equipment else 1,
                equipment_incidents_90d=incidents_90d, related_alert=alert is not None, reopened=req.reopened,
            ),
            st["priority"],
        )
        similar = st["similarity"].query(st["category"].vectorize, text, k=3, exclude_ids={req.exclude_ticket_id} if req.exclude_ticket_id else None)
        tech, tech_reasons = recommend(category.value, candidates, st["tech_stats"])
        return AIAnalysis(
            category=category,
            category_confidence=round(confidence, 3),
            priority=prio.priority,
            priority_score=prio.score,
            priority_reasons=prio.reasons,
            suggested_technician_id=tech.id if tech else None,
            suggested_technician_name=tech.name if tech else None,
            technician_reasons=tech_reasons,
            similar_cases=[SimilarCase(ticket_id=d.ticket_id, number=d.number, subject=d.subject, score=s, resolution=d.resolution) for d, s in similar],
            equipment_risk=risk,
            equipment_risk_factors=factors,
            equipment_incidents_90d=incidents_90d,
            related_alert=alert.staff_message if alert else None,
            briefing=briefing(category, confidence, eq_desc, incidents_90d, risk, similar[0][0].resolution if similar else None, alert.staff_message if alert else None),
            user_message=user_message(prio.priority, alert.message if alert else None),
            user_tips=list(info.tips) if info else [],
            model_version=st["version"],
        )

    async def insights(self) -> dict:
        await self.ensure_ready()
        now = utcnow()
        tickets = await load_ticket_rows(now - timedelta(days=400))
        equipment = await load_equipment_rows()
        offices = {str(o.id): o.name for o in await Office.find_all().to_list()}
        risk_model: RiskModel = self.state["risk"]

        def compute():
            by_eq = group_by_equipment(tickets)
            rates = model_failure_rates(equipment, by_eq, now)
            ranking = []
            for eq in equipment:
                if eq.status == "BAJA":
                    continue
                prob, factors = risk_model.score(eq, by_eq.get(eq.id, []), rates, now)
                ranking.append({
                    "equipment_id": eq.id, "patrimonial_code": eq.code, "type": eq.type,
                    "name": " ".join(x for x in (eq.brand, eq.model) if x) or eq.type,
                    "office": offices.get(eq.office_id or "", "Sin oficina"), "risk": prob, "factors": factors,
                    "incidents_90d": sum(1 for t in by_eq.get(eq.id, []) if t.created_at > now - timedelta(days=90)),
                })
            ranking.sort(key=lambda r: r["risk"], reverse=True)
            last30 = Counter(t.category for t in tickets if t.created_at > now - timedelta(days=30))
            prev30 = Counter(t.category for t in tickets if now - timedelta(days=60) < t.created_at <= now - timedelta(days=30))
            trend = [
                {"category": c.value, "label": CATEGORY_LABELS[c], "last_30d": last30.get(c.value, 0), "previous_30d": prev30.get(c.value, 0)}
                for c in TicketCategory
            ]
            by_office = Counter(t.office_id for t in tickets if t.created_at > now - timedelta(days=30))
            bursts = detect_bursts(tickets, now)
            return {
                "equipment_risk": ranking[:15],
                "category_trend": trend,
                "offices_30d": [{"office": offices.get(k, k), "count": v} for k, v in by_office.most_common(8)],
                "live_bursts": [{"category": b.category, "location": b.location, "count": b.count, "expected": b.expected} for b in bursts],
            }

        data = await asyncio.to_thread(compute)
        alerts = await Announcement.find({"active_until": {"$gt": now}}).sort(-Announcement.created_at).to_list()
        latest = await AIModelRecord.find_all().sort(-AIModelRecord.trained_at).limit(1).to_list()
        data["active_alerts"] = [{"id": str(a.id), "title": a.title, "message": a.staff_message, "until": a.active_until} for a in alerts]
        data["model"] = latest[0].model_dump(exclude={"id", "revision_id"}) if latest else None
        return data

    async def scan_anomalies(self) -> list[Announcement]:
        now = utcnow()
        tickets = await load_ticket_rows(now - timedelta(days=14))
        bursts = await asyncio.to_thread(detect_bursts, tickets, now)
        created = []
        for b in bursts:
            if await Announcement.find_one({"key": b.key, "active_until": {"$gt": now}}):
                continue
            office_ids = set(b.office_ids)
            if b.location:
                office_ids |= {str(o.id) for o in await Office.find({"location": b.location, "active": True}).to_list()}
            title, user_msg, staff_msg = alert_texts(b.category, b.location, b.count)
            ann = Announcement(
                key=b.key, office_ids=[PydanticObjectId(x) for x in office_ids], category=TicketCategory(b.category),
                title=title, message=user_msg, staff_message=staff_msg, active_until=now + timedelta(hours=3),
            )
            await ann.insert()
            created.append(ann)
        return created


@lru_cache
def get_engine() -> AIEngine:
    return AIEngine()
