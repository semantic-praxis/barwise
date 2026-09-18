-- Three tables. Only `customers` is the target of a foreign key.
CREATE TABLE customers (
  customer_id INTEGER NOT NULL,
  name VARCHAR(100) NOT NULL,
  PRIMARY KEY (customer_id)
);
CREATE TABLE orders (
  order_id INTEGER NOT NULL,
  customer_id INTEGER NOT NULL,
  status VARCHAR(20),
  PRIMARY KEY (order_id),
  FOREIGN KEY (customer_id) REFERENCES customers (customer_id)
);
CREATE TABLE audit_log (
  log_id INTEGER NOT NULL,
  note VARCHAR(200),
  PRIMARY KEY (log_id)
);
