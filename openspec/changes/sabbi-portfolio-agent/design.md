# Design: sabbi-portfolio-agent

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           BROWSER                                       │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │  Next.js 15 + assistant-ui + React 19 + Tailwind                │   │
│  │                                                                  │   │
│  │  ┌─────────────┐    ┌──────────────────────────────────────┐    │   │
│  │  │  Chat Panel  │    │  Portfolio Panel                     │    │   │
│  │  │  (assistant- │    │  - Metrics cards                     │    │   │
│  │  │   ui Thread) │    │  - Category tabs + filters           │    │   │
│  │  │             │    │  - Product cards grid (per category)  │    │   │
│  │  │  Messages   │    │  - Edit modal (two-column)            │    │   │
│  │  │  File upload│    │  - Delete confirm inline              │    │   │
│  │  │  Input bar  │    │  - Add product button                 │    │   │
│  │  └──────┬──────┘    └────────────────┬─────────────────────┘    │   │
│  │         │     useLangGraphRuntime    │  React state (zustand)   │   │
│  │         └────────────┬───────────────┘                          │   │
│  └──────────────────────┼──────────────────────────────────────────┘   │
│                         │ SSE streaming                                 │
│                         ▼                                               │
│  ┌──────────────────────────────────┐                                   │
│  │  /api/[...path]/route.ts        │  Next.js API proxy                │
│  │  Injects LANGCHAIN_API_KEY      │  (server-side, key never exposed) │
│  └──────────────────┬──────────────┘                                   │
└─────────────────────┼──────────────────────────────────────────────────┘
                      │ HTTP
                      ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                      LANGGRAPH SERVER (Python)                          │
│                                                                         │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │  LangGraph StateGraph                                            │   │
│  │                                                                  │   │
│  │   START ──► router ──┬──► process_document ──► extract_products  │   │
│  │                      │                              │            │   │
│  │                      │         ┌────────────────────┘            │   │
│  │                      │         ▼                                 │   │
│  │                      └──► agent (Claude + tools) ◄──┐           │   │
│  │                              │                      │            │   │
│  │                              ├── tool call? ────────┘            │   │
│  │                              │                                   │   │
│  │                              └── no tools ──► END               │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  Model: ChatAnthropic("claude-sonnet-4-20250514")                       │
│                                                                         │
│  Tools:                                                                 │
│    - add_product(name, provider, amount, category, composition)         │
│    - update_product(product_id, **fields)                               │
│    - delete_product(product_id)                                         │
│    - get_portfolio_summary()                                            │
│                                                                         │
│  Checkpointer: MemorySaver (dev) / PostgresSaver (prod)                │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Backend Data Models

### Python — State & Models (`apps/backend/src/agent/state.py`)

```python
from typing import Annotated, Optional
from typing_extensions import TypedDict
from langgraph.graph.message import add_messages
from langchain_core.messages import AnyMessage
from pydantic import BaseModel, Field
import uuid


class AssetAllocation(BaseModel):
    """Single asset class allocation within a product."""
    name: str = Field(description="Asset class name, e.g. 'Deuda privada'")
    percentage: float = Field(ge=0, le=100, description="Allocation percentage")


class Product(BaseModel):
    """Investment product in the portfolio."""
    id: str = Field(default_factory=lambda: f"prod_{uuid.uuid4().hex[:8]}")
    name: str
    provider: str = ""
    amount: float = Field(gt=0)
    category: str = Field(description="One of: directas, privados, club, publicos, otros, cash")
    composition: list[AssetAllocation] = Field(default_factory=list)


class ExtractedProduct(BaseModel):
    """Product extracted from a document, pending user confirmation."""
    name: str
    provider: str = ""
    amount: float
    category: str
    subcategory: str = ""
    composition: list[AssetAllocation] = Field(default_factory=list)
    confidence: float = Field(ge=0, le=1, description="Extraction confidence score")
    source: str = Field(description="Filename or URL the product was extracted from")


class DocumentInfo(BaseModel):
    """Metadata about a document being processed."""
    filename: str
    file_type: str  # "pdf", "image", "factsheet", "link"
    content_summary: str = ""


def merge_portfolio(
    existing: dict[str, Product],
    update: dict[str, Product]
) -> dict[str, Product]:
    """Custom reducer: merges portfolio dicts, update overwrites by key."""
    merged = {**existing}
    for key, val in update.items():
        if val is None:
            merged.pop(key, None)  # None signals deletion
        else:
            merged[key] = val
    return merged


class AgentState(TypedDict):
    messages: Annotated[list[AnyMessage], add_messages]
    portfolio: Annotated[dict[str, Product], merge_portfolio]
    processing_status: str  # "idle" | "processing" | "awaiting_confirm"
    current_document: Optional[DocumentInfo]
    extracted_products: list[ExtractedProduct]
```

