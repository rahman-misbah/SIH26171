"""Represents a provider independent response received from a model"""

from dataclasses import dataclass

@dataclass(frozen=True)
class ModelResponse:
    response: str