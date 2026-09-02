from edward.clients.base import ModelClient
from edward.clients.utils import image_to_data_uri
from edward.config import API_KEY, SYSTEM_PROMPT
from edward.models import ModelRequest, ModelResponse, TextContent, ImageContent

from groq import Groq

class GroqClient(ModelClient):
    """Concerte implementation of ModelClient using Groq. Currently uses Qwen2.6."""
    def __init__(self):
        self._client = Groq(api_key=API_KEY)

    def _process_model_request(self, request:ModelRequest) -> list[dict[str, str]]:
        """Processes a ModelRequest object and converts into a Groq readable format
        
        Args:
            request(ModelRequest): The object to be converted to Groq readable format
        
        Returns:
            list[dict[str, str]]: The processed list containing dictionaries for each individual object
        """
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

    def _extract_result(self, response: str) -> str:
        _, separator, result = response.partition("</think>")

        if not separator:
            return response.strip()
        return result.strip()

    def generate(self, request: ModelRequest) -> ModelResponse:
        response = self._client.chat.completions.create(
            model = "qwen/qwen3.6-27b",
            messages = [
                {
                    "role": "system",
                    "content": SYSTEM_PROMPT
                },
                {
                    "role": "user",
                    "content": self._process_model_request(request)
                }
            ],
            n=1
        )

        response = response.choices[0].message.content
        return self._extract_result(response)

if __name__ == "__main__":
    t1 = TextContent("This is a test prompt. Reply with a smiley emoticon if you can read the see my message.")

    req = ModelRequest((
        t1,
    ))

    client = GroqClient()
    print(client.generate(req))