### Category Taxonomy

```python
CATEGORIES = {
    "directas": {
        "label": "Inversiones directas",
        "subcategories": [
            "Accionariado",
            "RE Perú - Residencial",
            "RE Perú - Comercial",
            "RE Perú - Terrenos",
            "RE Extranjero",
        ],
    },
    "privados": {
        "label": "Mercados privados",
        "subcategories": [
            "Deuda privada",
            "Private equity",
            "Venture capital",
            "Real estate",
            "Hedge funds",
            "Infraestructura",
        ],
    },
    "club": {
        "label": "Club deals",
        "subcategories": ["Real estate", "Deuda privada", "Otros"],
    },
    "publicos": {
        "label": "Mercados públicos",
        "subcategories": [
            "RV US Large Cap", "RV US Small Cap",
            "RV International", "RV Emerging Markets",
            "RF Government", "RF Corporate",
            "RF High Yield", "RF Emerging Markets",
        ],
    },
    "otros": {
        "label": "Otros",
        "subcategories": ["Cripto", "Commodities"],
    },
    "cash": {
        "label": "Cash y equivalentes",
        "subcategories": ["Depósitos a plazo", "Money market", "Cuentas corrientes"],
    },
}
```

---

## Backend — LangGraph Graph (`apps/backend/src/agent/graph.py`)

```python
from langgraph.graph import StateGraph, START, END
from langgraph.checkpoint.memory import MemorySaver
from langchain_anthropic import ChatAnthropic
from agent.state import AgentState
from agent.nodes import router_node, process_document_node, extract_products_node, agent_node
from agent.tools import portfolio_tools


# LLM — Anthropic only
llm = ChatAnthropic(
    model="claude-sonnet-4-20250514",
    temperature=0,
    max_tokens=4096,
)

# Bind tools to the LLM
llm_with_tools = llm.bind_tools(portfolio_tools)


def should_route(state: AgentState) -> str:
    """Route based on whether there's a document to process or text input."""
    if state.get("current_document"):
        return "process_document"
    return "agent"


def should_continue(state: AgentState) -> str:
    """Check if the agent wants to call more tools."""
    last_message = state["messages"][-1]
    if hasattr(last_message, "tool_calls") and last_message.tool_calls:
        return "agent"  # Loop back to process tool calls
    return END


builder = StateGraph(AgentState)

# Nodes
builder.add_node("router", router_node)
builder.add_node("process_document", process_document_node)
builder.add_node("extract_products", extract_products_node)
builder.add_node("agent", agent_node)

# Edges
builder.add_edge(START, "router")
builder.add_conditional_edges("router", should_route, {
    "process_document": "process_document",
    "agent": "agent",
})
builder.add_edge("process_document", "extract_products")
builder.add_edge("extract_products", "agent")
builder.add_conditional_edges("agent", should_continue, {
    "agent": "agent",
    END: END,
})

# Compile with checkpointing
memory = MemorySaver()
graph = builder.compile(checkpointer=memory)
```

---

