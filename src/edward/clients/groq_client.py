from edward.clients.base import ModelClient
from edward.clients.utils import image_to_data_uri
from edward.config import API_KEY, SYSTEM_PROMPT
from edward.models import ModelRequest, ModelResponse, TextContent, ImageContent

from groq import Groq

class GroqClient(ModelClient):
    """Concerte implementation of ModelClient using Groq. Currently uses Qwen2.6."""
    def __init__(self):
        self._client = Groq(api_key=API_KEY)

    def _process_model_request(self, request:ModelRequest):
        processed_content = list()

        for content in request.content:
            if isinstance(content, TextContent):
                processed_content.append(
                    {
                        "type": "text",
                        "text": content.text
                    }
                )

            else:
                # Image ID
                processed_content.append(
                    {
                        "type": "text",
                        "text": f"Image for image ID {content.image_id}"
                    }
                )

                processed_content.append(
                    {
                        "type":"image_url",
                        "image_url": {
                            "url": image_to_data_uri(content)
                        }
                    }
                )

        return processed_content

    def generate(self, request: ModelRequest) -> ModelResponse:
        # Prompt intended for the model
        prompt = [
            {
                "role": "system",
                "content": SYSTEM_PROMPT
            },
            {
                "role": "user",
                "content": self._process_model_request(request)
            }
        ]

        return prompt

if __name__ == "__main__":
    t1 = TextContent("Hello, bois")
    t2 = TextContent("Howdy!")
    i1 = ImageContent("img_01", b"Howdy_image", "image/png")

    req = ModelRequest((
        t1,
        t2,
        i1
    ))

    client = GroqClient()
    print(client.generate(req)[1])