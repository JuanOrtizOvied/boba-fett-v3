"""LangGraph graph definition for the SABBI portfolio assistant.

Exposed as graph id `agent` via `langgraph.json` at `./src/agent/graph.py:graph`.

Nodes: `router` -> (`process_document` | `agent`) -> `agent` -> (`tools` | END),
`tools` -> `agent` (loop). Portfolio mutations happen inside `tools` (a
standard `ToolNode`) which write directly to PostgreSQL — the graph state
itself only carries `messages`.
"""

from __future__ import annotations

from langgraph.checkpoint.memory import MemorySaver
from langgraph.graph import END, START, StateGraph
from langgraph.prebuilt import ToolNode

from agent.nodes import agent_node, has_file_attachment, process_document_node, router_node
from agent.state import AgentState
from agent.tools import portfolio_tools


def should_continue(state: AgentState) -> str:
    """Route to `tools` while the last agent message still has pending tool calls."""
    last_message = state["messages"][-1]
    if getattr(last_message, "tool_calls", None):
        return "tools"
    return END


builder = StateGraph(AgentState)

builder.add_node("router", router_node)
builder.add_node("process_document", process_document_node)
builder.add_node("agent", agent_node)
# Standard ToolNode — tools write to Postgres directly, no custom executor.
builder.add_node("tools", ToolNode(portfolio_tools))

builder.add_edge(START, "router")
builder.add_conditional_edges(
    "router",
    has_file_attachment,
    {"process_document": "process_document", "agent": "agent"},
)
builder.add_edge("process_document", "agent")
builder.add_conditional_edges("agent", should_continue, {"tools": "tools", END: END})
builder.add_edge("tools", "agent")  # after tool execution, loop back to agent

graph = builder.compile(checkpointer=MemorySaver())
