-- Migração: categories passa a ser escopada por loja (loja_id + slug)

BEGIN;

ALTER TABLE categories
    ADD COLUMN IF NOT EXISTS loja_id UUID REFERENCES lojas(id) ON DELETE CASCADE;

-- 1) Categorias usadas por uma única loja
WITH categoria_loja_unica AS (
    SELECT
        p.category_id,
        MIN(p.loja_id) AS loja_id
    FROM products p
    WHERE p.category_id IS NOT NULL
    GROUP BY p.category_id
    HAVING COUNT(DISTINCT p.loja_id) = 1
)
UPDATE categories c
SET loja_id = clu.loja_id
FROM categoria_loja_unica clu
WHERE c.id = clu.category_id
  AND c.loja_id IS NULL;

-- 2) Categorias usadas por múltiplas lojas: clona por loja e reponta produtos
WITH categoria_multiloja AS (
    SELECT
        p.category_id,
        ARRAY_AGG(DISTINCT p.loja_id ORDER BY p.loja_id) AS lojas
    FROM products p
    WHERE p.category_id IS NOT NULL
    GROUP BY p.category_id
    HAVING COUNT(DISTINCT p.loja_id) > 1
), loja_base AS (
    SELECT
        cml.category_id,
        cml.lojas[1] AS base_loja_id,
        cml.lojas[2:ARRAY_LENGTH(cml.lojas, 1)] AS outras_lojas
    FROM categoria_multiloja cml
), categorias_base_atualizadas AS (
    UPDATE categories c
    SET loja_id = lb.base_loja_id
    FROM loja_base lb
    WHERE c.id = lb.category_id
      AND c.loja_id IS NULL
    RETURNING c.id, c.name, c.slug, c.image_url, c.created_at
), clones_criados AS (
    INSERT INTO categories (id, loja_id, name, slug, image_url, created_at)
    SELECT
        gen_random_uuid(),
        loja_destino.loja_id,
        cba.name,
        cba.slug,
        cba.image_url,
        cba.created_at
    FROM categorias_base_atualizadas cba
    JOIN loja_base lb ON lb.category_id = cba.id
    CROSS JOIN LATERAL UNNEST(lb.outras_lojas) AS loja_destino(loja_id)
    RETURNING id, loja_id, name, slug
)
UPDATE products p
SET category_id = cc.id
FROM categories categoria_origem
JOIN clones_criados cc
  ON cc.name = categoria_origem.name
 AND cc.slug = categoria_origem.slug
WHERE p.category_id = categoria_origem.id
  AND p.loja_id = cc.loja_id
  AND categoria_origem.loja_id IS NOT NULL
  AND categoria_origem.loja_id <> cc.loja_id;

-- 3) Categorias sem produtos: usa loja padrão
WITH loja_padrao AS (
    SELECT id
    FROM lojas
    ORDER BY created_at, id
    LIMIT 1
)
UPDATE categories c
SET loja_id = lp.id
FROM loja_padrao lp
WHERE c.loja_id IS NULL;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM categories WHERE loja_id IS NULL) THEN
        RAISE EXCEPTION 'Ainda existem categorias sem loja_id. Revise os dados antes de concluir a migração.';
    END IF;
END $$;

ALTER TABLE categories
    ALTER COLUMN loja_id SET NOT NULL;

DROP INDEX IF EXISTS idx_categories_slug;
CREATE INDEX IF NOT EXISTS idx_categories_loja_id ON categories(loja_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_categories_loja_slug
    ON categories(loja_id, slug);

COMMIT;
