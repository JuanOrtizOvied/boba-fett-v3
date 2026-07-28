# Delta for portfolio-builder/product-management

## MODIFIED Requirements

### Requirement: Product Card and Edit Modal Use Asset Class

Product cards MUST show an asset-class badge (colored by `asset_class`) instead of a category badge. The edit/add modal's classification dropdown MUST be labeled "Clase de activo" and MUST write to `asset_class`. `CategoryFilter` MUST be renamed `AssetClassFilter`.
(Previously: badge, dropdown, and filter were category-based.)

#### Scenario: Card displays asset class badge

- GIVEN a product with `asset_class = "mercados_privados"`
- WHEN its card renders
- THEN the badge shows the asset class label and color, matching the prior category badge appearance

#### Scenario: Edit modal dropdown selects asset class

- GIVEN the edit modal is open for a product
- WHEN the investor changes the "Clase de activo" dropdown and saves
- THEN the product's `asset_class` is updated and the card moves to the corresponding section

#### Scenario: New product requires an asset class

- GIVEN the add-product modal is open with no asset class selected
- WHEN the investor attempts to save
- THEN the same required-field validation previously applied to `category` now applies to `asset_class`
