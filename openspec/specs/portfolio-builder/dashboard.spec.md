# Spec: Portfolio Dashboard & Summary [ADDED]

## Domain: portfolio-builder / dashboard

### Feature: Panel de portafolio con métricas, filtros y resumen final

El panel derecho muestra todos los productos organizados por categoría,
con métricas en tiempo real, filtros por categoría, y una vista de resumen
final equivalente a la hoja "Portafolio Final" del Excel.

---

#### Scenario: Métricas del portafolio en tiempo real

```gherkin
Given el portafolio tiene 10 productos con monto total de $1,160,000
When el inversionista ve el panel de portafolio
Then se muestran 4 tarjetas de métricas:
  | métrica         | valor        | subtexto           |
  | Total           | $1.16M       | 10 productos       |
  | Mayor posición  | 19.0%        | Depto. Miraflores  |
  | Categorías      | 6 de 6       | Completo           |
  | Estado          | Listo (verde)| Puedes enviarlo    |
When se elimina un producto de $220,000
Then las métricas se recalculan:
  | métrica         | nuevo valor  |
  | Total           | $940K        |
  | Mayor posición  | recalculado  |
```

---

#### Scenario: Filtrado por categoría con tabs

```gherkin
Given el portafolio tiene productos en 6 categorías
When el inversionista ve los tabs de filtro
Then se muestra el tab "Todos" activo con conteo total
  And se muestran tabs para cada categoría con su conteo:
    | tab              | conteo |
    | Todos            | 10     |
    | Inv. directas    | 2      |
    | Merc. privados   | 3      |
    | Club deals       | 1      |
    | Merc. públicos   | 1      |
    | Otros            | 2      |
    | Cash             | 1      |
When el inversionista hace clic en "Merc. privados"
Then solo se muestran las secciones de "Mercados privados"
  And las demás secciones se ocultan
  And el tab "Merc. privados" se marca como activo con color de la categoría
When el inversionista hace clic en "Todos"
Then todas las secciones se muestran nuevamente
```

---

#### Scenario: Secciones por categoría con header y total

```gherkin
Given el portafolio tiene productos en la categoría "Mercados privados"
When se renderiza la sección
Then el header de la sección muestra:
  | elemento       | valor                    |
  | badge          | "2" con color de cat.    |
  | título         | Mercados privados        |
  | total derecho  | $385,000                 |
  And debajo del header se muestra el grid de cards
  And al final del grid hay un botón "Agregar producto"
```

---

#### Scenario: Scroll vertical solo en el panel de portafolio

```gherkin
Given hay suficientes cards para exceder la altura de la pantalla
When el inversionista hace scroll
Then solo el panel de portafolio (derecha) hace scroll vertical
  And el topbar permanece fijo
  And el chat input permanece fijo en la parte inferior del panel izquierdo
  And el chat header permanece fijo en la parte superior del panel izquierdo
  And solo el área de mensajes del chat tiene scroll independiente
```

---

#### Scenario: Vista de resumen final (Portafolio Final)

```gherkin
Given el inversionista ha completado su portafolio con todos los productos
When hace clic en "Resumen final" en el topbar
Then se muestra la vista de resumen final a pantalla completa (sin chat)
  And la vista incluye:
    | componente                                 |
    | Donut chart con distribución por categoría |
    | Leyenda del donut con colores y porcentajes|
    | Tabla consolidada con todas las categorías |
    | Botón "Exportar Excel"                     |
    | Botón "Enviar a SABBI"                     |
```

---

#### Scenario: Donut chart de distribución

```gherkin
Given el portafolio tiene distribución:
  | categoría            | porcentaje |
  | Inversiones directas | 31.9%      |
  | Mercados privados    | 33.2%      |
  | Club deals           | 10.8%      |
  | Mercados públicos    | 10.3%      |
  | Otros                | 8.6%       |
  | Cash y equivalentes  | 5.2%       |
When se renderiza el donut chart
Then cada segmento tiene el color asignado a su categoría
  And el centro del donut muestra el monto total y conteo de productos
  And la leyenda muestra 6 items con dot de color, nombre y porcentaje
```

---

#### Scenario: Tabla consolidada del resumen

```gherkin
Given el portafolio está completo
When se renderiza la tabla del resumen final
Then la tabla tiene las columnas:
  | columna      | alineación |
  | Categoría    | izquierda  |
  | Actual       | derecha    |
  | Retorno      | derecha    |
  | Deseado      | derecha    |
  And las filas de categoría tienen fondo highlight y badge con número
  And las filas de subcategoría están indentadas con color secundario
  And cada subcategoría muestra una barra de progreso proporcional
  And los retornos positivos se muestran en color verde
  And la fila total tiene borde superior grueso y fondo highlight
  And el total de la columna "Actual" es exactamente 100.0%
```

---

#### Scenario: Exportar portafolio a Excel

```gherkin
Given el portafolio está completo con todos los productos clasificados
When el inversionista hace clic en "Exportar Excel"
Then el frontend solicita GET /api/portfolio/:id/export al backend
  And el backend genera el .xlsx server-side con openpyxl (datos directos de Postgres)
  And el archivo contiene las hojas por categoría con los montos correctos
  And la hoja "Portafolio Final" consolida todas las categorías
  And los porcentajes suman 100%
  And el archivo se descarga automáticamente (sin SheetJS ni dependencias JS)
```

---

#### Scenario: Enviar portafolio a SABBI [DEFERRED v1.1]

> **Note**: The SABBI submission endpoint/integration is not yet defined.
> In v1, the "Enviar a SABBI" button is rendered but disabled with a
> tooltip "Próximamente". The Excel export covers the immediate need —
> users can send the exported file manually. The integration API/webhook
> design will be specified in v1.1 once the SABBI backend contract is available.

```gherkin
Given el portafolio está completo
When el inversionista hace clic en "Enviar a SABBI"
Then se muestra una confirmación antes de enviar
  And al confirmar, el portafolio se envía al sistema de SABBI
  And el inversionista recibe un mensaje de confirmación
```

---

#### Scenario: Navegación entre vistas

```gherkin
Given el inversionista está en la vista "Construir portafolio"
When hace clic en "Resumen final" en el topbar
Then la vista cambia a resumen final (full width, sin chat)
When hace clic en "Construir portafolio" en el topbar
Then la vista cambia al layout split (chat + portafolio)
  And el estado del chat y portafolio se mantiene
```
