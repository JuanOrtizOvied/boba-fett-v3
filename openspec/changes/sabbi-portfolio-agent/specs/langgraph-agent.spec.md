# Spec: LangGraph Agent Backend [ADDED]

## Domain: portfolio-builder / agent

### Feature: Grafo de agente LangGraph con Claude para procesamiento de portafolio

El backend utiliza LangGraph con modelos Anthropic (Claude) para procesar
documentos, extraer productos de inversión, clasificarlos, y gestionar
el estado del portafolio a través de tool calling.

---

#### Scenario: Configuración del modelo Anthropic

```gherkin
Given el backend LangGraph está configurado
Then el modelo LLM utilizado es ChatAnthropic con "claude-sonnet-4-20250514"
  And la temperature es 0 para respuestas determinísticas en extracción
  And la API key se configura via ANTHROPIC_API_KEY en variables de entorno
  And NO se utiliza ningún modelo de OpenAI
```

---

#### Scenario: Estado del agente (AgentState)

```gherkin
Given el grafo de LangGraph está definido
Then el estado del agente incluye:
  | campo               | tipo                              | descripción                       |
  | messages            | list[AnyMessage] (add_messages)   | Historial de conversación         |
  | portfolio           | dict[str, Product]                | Productos por ID                  |
  | processing_status   | str                               | idle, processing, awaiting_confirm|
  | current_document    | Optional[DocumentInfo]            | Documento en procesamiento        |
  | extracted_products  | list[ExtractedProduct]            | Productos pendientes de confirmar |
```

---

#### Scenario: Estructura del grafo principal

```gherkin
Given el grafo de LangGraph se compila
Then tiene los siguientes nodos:
  | nodo                | responsabilidad                                        |
  | router              | Clasifica el input del usuario y rutea al nodo correcto|
  | process_document    | Procesa PDFs, imágenes y factsheets con Claude vision  |
  | extract_products    | Extrae productos estructurados del contenido procesado |
  | agent               | Nodo conversacional principal con tools binding         |
  | generate_summary    | Genera la vista de resumen del portafolio              |
And tiene las siguientes edges:
  | from             | to                | condición                           |
  | START            | router            | siempre                             |
  | router           | process_document  | si hay archivo adjunto              |
  | router           | agent             | si es texto libre                   |
  | process_document | extract_products  | siempre                             |
  | extract_products | agent             | siempre                             |
  | agent            | agent             | si hay tool calls pendientes        |
  | agent            | END               | si no hay tool calls                |
```

---

#### Scenario: Tool — add_product

```gherkin
Given el agente tiene la tool "add_product" registrada
When Claude decide agregar un producto identificado
Then invoca add_product con los parámetros:
  | parámetro   | tipo                | requerido | ejemplo                    |
  | name        | str                 | sí        | "BlackRock Private Credit" |
  | provider    | str                 | no        | "BlackRock"                |
  | amount      | float               | sí        | 150000                     |
  | category    | CategoryEnum        | sí        | "privados"                 |
  | composition | list[AssetAlloc]    | sí        | [{name, percentage}]       |
  And la tool agrega el producto al estado portfolio
  And retorna confirmación con el ID asignado
  And el frontend recibe la actualización vía streaming
```

---

#### Scenario: Tool — update_product

```gherkin
Given existe un producto con id "prod_1" en el portafolio
When Claude invoca update_product con:
  | parámetro    | valor          |
  | product_id   | "prod_1"       |
  | name         | "Depto. Lima"  |
  | amount       | 250000         |
Then el producto se actualiza en el estado
  And retorna los datos actualizados
  And el frontend actualiza la card correspondiente
```

---

#### Scenario: Tool — delete_product

```gherkin
Given existe un producto con id "prod_1" en el portafolio
When Claude invoca delete_product con product_id "prod_1"
Then el producto se elimina del estado
  And retorna confirmación de eliminación
  And el frontend elimina la card correspondiente
```

