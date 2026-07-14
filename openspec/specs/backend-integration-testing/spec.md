# Backend Integration Testing Specification

## Purpose

Real-Postgres integration tests validating chat history persistence, agent
tool CRUD, and REST API CRUD against an actual database — replacing the
current mock-only asyncpg test coverage that has diverged from production
behavior. Existing mock-based unit tests remain unchanged for fast CI.

## Requirements

### Requirement: Test Database Fixture Isolation

The test suite MUST connect to a real PostgreSQL instance via
`TEST_DATABASE_URL`, apply `db/schema.sql` once per test session, and
isolate each test via a per-test transaction with savepoint rollback so no
test leaks state into another.

#### Scenario: Schema applied once per session

- GIVEN a session-scoped fixture connects to `TEST_DATABASE_URL`
- WHEN the test session starts
- THEN `schema.sql` is applied and the connection pool is reused across all tests

#### Scenario: Test isolation via rollback

- GIVEN a test inserts a product inside its transaction
- WHEN the test completes (pass or fail)
- THEN the transaction is rolled back and the row is not visible to subsequent tests

### Requirement: Chat Thread Persistence

The chat endpoints (`/chat/threads/{id}/state`,
`/chat/threads/{id}/messages/stream`) MUST persist and retrieve message
history through a real Postgres-backed LangGraph checkpointer, with the LLM
node mocked to return a canned response.

#### Scenario: New thread has empty state

- GIVEN a thread_id with no prior messages
- WHEN GET `/chat/threads/{id}/state` is called
- THEN the response returns `messages: []`

#### Scenario: Message round-trips through Postgres

- GIVEN a thread_id and a mocked LLM node returning a fixed AI response
- WHEN a message is streamed via POST `/chat/threads/{id}/messages/stream`
- THEN the human and AI messages are persisted in Postgres and returned by a subsequent GET on `/state`

#### Scenario: Multi-message thread loads full history

- GIVEN a thread with 3 prior human/AI message pairs already persisted
- WHEN GET `/chat/threads/{id}/state` is called
- THEN all 6 messages are returned in original order

#### Scenario: Missing message body is rejected

- GIVEN a POST to `/chat/threads/{id}/messages/stream` with an empty `message` string
- WHEN the request is sent
- THEN the API responds 422

### Requirement: Agent Tool CRUD Against Real Postgres

`add_product`, `update_product`, `delete_product`, and
`get_portfolio_summary` MUST be invoked directly (via `ainvoke`) with a
crafted `RunnableConfig` containing `user_id`, without invoking the LLM, and
MUST read/write through the real `ProductRepository`.

#### Scenario: add_product persists a valid product

- GIVEN a `RunnableConfig` with `user_id` set to a seeded test user
- WHEN `add_product` is invoked with name, amount > 0, and category
- THEN the tool returns `status: "added"` and the product is retrievable from Postgres

#### Scenario: add_product rejects non-positive amount

- GIVEN a valid `user_id`
- WHEN `add_product` is invoked with `amount: 0`
- THEN the database CHECK constraint rejects the insert and the tool call surfaces the DB error

#### Scenario: update_product on existing product

- GIVEN a product already persisted for the test user
- WHEN `update_product` is invoked with a new `amount`
- THEN the tool returns `status: "updated"` with the new amount reflected in Postgres

#### Scenario: update_product on nonexistent id

- GIVEN a `product_id` that does not exist
- WHEN `update_product` is invoked
- THEN the tool returns `status: "error"` with a "not found" message and no row changes

#### Scenario: delete_product removes an existing row

- GIVEN a product already persisted
- WHEN `delete_product` is invoked with its id
- THEN the tool returns `status: "deleted"` and the row no longer exists in Postgres

#### Scenario: delete_product on nonexistent id

- GIVEN a `product_id` that does not exist
- WHEN `delete_product` is invoked
- THEN the tool returns `status: "error"` and no row is affected

#### Scenario: get_portfolio_summary on empty portfolio

- GIVEN a test user with zero products
- WHEN `get_portfolio_summary` is invoked
- THEN the tool returns `total_amount: 0`, `product_count: 0`, and `largest_position: null`

#### Scenario: get_portfolio_summary on populated portfolio

- GIVEN a test user with 3 products across 2 categories
- WHEN `get_portfolio_summary` is invoked
- THEN totals, per-category distribution percentages, and the largest position by amount are computed from live Postgres data

### Requirement: REST API CRUD With Ownership and Auth Enforcement

The FastAPI portfolio routes (`/portfolio/me`, `/portfolio/me/products`,
`/products/{id}`, `/portfolio/me/summary`) MUST be tested end-to-end (real
HTTP request/response cycle against a real DB) for successful CRUD,
validation errors, ownership enforcement, and auth protection.

#### Scenario: Create product with valid payload

- GIVEN an authenticated user session
- WHEN POST `/portfolio/me/products` is sent with a valid `ProductCreate` body
- THEN the response is 201 with the created product, persisted in Postgres

#### Scenario: Create product with invalid payload

- GIVEN an authenticated user session
- WHEN POST `/portfolio/me/products` is sent with `amount: -5` or a missing required field
- THEN the response is 422 and no row is inserted

#### Scenario: Unauthenticated request is rejected

- GIVEN no valid `sabbi_access` session cookie
- WHEN any portfolio route is called
- THEN the response is 401 and no repository method is invoked

#### Scenario: Update rejects non-owner

- GIVEN a product owned by user A and an authenticated session for user B (including an admin)
- WHEN PATCH `/products/{id}` is called by user B
- THEN the response is 403 and the product is unchanged

#### Scenario: Delete nonexistent product

- GIVEN a `product_id` that does not exist
- WHEN DELETE `/products/{id}` is called by an authenticated owner
- THEN the response is 404

#### Scenario: List and summary reflect only the caller's products

- GIVEN two users each with their own products
- WHEN user A calls GET `/portfolio/me` and `/portfolio/me/summary`
- THEN only user A's products and totals are returned

## Mocking Boundary

Real: PostgreSQL, `ProductRepository`, FastAPI `TestClient`, LangGraph
Postgres checkpointer/store. Mocked: the LLM node inside the compiled graph
(returns a canned `AIMessage`) — no Anthropic API calls are made.
