# Delta for Local Dev Workflow

## ADDED Requirements

### Requirement: One-Command Local Startup

The system MUST provide documented commands that install dependencies and start both frontend and backend for local development.

#### Scenario: Full stack starts locally

- GIVEN dependencies and environment values are present
- WHEN a developer runs the documented dev command
- THEN the web app and backend SHALL start on documented local ports.

#### Scenario: Environment setup is incomplete

- GIVEN required local environment values are missing
- WHEN a developer follows the dev workflow
- THEN documentation MUST identify the missing setup needed to proceed.
