-- A two-table schema for trying barwise's DDL import. See
-- GETTING_STARTED.md at the repository root.

CREATE TABLE customer (
  customer_number INTEGER      NOT NULL PRIMARY KEY,
  email           VARCHAR(255) NOT NULL UNIQUE,
  full_name       VARCHAR(100) NOT NULL
);

CREATE TABLE sales_order (
  order_number    INTEGER     NOT NULL PRIMARY KEY,
  customer_number INTEGER     NOT NULL REFERENCES customer (customer_number),
  placed_on       DATE        NOT NULL,
  status          VARCHAR(10) NOT NULL CHECK (status IN ('pending', 'shipped', 'delivered'))
);
