# Delta for Configurable LangGraph Backend

## ADDED Requirements

### Requirement: Authenticated Run Configuration Injection

The Next.js proxy MUST inject `user_id` into `RunnableConfig["configurable"]`
from a validated JWT, replacing the previously client-supplied
`portfolio_id`.

#### Scenario: Valid token yields scoped run config

- GIVEN a request carries a valid access-token cookie
- WHEN the Next.js proxy forwards the run request to LangGraph
- THEN `configurable.user_id` MUST be set from the token's subject claim

#### Scenario: Missing token blocks run creation

- GIVEN a request has no valid access-token cookie
- WHEN it attempts to create or continue a LangGraph run
- THEN the proxy MUST respond 401 without forwarding the request upstream

#### Scenario: Thread ownership validated on load

- GIVEN a user requests to load an existing LangGraph thread by `thread_id`
- WHEN the thread is not owned by the requesting user and the user is not an admin
- THEN the request MUST be rejected with 403
