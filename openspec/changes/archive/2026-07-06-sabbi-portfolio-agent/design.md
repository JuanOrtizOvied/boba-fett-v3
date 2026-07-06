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
│  │         │  useLangGraphRuntime       │  fetch /api/portfolio    │   │
│  │         └────────────┬───────────────┘                          │   │
│  └──────────────────────┼──────────────────────────────────────────┘   │
│                         │                                               │
│  ┌──────────────────────┼──────────────────────────────────────────┐   │
│  │  /api/[...path]/route.ts          Next.js API proxy             │   │
│  │  ├── /api/threads/*   → LangGraph (chat, streaming)             │   │
│  │  └── /api/portfolio/* → FastAPI   (CRUD, direct DB)             │   │
│  └──────────────────────┼──────────────────────────────────────────┘   │
└─────────────────────────┼──────────────────────────────────────────────┘
                          │ HTTP
                          ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                      PYTHON BACKEND                                     │
│                                                                         │
│  ┌────────────────────────────────┐  ┌──────────────────────────────┐  │
│  │  LangGraph StateGraph          │  │  FastAPI REST API            │  │
│  │                                │  │                              │  │
│  │  START ──► router ──┬──►       │  │  GET  /portfolio/:id        │  │
│  │    process_document │          │  │  POST /portfolio/:id/products│  │
│  │        ──► extract  │          │  │  PATCH /products/:id        │  │
│  │             ──► agent ◄─┐     │  │  DELETE /products/:id       │  │
│  │                  │      │     │  │  GET /portfolio/:id/summary  │  │
│  │           tools? ─┘     │     │  │                              │  │
│  │                  │      │     │  └──────────────┬───────────────┘  │
│  │              END ◄──────┘     │                 │                   │
│  │                                │                 │                   │
│  │  State: messages only          │                 │                   │
│  │  Tools: write to Postgres ─────┼─────────────────┤                   │
│  └────────────────────────────────┘                 │                   │
│                                                      │                   │
│  ┌───────────────────────────────────────────────────┘                   │
│  │                                                                       │
│  │  ┌──────────────────────────────────────────────────────────────┐    │
│  │  │  PostgreSQL                                                   │    │
│  │  │                                                               │    │
│  │  │  products (id, portfolio_id, name, provider, amount,          │    │
│  │  │           category, composition JSONB, created_at, updated_at)│    │
│  │  │                                                               │    │
│  │  │  LangGraph checkpointer tables (messages/threads only)        │    │
│  │  └──────────────────────────────────────────────────────────────┘    │
│  │                                                                       │
│  │  Model: ChatAnthropic("claude-sonnet-4-20250514")                    │
│  └───────────────────────────────────────────────────────────────────────┘
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Backend Data Models

### LangGraph State (`apps/backend/src/agent/state.py`)

The agent state is minimal — conversation messages only. Portfolio data
lives in PostgreSQL, not in the LangGraph checkpoint.

```python
from typing import Annotated
from typing_extensions import TypedDict
from langgraph.graph.message import add_messages
from langchain_core.messages import AnyMessage


class AgentState(TypedDict):
    messages: Annotated[list[AnyMessage], add_messages]
```

### Database Models (`apps/backend/src/db/models.py`)

Portfolio data persists in PostgreSQL. Products use JSONB for the composition
array — no need for a separate allocations table since compositions are always
read/written as a unit with the product.

```python
from pydantic import BaseModel, Field
import uuid


class AssetAllocation(BaseModel):
    name: str = Field(description="Asset class name, e.g. 'Deuda privada'")
    percentage: float = Field(ge=0, le=100)


class Product(BaseModel):
    id: str = Field(default_factory=lambda: f"prod_{uuid.uuid4().hex[:8]}")
    portfolio_id: str
    name: str
    provider: str = ""
    amount: float = Field(gt=0)
    category: str = Field(description="One of: directas, privados, club, publicos, otros, cash")
    composition: list[AssetAllocation] = Field(default_factory=list)


class ProductCreate(BaseModel):
    name: str
    provider: str = ""
    amount: float = Field(gt=0)
    category: str
    composition: list[AssetAllocation] = Field(default_factory=list)


class ProductUpdate(BaseModel):
    name: str | None = None
    provider: str | None = None
    amount: float | None = None
    category: str | None = None
    composition: list[AssetAllocation] | None = None
```

### Database Schema (`apps/backend/src/db/schema.sql`)

```sql
CREATE TABLE IF NOT EXISTS products (
    id TEXT PRIMARY KEY,
    portfolio_id TEXT NOT NULL,
    name TEXT NOT NULL,
    provider TEXT DEFAULT '',
    amount NUMERIC NOT NULL CHECK (amount > 0),
    category TEXT NOT NULL,
    composition JSONB DEFAULT '[]',
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_products_portfolio ON products (portfolio_id);
```

### Database Access (`apps/backend/src/db/repository.py`)

```python
import asyncpg
from db.models import Product, ProductCreate, ProductUpdate, AssetAllocation
import uuid, json


class ProductRepository:
    def __init__(self, pool: asyncpg.Pool):
        self.pool = pool

    async def list_by_portfolio(self, portfolio_id: str) -> list[Product]:
        rows = await self.pool.fetch(
            "SELECT * FROM products WHERE portfolio_id = $1 ORDER BY created_at",
            portfolio_id,
        )
        return [self._row_to_product(r) for r in rows]

    async def create(self, portfolio_id: str, data: ProductCreate) -> Product:
        product_id = f"prod_{uuid.uuid4().hex[:8]}"
        await self.pool.execute(
            """INSERT INTO products (id, portfolio_id, name, provider, amount, category, composition)
               VALUES ($1, $2, $3, $4, $5, $6, $7)""",
            product_id, portfolio_id, data.name, data.provider,
            data.amount, data.category, json.dumps([a.model_dump() for a in data.composition]),
        )
        return Product(id=product_id, portfolio_id=portfolio_id, **data.model_dump())

    async def update(self, product_id: str, data: ProductUpdate) -> Product | None:
        updates = data.model_dump(exclude_none=True)
        if "composition" in updates:
            updates["composition"] = json.dumps([a.model_dump() for a in data.composition])
        if not updates:
            return await self.get(product_id)
        set_clause = ", ".join(f"{k} = ${i+2}" for i, k in enumerate(updates))
        set_clause += f", updated_at = now()"
        row = await self.pool.fetchrow(
            f"UPDATE products SET {set_clause} WHERE id = $1 RETURNING *",
            product_id, *updates.values(),
        )
        return self._row_to_product(row) if row else None

    async def delete(self, product_id: str) -> bool:
        result = await self.pool.execute("DELETE FROM products WHERE id = $1", product_id)
        return result == "DELETE 1"

    async def get_summary(self, portfolio_id: str) -> dict:
        products = await self.list_by_portfolio(portfolio_id)
        total = sum(p.amount for p in products)
        by_category = {}
        for p in products:
            by_category.setdefault(p.category, []).append(p)
        distribution = {cat: sum(p.amount for p in prods) / total * 100 if total else 0
                        for cat, prods in by_category.items()}
        largest = max(products, key=lambda p: p.amount) if products else None
        return {
            "total_amount": total,
            "product_count": len(products),
            "categories_used": list(by_category.keys()),
            "distribution": distribution,
            "largest_position": {"name": largest.name, "percentage": largest.amount / total * 100}
                                if largest else None,
        }

    def _row_to_product(self, row) -> Product:
        comp = json.loads(row["composition"]) if isinstance(row["composition"], str) else row["composition"]
        return Product(
            id=row["id"], portfolio_id=row["portfolio_id"], name=row["name"],
            provider=row["provider"], amount=float(row["amount"]), category=row["category"],
            composition=[AssetAllocation(**a) for a in (comp or [])],
        )
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
from langgraph.prebuilt import ToolNode
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
        return "tools"
    return END


builder = StateGraph(AgentState)

# Nodes
builder.add_node("router", router_node)
builder.add_node("process_document", process_document_node)
builder.add_node("extract_products", extract_products_node)
builder.add_node("agent", agent_node)
builder.add_node("tools", ToolNode(portfolio_tools))  # standard ToolNode — tools write to DB directly

# Edges
builder.add_edge(START, "router")
builder.add_conditional_edges("router", should_route, {
    "process_document": "process_document",
    "agent": "agent",
})
builder.add_edge("process_document", "extract_products")
builder.add_edge("extract_products", "agent")
builder.add_conditional_edges("agent", should_continue, {
    "tools": "tools",
    END: END,
})
builder.add_edge("tools", "agent")  # after tool execution, loop back to agent

# Compile with checkpointing
memory = MemorySaver()
graph = builder.compile(checkpointer=memory)
```

---

## Backend — Tools (`apps/backend/src/agent/tools.py`)

Tools read/write directly to PostgreSQL via the `ProductRepository`. The
`portfolio_id` is passed as LangGraph config (via `RunnableConfig`) so each
conversation thread operates on its own portfolio.

```python
from langchain_core.tools import tool
from langchain_core.runnables import RunnableConfig
from db.models import ProductCreate, ProductUpdate, AssetAllocation
from db.connection import get_repository


@tool
async def add_product(
    name: str,
    amount: float,
    category: str,
    provider: str = "",
    composition: list[dict] | None = None,
    *,
    config: RunnableConfig,
) -> dict:
    """Add a new investment product to the portfolio.

    Args:
        name: Product name (e.g., 'BlackRock Private Credit Fund')
        amount: Investment amount in USD
        category: One of: directas, privados, club, publicos, otros, cash
        provider: Provider/manager name
        composition: List of {name: str, percentage: float} asset allocations
    """
    repo = get_repository(config)
    portfolio_id = config["configurable"]["portfolio_id"]
    comp = [
        AssetAllocation(name=c["name"], percentage=c["percentage"])
        for c in (composition or [{"name": name, "percentage": 100}])
    ]
    product = await repo.create(
        portfolio_id,
        ProductCreate(name=name, provider=provider, amount=amount,
                      category=category, composition=comp),
    )
    return {"status": "added", "product": product.model_dump()}


@tool
async def update_product(
    product_id: str,
    name: str | None = None,
    provider: str | None = None,
    amount: float | None = None,
    category: str | None = None,
    composition: list[dict] | None = None,
    *,
    config: RunnableConfig,
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
    repo = get_repository(config)
    comp = [AssetAllocation(**c) for c in composition] if composition else None
    product = await repo.update(
        product_id,
        ProductUpdate(name=name, provider=provider, amount=amount,
                      category=category, composition=comp),
    )
    if not product:
        return {"status": "error", "message": f"Product {product_id} not found"}
    return {"status": "updated", "product": product.model_dump()}


@tool
async def delete_product(
    product_id: str,
    *,
    config: RunnableConfig,
) -> dict:
    """Remove an investment product from the portfolio.

    Args:
        product_id: ID of the product to remove
    """
    repo = get_repository(config)
    deleted = await repo.delete(product_id)
    if not deleted:
        return {"status": "error", "message": f"Product {product_id} not found"}
    return {"status": "deleted", "product_id": product_id}


@tool
async def get_portfolio_summary(
    *,
    config: RunnableConfig,
) -> dict:
    """Get a summary of the current portfolio with totals and distribution.
    Call this when the user asks about their portfolio status or to generate
    the final portfolio view.
    """
    repo = get_repository(config)
    portfolio_id = config["configurable"]["portfolio_id"]
    return await repo.get_summary(portfolio_id)


portfolio_tools = [add_product, update_product, delete_product, get_portfolio_summary]
```

---

## Backend — Nodes (`apps/backend/src/agent/nodes.py`)

With portfolio state in Postgres, nodes only manage conversation flow.
Document processing uses a two-step approach: first extract raw data with
Claude, then the agent node uses tools to persist products to the DB.

```python
from langchain_anthropic import ChatAnthropic
from langchain_core.messages import SystemMessage, HumanMessage
from agent.state import AgentState
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
    if hasattr(last_msg, "content") and isinstance(last_msg.content, list):
        for block in last_msg.content:
            if isinstance(block, dict) and block.get("type") in ("image_url", "image", "document"):
                return {"messages": []}  # route to process_document
    return {"messages": []}  # route to agent


def has_file_attachment(state: AgentState) -> str:
    """Check if the latest user message has a file attachment."""
    last_msg = state["messages"][-1]
    if hasattr(last_msg, "content") and isinstance(last_msg.content, list):
        for block in last_msg.content:
            if isinstance(block, dict) and block.get("type") in ("image_url", "image", "document"):
                return "process_document"
    return "agent"


async def process_document_node(state: AgentState) -> dict:
    """Process uploaded documents using Claude vision/text capabilities.
    Extracts product data and injects it as a system message for the agent."""
    last_msg = state["messages"][-1]

    extraction_prompt = """Analiza este documento.

Extrae TODOS los productos de inversión que encuentres. Para cada producto identifica:
- nombre del producto o fondo
- institución administradora (provider)
- monto invertido en USD
- categoría (una de: directas, privados, club, publicos, otros, cash)
- composición por asset class si está disponible

Presenta los productos encontrados en una lista clara y luego usa la tool
add_product para agregar cada uno al portafolio del usuario."""

    return {
        "messages": [HumanMessage(content=extraction_prompt)],
    }


async def agent_node(state: AgentState) -> dict:
    """Main conversational agent node with tool calling."""
    messages = [SystemMessage(content=SYSTEM_PROMPT)] + state["messages"]
    response = await llm_with_tools.ainvoke(messages)
    return {"messages": [response]}
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

Portfolio state lives in **PostgreSQL**. The frontend fetches it via the
REST API (`/api/portfolio/:id`). Chat state lives in LangGraph (messages only).

```
useLangGraphRuntime (assistant-ui)
  └── Chat messages ← synced with LangGraph thread

usePortfolio (React hook, fetches from REST API)
  ├── products: Product[]              ← GET /api/portfolio/:id
  ├── activeCategory: string | "todos" ← local UI state (useState)
  ├── editingProduct: Product | null   ← local UI state (useState)
  ├── isModalOpen: boolean             ← local UI state (useState)
  ├── refetch()                        ← re-fetch after mutations
  └── computed (useMemo):
      ├── totalAmount
      ├── productCount
      ├── categoryDistribution
      └── largestPosition
```

### Portfolio Identity (v1 — no auth)

A `portfolio_id` (UUID) is generated on first visit and stored in `localStorage`.
It is passed to:
- The REST API as a path parameter (`/api/portfolio/:id`)
- The LangGraph agent as `configurable.portfolio_id` (so tools know which portfolio to write to)

```typescript
const getPortfolioId = (): string => {
  let id = localStorage.getItem("portfolio_id");
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem("portfolio_id", id);
  }
  return id;
};
```

When auth is added (v1.1+), the `portfolio_id` gets associated with a user
account and the localStorage fallback becomes a migration path.

### Data Flow — Two Paths, One Database

```
AI-assisted (chat):
  User message → LangGraph agent → tool call (add_product)
    → tool writes to Postgres → agent responds
    → frontend refetches portfolio → panel re-renders

Manual (modal):
  User clicks "Save" → PATCH /api/portfolio/products/:id
    → FastAPI writes to Postgres → 200 OK
    → frontend refetches portfolio → panel re-renders
```

Both paths write to the same `products` table. The portfolio panel polls
or refetches after every chat interaction completes and after every manual
CRUD operation.

```typescript
// In usePortfolio.ts — fetch portfolio from REST API
const usePortfolio = (portfolioId: string) => {
  const [products, setProducts] = useState<Product[]>([]);

  const refetch = useCallback(async () => {
    const res = await fetch(`/api/portfolio/${portfolioId}`);
    const data = await res.json();
    setProducts(data.products);
  }, [portfolioId]);

  useEffect(() => { refetch(); }, [refetch]);

  return { products, refetch, /* ...computed values... */ };
};
```

---

## Backend — REST API (`apps/backend/src/api/routes.py`)

FastAPI app co-located in the backend. Handles direct CRUD operations from
the frontend — no LLM involved. Shares the same Postgres connection pool
and `ProductRepository` as the agent tools.

```python
from fastapi import FastAPI, HTTPException
from db.models import ProductCreate, ProductUpdate
from db.connection import get_pool, ProductRepository

