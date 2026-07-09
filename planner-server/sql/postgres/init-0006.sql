-- Add PRIMARY KEY constraints on existing tables
ALTER TABLE users ADD PRIMARY KEY (id);
ALTER TABLE projects ADD PRIMARY KEY (id);
ALTER TABLE tasks ADD PRIMARY KEY (id);
ALTER TABLE notes ADD PRIMARY KEY (id);
