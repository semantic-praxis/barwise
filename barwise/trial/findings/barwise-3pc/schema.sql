CREATE TABLE batch (batch_nr VARCHAR(10) PRIMARY KEY);
CREATE TABLE work_order (
  batch_nr VARCHAR(10) NOT NULL,
  order_quantity INT NOT NULL,
  PRIMARY KEY (batch_nr),
  FOREIGN KEY (batch_nr) REFERENCES batch (batch_nr)
);
