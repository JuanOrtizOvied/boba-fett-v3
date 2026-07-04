"""Model factory: resolves provider/model from environment configuration.

Credential validation is isolated here so graph logic (`nodes.py`, `graph.py`)
never has to know how a provider is configured or authenticated. Errors raised
by this module MUST name the missing environment variable and MUST NEVER
include its value.
"""

from __future__ import annotations

import os

DEFAULT_PROVIDER = "openai"
DEFAULT_MODEL = "gpt-4o-mini"

SUPPORTED_PROVIDERS = ("openai", "anthropic")

_PROVIDER_API_KEY_VAR = {
    "openai": "OPENAI_API_KEY",
    "anthropic": "ANTHROPIC_API_KEY",
}


class MissingConfigurationError(RuntimeError):
    """Raised when required backend configuration is missing or invalid.

    Messages name the missing/invalid environment variable only — never its
    value — per the `configurable-langgraph-backend` spec.
    """


def get_provider() -> str:
    """Return the configured LLM provider, defaulting to `openai`."""
    provider = os.environ.get("LLM_PROVIDER", DEFAULT_PROVIDER).strip().lower()
    if not provider:
        raise MissingConfigurationError(
            "LLM_PROVIDER is not set. Set LLM_PROVIDER to one of: "
            f"{', '.join(SUPPORTED_PROVIDERS)}."
        )
    if provider not in SUPPORTED_PROVIDERS:
        raise MissingConfigurationError(
            f"LLM_PROVIDER='{provider}' is not a supported provider. "
            f"Supported providers: {', '.join(SUPPORTED_PROVIDERS)}."
        )
    return provider


def get_model_name() -> str:
    """Return the configured model name, defaulting to `gpt-4o-mini`."""
    model = os.environ.get("LLM_MODEL", DEFAULT_MODEL).strip()
    if not model:
        raise MissingConfigurationError("LLM_MODEL is not set.")
    return model


def _require_api_key(provider: str) -> str:
    var_name = _PROVIDER_API_KEY_VAR[provider]
    value = os.environ.get(var_name)
    if not value:
        raise MissingConfigurationError(
            f"{var_name} is not set. Set {var_name} to use the '{provider}' provider."
        )
    return value


def create_chat_model(provider: str | None = None, model: str | None = None):
    """Create a configured chat model instance.

    Resolves provider/model from arguments or environment, validates the
    matching API key is present, and instantiates the LangChain chat model.
    Raises `MissingConfigurationError` naming the missing variable when
    required configuration is absent.
    """
    resolved_provider = provider or get_provider()
    if resolved_provider not in SUPPORTED_PROVIDERS:
        raise MissingConfigurationError(
            f"LLM_PROVIDER='{resolved_provider}' is not a supported provider. "
            f"Supported providers: {', '.join(SUPPORTED_PROVIDERS)}."
        )
    resolved_model = model or get_model_name()
    _require_api_key(resolved_provider)

    if resolved_provider == "openai":
        from langchain_openai import ChatOpenAI

        return ChatOpenAI(model=resolved_model, temperature=0)

    from langchain_anthropic import ChatAnthropic

    return ChatAnthropic(model=resolved_model, temperature=0)
