from sklearn.base import BaseEstimator, TransformerMixin
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.pipeline import FeatureUnion

from app.ai.text import normalize

_ST_CACHE: dict[str, object] = {}


class SentenceEmbedder(BaseEstimator, TransformerMixin):
    """Embeddings multilingües (deep learning, transformer) para clasificación y similitud semántica."""

    def __init__(self, model_name: str):
        self.model_name = model_name

    def fit(self, X, y=None):
        return self

    def transform(self, X):
        model = _ST_CACHE.get(self.model_name)
        if model is None:
            from sentence_transformers import SentenceTransformer

            model = SentenceTransformer(self.model_name)
            _ST_CACHE[self.model_name] = model
        return model.encode(list(X), normalize_embeddings=True, batch_size=32, show_progress_bar=False)


def build_featurizer(backend: str, model_name: str):
    if backend == "sentence-transformers":
        return SentenceEmbedder(model_name)
    return FeatureUnion(
        [
            ("word", TfidfVectorizer(preprocessor=normalize, ngram_range=(1, 2), sublinear_tf=True)),
            ("char", TfidfVectorizer(preprocessor=normalize, analyzer="char_wb", ngram_range=(3, 5), sublinear_tf=True, min_df=2)),
        ]
    )
