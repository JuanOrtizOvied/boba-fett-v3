# Delta for Assistant Chat Runtime

## ADDED Requirements

### Requirement: Streaming Assistant Chat

The system MUST render a browser chat experience that sends user messages to the backend and streams assistant responses.

#### Scenario: User receives streamed response

- GIVEN the frontend and backend are running
- WHEN a user submits a chat message
- THEN the assistant response SHALL appear incrementally in the browser.

#### Scenario: Backend is unavailable

- GIVEN the frontend is running but the backend is unreachable
- WHEN a user submits a chat message
- THEN the UI MUST surface a recoverable error instead of silently failing.
