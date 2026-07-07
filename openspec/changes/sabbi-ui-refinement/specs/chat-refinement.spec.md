# Delta for portfolio-builder / conversation

## ADDED Requirements

### Requirement: Chat header with agent identity

The chat panel MUST show a dedicated header above the message thread with a gradient avatar and an online status indicator.

#### Scenario: Chat header renders avatar and status

- GIVEN the investor opens the portfolio builder
- WHEN the chat panel loads
- THEN a header shows a circular gradient avatar (robot icon) and the label "Asistente SABBI"
- AND a green status dot with text "En línea" appears next to the label

### Requirement: Grouped inline tool result cards

Portfolio-mutating tool calls (`add_product`, `update_product`, `delete_product`) emitted during a single assistant turn MUST render as ONE inline card listing every affected product, not one card per tool call.

#### Scenario: Single turn adds multiple products

- GIVEN the agent's turn issues 4 `add_product` tool calls
- WHEN the assistant message renders
- THEN exactly one tool-result card appears in that message
- AND the card lists all 4 products, each with a category badge, product name, and amount

#### Scenario: Mixed tool calls in one turn

- GIVEN a single assistant turn calls `add_product` twice and `update_product` once
- WHEN the message renders
- THEN the single grouped card lists all 3 affected products in call order
- AND each list item shows the category badge, product name, and amount reflecting the tool's result

#### Scenario: Single tool call still renders a card

- GIVEN the agent's turn issues exactly 1 `add_product` tool call
- WHEN the message renders
- THEN one tool-result card appears containing that single product

### Requirement: Asymmetric message bubble styling

User and assistant messages MUST use distinct bubble treatments matching the reference design.

#### Scenario: User message bubble

- GIVEN the investor sends a text message
- WHEN the message renders
- THEN the user bubble has border-radius `18px 18px 4px 18px`
- AND the bubble background uses the accent color with white text

#### Scenario: Assistant message has no bubble background

- GIVEN the agent responds with text
- WHEN the message renders
- THEN the assistant message text has no background fill and no border-radius (transparent, left-aligned content)

### Requirement: Translucent attachment chips

File attachments inside a user message MUST render as translucent chips within the same message bubble.

#### Scenario: User attaches two PDFs

- GIVEN the investor sends a message with 2 PDF attachments
- WHEN the message renders
- THEN each attachment renders as a chip with `rgba(255,255,255,.12)` background, `rgba(255,255,255,.2)` border, file icon, name, and size
- AND both chips appear inside the same user message bubble as the text

### Requirement: Composer pill styling with quick actions preserved

The composer MUST use a rounded pill input style and MUST keep the existing quick-action buttons (Captura, PDF, Factsheet, Link) below it.

#### Scenario: Composer renders as a pill

- GIVEN the investor views the chat panel
- WHEN the composer renders
- THEN the input container has `border-radius: 20px` and a subtle background/border
- AND focusing the input shows an accent-colored ring

#### Scenario: Quick-action buttons remain visible

- GIVEN the investor views the composer area
- WHEN the composer renders
- THEN the quick-action row (Captura, PDF, Factsheet, Link) is visible below the input
- AND clicking each button preserves its existing behavior (unchanged from current implementation)

## MODIFIED Requirements

### Requirement: Múltiples productos en un solo documento

Cuando el agente procesa un documento con múltiples productos, el chat debe presentarlos en una única estructura por turno y agregar las cards correspondientes al panel derecho.

(Previously: described only a plain list of products; now requires the grouped single-card tool-result rendering defined above.)

#### Scenario: Multiple products from one document

- GIVEN el inversionista sube un estado de cuenta con 4 productos
- WHEN el agente procesa el documento y llama `add_product` 4 veces en el mismo turno
- THEN el chat muestra UNA sola card de resultado listando los 4 productos con badge, nombre y monto
- AND los 4 productos se agregan como cards al panel de portafolio
- AND las métricas del portafolio se actualizan (total, conteo)
