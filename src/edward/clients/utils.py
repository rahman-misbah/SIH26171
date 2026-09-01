"""Utility functions"""
from ..models import ImageContent

import base64

def image_to_base64(image: ImageContent) -> str:
    """Converts an image into base64 encoded string
    
    Args:
        image(ImageContent): Image object to be encoded to base64
    
    Returns:
        str: Base64 representation of the image
    """

    return base64.b64encode(image.data).decode("utf-8")

def image_to_data_uri(image:ImageContent) -> str:
    """Converts an ImageContent object into a Data URI.
    Uses RFC 2397 Data URI format
    
    Args:
        image(ImageContent): Image object to be converted into Data URI
    
    Returns:
        str: Data URI of the image
    """

    return f"data:{image.mime_type};base64,{image_to_base64(image)}"