app = FastAPI(title="SABBI Portfolio API")


@app.on_event("startup")
async def startup():
    app.state.pool = await get_pool()
    app.state.repo = ProductRepository(app.state.pool)


@app.get("/portfolio/{portfolio_id}")
async def list_products(portfolio_id: str):
    products = await app.state.repo.list_by_portfolio(portfolio_id)
    return {"products": [p.model_dump() for p in products]}


@app.post("/portfolio/{portfolio_id}/products", status_code=201)
async def create_product(portfolio_id: str, data: ProductCreate):
    product = await app.state.repo.create(portfolio_id, data)
    return product.model_dump()


@app.patch("/products/{product_id}")
async def update_product(product_id: str, data: ProductUpdate):
    product = await app.state.repo.update(product_id, data)
    if not product:
        raise HTTPException(404, f"Product {product_id} not found")
    return product.model_dump()


@app.delete("/products/{product_id}", status_code=204)
async def delete_product(product_id: str):
    deleted = await app.state.repo.delete(product_id)
    if not deleted:
        raise HTTPException(404, f"Product {product_id} not found")


@app.get("/portfolio/{portfolio_id}/summary")
async def portfolio_summary(portfolio_id: str):
    return await app.state.repo.get_summary(portfolio_id)


@app.get("/portfolio/{portfolio_id}/export")
async def export_excel(portfolio_id: str):
    """Generate and return a .xlsx file matching the SABBI template format."""
    from fastapi.responses import StreamingResponse
    from db.excel import generate_portfolio_excel

    products = await app.state.repo.list_by_portfolio(portfolio_id)
    buffer = generate_portfolio_excel(products)
    return StreamingResponse(
        buffer,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename=portfolio_{portfolio_id[:8]}.xlsx"},
    )