## Backend — Tools (`apps/backend/src/agent/tools.py`)

```python
from langchain_core.tools import tool
from agent.state import Product, AssetAllocation
import uuid


@tool
def add_product(
    name: str,
    amount: float,
    category: str,
    provider: str = "",
    composition: list[dict] | None = None,
) -> dict:
    """Add a new investment product to the portfolio.

    Args:
        name: Product name (e.g., 'BlackRock Private Credit Fund')
        amount: Investment amount in USD
        category: One of: directas, privados, club, publicos, otros, cash
        provider: Provider/manager name
        composition: List of {name: str, percentage: float} asset allocations
    """
    product_id = f"prod_{uuid.uuid4().hex[:8]}"
    comp = [
        AssetAllocation(name=c["name"], percentage=c["percentage"])
        for c in (composition or [{"name": name, "percentage": 100}])
    ]
    product = Product(
        id=product_id,
        name=name,
        provider=provider,
        amount=amount,
        category=category,
        composition=comp,
    )
    return {
        "status": "added",
        "product": product.model_dump(),
    }


@tool
def update_product(
    product_id: str,
    name: str | None = None,
    provider: str | None = None,
    amount: float | None = None,
    category: str | None = None,
    composition: list[dict] | None = None,
) -> dict:
    """Update an existing investment product.

    Args:
        product_id: ID of the product to update
        name: New product name (optional)
        provider: New provider name (optional)
        amount: New amount in USD (optional)
        category: New category (optional)
        composition: New composition list (optional)
    """
    return {
        "status": "updated",
        "product_id": product_id,
        "updates": {
            k: v for k, v in {
                "name": name, "provider": provider,
                "amount": amount, "category": category,
                "composition": composition,
            }.items() if v is not None
        },
    }


@tool
def delete_product(product_id: str) -> dict:
    """Remove an investment product from the portfolio.

    Args:
        product_id: ID of the product to remove
    """
    return {"status": "deleted", "product_id": product_id}


@tool
def get_portfolio_summary() -> dict:
    """Get a summary of the current portfolio with totals and distribution.
    Call this when the user asks about their portfolio status or to generate
    the final portfolio view.
    """
    return {"status": "summary_requested"}


portfolio_tools = [add_product, update_product, delete_product, get_portfolio_summary]
```

---

## Backend — Nodes (`apps/backend/src/agent/nodes.py`)

