# Delta for portfolio-builder / dashboard + product-management

## ADDED Requirements

### Requirement: Topbar brand identity

The topbar MUST display a gradient logo mark and the brand text "SABBI Portfolio Builder".

#### Scenario: Topbar renders brand

- GIVEN the investor opens the portfolio builder
- WHEN the topbar renders
- THEN a 28x28px rounded gradient logo mark (`linear-gradient(135deg,#7c3aed,#4338ca)`) appears on the left
- AND the brand label reads exactly "SABBI Portfolio Builder"

## MODIFIED Requirements

### Requirement: Tabla consolidada del resumen

La tabla del resumen final debe mostrar columnas de Categoría, Actual, Retorno y Deseado, con estilos visuales de barra de progreso y jerarquía de filas. En esta iteración, "Retorno" y "Deseado" son visual-only: se muestran con valores placeholder ya que el cálculo real está fuera de alcance.

(Previously: assumed Retorno/Deseado carried real computed percentages; now explicitly placeholder-only pending a future computation feature.)

#### Scenario: Tabla consolidada con columnas Retorno y Deseado

```gherkin
Given el portafolio está completo
When se renderiza la tabla del resumen final
Then la tabla tiene las columnas:
  | columna      | alineación | contenido                          |
  | Categoría    | izquierda  | nombre + badge numerado            |
  | Actual       | derecha    | porcentaje calculado real          |
  | Retorno      | derecha    | placeholder "—"                    |
  | Deseado      | derecha    | placeholder "—"                    |
And las filas de categoría tienen fondo highlight y badge con número
  And las filas de subcategoría están indentadas con color secundario
  And cada subcategoría muestra una barra de progreso proporcional al valor de "Actual"
  And la fila total tiene borde superior grueso y fondo highlight
  And el total de la columna "Actual" es exactamente 100.0%
```

#### Scenario: Retorno y Deseado no bloquean el envío del portafolio [DEFERRED v1.1]

> **Note**: Computing real Retorno (trailing return) and Deseado (target allocation)
> values requires additional data inputs and business rules not yet defined.
> Deferred to v1.1. Placeholders render as em-dash "—" so the table layout
> matches the reference without implying computed data exists.

```gherkin
Given las columnas Retorno y Deseado muestran "—"
When el inversionista revisa el resumen
Then no se bloquea ni se advierte sobre datos faltantes
  And el botón "Enviar a SABBI" conserva su estado existente (deshabilitado, ver spec dashboard)
```

### Requirement: Visualización de una card de producto

Cada producto de inversión se representa como una card interactiva mostrando barra lateral de color, nombre, proveedor, monto, composición y badge de categoría. El monto debe usar tipografía DM Sans para diferenciarlo del resto del contenido en Inter.

(Previously: did not specify which font family the amount uses.)

#### Scenario: Visualización de una card de producto

```gherkin
Given existe un producto "BlackRock Private Credit Fund" en el portafolio
When el inversionista ve el panel de portafolio
Then la card muestra:
  | elemento              | valor                            | fuente     |
  | barra lateral color   | color de la categoría            | —          |
  | nombre                | BlackRock Private Credit Fund    | Inter      |
  | proveedor             | BDEBT · BlackRock · SABBI        | Inter      |
  | monto                 | $150,000                         | DM Sans    |
  | barra de composición  | segmentos proporcionales         | —          |
  | leyenda composición   | nombre + porcentaje por asset    | Inter      |
  | badge categoría       | Merc. privados                   | Inter      |
  And los botones de editar y eliminar son invisibles
When el inversionista hace hover sobre la card
Then los botones de editar (lápiz) y eliminar (basura) se hacen visibles
```

### Requirement: Secciones por categoría con header y total

Cada sección de categoría muestra un header con badge numerado, título y total. El total de la sección debe usar tipografía DM Sans.

(Previously: did not specify the total's font family.)

#### Scenario: Header de sección con badge y total en DM Sans

```gherkin
Given el portafolio tiene productos en la categoría "Mercados privados"
When se renderiza la sección
Then el header de la sección muestra:
  | elemento       | valor                    | fuente  |
  | badge          | "2" con color de cat.    | Inter   |
  | título         | Mercados privados        | Inter   |
  | total derecho  | $385,000                 | DM Sans |
  And debajo del header se muestra el grid de cards
  And al final del grid hay un botón "Agregar producto"
```
