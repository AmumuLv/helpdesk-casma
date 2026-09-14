from dataclasses import dataclass

import numpy as np
from sklearn.metrics.pairwise import cosine_similarity


@dataclass
class CaseDoc:
    ticket_id: str
    number: str
    subject: str
    text: str
    resolution: str


class SimilarityIndex:
    """Razonamiento basado en casos: recupera incidencias resueltas parecidas y su solución."""

    def __init__(self):
        self.docs: list[CaseDoc] = []
        self.matrix = None

    def build(self, vectorize, docs: list[CaseDoc]) -> None:
        self.docs = docs
        self.matrix = vectorize([d.text for d in docs]) if docs else None

    def query(self, vectorize, text: str, k: int = 3, min_score: float = 0.22, exclude_ids: set[str] | None = None):
        if self.matrix is None or not self.docs:
            return []
        sims = cosine_similarity(vectorize([text]), self.matrix)[0]
        results = []
        for idx in np.argsort(sims)[::-1]:
            score = float(sims[idx])
            if score < min_score:
                break
            doc = self.docs[idx]
            if exclude_ids and doc.ticket_id in exclude_ids:
                continue
            results.append((doc, round(score, 3)))
            if len(results) >= k:
                break
        return results