```

### Excel Generation (`apps/backend/src/db/excel.py`)

Server-side Excel generation using openpyxl. The data is already in Postgres —
no round-trip to the browser. Zero frontend bundle impact.

```python
from io import BytesIO
from openpyxl import Workbook
from db.models import Product
from agent.state import CATEGORIES


def generate_portfolio_excel(products: list[Product]) -> BytesIO:
    wb = Workbook()

    # One sheet per category with products
    by_category = {}
    for p in products:
        by_category.setdefault(p.category, []).append(p)

    first = True
    for cat_key, cat_info in CATEGORIES.items():
        cat_products = by_category.get(cat_key, [])
        if not cat_products:
            continue
        ws = wb.active if first else wb.create_sheet()
        first = False
        ws.title = cat_info["label"][:31]  # Excel sheet name limit

        ws.append(["Producto", "Proveedor", "Monto (USD)", "Subcategoría"])
        for p in cat_products:
            ws.append([p.name, p.provider, p.amount, ""])
        ws.append([])
        ws.append(["Total", "", sum(p.amount for p in cat_products)])

    # Summary sheet
    ws_summary = wb.create_sheet("Portafolio Final")
    total = sum(p.amount for p in products)
    ws_summary.append(["Categoría", "Monto (USD)", "% del Total"])
    for cat_key, cat_info in CATEGORIES.items():
        cat_total = sum(p.amount for p in by_category.get(cat_key, []))
        pct = (cat_total / total * 100) if total else 0
        ws_summary.append([cat_info["label"], cat_total, round(pct, 1)])
    ws_summary.append(["Total", total, 100.0])

    buffer = BytesIO()
    wb.save(buffer)
    buffer.seek(0)
    return buffer
