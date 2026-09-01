"""Defines the provider-independent client interface for language models"""

from abc import ABC, abstractmethod

from ..models import ModelRequest
from ..models import ModelResponse

class ModelClient(ABC):
    """Defines the interface for a model provider client"""

    @abstractmethod
    def generate(self, request: ModelRequest) -> ModelResponse:
        """Generate a response for model request."""
        raise NotImplementedError