"""replace category with asset_class

Revision ID: 8f2a91c4d6b7
Revises: 4c0a04508674
Create Date: 2026-07-24 12:30:00.000000

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = '8f2a91c4d6b7'
down_revision = '4c0a04508674'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # -- Backfill: copy category -> asset_class where asset_class is empty --
    op.execute(
        "UPDATE products SET asset_class = category "
        "WHERE asset_class IS NULL OR asset_class = ''"
    )
    op.execute(
        "UPDATE product_catalog SET asset_class = category "
        "WHERE asset_class IS NULL OR asset_class = ''"
    )

    # `products.asset_class` absorbs `category`'s required-field contract.
    op.alter_column('products', 'asset_class', existing_type=sa.Text(), nullable=False)

    # -- Drop category columns (asset_class now carries the taxonomy value) --
    op.drop_column('products', 'category')
    op.drop_column('product_catalog', 'category')

    # -- Rename summary column --
    op.alter_column(
        'portfolio_snapshots', 'category_summary', new_column_name='asset_class_summary'
    )

    # -- Rewrite JSONB keys inside existing snapshot summaries --
    op.execute(
        """
        UPDATE portfolio_snapshots
        SET asset_class_summary = (
          SELECT jsonb_agg(
              jsonb_build_object(
                  'asset_class', elem->>'category',
                  'percentage', elem->'percentage'
              )
          )
          FROM jsonb_array_elements(asset_class_summary) AS elem
        )
        WHERE asset_class_summary IS NOT NULL AND asset_class_summary != '[]'::jsonb
        """
    )


def downgrade() -> None:
    # -- Re-add category columns --
    op.add_column('products', sa.Column('category', sa.Text(), nullable=True))
    op.add_column(
        'product_catalog', sa.Column('category', sa.Text(), server_default='', nullable=True)
    )

    op.execute("UPDATE products SET category = asset_class")
    op.execute("UPDATE product_catalog SET category = asset_class")

    op.alter_column('products', 'category', existing_type=sa.Text(), nullable=False)
    op.alter_column('products', 'asset_class', existing_type=sa.Text(), nullable=True)

    # -- Rewrite JSONB keys back --
    op.execute(
        """
        UPDATE portfolio_snapshots
        SET asset_class_summary = (
          SELECT jsonb_agg(
              jsonb_build_object(
                  'category', elem->>'asset_class',
                  'percentage', elem->'percentage'
              )
          )
          FROM jsonb_array_elements(asset_class_summary) AS elem
        )
        WHERE asset_class_summary IS NOT NULL AND asset_class_summary != '[]'::jsonb
        """
    )

    op.alter_column(
        'portfolio_snapshots', 'asset_class_summary', new_column_name='category_summary'
    )
