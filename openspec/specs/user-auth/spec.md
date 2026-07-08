# User Authentication Specification

## Purpose

Email/password authentication for SABBI: short-lived JWT access tokens plus
refresh tokens, backing role-based access for `user` and `admin` accounts.
Tokens are stored as httpOnly cookies (never exposed to browser JS).

## Requirements

### Requirement: Password Hashing

Stored passwords MUST be hashed with bcrypt or argon2. Plaintext passwords
MUST NOT be persisted or logged.

#### Scenario: Password stored as hash

- GIVEN an admin creates a user account with a password
- WHEN the account is persisted
- THEN only the hashed password is stored in `users.password_hash`

### Requirement: Login

The system MUST authenticate a user by email and password and issue an
access token (15 min TTL) and refresh token on success.

#### Scenario: Successful login

- GIVEN a user exists with valid credentials
- WHEN they POST `/auth/login` with correct email/password
- THEN the response sets an httpOnly access-token cookie and an httpOnly refresh-token cookie
- AND the response body includes id, email, role — never the password hash

#### Scenario: Invalid credentials

- GIVEN a user submits an incorrect password or unknown email
- WHEN they POST `/auth/login`
- THEN the system MUST respond 401 without revealing whether the email exists

### Requirement: Access Token Validation

Every protected API request MUST be validated against a signed, non-expired
JWT access token.

#### Scenario: Valid token allows access

- GIVEN a request includes a valid, non-expired access-token cookie
- WHEN it hits a protected FastAPI route
- THEN `get_current_user` MUST resolve the authenticated user and allow the request

#### Scenario: Expired token is rejected

- GIVEN the access token has expired
- WHEN a protected route is called
- THEN the system MUST respond 401 with a code the frontend uses to trigger a refresh

### Requirement: Refresh Token Lifecycle

The system MUST support issuing a new access token via a valid refresh token
without requiring re-login.

#### Scenario: Refresh issues new access token

- GIVEN a valid, non-expired refresh-token cookie exists
- WHEN the frontend calls `/auth/refresh` after a 401
- THEN a new access-token cookie MUST be issued
- AND the refresh token MUST be validated server-side, not merely decoded

#### Scenario: Invalid or expired refresh token forces re-login

- GIVEN the refresh token is missing, expired, or invalid
- WHEN `/auth/refresh` is called
- THEN the system MUST respond 401 and the frontend MUST redirect to `/login`

### Requirement: Logout

The system MUST allow a user to end their session by clearing auth cookies.

#### Scenario: Logout clears session

- GIVEN a user is logged in
- WHEN they POST `/auth/logout`
- THEN both access and refresh token cookies MUST be cleared
- AND subsequent protected requests MUST return 401

### Requirement: Current User Info

The system MUST expose the authenticated user's identity for frontend
session bootstrap.

#### Scenario: Fetch current user

- GIVEN a valid access-token cookie
- WHEN the frontend calls GET `/auth/me`
- THEN it MUST receive the user's id, email, and role
