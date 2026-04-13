# ModelScope

ModelScope is a full-stack data modeling web app for uploading CSV datasets,
checking data quality, running PCA, visualizing results, comparing datasets, and
exporting shareable project reports.

The app uses:

- `React` with `Vite` for the frontend
- `Express` for the backend API
- `PostgreSQL` for users, datasets, and PCA run storage
- `Docker` and `docker compose` as the primary run path

## Project structure

- `client/` React frontend
- `server/` Express backend
- `server/src/init_data/create.sql` database schema
- `docker-compose.yml` runs both services together
- `invalid_pca_dataset.csv` sample invalid CSV for testing validation

## Quick start

1. Start the full stack with Docker:

   `docker compose up --build`

2. Open:

   - Frontend: `http://localhost:5173`
   - API health route: `http://localhost:5001/api/health`

3. Register or log in, then upload a CSV or add a sample dataset.

## Main features

- Upload CSV datasets and automatically detect numeric and categorical columns.
- View dataset previews, quality summaries, warnings, and quantitative analysis.
- Configure PCA before running it:
  - include or exclude numeric columns
  - one-hot encode categorical columns
  - drop missing rows or fill missing values with mean/median
  - scale features
  - remove constant columns
  - remove outliers with z-score or IQR rules
- Validate whether each dataset or PCA configuration is usable and explain why.
- Visualize PCA runs with 2D/3D scatter plots, scree plots, loadings, row details,
  and k-means cluster coloring.
- Compare multiple datasets and PCA runs side-by-side on the Compare page.
- Export dataset reports, PCA reports, transformed PCA CSVs, PNG plots, and
  full project reports.

## Project reports

On the Projects page, click `Generate report` for a dataset. The app downloads a
standalone HTML report that includes:

- dataset summary and data quality results
- key insights and strongest correlations
- summary statistics
- PCA settings and preprocessing summaries
- embedded PCA scatter visuals
- cluster summaries for PCA runs

The generated HTML file can be shared directly or printed to PDF from a browser.

## Testing invalid data

Use `invalid_pca_dataset.csv` to test validation behavior. It intentionally
contains mixed numeric/text values, missing values, categorical fields, and a
constant column so you can see how upload and PCA validation messages behave.

## Development scripts

- `npm run dev:client`
- `npm run dev:server`
- `npm run build`

For local non-Docker development, install workspace dependencies first:

`npm run install:all`

Local development also requires PostgreSQL running on `localhost:5432` with:

- database: `modelscope_db`
- user: `postgres`
- password: `pwd`
