# Delta for admin-panel

## ADDED Requirements

### Requirement: Ficha Patrimonial Navigation Entry

The admin panel navigation MUST include a link to the ficha patrimonial
import page (`/admin/ficha-patrimonial`).

#### Scenario: Admin sees the ficha patrimonial nav link

- GIVEN an authenticated admin viewing any `/admin/*` page
- WHEN the admin layout renders
- THEN a "Ficha Patrimonial" navigation link to `/admin/ficha-patrimonial` MUST be visible
