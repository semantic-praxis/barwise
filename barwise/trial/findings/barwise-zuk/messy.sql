-- A messy vendor schema
CREATE TABLE IF NOT EXISTS sales.orders (
  order_id NUMBER(38) NOT NULL,
  customer_id NUMBER(38) NOT NULL,
  status VARCHAR2(20) CHECK (status IN ('NEW','PAID')),
  PRIMARY KEY (order_id),
  FOREIGN KEY (customer_id) REFERENCES sales.customers(customer_id)
);
CREATE TABLE [dbo].[Customers] (
  [CustomerId] INT NOT NULL PRIMARY KEY,
  [Name] NVARCHAR(100)
);
CREATE TABLE `line_items` (
  `id` INT UNSIGNED NOT NULL,
  `order_id` INT NOT NULL,
  `qty` INT DEFAULT 1,
  PRIMARY KEY (`id`, `order_id`)
) ENGINE=InnoDB;
CREATE TABLE plain_tbl (
  id INT PRIMARY KEY,
  note TEXT
)