```python
import base64
from langchain_anthropic import ChatAnthropic
from langchain_core.messages import SystemMessage, HumanMessage, AIMessage
from agent.state import AgentState, CATEGORIES, ExtractedProduct, DocumentInfo
from agent.tools import portfolio_tools

llm = ChatAnthropic(model="claude-sonnet-4-20250514", temperature=0, max_tokens=4096)
llm_with_tools = llm.bind_tools(portfolio_tools)

SYSTEM_PROMPT = """Eres el asistente de SABBI para construir portafolios de inversión.

Tu rol es ayudar al inversionista a clasificar todos sus productos de inversión
en las 6 categorías del portafolio SABBI:

1. Inversiones directas: Accionariado, RE Perú (residencial/comercial/terrenos), RE Extranjero
2. Mercados privados: Deuda privada, Private equity, VC, Real estate, Hedge funds, Infraestructura
3. Club deals: Real estate, Deuda privada, Otros
4. Mercados públicos: Renta variable (US/Intl/EM), Renta fija (Gov/Corp/HY/EM)
5. Otros: Cripto, Commodities
6. Cash y equivalentes: Depósitos a plazo, Money market, Cuentas corrientes

REGLAS:
- Cuando identifiques productos, usa la tool add_product para cada uno.
- Si un producto tiene exposición a múltiples asset classes, detalla la composición.
- Siempre confirma con el usuario los datos extraídos antes de continuar.
- Responde en español, tono profesional y amigable.
- Cuando el usuario describa inversiones en texto libre, identifica nombre, monto y categoría.
- Si no puedes identificar algún dato, pregunta específicamente.
- Muestra los productos encontrados en formato de lista con categoría, nombre y monto.
"""


async def router_node(state: AgentState) -> dict:
    """Inspect the latest message for file attachments and route accordingly."""
    last_msg = state["messages"][-1]
    # Check for file content in the message
    if hasattr(last_msg, "content") and isinstance(last_msg.content, list):
        for block in last_msg.content:
            if isinstance(block, dict) and block.get("type") in ("image_url", "image", "document"):
                file_type = "image" if block["type"] in ("image_url", "image") else "pdf"
                return {
                    "current_document": DocumentInfo(
                        filename=block.get("filename", "uploaded_file"),
                        file_type=file_type,
                    ),
                    "processing_status": "processing",
                }
    return {"current_document": None, "processing_status": "idle"}


async def process_document_node(state: AgentState) -> dict:
    """Process uploaded documents using Claude vision/text capabilities."""
    doc = state.get("current_document")
    if not doc:
        return {"processing_status": "idle"}

    last_msg = state["messages"][-1]
    extraction_prompt = f"""Analiza este documento ({doc.file_type}: {doc.filename}).

Extrae TODOS los productos de inversión que encuentres. Para cada producto retorna JSON:
{{
  "products": [
    {{
      "name": "nombre del producto o fondo",
      "provider": "institución administradora",
      "amount": monto_en_USD_como_numero,
      "category": "una de: directas, privados, club, publicos, otros, cash",
      "subcategory": "subcategoría específica",
      "composition": [{{"name": "asset class", "percentage": porcentaje}}],
      "confidence": 0.0-1.0
    }}
  ]
}}

Si es un factsheet, extrae la composición detallada por asset class.
Si no puedes determinar el monto, pon 0 y confidence bajo.
Responde SOLO con el JSON, sin texto adicional."""

    response = await llm.ainvoke([
        SystemMessage(content="Eres un extractor de datos de productos de inversión. Responde solo en JSON."),
        last_msg,
        HumanMessage(content=extraction_prompt),
    ])

    return {
        "current_document": DocumentInfo(
            filename=doc.filename,
            file_type=doc.file_type,
            content_summary=response.content if isinstance(response.content, str) else str(response.content),
        ),
    }


async def extract_products_node(state: AgentState) -> dict:
    """Parse extracted JSON into structured ExtractedProduct objects."""
    import json
    doc = state.get("current_document")
    if not doc or not doc.content_summary:
        return {"extracted_products": [], "processing_status": "idle"}

    try:
        # Clean JSON from possible markdown fencing
        raw = doc.content_summary.strip()
        if raw.startswith("```"):
            raw = raw.split("\n", 1)[1].rsplit("```", 1)[0]
        data = json.loads(raw)
        products = [
            ExtractedProduct(
                name=p["name"],
                provider=p.get("provider", ""),
                amount=p.get("amount", 0),
                category=p.get("category", "otros"),
                subcategory=p.get("subcategory", ""),
                composition=[
                    {"name": c["name"], "percentage": c["percentage"]}
                    for c in p.get("composition", [])
                ],
                confidence=p.get("confidence", 0.8),
                source=doc.filename,
            )
            for p in data.get("products", [])
        ]
    except (json.JSONDecodeError, KeyError):
        products = []

    return {
        "extracted_products": products,
        "processing_status": "awaiting_confirm" if products else "idle",
    }


async def agent_node(state: AgentState) -> dict:
    """Main conversational agent node with tool calling."""
    messages = [SystemMessage(content=SYSTEM_PROMPT)] + state["messages"]

    # If there are extracted products pending, inject them as context
    extracted = state.get("extracted_products", [])
    if extracted:
        products_text = "\n".join(
            f"- {p.name} | {p.provider} | ${p.amount:,.0f} | {p.category}"
            for p in extracted
        )
        messages.append(HumanMessage(
            content=f"[SISTEMA] Productos extraídos del documento:\n{products_text}\n\n"
                    "Usa la tool add_product para agregar cada uno al portafolio, "
                    "luego confirma con el usuario."
        ))

    response = await llm_with_tools.ainvoke(messages)

    return {
        "messages": [response],
        "extracted_products": [],  # Clear after processing
        "processing_status": "idle",
        "current_document": None,
    }
