from types import SimpleNamespace

from app.services.integrations import LLMService


def test_gemini_generate_falls_back_when_primary_model_is_unavailable():
    class FakeModels:
        def __init__(self) -> None:
            self.calls: list[str] = []

        def generate_content(self, *, model: str, contents: list[str]):
            self.calls.append(model)
            if model == "gemini-2.5-flash-preview-05-20":
                raise RuntimeError("404 NOT_FOUND")
            return SimpleNamespace(text='{"status":"ok"}')

    fake_models = FakeModels()
    fake_client = SimpleNamespace(models=fake_models)

    service = object.__new__(LLMService)
    service._gemini_client = fake_client
    service._gemini_model = "gemini-2.5-flash-preview-05-20"

    text = service._gemini_generate(["test prompt"])

    assert text == '{"status":"ok"}'
    assert fake_models.calls[0] == "gemini-2.5-flash-preview-05-20"
    assert service._gemini_model != "gemini-2.5-flash-preview-05-20"
