ALTER TABLE store_delivery_fees
  ALTER COLUMN distance_km TYPE NUMERIC(10,2);

ALTER TABLE orders
  ALTER COLUMN delivery_distance_km TYPE NUMERIC(10,2);