```

### Running Both Services

In development, the backend runs two servers:
- LangGraph dev server on `:2024` (conversation + agent)
- FastAPI on `:3003` (portfolio CRUD)

The Next.js API proxy routes requests by path prefix:
- `/api/threads/*`, `/api/runs/*` → LangGraph (`:2024`)
- `/api/portfolio/*`, `/api/products/*` → FastAPI (`:3003`)

In production, both can be mounted as a single ASGI app or run as
separate containers behind the ALB.

---

## Environment Variables

### Backend (`apps/backend/.env`)

```env
ANTHROPIC_API_KEY=sk-ant-...
DATABASE_URL=postgresql://user:pass@localhost:5432/sabbi
LANGSMITH_API_KEY=lsv2_...
LANGSMITH_TRACING=true
LANGSMITH_PROJECT=sabbi-portfolio-agent
```

### Frontend (`apps/web/.env.local`)

```env
NEXT_PUBLIC_LANGGRAPH_API_URL=http://localhost:2024
NEXT_PUBLIC_PORTFOLIO_API_URL=http://localhost:3003
NEXT_PUBLIC_LANGGRAPH_ASSISTANT_ID=agent
# Production only:
# LANGGRAPH_API_URL=http://<backend-ec2>:8000
# LANGCHAIN_API_KEY=lsv2_...
```

---

## Deployment

Same as boilerplate template: Docker → ECR → EC2 (GitHub Actions).

Backend uses Gunicorn + Uvicorn workers. Frontend uses PM2.

Key changes from boilerplate:
- Replace `OPENAI_API_KEY` with `ANTHROPIC_API_KEY` in deploy-backend.yml
- Add `DATABASE_URL` to backend deploy secrets (Postgres required)
- Add FastAPI service (can run as separate container or mount alongside LangGraph)