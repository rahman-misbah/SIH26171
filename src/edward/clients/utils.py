"""Utility functions"""
from ..models import ImageContent

import base64

def image_to_data_uri(image:ImageContent) -> set:
    """Converts an ImageContent object into a Data URI.
    Uses RFC 2397 Data URI format
    
    Args:
        image(ImageObject): Image object to be converted into Data URI
    
    Returns:
        str: Data URI of the image
    """
    data = base64.b64encode(image.data).decode("utf-8")

    return f"data:{image.mime_type};base64,{data}"