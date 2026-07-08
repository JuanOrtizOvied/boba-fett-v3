# User Management Specification

## Purpose

Admin-invite-only account provisioning. No public registration exists;
only an authenticated admin can create user accounts. An initial admin is
seeded from environment variables on first boot.

## Requirements

### Requirement: Admin-Only User Creation

Only authenticated admins MAY create new user accounts; no public
registration endpoint MUST exist.

#### Scenario: Admin creates a user

- GIVEN an authenticated admin
- WHEN they POST `/admin/users` with email, password, and role
- THEN a new user is created with `created_by` set to the admin's id
- AND the response excludes the password hash

#### Scenario: Non-admin cannot create users

- GIVEN an authenticated non-admin user
- WHEN they POST `/admin/users`
- THEN the system MUST respond 403

#### Scenario: No public registration

- GIVEN an unauthenticated client
- WHEN it requests any user-creation endpoint
- THEN no such endpoint MUST be reachable without a valid admin session

#### Scenario: Duplicate email rejected

- GIVEN a user with email "a@sabbi.com" already exists
- WHEN an admin attempts to create another user with the same email
- THEN the system MUST respond 409 without creating a duplicate

### Requirement: Initial Admin Seeding

On first boot, the system MUST seed an initial admin account from
`ADMIN_EMAIL` and `ADMIN_PASSWORD` environment variables if no admin user
exists yet.

#### Scenario: Seed on empty users table

- GIVEN the `users` table is empty and `ADMIN_EMAIL`/`ADMIN_PASSWORD` are set
- WHEN the backend starts
- THEN an admin user MUST be created with those credentials

#### Scenario: Seeding is idempotent

- GIVEN an admin user with `ADMIN_EMAIL` already exists
- WHEN the backend restarts
- THEN no duplicate admin MUST be created

### Requirement: User Listing

Admins MUST be able to list all user accounts.

#### Scenario: Admin lists users

- GIVEN an authenticated admin
- WHEN they GET `/admin/users`
- THEN the response MUST include id, email, role, and created_at for every user, excluding password hashes

### Requirement: Role Assignment

Each user MUST have exactly one role, `user` or `admin`, assigned at
creation time.

#### Scenario: Role stored at creation

- GIVEN an admin creates a user with role "admin"
- WHEN the account is persisted
- THEN `users.role` MUST equal "admin" and govern that user's permissions on every subsequent request
