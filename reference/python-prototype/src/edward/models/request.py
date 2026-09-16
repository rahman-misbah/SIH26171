"""Represents a provider independent request sent to a model"""
from dataclasses import dataclass

from .content import TextContent, ImageContent

type ModelContent = TextContent | ImageContent

def _is_model_content(content:object) -> bool:
    """Checks if an item is a ModelContent or not
    
    Returns:
        result(bool): True if content is either TextContent or ImageContrast, else false
    """
    return isinstance(content, (TextContent, ImageContent))

@dataclass(frozen=True)
class ModelRequest:
    """Represents a simple request
    
    Attributes:
        content(tuple): A sequence of all query objects (text/image)
    """
    content: tuple[ModelContent, ...]

    # PRIVATE METHODS -----------------------------------------------------------------------------

    def __post_init__(self):
        # Verify content attribute

        if not isinstance(self.content, tuple):
            raise TypeError(f"Expected a tuple. Received {type(self.content).__name__}")

        if len(self.content) == 0:
            raise ValueError("Empty request")

        for item in self.content:
            if not _is_model_content(item):
                raise ValueError(f"Invalid content format. Received {type(item).__name__}")

def main() -> None:
    """Run informal smoke tests for ModelRequest."""

    print("=" * 60)
    print("VALID MODEL REQUEST")
    print("=" * 60)

    request = ModelRequest(
        content=(
            TextContent("Analyze the following content."),
            ImageContent(
                image_id="test-image-001",
                data=b"dummy image data",
                mime_type="image/png",
            ),
            TextContent("Describe what you observe."),
        )
    )

    print("Request created successfully.")
    print(f"Number of content items: {len(request.content)}")

    for index, item in enumerate(request.content, start=1):
        print(f"{index}. {type(item).__name__}")

    assert len(request.content) == 3
    assert isinstance(request.content[0], TextContent)
    assert isinstance(request.content[1], ImageContent)
    assert isinstance(request.content[2], TextContent)

    print("✓ Valid ModelRequest passed")

    print()
    print("=" * 60)
    print("NON-TUPLE CONTENT")
    print("=" * 60)

    try:
        ModelRequest(
            content=[
                TextContent("This should fail.")
            ]
        )

    except TypeError as error:
        print(f"✓ List correctly rejected: {error}")

    else:
        raise AssertionError("List was accepted but should have been rejected")

    print()
    print("=" * 60)
    print("EMPTY REQUEST")
    print("=" * 60)

    try:
        ModelRequest(content=())

    except ValueError as error:
        print(f"✓ Empty tuple correctly rejected: {error}")

    else:
        raise AssertionError(
            "Empty ModelRequest was accepted but should have been rejected"
        )

    print()
    print("=" * 60)
    print("INVALID CONTENT")
    print("=" * 60)

    invalid_content = (
        "plain string",
        42,
        {"text": "Hello"},
        None,
    )

    for item in invalid_content:
        try:
            ModelRequest(
                content=(item,)
            )

        except ValueError as error:
            print(
                f"✓ {type(item).__name__} correctly rejected: {error}"
            )

        else:
            raise AssertionError(
                f"{type(item).__name__} was accepted but should have been rejected"
            )

    print()
    print("=" * 60)
    print("ALL MODEL REQUEST SMOKE TESTS PASSED ✓")
    print("=" * 60)

if __name__ == "__main__":
    main()
