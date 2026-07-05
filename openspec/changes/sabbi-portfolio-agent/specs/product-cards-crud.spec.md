# Spec: Product Cards CRUD [ADDED]

## Domain: portfolio-builder / product-management

### Feature: Gestión de cards de productos de inversión

Cada producto de inversión se representa como una card interactiva en el panel
de portafolio. Las cards soportan visualización, edición vía modal, eliminación
con confirmación inline, y creación manual.

---

#### Scenario: Visualización de una card de producto

```gherkin
Given existe un producto "BlackRock Private Credit Fund" en el portafolio
When el inversionista ve el panel de portafolio
Then la card muestra:
  | elemento              | valor                            |
  | barra lateral color   | color de la categoría            |
  | nombre                | BlackRock Private Credit Fund    |
  | proveedor             | BDEBT · BlackRock · SABBI        |
  | monto                 | $150,000                         |
  | barra de composición  | segmentos proporcionales         |
  | leyenda composición   | nombre + porcentaje por asset    |
  | badge categoría       | Merc. privados                   |
  And los botones de editar y eliminar son invisibles
When el inversionista hace hover sobre la card
Then los botones de editar (lápiz) y eliminar (basura) se hacen visibles
```

---

#### Scenario: Card con composición multi-asset class

```gherkin
Given existe un producto "Fondo de Fondos 1" con composición:
  | asset class      | porcentaje | color    |
  | Deuda privada    | 35         | #7c3aed  |
  | Private equity   | 25         | #6d28d9  |
  | Real estate      | 20         | #0d9488  |
  | Infraestructura  | 10         | #2563eb  |
  | Venture capital  | 10         | #64748b  |
When la card se renderiza
Then la barra de composición tiene 5 segmentos proporcionales
  And la leyenda tiene 5 items con dot de color, nombre y porcentaje
  And los segmentos suman visualmente 100% de la barra
```

---

#### Scenario: Editar producto abre modal de dos columnas

```gherkin
Given existe una card del producto "Empresa Familiar SAC"
When el inversionista hace clic en el botón de editar (lápiz)
Then se abre un modal centrado con overlay oscuro
  And el modal tiene título "Editar producto"
  And el modal tiene dos columnas:
    | columna izquierda         | columna derecha                  |
    | Nombre del producto       | Composición por asset class      |
    | Proveedor                 | Filas de nombre + porcentaje     |
    | Monto (USD)               | Total con validación             |
    | Categoría (dropdown)      | Botón agregar asset class        |
  And los campos están pre-poblados con los datos actuales del producto
  And la columna izquierda tiene el label "Datos del producto"
  And la columna derecha tiene el label "Composición por asset class"
```

---

#### Scenario: Validación de porcentajes en modal de edición

```gherkin
Given el modal de edición está abierto para un producto
When el inversionista modifica los porcentajes de composición
Then el total se calcula en tiempo real
  And si el total es exactamente 100%, se muestra en verde con clase "ok"
  And si el total NO es 100%, se muestra en rojo con clase "bad"
  And el botón "Guardar" permanece habilitado en ambos casos
    But se muestra una advertencia visual cuando no suma 100%
```

---

#### Scenario: Agregar asset class en modal de edición

```gherkin
Given el modal de edición está abierto con 1 fila de composición
When el inversionista hace clic en "Agregar asset class"
Then se agrega una nueva fila vacía con:
  | campo                | estado            |
  | input nombre         | placeholder vacío |
  | input porcentaje     | vacío             |
  | botón eliminar fila  | visible           |
  And el total se recalcula automáticamente
```

---

#### Scenario: Eliminar asset class en modal de edición

```gherkin
Given el modal de edición tiene 3 filas de composición
When el inversionista hace clic en el botón X de la segunda fila
Then la fila se elimina
  And el total se recalcula sin el porcentaje eliminado
  And las filas restantes se reorganizan
```

---

#### Scenario: Guardar cambios en modal de edición

```gherkin
Given el modal de edición tiene datos válidos:
  | campo     | valor              |
  | nombre    | Empresa Familiar   |
  | proveedor | Inversión directa  |
  | monto     | 180,000            |
  | categoría | directas           |
When el inversionista hace clic en "Guardar producto"
Then el modal se cierra
  And la card se actualiza con los nuevos datos
  And si la categoría cambió, la card se mueve a la sección correcta
  And las métricas del portafolio se recalculan
  And la barra de composición refleja los nuevos porcentajes
```