---

#### Scenario: Tool — get_portfolio_summary

```gherkin
Given el portafolio tiene 10 productos
When Claude invoca get_portfolio_summary
Then retorna:
  | campo                | valor                                        |
  | total_amount         | suma de todos los montos                     |
  | product_count        | 10                                           |
  | categories_used      | lista de categorías con al menos 1 producto  |
  | distribution         | porcentaje por categoría                     |
  | largest_position     | {name, percentage}                           |
  | composition_breakdown| distribución por asset class                 |
```

---

#### Scenario: Procesamiento de PDF con Claude

```gherkin
Given el usuario sube un archivo PDF de estado de cuenta
When el nodo process_document recibe el archivo
Then convierte el PDF a imágenes (una por página) si es necesario
  Or extrae el texto directamente si es texto nativo
  And envía el contenido a Claude con un prompt de extracción
  And el prompt indica extraer:
    | dato          | instrucción                                        |
    | nombre        | nombre completo del producto o fondo                |
    | ticker        | ticker o código si existe                           |
    | proveedor     | institución administradora                          |
    | monto         | monto invertido en USD                              |
    | categoría     | una de las 6 categorías SABBI                       |
    | composición   | desglose por asset class si está disponible          |
```

---

#### Scenario: Procesamiento de imagen con Claude Vision

```gherkin
Given el usuario sube una captura de pantalla de su broker
When el nodo process_document recibe la imagen
Then envía la imagen a Claude usando content type "image"
  And el prompt solicita identificar productos de inversión visibles
  And Claude analiza la imagen y retorna datos estructurados en JSON
  And el nodo extract_products parsea el JSON y crea productos pendientes
```

---

#### Scenario: System prompt del agente

```gherkin
Given el agente se inicializa
Then el system prompt incluye:
  | sección                          | contenido                                           |
  | rol                              | Asistente SABBI para construir portafolios           |
  | categorías válidas               | las 6 categorías con subcategorías                  |
  | formato de respuesta             | listar productos encontrados con badge y monto       |
  | instrucción de clasificación     | reglas para asignar categoría y subcategoría         |
  | instrucción de composición       | cómo manejar productos multi-asset class             |
  | instrucción de confirmación      | siempre confirmar con el usuario antes de continuar  |
  | idioma                           | español                                              |
  | tono                             | profesional, amigable, conciso                       |
```

---

#### Scenario: Streaming de respuestas al frontend

```gherkin
Given el agente está procesando una solicitud del usuario
When el agente genera una respuesta
Then los tokens se envían vía Server-Sent Events (SSE)
  And el frontend renderiza token por token en tiempo real
  And las tool calls se ejecutan y sus resultados se envían al frontend
  And el frontend actualiza las cards en tiempo real cuando recibe tool results
```

---

#### Scenario: Manejo de errores en procesamiento

```gherkin
Given el usuario sube un archivo corrupto o ilegible
When el nodo process_document falla en la extracción
Then el agente responde con un mensaje amigable:
  "No pude leer este archivo. ¿Podrías intentar con otro formato o compartirme
   los datos de otra forma?"
  And el estado processing_status vuelve a "idle"
  And no se crean productos parciales o inválidos
```

---

#### Scenario: Persistencia del estado del portafolio

```gherkin
Given el inversionista ha agregado 5 productos en la conversación
When el inversionista recarga la página
Then el estado del portafolio se recupera del checkpoint de LangGraph
  And los 5 productos siguen visibles en las cards
  And el historial de chat se mantiene
  And las métricas reflejan los datos correctos
```

---

#### Scenario: Concurrencia y thread management

```gherkin
Given dos inversionistas usan el sistema simultáneamente
When cada uno crea un thread nuevo
Then cada thread tiene su propio estado aislado
  And los productos de un thread no afectan al otro
  And cada thread tiene su propio checkpoint
```
