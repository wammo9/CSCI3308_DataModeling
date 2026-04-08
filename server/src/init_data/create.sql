-- ModelScope database schema
-- Runs automatically when the Postgres container first starts.

DROP TABLE IF EXISTS pca_runs CASCADE;
DROP TABLE IF EXISTS datasets CASCADE;
DROP TABLE IF EXISTS users CASCADE;

CREATE TABLE users (
    id            SERIAL PRIMARY KEY,
    username      VARCHAR(50)  UNIQUE NOT NULL,
    password_hash CHAR(60)     NOT NULL,
    created_at    TIMESTAMPTZ  DEFAULT NOW()
);

-- Stores metadata and the parsed numeric matrix for each uploaded CSV.
-- raw_data is a JSON array of arrays (rows × quant columns).
CREATE TABLE datasets (
    id                    SERIAL PRIMARY KEY,
    user_id               INTEGER      REFERENCES users(id) ON DELETE CASCADE,
    original_filename     VARCHAR(255) NOT NULL,
    row_count             INTEGER,
    column_count          INTEGER,
    quantitative_columns  TEXT[],
    raw_data              JSONB,
    upload_timestamp      TIMESTAMPTZ  DEFAULT NOW()
);

-- Stores PCA run results so the visualization can be fetched without re-computing.
CREATE TABLE pca_runs (
    id                      SERIAL PRIMARY KEY,
    dataset_id              INTEGER      REFERENCES datasets(id) ON DELETE CASCADE,
    n_components            INTEGER      NOT NULL,
    explained_variance_ratio JSONB,
    transformed_data        JSONB,
    column_names            TEXT[],
    n_samples               INTEGER,
    created_at              TIMESTAMPTZ  DEFAULT NOW()
);
