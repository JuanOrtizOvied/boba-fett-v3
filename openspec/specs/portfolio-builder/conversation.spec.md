# Spec: Conversation & Document Extraction [ADDED]

## Domain: portfolio-builder / conversation

### Feature: Agente conversacional para ingesta de productos de inversión

El agente permite al inversionista compartir información de sus inversiones
a través de múltiples canales (texto, archivos, links) y extrae automáticamente
los productos de inversión con sus atributos.

---

#### Scenario: Mensaje de bienvenida al iniciar conversación

```gherkin
Given el inversionista abre el portfolio builder por primera vez
When se carga la interfaz
Then el agente muestra un mensaje de bienvenida
  And el mensaje lista los tipos de input soportados:
    | tipo                      | icono     |
    | Capturas de pantalla      | camera    |
    | PDFs de estados de cuenta | pdf       |
    | Factsheets de fondos      | file      |
    | Links de productos        | link      |
  And el input del chat está visible y fijo en la parte inferior
  And el panel de portafolio está vacío con estado "Sin productos"
```

---

#### Scenario: Extracción de productos desde PDF de estado de cuenta

```gherkin
Given el inversionista está en la conversación activa
When el inversionista sube un archivo "Estado_BlackRock_Q2_2025.pdf"
Then el mensaje del usuario muestra el texto + el archivo adjunto con ícono PDF
  And el archivo adjunto muestra nombre y tamaño
  And ambos elementos pertenecen al mismo mensaje del usuario
When el agente procesa el documento
Then el agente responde con la lista de productos encontrados
  And cada producto muestra:
    | atributo     | ejemplo                       |
    | badge        | categoría con color           |
    | nombre       | BlackRock Private Credit Fund |
    | monto        | $150,000                      |
  And los productos se agregan automáticamente como cards en el panel derecho
  And el agente pregunta si los datos son correctos
```

---

#### Scenario: Extracción de productos desde captura de pantalla

```gherkin
Given el inversionista está en la conversación activa
When el inversionista sube una imagen de captura de pantalla de su broker
Then el agente utiliza vision (Claude) para analizar la imagen
  And extrae los productos visibles con nombre, monto y clasificación
  And presenta los productos encontrados en el chat
  And agrega las cards correspondientes en el panel de portafolio
```

---

#### Scenario: Ingreso de producto por texto libre

```gherkin
Given el inversionista está en la conversación activa
When el inversionista escribe "Tengo un depto en Miraflores como inversión, vale unos $220,000"
Then el agente identifica:
  | atributo   | valor                 |
  | nombre     | Depto. Miraflores     |
  | monto      | 220000                |
  | categoría  | Inversiones directas  |
  | sub        | RE Perú, Residencial  |
  And el agente confirma la clasificación al usuario
  And crea la card en el panel de portafolio bajo "Inversiones directas"
```

---

#### Scenario: Extracción desde factsheet de un fondo

```gherkin
Given el inversionista sube un PDF de factsheet de un fondo de inversión
When el agente procesa el factsheet
Then extrae la composición por asset class del fondo
  And asigna los porcentajes de composición a la card del producto
  And si el fondo tiene exposición a múltiples asset classes:
    | asset class      | porcentaje |
    | Deuda privada    | 35%        |
    | Private equity   | 25%        |
    | Real estate      | 20%        |
    | Infraestructura  | 10%        |
    | Venture capital  | 10%        |
  Then la barra de composición de la card refleja todos los porcentajes
  And la leyenda muestra cada asset class con su color y porcentaje
```

---

#### Scenario: Procesamiento de link de producto de inversión [DEFERRED v1.1]

> **Note**: Web scraping requires a dedicated tool (e.g. `fetch_url` with
> `httpx` + `BeautifulSoup`) and content sanitization. Deferred to v1.1
> to keep v1 scope focused on PDF/image/text extraction. In v1, links
> pasted in chat are treated as text — the agent will ask the user to
> provide the product details manually.

```gherkin
Given el inversionista pega un link a la página de un fondo
When el agente recibe el link
Then el agente realiza web scraping del contenido de la página
  And extrae nombre del fondo, proveedor, y composición si está disponible
  And presenta los datos al usuario para confirmación
  And el usuario puede completar el monto manualmente
```

---

#### Scenario: Múltiples productos en un solo documento

```gherkin
Given el inversionista sube un estado de cuenta con 4 productos
When el agente procesa el documento
Then el agente presenta los 4 productos encontrados en una lista
  And cada producto tiene badge de categoría, nombre y monto
  And los 4 productos se agregan como cards al panel de portafolio
  And las métricas del portafolio se actualizan (total, conteo)
```

---

#### Scenario: El agente no puede identificar un producto

```gherkin
Given el inversionista sube un documento con contenido ambiguo
When el agente no puede extraer con certeza un producto
Then el agente indica qué pudo y qué no pudo identificar
  And hace preguntas específicas al usuario:
    | pregunta                                               |
    | "¿Cuál es el nombre exacto del producto?"              |
    | "¿En qué categoría clasificarías esta inversión?"      |
    | "¿Cuál es el monto invertido?"                         |
  And no crea cards hasta tener información suficiente
```

---

#### Scenario: Chat input siempre visible

```gherkin
Given el inversionista tiene 20+ mensajes en el chat
When el inversionista hace scroll hacia arriba en el historial
Then el input del chat permanece fijo en la parte inferior
  And solo la sección de mensajes hace scroll
  And el input no se oculta ni se desplaza
```

---

#### Scenario: Archivos adjuntos pertenecen al mensaje del usuario

```gherkin
Given el inversionista escribe un mensaje y adjunta 2 archivos PDF
When el mensaje se envía
Then el texto del mensaje y los archivos adjuntos aparecen en un solo bubble
  And los archivos se muestran como chips dentro del bubble del usuario
  And cada chip tiene ícono PDF, nombre del archivo y tamaño
  And NO se muestran como mensajes separados del bot
```
