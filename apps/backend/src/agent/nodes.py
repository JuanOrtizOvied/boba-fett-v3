"""Graph node functions for the assistant agent."""

from __future__ import annotations

from agent.models import create_chat_model
from agent.state import AgentState


async def chatbot(state: AgentState) -> AgentState:
    """Invoke the configured chat model with the current conversation.

    The chat model is created lazily on each invocation so importing/compiling
    the graph never requires provider credentials to be present.
    """
    model = create_chat_model()
    response = await model.ainvoke(state["messages"])
    return {"messages": [response]}
