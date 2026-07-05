# Configurable LangGraph Backend

## ADDED Requirements

### Requirement: Environment-Configured Model Runtime

The backend MUST run a LangGraph assistant graph whose provider and model can be selected through environment configuration.

#### Scenario: Configured model is used

- GIVEN valid provider credentials and model settings exist
- WHEN the backend starts
- THEN chat requests SHALL use the configured provider and model.

#### Scenario: Required configuration is missing

- GIVEN required provider credentials or model settings are missing
- WHEN the backend starts or handles chat
- THEN the failure MUST identify missing configuration without exposing secrets.
