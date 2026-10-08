CREATE TABLE student (student_id INTEGER NOT NULL, PRIMARY KEY (student_id));
CREATE TABLE graduate_student (
  student_id INTEGER NOT NULL,
  thesis_title VARCHAR(200),
  PRIMARY KEY (student_id),
  FOREIGN KEY (student_id) REFERENCES student (student_id)
);
