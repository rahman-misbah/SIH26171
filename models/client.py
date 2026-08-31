"""Defines the provider-independent client interface for language models"""

from abc import ABC, abstractmethod

from request import ModelRequest
from response import ModelResponse

class ModelClient(ABC):
    """Defines the interface for a model provider client"""

    @abstractmethod
    def generate(self, request: ModelRequest) -> ModelResponse:
        """Generate a response for model request."""
        raise NotImplementedError