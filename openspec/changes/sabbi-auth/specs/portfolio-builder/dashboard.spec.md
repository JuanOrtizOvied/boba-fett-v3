# Delta for Portfolio Builder / Dashboard

## ADDED Requirements

### Requirement: Authenticated Portfolio Fetch

The dashboard MUST fetch portfolio data scoped to the authenticated user's
identity instead of a localStorage-generated UUID.

#### Scenario: Dashboard loads current user's portfolio

- GIVEN a user is logged in with a valid session
- WHEN the portfolio panel mounts
- THEN it MUST request portfolio data using the authenticated user's identity (via httpOnly cookie), not a client-supplied ID

#### Scenario: Unauthenticated access redirects to login

- GIVEN no valid session exists
- WHEN the user navigates to the portfolio page
- THEN the app MUST redirect to `/login` instead of rendering an empty/anonymous portfolio

#### Scenario: Session expiry mid-session

- GIVEN a user's access token expires while viewing the dashboard
- WHEN a portfolio fetch returns 401
- THEN the frontend MUST attempt a silent refresh, and redirect to `/login` only if the refresh also fails
