# CSCI3308_DataModeling

ModelScope now includes a starter full-stack project with:

- `Express` for the backend API
- `React` with `Vite` for the frontend
- `Docker` and `docker compose` as the primary run path

## Project structure

- `client/` React frontend
- `server/` Express backend
- `docker-compose.yml` runs both services together

## Quick start

1. Install dependencies locally if you want non-Docker development:
   `npm run install:all`
2. Start the full stack with Docker:
   `docker compose up --build`
3. Open:
   - Frontend: `http://localhost:5173`
   - API health route: `http://localhost:5001/api/health`

## Development scripts

- `npm run dev:client`
- `npm run dev:server`
- `npm run build`
