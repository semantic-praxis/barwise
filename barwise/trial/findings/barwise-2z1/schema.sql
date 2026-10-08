CREATE TABLE meter (meter_id INTEGER PRIMARY KEY);
CREATE TABLE meter_records_reading_value_at_interval_timestamp (
  meter_id INTEGER NOT NULL,
  reading_value DECIMAL(18,2) NOT NULL,
  interval_timestamp VARCHAR(255) NOT NULL,
  PRIMARY KEY (meter_id, interval_timestamp),
  FOREIGN KEY (meter_id) REFERENCES meter (meter_id)
);
