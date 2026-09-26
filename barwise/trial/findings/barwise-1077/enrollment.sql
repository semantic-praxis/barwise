CREATE TABLE enrollment (
  student_id INTEGER NOT NULL,
  course_id INTEGER NOT NULL,
  grade CHAR(2),
  PRIMARY KEY (student_id, course_id)
);
