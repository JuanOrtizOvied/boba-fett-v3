"""Agent state schema shared across graph nodes."""

from __future__ import annotations

from typing import Annotated

from langchain_core.messages import AnyMessage
from langgraph.graph.message import add_messages
from typing_extensions import TypedDict


class AgentState(TypedDict):
    """State threaded through the assistant graph.

    `messages` accumulates the conversation using LangGraph's `add_messages`
    reducer so nodes can append new messages without overwriting history.
    """

    messages: Annotated[list[AnyMessage], add_messages]