---

#### Scenario: Cancelar edición en modal

```gherkin
Given el modal de edición está abierto con cambios sin guardar
When el inversionista hace clic en "Cancelar"
  Or hace clic fuera del modal (overlay)
  Or presiona la tecla Escape
Then el modal se cierra
  And los datos originales del producto NO se modifican
  And la card permanece igual
```

---

#### Scenario: Validación de campos requeridos al guardar

```gherkin
Given el modal de edición está abierto
When el inversionista deja el campo "Nombre" vacío y hace clic en "Guardar"
Then se muestra un mensaje de error "Ingresa un nombre"
  And el modal NO se cierra
When el inversionista deja el campo "Monto" en 0 y hace clic en "Guardar"
Then se muestra un mensaje de error "Ingresa un monto"
When no hay ningún asset class con porcentaje > 0
Then se muestra un mensaje de error "Agrega al menos un asset class"
```

---

#### Scenario: Eliminar producto — confirmación inline

```gherkin
Given existe una card del producto "Edifica Fund III" con monto $125,000
When el inversionista hace clic en el botón de eliminar (basura)
Then la card se transforma en modo de confirmación:
  | elemento                | valor                                        |
  | ícono                   | basura en círculo rojo                        |
  | título                  | "¿Eliminar este producto?"                    |
  | descripción             | mensaje sobre recalculación de porcentajes    |
  | resumen                 | nombre del producto + monto                   |
  | borde                   | 2px solid rojo                                |
  | barra lateral           | roja                                          |
  | botón cancelar          | visible                                       |
  | botón eliminar          | rojo con ícono de basura                      |
  And el contenido normal de la card (view) se oculta
  And el formulario de edición NO se muestra
```

---

#### Scenario: Confirmar eliminación de producto

```gherkin
Given la card está en modo de confirmación de eliminación
When el inversionista hace clic en "Eliminar"
Then la card se desvanece con animación (opacity 0, scale 0.95, 300ms)
  And el producto se elimina del estado del portafolio
  And las métricas se recalculan (total, conteo, mayor posición)
  And la card desaparece del grid
```

---

#### Scenario: Cancelar eliminación de producto

```gherkin
Given la card está en modo de confirmación de eliminación
When el inversionista hace clic en "Cancelar"
Then la card vuelve a su estado normal de visualización
  And el producto NO se elimina
  And ningún dato cambia
```

---

#### Scenario: Agregar producto manualmente

```gherkin
Given el inversionista está en el panel de portafolio
When hace clic en el botón "Agregar producto" (card con borde dashed y ícono +)
Then se abre el modal con título "Agregar producto"
  And todos los campos están vacíos
  And la categoría se pre-selecciona según la sección donde hizo clic
  And hay una fila vacía de composición por asset class
When el inversionista llena los campos y hace clic en "Guardar producto"
Then se crea una nueva card en la sección de la categoría seleccionada
  And las métricas se actualizan
  And el modal se cierra
```

---

#### Scenario: Cada categoría tiene botón de agregar producto

```gherkin
Given el portafolio tiene productos en las 6 categorías
When el inversionista ve el panel de portafolio con filtro "Todos"
Then cada sección de categoría muestra al final de su grid un botón "Agregar producto"
  And el botón tiene borde dashed, ícono + y texto "Agregar producto"
  And al hacer hover el botón cambia a fondo accent con texto accent
```

---

#### Scenario: CRUD manual via REST API (sin LLM)

```gherkin
Given el inversionista edita un producto desde el modal
When hace clic en "Guardar producto"
Then el frontend envía PATCH /api/products/:id directamente a la REST API
  And la operación se ejecuta contra PostgreSQL sin invocar al LLM
  And el frontend refetch el portfolio para actualizar la UI
  And el costo de la operación es $0 (no hay llamada a Claude)
Given el inversionista elimina un producto desde la card
When confirma la eliminación
Then el frontend envía DELETE /api/products/:id a la REST API
  And el producto se elimina de PostgreSQL directamente
```
