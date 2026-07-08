# Delta for Portfolio Builder / Agent

## MODIFIED Requirements

### Requirement: Portfolio Identity Resolution

The system MUST resolve portfolio identity for LangGraph agent tool calls
from the authenticated user's validated JWT (`user_id`), not from a
client-supplied `portfolio_id`.
(Previously: portfolio identity was a client-generated UUID stored in
localStorage and passed as `configurable.portfolio_id`; lost on browser
data clear.)

#### Scenario: Authenticated user's tools scope to their account

- GIVEN a user is authenticated with a valid access token
- WHEN the LangGraph proxy forwards a run request
- THEN the proxy MUST inject `user_id` (from the validated JWT) into `RunnableConfig["configurable"]["user_id"]`
- AND agent tools MUST read `user_id` instead of `portfolio_id` when reading/writing PostgreSQL

#### Scenario: Missing or invalid token blocks tool execution

- GIVEN a request has no valid access token
- WHEN the LangGraph proxy attempts to inject `user_id`
- THEN the run MUST be rejected with 401 before reaching agent tools

#### Scenario: Portfolio persists across devices for the same user

- GIVEN an investor logs in from a new device with the same account
- WHEN the portfolio panel loads
- THEN the same products are visible, scoped by `user_id`

### Requirement: Concurrency and Multi-User Isolation

The system MUST isolate each authenticated user's portfolio and chat
threads from other non-admin users' data.
(Previously: isolation was per browser-generated `portfolio_id`, not per
authenticated identity; two anonymous browsers were simply two different
UUIDs.)

#### Scenario: Two authenticated users do not see each other's data

- GIVEN two users are logged in simultaneously
- WHEN each interacts with the agent
- THEN each user's products remain isolated in PostgreSQL by `user_id`
- AND neither user's chat threads are visible to the other
- AND each user can have multiple chat threads over the same portfolio
