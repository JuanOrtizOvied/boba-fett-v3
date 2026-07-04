"""Tests for the environment-driven model factory (`agent.models`)."""

from __future__ import annotations

import pytest

from agent.models import (
    DEFAULT_MODEL,
    DEFAULT_PROVIDER,
    MissingConfigurationError,
    create_chat_model,
    get_model_name,
    get_provider,
)


# --- Provider selection ---


def test_get_provider_defaults_to_openai(monkeypatch):
    monkeypatch.delenv("LLM_PROVIDER", raising=False)
    assert get_provider() == DEFAULT_PROVIDER


def test_get_provider_reads_env_case_insensitively(monkeypatch):
    monkeypatch.setenv("LLM_PROVIDER", "Anthropic")
    assert get_provider() == "anthropic"


def test_get_provider_rejects_unsupported_value(monkeypatch):
    monkeypatch.setenv("LLM_PROVIDER", "cohere")
    with pytest.raises(MissingConfigurationError, match="LLM_PROVIDER"):
        get_provider()


def test_get_provider_rejects_blank_value(monkeypatch):
    monkeypatch.setenv("LLM_PROVIDER", "   ")
    with pytest.raises(MissingConfigurationError, match="LLM_PROVIDER"):
        get_provider()


# --- Model selection ---


def test_get_model_name_defaults(monkeypatch):
    monkeypatch.delenv("LLM_MODEL", raising=False)
    assert get_model_name() == DEFAULT_MODEL


def test_get_model_name_reads_env(monkeypatch):
    monkeypatch.setenv("LLM_MODEL", "gpt-4o")
    assert get_model_name() == "gpt-4o"


def test_get_model_name_rejects_blank_value(monkeypatch):
    monkeypatch.setenv("LLM_MODEL", "")
    with pytest.raises(MissingConfigurationError, match="LLM_MODEL"):
        get_model_name()


# --- Missing configuration errors name the variable, never a value ---


def test_missing_openai_key_names_variable_without_value(monkeypatch):
    monkeypatch.setenv("LLM_PROVIDER", "openai")
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    with pytest.raises(MissingConfigurationError) as exc_info:
        create_chat_model()
    message = str(exc_info.value)
    assert "OPENAI_API_KEY" in message


def test_missing_anthropic_key_names_variable_without_value(monkeypatch):
    monkeypatch.setenv("LLM_PROVIDER", "anthropic")
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    with pytest.raises(MissingConfigurationError) as exc_info:
        create_chat_model()
    message = str(exc_info.value)
    assert "ANTHROPIC_API_KEY" in message


def test_blank_api_key_is_treated_as_missing(monkeypatch):
    monkeypatch.setenv("LLM_PROVIDER", "openai")
    monkeypatch.setenv("OPENAI_API_KEY", "")
    with pytest.raises(MissingConfigurationError, match="OPENAI_API_KEY"):
        create_chat_model()


def test_error_message_never_echoes_a_configured_secret_value(monkeypatch):
    fake_secret = "sk-do-not-print-this-value"
    monkeypatch.setenv("LLM_PROVIDER", "cohere")
    monkeypatch.setenv("OPENAI_API_KEY", fake_secret)
    with pytest.raises(MissingConfigurationError) as exc_info:
        create_chat_model()
    assert fake_secret not in str(exc_info.value)


# --- Provider instantiation with credentials present ---


def test_create_openai_model_when_key_present(monkeypatch):
    monkeypatch.setenv("LLM_PROVIDER", "openai")
    monkeypatch.setenv("LLM_MODEL", "gpt-4o-mini")
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test-not-a-real-secret")

    from langchain_openai import ChatOpenAI

    model = create_chat_model()
    assert isinstance(model, ChatOpenAI)


def test_create_anthropic_model_when_key_present(monkeypatch):
    monkeypatch.setenv("LLM_PROVIDER", "anthropic")
    monkeypatch.setenv("LLM_MODEL", "claude-3-5-sonnet-latest")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-test-not-a-real-secret")

    from langchain_anthropic import ChatAnthropic

    model = create_chat_model()
    assert isinstance(model, ChatAnthropic)
