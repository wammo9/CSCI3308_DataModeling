-- ModelScope database schema
-- Runs automatically when the Postgres container first starts.
-- Keep initialization non-destructive so local data survives container restarts.

CREATE TABLE IF NOT EXISTS users (
    id            SERIAL PRIMARY KEY,
    username      VARCHAR(50)  UNIQUE NOT NULL,
    password_hash CHAR(60)     NOT NULL,
    display_name  TEXT         DEFAULT '',
    email         VARCHAR(255),
    created_at    TIMESTAMPTZ  DEFAULT NOW()
);

-- Stores metadata and the parsed numeric matrix for each uploaded CSV.
-- raw_data is a JSON array of arrays (rows x quant columns).
-- preview_data stores the first 10 rows with ALL original columns for preview.
-- quality_report stores upload-time profile data for the dataset.
CREATE TABLE IF NOT EXISTS datasets (
    id                    SERIAL PRIMARY KEY,
    user_id               INTEGER      REFERENCES users(id) ON DELETE CASCADE,
    original_filename     VARCHAR(255) NOT NULL,
    name                  TEXT,
    notes                 TEXT         DEFAULT '',
    is_favorite           BOOLEAN      DEFAULT FALSE,
    tags                  TEXT[]       DEFAULT ARRAY[]::TEXT[],
    saved_presets         JSONB        DEFAULT '[]'::jsonb,
    version_group_id      INTEGER,
    previous_version_id   INTEGER,
    version_number        INTEGER      DEFAULT 1,
    row_count             INTEGER,
    column_count          INTEGER,
    quantitative_columns  TEXT[],
    categorical_columns   TEXT[],
    all_columns           TEXT[],
    raw_data              JSONB,
    preview_data          JSONB,
    row_metadata          JSONB,
    quality_report        JSONB,
    all_records           JSONB,
    upload_timestamp      TIMESTAMPTZ  DEFAULT NOW()
);

-- Stores PCA run results so the visualization can be fetched without re-computing.
-- all_explained_variance stores variance for ALL components (for scree plot).
CREATE TABLE IF NOT EXISTS pca_runs (
    id                       SERIAL PRIMARY KEY,
    dataset_id               INTEGER      REFERENCES datasets(id) ON DELETE CASCADE,
    notes                    TEXT         DEFAULT '',
    is_pinned                BOOLEAN      DEFAULT FALSE,
    n_components             INTEGER      NOT NULL,
    explained_variance_ratio JSONB,
    all_explained_variance   JSONB,
    loadings                 JSONB,
    transformed_data         JSONB,
    column_names             TEXT[],
    n_samples                INTEGER,
    preprocessing_options    JSONB,
    preprocessing_report     JSONB,
    preprocessing_diff       JSONB,
    row_indexes              JSONB,
    created_at               TIMESTAMPTZ  DEFAULT NOW()
);
