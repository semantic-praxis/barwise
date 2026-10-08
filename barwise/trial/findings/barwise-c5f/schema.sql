CREATE TABLE site (site_id INTEGER NOT NULL, PRIMARY KEY (site_id));
CREATE TABLE network_device (
  network_device_id INTEGER NOT NULL,
  site_id INTEGER NOT NULL,
  PRIMARY KEY (network_device_id)
);
