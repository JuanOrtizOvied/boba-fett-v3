"""LangGraph assistant graph definition.

Exposed as graph id `agent` via `langgraph.json` at `./src/agent/graph.py:graph`.
"""

from __future__ import annotations

from langgraph.graph import END, START, StateGraph

from agent.nodes import chatbot
from agent.state import AgentState

builder = StateGraph(AgentState)
builder.add_node("chatbot", chatbot)
builder.add_edge(START, "chatbot")
builder.add_edge("chatbot", END)

graph = builder.compile()
