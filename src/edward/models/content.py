"""Represents text and image content"""
from dataclasses import dataclass

@dataclass(frozen=True)
class TextContent:
    """Represents a simple text
    
    Attributes:
        text(str): The simple text data
    """
    text: str

    # DUNDER METHODS ------------------------------------------------------------------------------

    def __str__(self) -> str:
        return self.text

@dataclass(frozen=True)
class ImageContent:
    """Represents an image

    Attributes:
        image_id(str): A unique id for the image
        data(bytes): Byte array of the image
        mime_type(str): MIME of the image
    """
    image_id: str
    data: bytes
    mime_type: str

    # DUNDER METHODS ------------------------------------------------------------------------------

    def __post_init__(self):
        self._verify_mime()

    # PROPERTIES ----------------------------------------------------------------------------------

    @property
    def size(self) -> int:
        return len(self.data)

    @property
    def format(self) -> str:
        image_format = self.mime_type.removeprefix('image/')

        if image_format == "svg+xml":
            image_format = "svg"

        return image_format
    
    # PRIVATE METHODS -----------------------------------------------------------------------------
    def _verify_mime(self) -> None:
        """Verifies mime_type validity
        
        Raises:
            TypeError: If mime_type is not a string
            ValueError: If mime_type is not a valid format
        """

        if not isinstance(self.mime_type, str):
            raise TypeError("mime_type must be a string")
        
        if not self.mime_type.startswith("image/"):
            raise ValueError(f"Expected an image MIME type, received {self.mime_type}")

        valid_mime_types: list[str] = ["webp",
                                       "avif",
                                       "jxl",
                                       "jpeg",
                                       "png",
                                       "gif",
                                       "apng",
                                       "svg+xml"
                                       ]

        if self.mime_type.removeprefix("image/") not in valid_mime_types:
            raise ValueError(f"Not a valid MIME type. Received {self.mime_type}")

def main() -> None:
    """Run informal smoke tests for content classes."""


    print("=" * 60)
    print("TEXT CONTENT")
    print("=" * 60)

    text = TextContent("Hello, model!")

    print(f"text: {text.text}")
    print(f"str(text): {text}")

    assert text.text == "Hello, model!"
    assert str(text) == "Hello, model!"

    print("✓ TextContent passed")

    print()

    print("=" * 60)
    print("IMAGE CONTENT")
    print("=" * 60)

    image = ImageContent(
        image_id="test-image-001",
        data=b"dummy image data",
        mime_type="image/png",
    )

    print(f"id: {image.image_id}")
    print(f"mime type: {image.mime_type}")
    print(f"format: {image.format}")
    print(f"size: {image.size} bytes")

    assert image.image_id == "test-image-001"
    assert image.mime_type == "image/png"
    assert image.format == "png"
    assert image.size == len(b"dummy image data")

    print("✓ ImageContent passed")

    print()

    print("=" * 60)
    print("SVG FORMAT")
    print("=" * 60)

    svg = ImageContent(
        image_id="test-svg-001",
        data=b"<svg></svg>",
        mime_type="image/svg+xml",
    )

    print(f"mime type: {svg.mime_type}")
    print(f"format: {svg.format}")

    assert svg.format == "svg"

    print("✓ SVG format passed")

    print()

    print("=" * 60)
    print("INVALID MIME TYPES")
    print("=" * 60)

    invalid_mime_types = [
        "text/plain",
        "application/json",
        "image/banana",
        "",
    ]

    for mime_type in invalid_mime_types:
        try:
            ImageContent(
                image_id="invalid-image",
                data=b"dummy",
                mime_type=mime_type,
            )

        except (TypeError, ValueError) as error:
            print(
                f"✓ {mime_type!r} correctly rejected "
                f"({type(error).__name__})"
            )

        else:
            raise AssertionError(
                f"{mime_type!r} was accepted but should have been rejected"
            )

    print()

    print("=" * 60)
    print("ALL SMOKE TESTS PASSED ✓")
    print("=" * 60)


if __name__ == "__main__":
    main()
