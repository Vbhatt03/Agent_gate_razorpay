import { Pool } from "pg";

export type CatalogSearch = {
  query?: string;
  maxPricePaise?: number;
  category?: string;
};

export type CatalogSummary = {
  sku: string;
  name: string;
  pricePaise: number;
  category: string;
  inStock: boolean;
};

export type CatalogProduct = CatalogSummary & {
  description: string;
};

export interface CatalogRepository {
  search(input: CatalogSearch): Promise<CatalogSummary[]>;
  findBySku(sku: string): Promise<CatalogProduct | null>;
  close(): Promise<void>;
}

type CatalogRow = {
  sku: string;
  name: string;
  price_paise: string;
  category: string;
  stock: number;
  description?: string;
};

function toSummary(row: CatalogRow): CatalogSummary {
  return {
    sku: row.sku,
    name: row.name,
    pricePaise: Number(row.price_paise),
    category: row.category,
    inStock: row.stock > 0,
  };
}

export function createCatalogRepository(databaseUrl: string, merchantName: string): CatalogRepository {
  const pool = new Pool({ connectionString: databaseUrl });

  return {
    async search(input) {
      const result = await pool.query<CatalogRow>(
        `
          select c.sku, c.name, c.price_paise, c.category, c.stock
          from catalog_items c
          join merchants m on m.id = c.merchant_id
          where m.name = $1
            and c.is_active = true
            and ($2::text is null or c.name ilike '%' || $2 || '%' or c.sku ilike '%' || $2 || '%')
            and ($3::bigint is null or c.price_paise <= $3)
            and ($4::text is null or c.category = $4)
          order by c.price_paise asc, c.name asc
        `,
        [merchantName, input.query ?? null, input.maxPricePaise ?? null, input.category ?? null],
      );

      return result.rows.map(toSummary);
    },

    async findBySku(sku) {
      const result = await pool.query<CatalogRow>(
        `
          select c.sku, c.name, c.description, c.price_paise, c.category, c.stock
          from catalog_items c
          join merchants m on m.id = c.merchant_id
          where m.name = $1 and c.sku = $2 and c.is_active = true
          limit 1
        `,
        [merchantName, sku],
      );
      const row = result.rows[0];

      return row
        ? {
            ...toSummary(row),
            description: row.description ?? "",
          }
        : null;
    },

    close: () => pool.end(),
  };
}
