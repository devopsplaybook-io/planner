-- Add PRIMARY KEY constraints only when the historical table was created
-- without one. Fresh schemas already declare them in init-0001..init-0004.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'users'::regclass AND contype = 'p'
    ) THEN
        ALTER TABLE users ADD PRIMARY KEY (id);
    END IF;
END
$$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'projects'::regclass AND contype = 'p'
    ) THEN
        ALTER TABLE projects ADD PRIMARY KEY (id);
    END IF;
END
$$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'tasks'::regclass AND contype = 'p'
    ) THEN
        ALTER TABLE tasks ADD PRIMARY KEY (id);
    END IF;
END
$$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'notes'::regclass AND contype = 'p'
    ) THEN
        ALTER TABLE notes ADD PRIMARY KEY (id);
    END IF;
END
$$;
