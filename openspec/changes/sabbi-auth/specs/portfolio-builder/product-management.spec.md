# Delta for Portfolio Builder / Product Management

## MODIFIED Requirements

### Requirement: CRUD manual via REST API (sin LLM)

El sistema MUST requerir una sesión autenticada válida para toda operación
CRUD directa sobre productos vía REST, y MUST limitar las operaciones a los
productos del usuario autenticado (o permitir lectura de solo lectura a
administradores).
(Previously: los endpoints REST no verificaban autenticación y operaban
sobre cualquier `portfolio_id` suministrado por el cliente.)

#### Scenario: Authenticated edit via REST API

- GIVEN el inversionista edita un producto desde el modal
- WHEN hace clic en "Guardar producto"
- THEN el frontend envía PATCH /api/products/:id con la sesión autenticada
- AND el backend valida el token y verifica que el producto pertenece al usuario
- AND la operación se ejecuta contra PostgreSQL sin invocar al LLM

#### Scenario: Authenticated delete via REST API

- GIVEN el inversionista elimina un producto desde la card
- WHEN confirma la eliminación
- THEN el frontend envía DELETE /api/products/:id con la sesión autenticada
- AND el producto se elimina de PostgreSQL solo si pertenece al usuario autenticado

#### Scenario: Unauthenticated request is rejected

- GIVEN no valid access token is present
- WHEN a client calls any `/api/products/*` or `/api/portfolio/*` endpoint
- THEN the API MUST respond 401 Unauthorized without touching the database

#### Scenario: User cannot edit another user's product

- GIVEN a product belongs to user A
- WHEN user B (non-admin) attempts to PATCH or DELETE that product
- THEN the API MUST respond 403 Forbidden