```

---

## Frontend Architecture

### Key Components

| Component | Path | Responsibility |
|-----------|------|----------------|
| `MyAssistant` | `app/assistant.tsx` | LangGraph runtime wiring + split layout |
| `ChatPanel` | `components/chat/ChatPanel.tsx` | Chat messages + input (assistant-ui Thread) |
| `PortfolioPanel` | `components/portfolio/PortfolioPanel.tsx` | Metrics + tabs + cards grid |
| `ProductCard` | `components/portfolio/ProductCard.tsx` | Card view + delete confirm inline |
| `EditProductModal` | `components/portfolio/EditProductModal.tsx` | Two-column edit/add modal |
| `PortfolioSummary` | `components/portfolio/PortfolioSummary.tsx` | Donut chart + consolidated table |
| `MetricsRow` | `components/portfolio/MetricsRow.tsx` | Four metric cards |
| `CategoryTabs` | `components/portfolio/CategoryTabs.tsx` | Filter tabs by category |

### State Management

```
useLangGraphRuntime (assistant-ui)
  ├── Chat messages ← synced with LangGraph thread
  └── Tool call results ← triggers portfolio updates

usePortfolioStore (zustand)
  ├── products: Map<string, Product>
  ├── activeCategory: string | "todos"
  ├── editingProduct: Product | null
  ├── isModalOpen: boolean
  ├── computed:
  │   ├── totalAmount
  │   ├── productCount
  │   ├── categoryDistribution
  │   └── largestPosition
  └── actions:
      ├── addProduct(product)
      ├── updateProduct(id, updates)
      ├── deleteProduct(id)
      ├── setActiveCategory(cat)
      └── openEditModal(product | null)
```

### Tool Result → UI Sync

When the LangGraph agent calls `add_product`, `update_product`, or `delete_product`,
the tool results stream to the frontend via SSE. The assistant-ui runtime receives
these as tool call messages. A custom `useEffect` hook watches for tool results
and dispatches the corresponding zustand actions to update the portfolio panel.

```typescript
// In assistant.tsx — sync tool results to portfolio state
useEffect(() => {
  const toolMessages = messages.filter(m => m.role === "tool");
  for (const tm of toolMessages) {
    const result = JSON.parse(tm.content);
    if (result.status === "added") store.addProduct(result.product);
    if (result.status === "updated") store.updateProduct(result.product_id, result.updates);
    if (result.status === "deleted") store.deleteProduct(result.product_id);
  }
}, [messages]);
```

---

## Environment Variables

### Backend (`apps/backend/.env`)

```env
ANTHROPIC_API_KEY=sk-ant-...
LANGSMITH_API_KEY=lsv2_...
LANGSMITH_TRACING=true
LANGSMITH_PROJECT=sabbi-portfolio-agent
```

### Frontend (`apps/web/.env.local`)

```env
NEXT_PUBLIC_LANGGRAPH_API_URL=http://localhost:2024
NEXT_PUBLIC_LANGGRAPH_ASSISTANT_ID=agent
# Production only:
# LANGGRAPH_API_URL=http://<backend-ec2>:8000
# LANGCHAIN_API_KEY=lsv2_...
```

---

## Deployment

Same as boilerplate template: Docker → ECR → EC2 (GitHub Actions).

Backend uses Gunicorn + Uvicorn workers. Frontend uses PM2.

Key change from boilerplate: replace `OPENAI_API_KEY` with `ANTHROPIC_API_KEY`
in backend deploy workflow secrets.